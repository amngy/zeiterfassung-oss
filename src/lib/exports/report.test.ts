// Export-layer tests. These cover the parts of the payroll/Zoll documents that
// are easy to get subtly wrong and impossible to spot in a rendered file:
//  - the raw-entry window is a Europe/Berlin month, not a UTC month
//  - the "Summe" row reconciles with the columns above it
//  - a forgotten clock-out is visible instead of looking like a day off
//  - a long note cannot run off the PDF page
//
// `@/lib/db` is mocked so nothing here needs a database or a generated client.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { berlin } from "@/lib/time/test-helpers";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { timeEntry: { findMany } } }));

import {
  dayHours,
  dayNote,
  displayHours,
  displayTotals,
  loadRawEntries,
  OPEN_ENTRY_NOTE,
  overtimeLines,
  type MonthlyReport,
  type ReportDayRow,
} from "./report";
import { monthlyReportCsv, csvBytes } from "./csv";
import { monthlyReportPdf, wrapText } from "./pdf";

const HOUR_MS = 3_600_000;

// ── fixtures ────────────────────────────────────────────────────────────────

interface FakeEntry {
  start: Date;
  end: Date | null;
  type: "WORK" | "BREAK";
  source: "CLOCK" | "MANUAL";
  status: "ACTIVE" | "SUPERSEDED";
  note: string | null;
  user: { name: string };
}

function entry(start: Date, end: Date | null, name: string): FakeEntry {
  return {
    start,
    end,
    type: "WORK",
    source: "CLOCK",
    status: "ACTIVE",
    note: null,
    user: { name },
  };
}

