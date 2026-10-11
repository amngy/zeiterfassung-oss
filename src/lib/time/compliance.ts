// ArbZG (Arbeitszeitgesetz) compliance checks — pure functions over the day/
// period summaries. Thresholds come from the configurable rule profile (NOT
// hard-coded), so the expected 2026 reform (e.g. daily→weekly cap) can be
// handled by changing settings. Violations are flagged (WARN) by default and
// only hard-block when the profile says so.

import type { CalcOptions, DaySummary, EntryInput, HolidayEffect, PeriodSummary } from "./types";
import { weekdayOfKey, weekRangeOf } from "./tz";
import { buildShifts, MIN_COUNTABLE_BREAK_MINUTES, type Shift } from "./shifts";
import { requiredBreakMinutes } from "./breaks";

// `requiredBreakMinutes` moved to ./breaks so the Pausenautomatik and these
// checks can never disagree about what §4 asks for. Re-exported here because it
// has always been part of this module's surface.
export { requiredBreakMinutes };

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

/**
 * The slice of the settings RuleProfile the checks need. Declared here (not
 * imported from @/lib/settings) to keep this module free of any DB/app coupling;
 * the settings RuleProfile is structurally assignable to it.
 */
export interface ArbZgRules {
  capMode: "DAILY" | "WEEKLY";
  maxHoursPerDay: number;
  /** §3 S. 2 averaging target the 10 h extension must come back down to. */
  standardHoursPerDay?: number;
  maxHoursPerWeek: number;
  break1AfterHours: number;
  break1Minutes: number;
  break2AfterHours: number;
  break2Minutes: number;
  minRestHours: number;
  blockOnViolation: boolean;
}

export type ViolationCode =
  | "MAX_DAILY_HOURS"
  | "MAX_WEEKLY_HOURS"
  | "BREAK_INSUFFICIENT"
  /** §4: enough total break time, but not in blocks of ≥ 15 minutes. */
  | "BREAK_FRAGMENTED"
  /** No (or too little) break recorded — the Pausenautomatik booked one. */
  | "BREAK_AUTO_APPLIED"
  /** A break was started and never ended; it was counted at its fixed length. */
  | "BREAK_UNFINISHED"
  | "REST_INSUFFICIENT"
  /** §3 S. 2: the 8→10 h extension was not averaged back down over 24 weeks. */
  | "AVERAGING_EXCEEDED"
  | "SUNDAY_WORK"
  | "HOLIDAY_WORK";

export type ViolationSeverity = "WARN" | "BLOCK";

export interface Violation {
  code: ViolationCode;
  severity: ViolationSeverity;
  /** Berlin day key the violation pertains to. */
  date: string;
  /** German, human-readable explanation. */
  message: string;
}

function sev(rules: ArbZgRules): ViolationSeverity {
  return rules.blockOnViolation ? "BLOCK" : "WARN";
}

function fmtH(ms: number): string {
  return (ms / HOUR_MS).toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
}

/**
 * Hints for the two things the Pausenautomatik did to a record.
 *
 * Always WARN, never BLOCK: neither is a breach of the ArbZG — the break has
 * been booked and §4 is satisfied. What is incomplete is the RECORD, and
 * §16(2) wants the actual times in it, so both hints ask for a correction
 * rather than reporting a rule as broken.
 */
function autoBreakNotices(
  date: string,
  autoBreakMs: number,
  unfinishedBreakMs: number,
): Violation[] {
  const out: Violation[] = [];
  if (unfinishedBreakMs > 0) {
    out.push({
      code: "BREAK_UNFINISHED",
      severity: "WARN",
      date,
      message: `Eine Pause wurde begonnen, aber nie beendet. Sie wurde mit ${Math.round(
        unfinishedBreakMs / MIN_MS,
      )} min angesetzt — bitte die tatsächliche Pausenzeit per Korrektur nachtragen.`,
    });
  }
  if (autoBreakMs > 0) {
    out.push({
      code: "BREAK_AUTO_APPLIED",
      severity: "WARN",
      date,
      message: `Es wurde keine ausreichende Pause erfasst — ${Math.round(
        autoBreakMs / MIN_MS,
      )} min wurden automatisch als Pause abgezogen (§4 ArbZG). Bitte die tatsächliche Pausenzeit per Korrektur nachtragen.`,
    });
  }
  return out;
}

/**
 * Per-day ArbZG checks: daily max hours, mandatory break sufficiency, and
 * work on a Sunday / public holiday (§9 ArbZG — generally work-free).
 * Rest-between-days and weekly-cap checks span days and live in checkPeriod.
 */
