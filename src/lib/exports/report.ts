// Builds the data for a payroll-ready monthly report for one employee. Both the
// CSV and the PDF exporters consume this single shape, so the two never diverge.
// Reuses the same timesheet calc the employee sees (@/lib/timesheet).

import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getTimesheet } from "@/lib/timesheet";
import { getHolidaysInRange, resolveRegion } from "@/lib/holidays";
import {
  berlinDayKey,
  berlinDayRange,
  formatClock,
  formatMonth,
  monthRangeOf,
  type DaySummary,
  type Violation,
} from "@/lib/time";
import type { RawEntryRow } from "./csv";

const HOUR_MS = 3_600_000;

export interface ReportDayRow {
  dayKey: string;
  span: string; // "08:00 – 16:30" or "—"
  workedMs: number;
  breakMs: number;
  /** Part of `breakMs` the Pausenautomatik booked (no/too little break recorded). */
  autoBreakMs: number;
  /** Part of `breakMs` from a break that was started and never ended. */
  unfinishedBreakMs: number;
  expectedMs: number;
  /** Time credited because the day was covered by approved leave or sickness. */
  absenceMs: number;
  balanceMs: number;
  note: string; // holiday name / absence / status, for the rightmost column
  flagged: boolean; // has an ArbZG violation
  /** A forgotten clock-out on this day: time was recorded but cannot be measured. */
  hasOpenAnomaly: boolean;
}

export interface ReportTotals {
  workedMs: number;
  breakMs: number;
  expectedMs: number;
  /** Credited leave/sickness across the period. */
  absenceMs: number;
  /**
   * Ist + Abwesenheit − Soll over the WHOLE period, so the total row reconciles
   * with its own columns and with the sum of the daily Saldo column.
   */
  balanceMs: number;
  /**
   * The running balance as of today (worked − expected counting only days up to
   * today). Only set when the period actually contains today — for a closed past
   * month it is identical to `balanceMs` and is therefore reported as null, so
   * "Saldo" never silently means two different things.
   */
  balanceToDateMs: number | null;
}

export interface MonthlyReport {
  user: { id: string; name: string; email: string; role: string; isMinijob: boolean; region: string };
  monthKey: string; // "YYYY-MM"
  monthLabel: string; // "Juni 2026"
  range: { from: string; to: string };
  days: ReportDayRow[];
  totals: ReportTotals;
  violations: Violation[];
  absences: { type: "VACATION" | "SICK"; from: string; to: string; days: number; note: string | null }[];
  generatedAtKey: string;
  companyName: string;
  /** The period contains an unresolved open entry (forgotten clock-out). */
  hasOpenAnomaly: boolean;
  /** The Pausenautomatik contributed break time somewhere in the period. */
  hasAutoBreak: boolean;
}

/** Marker put in a day's note column when that day has a forgotten clock-out. */
export const OPEN_ENTRY_NOTE = "offener Eintrag — nicht abgeschlossen";

/** Marker for a day whose break was (partly) booked by the Pausenautomatik. */
export const AUTO_BREAK_NOTE = "Pause automatisch angesetzt";

/**
 * Document-level note whenever the month contains an automatically booked break.
 * A payroll figure that includes time nobody clocked has to say so on the
 * document itself — the reader cannot be expected to infer it from a column.
 */
export const AUTO_BREAK_WARNING =
  "Hinweis: In diesem Monat wurde an mindestens einem Tag eine Pause automatisch " +
  "angesetzt, weil keine (oder eine nie beendete) Pause erfasst war. Die betroffenen Tage " +
  "sind in der Spalte „Hinweis“ markiert. Die Pausenautomatik ersetzt keine Korrektur — " +
  "bitte die tatsächliche Pausenzeit nachtragen und den Nachweis neu erzeugen.";

/** Document-level warning shown when any day in the period is affected. */
export const OPEN_ENTRY_WARNING =
  "Achtung: In diesem Monat gibt es mindestens einen offenen Eintrag (vermutlich vergessenes " +
  "Ausstempeln). Die Arbeitszeit der betroffenen Tage ist NICHT in Ist und Saldo enthalten — " +
  "bitte über eine Korrektur richtigstellen und den Nachweis neu erzeugen.";

/**
 * The text of a day's "Hinweis" column: holiday/absence, the open-entry marker
 * and the ArbZG marker, joined. Shared so CSV and PDF can never disagree about
 * which days carry a note; only the ArbZG label differs (the PDF column is
 * narrow, so it uses the short form).
 */
