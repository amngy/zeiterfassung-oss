import { describe, expect, it } from "vitest";
import { absenceDayMap, type AbsenceSpan } from "./absence";
import { summarizeDay, summarizePeriod } from "./day";
import { berlin, brk, fullTimeSchedule, work } from "./test-helpers";
import type { AbsenceEffect } from "./types";

const H = 3_600_000;
const MIN = 60_000;
const anna = fullTimeSchedule();
/** Six contracted hours a day — the part-time case the exemption exists for. */
const nicole = fullTimeSchedule({
  mon: 6, tue: 6, wed: 6, thu: 6, fri: 6, sat: 0, sun: 0,
});
const AFTER = berlin("2026-09-01", "00:00");

function vacation(fromKey: string, toKey: string, half: Partial<AbsenceSpan> = {}): AbsenceSpan {
  return { kind: "VACATION", fromKey, toKey, ...half };
}
function sick(fromKey: string, toKey: string): AbsenceSpan {
  return { kind: "SICK", fromKey, toKey };
}
function full(kind: AbsenceEffect["kind"] = "VACATION"): AbsenceEffect {
  return { kind, fraction: 1 };
}

describe("absenceDayMap — spells to per-day effects", () => {
  it("covers every calendar day of a spell, weekends included", () => {
    const map = absenceDayMap([vacation("2026-07-20", "2026-07-23")]);
    expect([...map.keys()]).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
    ]);
    expect(map.get("2026-07-22")).toEqual(full());
  });

  it("values a half-day edge at 0.5 and the days between it at 1", () => {
    const map = absenceDayMap([
      vacation("2026-07-20", "2026-07-22", { halfDayStart: true, halfDayEnd: true }),
    ]);
    expect(map.get("2026-07-20")?.fraction).toBe(0.5);
    expect(map.get("2026-07-21")?.fraction).toBe(1);
    expect(map.get("2026-07-22")?.fraction).toBe(0.5);
  });

  it("counts a one-day spell with a half flag as half a day, not a quarter", () => {
    const map = absenceDayMap([
      vacation("2026-07-20", "2026-07-20", { halfDayStart: true, halfDayEnd: true }),
    ]);
    expect(map.get("2026-07-20")?.fraction).toBe(0.5);
  });

  it("lets sickness win over an overlapping holiday, whatever the row order", () => {
    const overlap = "2026-08-04";
    const sickFirst = absenceDayMap([sick("2026-08-03", "2026-08-21"), vacation("2026-07-20", "2026-08-06")]);
    const vacFirst = absenceDayMap([vacation("2026-07-20", "2026-08-06"), sick("2026-08-03", "2026-08-21")]);
    expect(sickFirst.get(overlap)).toEqual(full("SICK"));
    expect(vacFirst.get(overlap)).toEqual(full("SICK"));
  });

  it("clamps the expansion to the range being displayed", () => {
    const map = absenceDayMap([vacation("2026-01-01", "2026-12-31")], "2026-07-01", "2026-07-03");
    expect([...map.keys()]).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  });

  it("drops a spell that falls entirely outside the clamped range", () => {
    const map = absenceDayMap([vacation("2026-01-05", "2026-01-09")], "2026-07-01", "2026-07-31");
    expect(map.size).toBe(0);
  });
});

describe("summarizeDay — an approved absence credits the day", () => {
  // The reported bug: an approved holiday left the day showing a full day of
  // undertime, because nothing told the calc layer the person was on leave.
  it("brings a whole holiday day to zero instead of minus a working day", () => {
    const absences = absenceDayMap([vacation("2026-07-20", "2026-08-06")]);
    const d = summarizeDay("2026-07-21", [], nicole, { asOf: AFTER, absences });
    expect(d.workedMs).toBe(0);
    expect(d.expectedMs).toBe(6 * H);
    expect(d.absenceMs).toBe(6 * H);
    expect(d.balanceMs).toBe(0);
    expect(d.absence).toEqual(full());
  });

  it("leaves the Soll standing — the hours are credited, not written off", () => {
    const absences = absenceDayMap([sick("2026-08-03", "2026-08-21")]);
    const d = summarizeDay("2026-08-04", [], nicole, { asOf: AFTER, absences });
    expect(d.expectedMs).toBe(6 * H);
    expect(d.absence?.kind).toBe("SICK");
  });

  it("tops up only the hours missed when somebody was sent home ill", () => {
    const absences = absenceDayMap([sick("2026-08-04", "2026-08-04")]);
    const entries = [work(berlin("2026-08-04", "08:00"), berlin("2026-08-04", "10:00"))];
    const d = summarizeDay("2026-08-04", entries, nicole, { asOf: AFTER, absences });
    expect(d.workedMs).toBe(2 * H);
    expect(d.absenceMs).toBe(4 * H);
    expect(d.balanceMs).toBe(0);
  });

  it("still shows overtime for work done on a day off, never a double credit", () => {
    const absences = absenceDayMap([vacation("2026-08-04", "2026-08-04")]);
    const entries = [work(berlin("2026-08-04", "08:00"), berlin("2026-08-04", "16:00"))];
    const d = summarizeDay("2026-08-04", entries, nicole, { asOf: AFTER, absences });
    expect(d.workedMs).toBe(8 * H);
    expect(d.absenceMs).toBe(0);
    expect(d.balanceMs).toBe(2 * H);
  });

  it("credits only half the Soll on a half-day holiday", () => {
    const absences = absenceDayMap([
      vacation("2026-08-03", "2026-08-04", { halfDayEnd: true }),
    ]);
    const d = summarizeDay("2026-08-04", [], nicole, { asOf: AFTER, absences });
    expect(d.absenceMs).toBe(3 * H);
    expect(d.balanceMs).toBe(-3 * H);
  });

  it("credits nothing on a weekend or a public holiday — there is no Soll", () => {
    const absences = absenceDayMap([vacation("2026-07-20", "2026-08-06")]);
    const weekend = summarizeDay("2026-07-25", [], nicole, { asOf: AFTER, absences });
    expect(weekend.expectedMs).toBe(0);
    expect(weekend.absenceMs).toBe(0);
    expect(weekend.balanceMs).toBe(0);

    const holidays = new Map([["2026-07-21", "FULL" as const]]);
    const feiertag = summarizeDay("2026-07-21", [], nicole, { asOf: AFTER, absences, holidays });
    expect(feiertag.expectedMs).toBe(0);
    expect(feiertag.absenceMs).toBe(0);
    expect(feiertag.balanceMs).toBe(0);
  });

  it("changes nothing at all when no absence map is supplied", () => {
    const d = summarizeDay("2026-07-21", [], nicole, { asOf: AFTER });
    expect(d.absenceMs).toBe(0);
    expect(d.absence).toBeNull();
    expect(d.balanceMs).toBe(-6 * H);
  });
});