export function checkDay(
  day: DaySummary,
  rules: ArbZgRules,
  holidays?: Map<string, HolidayEffect>,
  /** When shifts are supplied, §3/§4 are assessed per shift instead (see checkShift). */
  shiftBased = false,
): Violation[] {
  const out: Violation[] = [];

  // Hoisted above the guard below: these two do not judge the day, they REPORT
  // what the calculation did to it. A day can carry an automatic break and an
  // unrelated open entry at once, and the deduction still has to be explained —
  // a figure the employee cannot account for is exactly what this must avoid.
  // (Both are 0 on a running day, so nothing is emitted there.)
  if (!shiftBased) {
    out.push(...autoBreakNotices(day.date, day.autoBreakMs, day.unfinishedBreakMs));
  }

  // Don't flag an in-progress day or one with an unresolved open entry — the
  // numbers aren't final yet.
  if (day.isRunning || day.hasOpenAnomaly) return out;

  if (!shiftBased && day.workedMs > 0) {
    const workedHours = day.workedMs / HOUR_MS;

    // Daily maximum (DAILY cap mode only; WEEKLY mode checks the week instead).
    if (rules.capMode === "DAILY" && workedHours > rules.maxHoursPerDay) {
      out.push({
        code: "MAX_DAILY_HOURS",
        severity: sev(rules),
        date: day.date,
        message: `Tagesarbeitszeit ${fmtH(day.workedMs)} h überschreitet das Maximum von ${rules.maxHoursPerDay} h.`,
      });
    }

    // Mandatory break (§4 ArbZG).
    const requiredMin = requiredBreakMinutes(workedHours, rules);
    if (requiredMin > 0 && day.breakMs < requiredMin * MIN_MS) {
      const actualMin = Math.round(day.breakMs / MIN_MS);
      out.push({
        code: "BREAK_INSUFFICIENT",
        severity: sev(rules),
        date: day.date,
        message: `Pause von ${actualMin} min ist zu kurz — bei ${fmtH(day.workedMs)} h Arbeit sind mindestens ${requiredMin} min vorgeschrieben.`,
      });
    }
  }

  // Sunday work (§9 ArbZG). Public holidays are work-free too.
  if (day.presenceMs > 0 && weekdayOfKey(day.date) === "sun") {
    out.push({
      code: "SUNDAY_WORK",
      severity: "WARN",
      date: day.date,
      message: "Arbeit an einem Sonntag (grundsätzlich beschäftigungsfrei nach §9 ArbZG).",
    });
  }
  if (day.presenceMs > 0 && holidays?.get(day.date) === "FULL") {
    out.push({
      code: "HOLIDAY_WORK",
      severity: "WARN",
      date: day.date,
      message: "Arbeit an einem gesetzlichen Feiertag (grundsätzlich beschäftigungsfrei nach §9 ArbZG).",
    });
  }

  return out;
}

/** First WORK-segment start and last WORK-segment end of a day, as instants. */
function workBounds(day: DaySummary): { first: Date; last: Date; running: boolean } | null {
  const work = day.segments.filter((s) => s.type === "WORK");
  const first = work[0];
  // The LAST segment by END, not by start: with overlapping entries (nothing
  // validates overlap) the array order would otherwise understate the day's end
  // and suppress a genuine rest violation.
  let last = work[0];
  for (const s of work) if (!last || s.end.getTime() > last.end.getTime()) last = s;
  if (!first || !last) return null;
  return { first: first.start, last: last.end, running: last.running };
}

// ── Shift-based checks (§3, §4, §5) ──────────────────────────────────────────

/**
 * §3 and §4 for one reconstructed shift, attributed to the day it BEGINS on.
 *
 * This is what makes a night shift visible. A single 18:00→06:00 shift is 12 h
 * of working time under §3 regardless of the midnight boundary, and it needs the
 * 45-minute break §4 attaches to more than 9 hours — neither of which the old
 * day-clipped check could ever see.
 */