export function dayNote(day: ReportDayRow, arbzgLabel: string): string {
  return [
    day.note,
    day.hasOpenAnomaly ? OPEN_ENTRY_NOTE : "",
    hasAutoBreak(day) ? AUTO_BREAK_NOTE : "",
    day.flagged ? arbzgLabel : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** True when any part of this day's break was booked rather than clocked. */
export function hasAutoBreak(day: ReportDayRow): boolean {
  return day.autoBreakMs > 0 || day.unfinishedBreakMs > 0;
}

/** Round to the two decimals the exports print (matching `toFixed(2)` exactly). */
function round2(hours: number): number {
  return Number(hours.toFixed(2));
}

/**
 * Milliseconds as the decimal hours the exports actually PRINT. Rounding once,
 * here, is what lets a printed total equal the sum of a printed column: totals
 * are built from these values, never from the raw millisecond sum.
 */
export function displayHours(ms: number): number {
  return round2(ms / HOUR_MS);
}

/** A day row's five numeric columns, in printed decimal hours. */
export function dayHours(day: ReportDayRow): {
  worked: number;
  breakTime: number;
  absence: number;
  expected: number;
  balance: number;
} {
  const worked = displayHours(day.workedMs);
  const expected = displayHours(day.expectedMs);
  const absence = displayHours(day.absenceMs);
  return {
    worked,
    breakTime: displayHours(day.breakMs),
    absence,
    expected,
    // Derived from the printed columns (Saldo = Ist + Abwesenheit − Soll), so a
    // reader checking the row with a calculator always gets the printed value.
    balance: round2(worked + absence - expected),
  };
}

export interface DisplayTotals {
  workedHours: number;
  breakHours: number;
  absenceHours: number;
  expectedHours: number;
  /** Ist + Abw − Soll of the printed totals; the sum of the printed Saldo column. */
  balanceHours: number;
  /** Balance counting only days up to today, or null when today is out of range. */
  balanceToDateHours: number | null;
}

/**
 * The "Summe" row, in printed decimal hours. Every figure is the sum of the
 * values as printed in the day rows, so adding up a column by hand reproduces
 * the total exactly, and Ist − Soll equals the printed Saldo.
 */
export function displayTotals(report: MonthlyReport): DisplayTotals {
  let worked = 0;
  let breakTime = 0;
  let absence = 0;
  let expected = 0;
  let balance = 0;
  let balanceToDate = 0;
  for (const day of report.days) {
    const h = dayHours(day);
    worked += h.worked;
    breakTime += h.breakTime;
    absence += h.absence;
    expected += h.expected;
    balance += h.balance;
    if (day.dayKey <= report.generatedAtKey) balanceToDate += h.balance;
  }
  return {
    workedHours: round2(worked),
    breakHours: round2(breakTime),
    absenceHours: round2(absence),
    expectedHours: round2(expected),
    balanceHours: round2(balance),
    balanceToDateHours: report.totals.balanceToDateMs === null ? null : round2(balanceToDate),
  };
}

function fmtKey(d: Date): string {
  return berlinDayKey(d, "UTC");
}

function spanLabel(day: DaySummary): string {
  const work = day.segments.filter((s) => s.type === "WORK");
  const first = work[0];
  const last = work[work.length - 1];
  if (!first || !last) return "—";
  if (last.running) return `seit ${formatClock(first.start)}`;
  return `${formatClock(first.start)} – ${formatClock(last.end)}`;
}

/** Assemble a month's report for one employee. `monthKey` is "YYYY-MM". */
export async function buildMonthlyReport(
  userId: string,
  monthKey: string,
  asOf: Date,
): Promise<MonthlyReport | null> {
  const anchor = `${monthKey}-01`;
  const { from, to } = monthRangeOf(anchor);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, isMinijob: true, bundesland: true },
  });
  if (!user) return null;

  const [settings, timesheet] = await Promise.all([
    getAppSettings(),
    getTimesheet(userId, "month", anchor, asOf),
  ]);
  const region = resolveRegion(user.bundesland, settings);
  const holidays = await getHolidaysInRange(region, from, to);
  const holidayByDay = new Map(holidays.map((h) => [h.dayKey, h]));

  // Absences overlapping the month (approved + pending), for the notes column.
  const absenceRows = await prisma.absence.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: new Date(`${to}T00:00:00.000Z`) },
      endDate: { gte: new Date(`${from}T00:00:00.000Z`) },
    },
    orderBy: { startDate: "asc" },
  });

  // Per-day absence labels: mark each day a vacation/sick spell covers.
  const absenceByDay = new Map<string, string>();
  for (const a of absenceRows) {
    const aFrom = fmtKey(a.startDate);
    const aTo = fmtKey(a.endDate);
    const label =
      a.type === "SICK" ? "Krank" : a.status === "APPROVED" ? "Urlaub" : "Urlaub (offen)";
    for (const d of timesheet.period.days) {
      if (d.date >= aFrom && d.date <= aTo) absenceByDay.set(d.date, label);
    }
  }

  const flaggedDays = new Set(timesheet.violations.map((v) => v.date));

  const days: ReportDayRow[] = timesheet.period.days.map((d) => {
    const holiday = holidayByDay.get(d.date);
    const absence = absenceByDay.get(d.date);
    const note = [holiday?.name, absence].filter(Boolean).join(" · ");
    return {
      dayKey: d.date,
      span: spanLabel(d),
      workedMs: d.workedMs,
      breakMs: d.breakMs,
      autoBreakMs: d.autoBreakMs,
      unfinishedBreakMs: d.unfinishedBreakMs,
      expectedMs: d.expectedMs,
      absenceMs: d.absenceMs,
      balanceMs: d.balanceMs,
      note,
      flagged: flaggedDays.has(d.date),
      hasOpenAnomaly: d.hasOpenAnomaly,
    };
  });

  // A to-date balance is only meaningful while the month is still running; for a
  // closed month it equals the full-period balance and would just be noise.
  const todayKey = berlinDayKey(asOf);
  const includesToday = todayKey >= from && todayKey <= to;

  return {
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      isMinijob: user.isMinijob, region,
    },
    monthKey,
    monthLabel: formatMonth(anchor),
    range: { from, to },
    days,
    totals: {
      workedMs: timesheet.period.workedMs,
      breakMs: timesheet.period.breakMs,
      expectedMs: timesheet.period.expectedMs,
      absenceMs: timesheet.period.absenceMs,
      // Full-period Ist + Abw − Soll: the columns next to it are full-period
      // too. period.balanceMs counts only days up to today and is separate.
      balanceMs:
        timesheet.period.workedMs +
        timesheet.period.absenceMs -
        timesheet.period.expectedMs,
      balanceToDateMs: includesToday ? timesheet.period.balanceMs : null,
    },
    violations: timesheet.violations,
    absences: absenceRows.map((a) => ({
      type: a.type,
      from: fmtKey(a.startDate),
      to: fmtKey(a.endDate),
      days: a.workingDaysCount,
      note: a.note,
    })),
    generatedAtKey: todayKey,
    companyName: settings.companyName,
    hasOpenAnomaly: timesheet.period.hasOpenAnomaly,
    hasAutoBreak:
      timesheet.period.autoBreakMs > 0 || timesheet.period.unfinishedBreakMs > 0,
  };
}