/** Stand in for prisma.timeEntry.findMany: apply the `start` window it is given. */
function serve(rows: FakeEntry[]): void {
  findMany.mockImplementation(async (args: { where: { start: { gte: Date; lt: Date } } }) => {
    const { gte, lt } = args.where.start;
    return rows
      .filter((r) => r.start.getTime() >= gte.getTime() && r.start.getTime() < lt.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  });
}

function day(over: Partial<ReportDayRow> & { dayKey: string }): ReportDayRow {
  return {
    span: "—",
    workedMs: 0,
    breakMs: 0,
    autoBreakMs: 0,
    unfinishedBreakMs: 0,
    expectedMs: 0,
    absenceMs: 0,
    balanceMs: 0,
    note: "",
    flagged: false,
    hasOpenAnomaly: false,
    ...over,
  };
}

function report(days: ReportDayRow[], over: Partial<MonthlyReport> = {}): MonthlyReport {
  const workedMs = days.reduce((a, d) => a + d.workedMs, 0);
  const expectedMs = days.reduce((a, d) => a + d.expectedMs, 0);
  const absenceMs = days.reduce((a, d) => a + d.absenceMs, 0);
  return {
    user: {
      id: "u1",
      name: "Anna Muster",
      email: "anna@example.de",
      role: "EMPLOYEE",
      isMinijob: false,
      region: "NW",
    },
    monthKey: "2026-07",
    monthLabel: "Juli 2026",
    range: { from: "2026-07-01", to: "2026-07-31" },
    days,
    totals: {
      workedMs,
      breakMs: days.reduce((a, d) => a + d.breakMs, 0),
      expectedMs,
      absenceMs,
      balanceMs: workedMs + absenceMs - expectedMs,
      balanceToDateMs: null,
    },
    violations: [],
    recordingIssues: [],
    overtime: null,
    absences: [],
    generatedAtKey: "2026-08-01",
    companyName: "Muster GmbH",
    hasOpenAnomaly: days.some((d) => d.hasOpenAnomaly),
    hasAutoBreak: days.some((d) => d.autoBreakMs > 0 || d.unfinishedBreakMs > 0),
    ...over,
  };
}

/** Read a "Summe"-style CSV number back as a float ("'-8,00" → -8). */
function num(cell: string): number {
  return Number(cell.replace(/^'/, "").replace(",", "."));
}

function cells(line: string): string[] {
  return line.split(";");
}

// ── the raw-entries window is a Berlin month ────────────────────────────────

describe("loadRawEntries — month window", () => {
  // Braces matter: an arrow returning the mock would be taken for a cleanup hook.
  beforeEach(() => {
    findMany.mockReset();
  });

  it("includes a punch just after midnight Berlin on the first of the month", async () => {
    serve([entry(berlin("2026-07-01", "00:30"), berlin("2026-07-01", "04:00"), "Anna")]);

    const rows = await loadRawEntries("2026-07-01", "2026-07-31");

    expect(rows).toHaveLength(1);
    expect(rows[0]!.startKey).toBe("2026-07-01");
    expect(rows[0]!.startClock).toBe("00:30");
  });

  it("excludes a punch just after midnight Berlin on the first of the NEXT month", async () => {
    serve([entry(berlin("2026-08-01", "00:30"), berlin("2026-08-01", "04:00"), "Anna")]);

    const rows = await loadRawEntries("2026-07-01", "2026-07-31");

    expect(rows).toEqual([]);
  });

  it("excludes the last punch of the previous month and keeps the last of this one", async () => {
    serve([
      entry(berlin("2026-06-30", "23:30"), berlin("2026-07-01", "02:00"), "Anna"),
      entry(berlin("2026-07-31", "23:30"), berlin("2026-08-01", "02:00"), "Anna"),
    ]);

    const rows = await loadRawEntries("2026-07-01", "2026-07-31");

    expect(rows.map((r) => r.startKey)).toEqual(["2026-07-31"]);
  });

  it("queries the Berlin day boundaries, not UTC midnight (summer: 22:00Z)", async () => {
    serve([]);
    await loadRawEntries("2026-07-01", "2026-07-31");

    const where = findMany.mock.calls[0]![0].where;
    expect(where.start.gte.toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(where.start.lt.toISOString()).toBe("2026-07-31T22:00:00.000Z");
  });

  it("uses the right offset in winter too (CET: 23:00Z)", async () => {
    serve([]);
    await loadRawEntries("2026-01-01", "2026-01-31");

    const where = findMany.mock.calls[0]![0].where;
    expect(where.start.gte.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(where.start.lt.toISOString()).toBe("2026-01-31T23:00:00.000Z");
  });
});

// ── the Summe row reconciles ────────────────────────────────────────────────

describe("displayTotals — the Summe row adds up", () => {
  it("equals the sum of the PRINTED day values, not the raw sum", () => {
    // 7.496 h prints as 7,50 — twenty of them read as 150,00 in the column while
    // the raw sum is 149,92. The printed total has to match the printed column.
    const days = Array.from({ length: 20 }, (_, i) =>
      day({ dayKey: `2026-07-${String(i + 1).padStart(2, "0")}`, workedMs: 7.496 * HOUR_MS }),
    );
    const t = displayTotals(report(days));

    expect(displayHours(days[0]!.workedMs)).toBe(7.5);
    expect(t.workedHours).toBe(150);
    expect(t.workedHours).toBe(days.reduce((a, d) => a + dayHours(d).worked, 0));
    // …and the raw millisecond sum would have printed something else.
    expect(displayHours(days.reduce((a, d) => a + d.workedMs, 0))).toBe(149.92);
  });

  it("reports Saldo = Ist − Soll and the sum of the Saldo column", () => {
    const days = [
      day({ dayKey: "2026-07-01", workedMs: 8.5 * HOUR_MS, expectedMs: 8 * HOUR_MS }),
      day({ dayKey: "2026-07-02", workedMs: 6.25 * HOUR_MS, expectedMs: 8 * HOUR_MS }),
      day({ dayKey: "2026-07-03", workedMs: 0, expectedMs: 8 * HOUR_MS }),
    ];
    const t = displayTotals(report(days));

    expect(t.balanceHours).toBe(t.workedHours - t.expectedHours);
    expect(t.balanceHours).toBe(days.reduce((a, d) => a + dayHours(d).balance, 0));
    expect(t.balanceHours).toBe(-9.25);
  });

  it("keeps the running to-date balance as its own figure mid-month", () => {
    // Half a month worked, the rest not owed yet: the columns say −80, the
    // running balance says ±0. Both are printed, each with its own label.
    const days = Array.from({ length: 20 }, (_, i) =>
      day({
        dayKey: `2026-07-${String(i + 1).padStart(2, "0")}`,
        workedMs: i < 10 ? 8 * HOUR_MS : 0,
        expectedMs: 8 * HOUR_MS,
      }),
    );
    const r = report(days, {
      generatedAtKey: "2026-07-10",
      totals: {
        workedMs: 80 * HOUR_MS,
        breakMs: 0,
        expectedMs: 160 * HOUR_MS,
        absenceMs: 0,
        balanceMs: -80 * HOUR_MS,
        balanceToDateMs: 0, // worked-to-date − expected-to-date
      },
    });
    const t = displayTotals(r);

    expect(t.workedHours).toBe(80);
    expect(t.expectedHours).toBe(160);
    expect(t.balanceHours).toBe(-80); // = Ist − Soll, reconciles with the column
    expect(t.balanceToDateHours).toBe(0); // days 1–10 only
  });

  it("omits the to-date figure for a closed past month", () => {
    const days = [day({ dayKey: "2026-07-01", workedMs: 8 * HOUR_MS, expectedMs: 8 * HOUR_MS })];
    expect(displayTotals(report(days)).balanceToDateHours).toBeNull();
  });
});

// ── a forgotten clock-out must be visible ───────────────────────────────────

describe("overtimeLines — the Arbeitszeitkonto block adds up", () => {
  const booking = (dayKey: string, minutes: number, extra: Partial<{ kind: "PAYOUT" | "ADJUSTMENT"; reversesId: string }> = {}) => ({
    id: dayKey,
    kind: extra.kind ?? ("PAYOUT" as const),
    dayKey,
    minutes,
    note: "Abrechnung",
    createdAt: new Date(),
    createdByName: null,
    reversesId: extra.reversesId ?? null,
    reversed: false,
  });

  it("is absent without an account", () => {
    expect(overtimeLines(report([day({ dayKey: "2026-07-01" })]))).toBeNull();
  });

  it("prints Übertrag + Saldo + Buchungen = Stand for a closed month", () => {
    const days = [
      day({ dayKey: "2026-07-01", workedMs: 9.5 * HOUR_MS, expectedMs: 8 * HOUR_MS }),
      day({ dayKey: "2026-07-02", workedMs: 8 * HOUR_MS, expectedMs: 8 * HOUR_MS }),
    ];
    const lines = overtimeLines(
      report(days, {
        overtime: {
          carryInMs: 12.25 * HOUR_MS,
          bookings: [booking("2026-07-15", -600), booking("2026-07-20", 90, { kind: "ADJUSTMENT", reversesId: "x" })],
          bookedMs: -510 * 60_000,
        },
      }),
    )!;
    expect(lines.carryInHours).toBe(12.25);
    expect(lines.monthHours).toBe(1.5);
    expect(lines.bookings.map((b) => [b.label, b.hours])).toEqual([
      ["Auszahlung", -10],
      ["Storno: Korrektur", 1.5],
    ]);
    expect(lines.endHours).toBe(5.25);
    expect(lines.endLabel).toBe("Stand Fr, 31.07.2026");
  });

  it("uses the running balance while the month is open, and says so", () => {
    const days = [day({ dayKey: "2026-07-01", workedMs: 10 * HOUR_MS, expectedMs: 8 * HOUR_MS })];
    const lines = overtimeLines(
      report(days, {
        generatedAtKey: "2026-07-01",
        totals: { workedMs: 10 * HOUR_MS, breakMs: 0, expectedMs: 8 * HOUR_MS, absenceMs: 0, balanceMs: 2 * HOUR_MS, balanceToDateMs: 2 * HOUR_MS },
        overtime: { carryInMs: 0, bookings: [], bookedMs: 0 },
      }),
    )!;
    expect(lines.monthHours).toBe(2);
    expect(lines.endHours).toBe(2);
    expect(lines.endLabel).toBe("Stand Mi, 01.07.2026");
  });

  it("appears in the CSV", () => {
    const csv = monthlyReportCsv(
      report([day({ dayKey: "2026-07-01", workedMs: 8 * HOUR_MS, expectedMs: 8 * HOUR_MS })], {
        overtime: { carryInMs: 3 * HOUR_MS, bookings: [], bookedMs: 0 },
      }),
    );
    expect(csv).toContain("Arbeitszeitkonto;;Stunden");
    expect(csv).toContain("Übertrag;;3,00");
    expect(csv).toContain("Stand Fr, 31.07.2026;;3,00");
  });
});

describe("open entries (forgotten clock-out)", () => {
  it("marks the affected day, so it differs from a day not worked", () => {
    const notWorked = day({ dayKey: "2026-07-06", expectedMs: 8 * HOUR_MS, balanceMs: -8 * HOUR_MS });
    const open = day({ ...notWorked, dayKey: "2026-07-07", hasOpenAnomaly: true });

    expect(dayNote(notWorked, "ArbZG-Hinweis")).toBe("");
    expect(dayNote(open, "ArbZG-Hinweis")).toBe(OPEN_ENTRY_NOTE);
  });

  it("keeps holiday and ArbZG markers alongside it", () => {
    const d = day({ dayKey: "2026-07-07", note: "Tag der Arbeit", hasOpenAnomaly: true, flagged: true });
    expect(dayNote(d, "ArbZG")).toBe(`Tag der Arbeit · ${OPEN_ENTRY_NOTE} · ArbZG`);
  });

  it("puts a warning row and a day marker in the CSV", () => {
    const days = [
      day({ dayKey: "2026-07-06", expectedMs: 8 * HOUR_MS }),
      day({ dayKey: "2026-07-07", expectedMs: 8 * HOUR_MS, hasOpenAnomaly: true }),
    ];
    const csv = monthlyReportCsv(report(days));
    const lines = csv.split("\r\n");

    expect(lines.some((l) => l.startsWith("WARNUNG;"))).toBe(true);
    const openRow = lines.find((l) => l.includes("07.07.2026"))!;
    const quietRow = lines.find((l) => l.includes("06.07.2026"))!;
    expect(openRow).toContain(OPEN_ENTRY_NOTE);
    expect(quietRow).not.toContain(OPEN_ENTRY_NOTE);
    // …and the two rows are otherwise identical, which is exactly the bug.
    expect(cells(openRow).slice(1, 6)).toEqual(cells(quietRow).slice(1, 6));
  });

  it("adds nothing when no day is affected", () => {
    const csv = monthlyReportCsv(report([day({ dayKey: "2026-07-06", workedMs: 8 * HOUR_MS })]));
    expect(csv).not.toContain("WARNUNG");
    expect(csv).not.toContain(OPEN_ENTRY_NOTE);
  });
});

// ── CSV conventions and totals ──────────────────────────────────────────────

describe("monthlyReportCsv", () => {
  const days = [
    day({ dayKey: "2026-07-01", span: "08:00 – 16:30", workedMs: 7.496 * HOUR_MS, expectedMs: 8 * HOUR_MS }),
    day({ dayKey: "2026-07-02", span: "08:00 – 16:30", workedMs: 7.496 * HOUR_MS, expectedMs: 8 * HOUR_MS }),
  ];

  it("keeps the German conventions (BOM, CRLF, semicolons, decimal comma)", () => {
    const text = monthlyReportCsv(report(days));
    expect(text).toContain("\r\n");
    expect(text).not.toMatch(/[^\r]\n/);
    expect(text).toContain(";7,50;");

    const bytes = csvBytes(text);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("prints a Summe row that equals the column above it", () => {
    const lines = monthlyReportCsv(report(days)).split("\r\n");
    const dayRows = lines.filter((l) => /^\w\w, \d\d\.\d\d\.\d{4};/.test(l));
    const summe = cells(lines.find((l) => l.startsWith("Summe;"))!);

    for (const col of [2, 3, 4, 5, 6]) {
      const column = dayRows.reduce((a, l) => a + num(cells(l)[col]!), 0);
      expect(num(summe[col]!)).toBeCloseTo(column, 10);
    }
    // Saldo = Ist + Abwesenheit − Soll, in the values as printed.
    expect(num(summe[6]!)).toBeCloseTo(
      num(summe[2]!) + num(summe[4]!) - num(summe[5]!),
      10,
    );
  });

  it("prints a leave day as Ist 0 / Abw 6 / Soll 6 / Saldo 0", () => {
    // Without the Abwesenheit column the row read Ist 0 / Soll 6 / Saldo 0 and
    // the document never said where the six hours went.
    const leave = day({
      dayKey: "2026-07-20",
      workedMs: 0,
      expectedMs: 6 * HOUR_MS,
      absenceMs: 6 * HOUR_MS,
      note: "Urlaub",
    });
    const line = monthlyReportCsv(report([leave]))
      .split("\r\n")
      .find((l) => /^\w\w, 20\.07\.2026;/.test(l))!;
    const c = cells(line);
    expect(num(c[2]!)).toBe(0); // Ist
    expect(num(c[4]!)).toBe(6); // Abwesenheit
    expect(num(c[5]!)).toBe(6); // Soll
    expect(num(c[6]!)).toBe(0); // Saldo = Ist + Abw − Soll
    expect(c[7]).toContain("Urlaub");
  });

  it("labels the running balance separately while the month is open", () => {
    const r = report(days, {
      generatedAtKey: "2026-07-01",
      totals: {
        workedMs: 7.496 * HOUR_MS,
        breakMs: 0,
        expectedMs: 16 * HOUR_MS,
        absenceMs: 0,
        balanceMs: -8.504 * HOUR_MS,
        balanceToDateMs: -0.504 * HOUR_MS,
      },
    });
    const lines = monthlyReportCsv(r).split("\r\n");
    const toDate = lines.find((l) => l.startsWith("Saldo (Stand heute)"));

    expect(toDate).toBeDefined();
    expect(num(cells(toDate!)[6]!)).toBeCloseTo(-0.5, 10); // day 1 only
    expect(num(cells(lines.find((l) => l.startsWith("Summe;"))!)[6]!)).toBeCloseTo(-1, 10);
  });

  it("still neutralises formula injection in free text", () => {
    const r = report([day({ dayKey: "2026-07-01", note: "=HYPERLINK(\"http://evil\")" })]);
    expect(monthlyReportCsv(r)).toContain("'=HYPERLINK");
  });
});

// ── PDF: notes must not run off the page ────────────────────────────────────

describe("pdf notes", () => {
  it("wraps a long note into lines that fit the column", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const width = 165;
    const lines = wrapText(
      `Christi Himmelfahrt · Urlaub (offen) · ${OPEN_ENTRY_NOTE} · ArbZG`,
      font,
      9,
      width,
      3,
    );

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 9)).toBeLessThanOrEqual(width);
  });

  it("ellipsises what does not fit in the line budget", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrapText("Wort ".repeat(80), font, 9, 165, 2);

    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 9)).toBeLessThanOrEqual(165);
  });

  it("breaks a single word that is wider than the column", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrapText("Donaudampfschiffahrtsgesellschaftskapitaenspatent", font, 9, 60, 4);

    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 9)).toBeLessThanOrEqual(60);
  });

  it("renders a month with an open entry and a very long note", async () => {
    const days = [
      day({
        dayKey: "2026-07-06",
        span: "08:00 – 16:30",
        workedMs: 8 * HOUR_MS,
        expectedMs: 8 * HOUR_MS,
        note: "Betriebsausflug mit anschließender Jahresversammlung und einer sehr langen Anmerkung",
        flagged: true,
      }),
      day({ dayKey: "2026-07-07", expectedMs: 8 * HOUR_MS, hasOpenAnomaly: true }),
    ];
    const bytes = await monthlyReportPdf(report(days));
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