export function checkShift(shift: Shift, rules: ArbZgRules): Violation[] {
  const out: Violation[] = [];
  // Reported before the guard, for the same reason as in checkDay: a deduction
  // the calculation made must always be accounted for, even on a shift the rule
  // checks themselves skip.
  out.push(...autoBreakNotices(shift.dayKey, shift.autoBreakMs, shift.unfinishedBreakMs));
  if (shift.running || shift.anomaly || shift.workedMs <= 0) return out;

  const workedHours = shift.workedMs / HOUR_MS;

  if (rules.capMode === "DAILY" && workedHours > rules.maxHoursPerDay) {
    out.push({
      code: "MAX_DAILY_HOURS",
      severity: sev(rules),
      date: shift.dayKey,
      message: `Schicht von ${fmtH(shift.workedMs)} h überschreitet die zulässige werktägliche Arbeitszeit von ${rules.maxHoursPerDay} h (§3 ArbZG).`,
    });
  }

  const requiredMin = requiredBreakMinutes(workedHours, rules);
  if (requiredMin > 0) {
    const countableMin = Math.round(shift.countableBreakMs / MIN_MS);
    const totalMin = Math.round(shift.breakMs / MIN_MS);
    if (countableMin < requiredMin) {
      // Distinguish "too little break" from "enough break, chopped too small":
      // §4(1) only accepts blocks of at least 15 minutes, so six 5-minute pauses
      // satisfy nothing even though they sum to 30.
      if (totalMin >= requiredMin) {
        out.push({
          code: "BREAK_FRAGMENTED",
          severity: sev(rules),
          date: shift.dayKey,
          message: `Pausen von insgesamt ${totalMin} min liegen vor, davon zählen nur ${countableMin} min — anrechenbar sind nach §4 ArbZG nur Abschnitte von mindestens ${MIN_COUNTABLE_BREAK_MINUTES} min. Erforderlich sind ${requiredMin} min.`,
        });
      } else {
        out.push({
          code: "BREAK_INSUFFICIENT",
          severity: sev(rules),
          date: shift.dayKey,
          message: `Pause von ${countableMin} min ist zu kurz — bei ${fmtH(shift.workedMs)} h Arbeit sind mindestens ${requiredMin} min vorgeschrieben (§4 ArbZG).`,
        });
      }
    }
  }

  return out;
}

/**
 * §5 ArbZG rest between consecutive shifts.
 *
 * Measuring shift-to-shift rather than day-to-day fixes two blind spots at once:
 * a gap that sits INSIDE one calendar day (night shift ending 06:00, back at
 * 14:00 — 8 h rest) used to be invisible because only day boundaries were
 * compared, and a continuous cross-midnight shift used to be compared against
 * itself and skipped via a `gapMs > 0` guard.
 */
export function checkRestBetweenShifts(shifts: Shift[], rules: ArbZgRules): Violation[] {
  const out: Violation[] = [];
  const assessable = shifts.filter((s) => !s.anomaly && s.presenceMs > 0);
  for (let i = 1; i < assessable.length; i++) {
    const prev = assessable[i - 1]!;
    const cur = assessable[i]!;
    if (prev.running || cur.running) continue;
    const gapMs = cur.start.getTime() - prev.end.getTime();
    if (gapMs >= 0 && gapMs < rules.minRestHours * HOUR_MS) {
      out.push({
        code: "REST_INSUFFICIENT",
        severity: sev(rules),
        date: cur.dayKey,
        message: `Ruhezeit von ${fmtH(gapMs)} h zwischen zwei Schichten unterschreitet die vorgeschriebenen ${rules.minRestHours} h (§5 ArbZG).`,
      });
    }
  }
  return out;
}

/**
 * §3 S. 2 ArbZG: the extension from 8 to 10 hours a day is only lawful if the
 * average stays within 8 hours per working day across six calendar months or
 * 24 weeks. Nothing tracked that obligation before — only the 10 h ceiling was
 * checked — so an employee working 10 h every day produced no findings at all,
 * which is the exact arrangement the sentence forbids.
 *
 * Pass the FULL averaging window (24 weeks of shifts). Callers that only hold a
 * shorter range should not call this, or the average will be unrepresentative.
 */
export function checkAveraging(
  shifts: Shift[],
  rules: ArbZgRules,
  windowLabelDate: string,
): Violation[] {
  const target = rules.standardHoursPerDay ?? 8;
  if (target <= 0) return [];
  const assessable = shifts.filter((s) => !s.anomaly && !s.running && s.workedMs > 0);
  if (assessable.length === 0) return [];

  const totalMs = assessable.reduce((s, x) => s + x.workedMs, 0);
  const workingDays = new Set(assessable.map((s) => s.dayKey)).size;
  if (workingDays === 0) return [];

  const avgHours = totalMs / workingDays / HOUR_MS;
  if (avgHours <= target) return [];

  return [
    {
      code: "AVERAGING_EXCEEDED",
      severity: sev(rules),
      date: windowLabelDate,
      message: `Im Ausgleichszeitraum liegt der Durchschnitt bei ${avgHours.toFixed(2).replace(".", ",")} h je Arbeitstag (${workingDays} Tage) und überschreitet damit die nach §3 S. 2 ArbZG auszugleichenden ${target} h.`,
    },
  ];
}

export interface CheckPeriodOptions {
  /**
   * Raw entries covering the period AND a margin either side. When supplied,
   * §3/§4/§5 are assessed on reconstructed shifts, which is the only way a
   * cross-midnight shift or an intra-day rest gap can be seen at all. Pass a
   * window starting ~1 day before `period.from` so a shift beginning the
   * previous evening is complete and the first rest gap is real.
   */
  entries?: EntryInput[];
  calcOpts?: CalcOptions;
  /** Stricter JArbSchG profile, applied to days before {@link minorUntilKey}. */
  minorRules?: ArbZgRules;
  /** The employee's 18th birthday as a day key; days before it are minor days. */
  minorUntilKey?: string;
}