describe("summarizePeriod — absence credit in the running balance", () => {
  it("a full week of leave comes out level, with the week's Soll intact", () => {
    const absences = absenceDayMap([vacation("2026-07-20", "2026-07-24")]);
    const p = summarizePeriod("2026-07-20", "2026-07-26", [], nicole, {
      asOf: AFTER,
      absences,
    });
    expect(p.expectedMs).toBe(30 * H);
    expect(p.absenceMs).toBe(30 * H);
    expect(p.workedMs).toBe(0);
    expect(p.balanceMs).toBe(0);
  });

  it("excludes future absence days from the balance, exactly like future Soll", () => {
    // "Now" is mid-week: Wednesday's leave is credited, Thursday's is not yet.
    const asOf = berlin("2026-07-22", "18:00");
    const absences = absenceDayMap([vacation("2026-07-20", "2026-07-24")]);
    const p = summarizePeriod("2026-07-20", "2026-07-24", [], nicole, { asOf, absences });
    expect(p.expectedMs).toBe(30 * H);
    expect(p.expectedToDateMs).toBe(18 * H);
    expect(p.absenceMs).toBe(30 * H);
    expect(p.balanceMs).toBe(0);
  });

  it("keeps a genuinely short day short, absence or not", () => {
    const absences = absenceDayMap([vacation("2026-07-20", "2026-07-21")]);
    const entries = [work(berlin("2026-07-22", "09:00"), berlin("2026-07-22", "13:00"))];
    const p = summarizePeriod("2026-07-20", "2026-07-22", entries, nicole, {
      asOf: AFTER,
      absences,
    });
    expect(p.absenceMs).toBe(12 * H);
    expect(p.workedMs).toBe(4 * H);
    expect(p.balanceMs).toBe(-2 * H);
  });
});

describe("Pausenautomatik — the per-person exemption", () => {
  const policy = {
    enabled: true,
    fixedMinutes: 30,
    unfinishedBreakMinutes: 30,
    rules: {
      break1AfterHours: 6,
      break1Minutes: 30,
      break2AfterHours: 9,
      break2Minutes: 45,
    },
  };

  it("deducts the statutory break from a six-hour contract that ran over", () => {
    const entries = [work(berlin("2026-07-20", "09:00"), berlin("2026-07-20", "16:00"))];
    const d = summarizeDay("2026-07-20", entries, nicole, { asOf: AFTER, autoBreak: policy });
    expect(d.autoBreakMs).toBe(30 * MIN);
    expect(d.workedMs).toBe(6 * H + 30 * MIN);
  });

  it("books nothing for an exempt person on the same day", () => {
    const entries = [work(berlin("2026-07-20", "09:00"), berlin("2026-07-20", "16:00"))];
    const d = summarizeDay("2026-07-20", entries, nicole, {
      asOf: AFTER,
      autoBreak: { ...policy, deductMissingBreak: false },
    });
    expect(d.autoBreakMs).toBe(0);
    expect(d.workedMs).toBe(7 * H);
    expect(d.balanceMs).toBe(1 * H);
  });

  it("still settles a break that was started and never ended", () => {
    // The exemption is about a break nobody recorded — not about discarding one
    // that demonstrably happened and was only left open.
    const entries = [
      work(berlin("2026-07-20", "09:00"), berlin("2026-07-20", "16:00")),
      brk(berlin("2026-07-20", "12:00"), null, "open-break"),
    ];
    const d = summarizeDay("2026-07-20", entries, nicole, {
      asOf: AFTER,
      autoBreak: { ...policy, deductMissingBreak: false },
    });
    expect(d.unfinishedBreakMs).toBe(30 * MIN);
    expect(d.autoBreakMs).toBe(0);
    expect(d.workedMs).toBe(6 * H + 30 * MIN);
  });

  it("does not touch a full-timer's recorded break either way", () => {
    const entries = [
      work(berlin("2026-07-20", "08:00"), berlin("2026-07-20", "17:00")),
      brk(berlin("2026-07-20", "12:00"), berlin("2026-07-20", "12:45")),
    ];
    const exempt = summarizeDay("2026-07-20", entries, anna, {
      asOf: AFTER,
      autoBreak: { ...policy, deductMissingBreak: false },
    });
    const normal = summarizeDay("2026-07-20", entries, anna, { asOf: AFTER, autoBreak: policy });
    expect(exempt.workedMs).toBe(normal.workedMs);
    expect(exempt.autoBreakMs).toBe(0);
    expect(normal.autoBreakMs).toBe(0);
  });
});