/**
 * Raw recorded time entries (one row per interval) over [fromKey, toKey], for the
 * raw-entries CSV. Defaults to ACTIVE entries; pass includeSuperseded for the
 * full version history. Optionally scoped to a single employee.
 */
export async function loadRawEntries(
  fromKey: string,
  toKey: string,
  opts: { userId?: string; includeSuperseded?: boolean } = {},
): Promise<RawEntryRow[]> {
  // TimeEntry.start is an absolute instant while the business day is Europe/Berlin,
  // so the window must be the Berlin day range — exactly like getTimesheet does.
  // A UTC window would drop the month's own first 1–2 hours and pull in the next
  // month's, making this file disagree with the monthly CSV/PDF of the same month.
  const start = berlinDayRange(fromKey).start;
  // entries that START up to the end of the last Berlin day (exclusive)
  const end = berlinDayRange(toKey).end;

  const rows = await prisma.timeEntry.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.includeSuperseded ? {} : { status: "ACTIVE" }),
      start: { gte: start, lt: end },
    },
    orderBy: [{ start: "asc" }],
    include: { user: { select: { name: true } } },
  });

  return rows.map((r) => {
    const workedMs = r.end ? r.end.getTime() - r.start.getTime() : 0;
    return {
      employeeName: r.user.name,
      type: r.type,
      startKey: berlinDayKey(r.start),
      startClock: formatClock(r.start),
      endClock: r.end ? formatClock(r.end) : "offen",
      workedMs,
      source: r.source,
      status: r.status,
      note: r.note,
    };
  });
}