/**
 * Period checks that span days:
 *  - REST_INSUFFICIENT: < minRestHours between the last punch of one day and the
 *    first punch of the next worked day (§5 ArbZG).
 *  - MAX_WEEKLY_HOURS: only in WEEKLY cap mode, if the period's worked time
 *    exceeds maxHoursPerWeek (the period is expected to be a single week).
 */
export function checkPeriod(
  period: PeriodSummary,
  rules: ArbZgRules,
  holidays?: Map<string, HolidayEffect>,
  opts?: CheckPeriodOptions,
): Violation[] {
  const out: Violation[] = [];
  const entries = opts?.entries;
  const calcOpts = opts?.calcOpts;
  const shiftBased = entries != null && calcOpts != null;

  // The applicable rule profile is a property of the DAY, not of "today". A
  // person who turns 18 mid-period must be judged by JArbSchG for the days
  // before their birthday and by the ArbZG profile afterwards — previously the
  // profile was chosen once from `asOf`, so every earlier breach silently
  // vanished the moment they came of age.
  const rulesFor = (dayKey: string): ArbZgRules =>
    opts?.minorRules && opts.minorUntilKey && dayKey < opts.minorUntilKey
      ? opts.minorRules
      : rules;

  for (const day of period.days) {
    out.push(...checkDay(day, rulesFor(day.date), holidays, shiftBased));
  }

  if (shiftBased) {
    const shifts = buildShifts(entries!, calcOpts!);
    // Only report shifts that BEGIN inside the visible period, so the margin
    // entries loaded for context don't produce violations the user can't see.
    const inRange = shifts.filter((s) => s.dayKey >= period.from && s.dayKey <= period.to);
    for (const s of inRange) out.push(...checkShift(s, rulesFor(s.dayKey)));
    // Rest is computed across ALL shifts (including the margin) so the first
    // day of the period is compared against the evening before it.
    for (const v of checkRestBetweenShifts(shifts, rules)) {
      if (v.date >= period.from && v.date <= period.to) out.push(v);
    }
  } else {
    // Legacy day-based rest check — retained for callers that cannot supply raw
    // entries. It cannot see intra-day gaps or cross-midnight shifts.
    const worked = period.days
      .map((d) => ({ day: d, b: workBounds(d) }))
      .filter((x): x is { day: DaySummary; b: NonNullable<ReturnType<typeof workBounds>> } => x.b !== null);
    for (let i = 1; i < worked.length; i++) {
      const prev = worked[i - 1]!;
      const cur = worked[i]!;
      if (prev.b.running || cur.day.isRunning) continue;
      const gapMs = cur.b.first.getTime() - prev.b.last.getTime();
      if (gapMs > 0 && gapMs < rules.minRestHours * HOUR_MS) {
        out.push({
          code: "REST_INSUFFICIENT",
          severity: sev(rules),
          date: cur.day.date,
          message: `Ruhezeit von ${fmtH(gapMs)} h zum Vortag unterschreitet die vorgeschriebenen ${rules.minRestHours} h (§5 ArbZG).`,
        });
      }
    }
  }

  // Weekly cap mode — evaluated per ISO week, so a month-scoped period (month
  // view / dashboard badge) cannot falsely trip the per-week maximum. The
  // in-progress (running) day is excluded so the cap isn't tripped by a partial.
  if (rules.capMode === "WEEKLY") {
    const byWeek = new Map<string, { worked: number; lastDate: string }>();
    for (const d of period.days) {
      if (d.isRunning) continue;
      const wk = weekRangeOf(d.date).from;
      const acc = byWeek.get(wk) ?? { worked: 0, lastDate: d.date };
      acc.worked += d.workedMs;
      if (d.date > acc.lastDate) acc.lastDate = d.date;
      byWeek.set(wk, acc);
    }
    for (const { worked: wkWorked, lastDate } of byWeek.values()) {
      if (wkWorked > rules.maxHoursPerWeek * HOUR_MS) {
        out.push({
          code: "MAX_WEEKLY_HOURS",
          severity: sev(rules),
          date: lastDate,
          message: `Wochenarbeitszeit ${fmtH(wkWorked)} h überschreitet das Maximum von ${rules.maxHoursPerWeek} h.`,
        });
      }
    }
  }

  return out;
}

/** Count violations by severity (for dashboard badges). */
export function countViolations(violations: Violation[]): {
  warn: number;
  block: number;
  total: number;
} {
  let warn = 0;
  let block = 0;
  for (const v of violations) v.severity === "BLOCK" ? block++ : warn++;
  return { warn, block, total: violations.length };
}
