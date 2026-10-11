// Pausenautomatik — the fixed break the system books when the record does not
// contain one.
//
// WHY THIS MODULE EXISTS
// Two situations used to overstate paid working time, both silently:
//
//   a) A break was STARTED but never ended ("nie zurückgemeldet"). An open BREAK
//      cannot be measured, so the calc layer dropped it entirely: the employee
//      who went to lunch at 12:00 and never came back was credited the lunch as
//      work as soon as somebody closed the surrounding work session.
//   b) NO break was recorded at all on a day that requires one under §4 ArbZG.
//      That produced a warning and nothing else — the unbroken presence was
//      counted, and paid, in full.
//
// This module supplies the missing break in both cases. Two principles hold it
// inside the design of the rest of the app:
//
//   - The RAW PUNCHES ARE NEVER TOUCHED. TimeEntry stays immutable, the raw-entry
//     export still shows exactly what was clocked, and an open entry stays open
//     until a human corrects it. The break is derived at calculation time.
//   - NOTHING IS DEDUCTED SILENTLY. The added minutes are reported separately as
//     `autoBreakMs` / `unfinishedBreakMs` and raise their own ArbZG hint, so the
//     figure is always traceable back to "the system booked this, nobody did".
//
// The automatic deduction is a company policy, not a legal fact: §16(2) ArbZG
// wants the ACTUAL times recorded. It is therefore configurable, off by default
// in this pure module (a caller that passes no policy gets the previous
// behaviour byte for byte), and always accompanied by a prompt to correct the
// record.

import type { CalcOptions, EntryInput } from "./types";
import { berlinDayKey } from "./tz";

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const DEFAULT_MAX_OPEN_HOURS = 16;

/** The §4 ArbZG break thresholds a rule profile carries (ArbZG or JArbSchG). */
export interface BreakThresholds {
  break1AfterHours: number;
  break1Minutes: number;
  break2AfterHours: number;
  break2Minutes: number;
}

/** Minimum break required (minutes) for a given amount of worked time. */
export function requiredBreakMinutes(workedHours: number, rules: BreakThresholds): number {
  if (workedHours > rules.break2AfterHours) return rules.break2Minutes;
  if (workedHours > rules.break1AfterHours) return rules.break1Minutes;
  return 0;
}

export interface AutoBreakPolicy {
  /** Master switch. Disabled → the calc behaves exactly as it did before. */
  enabled: boolean;
  /**
   * The break the company books when too little was recorded. It is never used
   * BELOW the §4 minimum for the hours worked, so a small value cannot be used
   * to under-deduct; 0 means "exactly the statutory minimum".
   */
  fixedMinutes: number;
  /**
   * A break that was started and never ended counts as this many minutes.
   * 0 → such a break is not counted at all (the previous behaviour).
   */
  unfinishedBreakMinutes: number;
  /**
   * Whether the §4 top-up is booked at all when too little break was recorded.
   * Undefined or true → yes, the company policy applies (every existing caller).
   *
   * False exempts ONE person from that top-up — the case it exists for is a
   * contract whose daily target sits at or below the six-hour threshold: an
   * occasional overrun would otherwise cost them the automatic 30 minutes even
   * though the hours they are paid for never required a break. It deliberately
   * does NOT switch off {@link closeUnfinishedBreaks}: a break somebody started
   * and forgot to end really happened, and dropping it would credit lunch as
   * work — which is the opposite of what an exemption is meant to fix.
   */
  deductMissingBreak?: boolean;
  /** The §4 thresholds of the profile in force on the day being calculated. */
  rules: BreakThresholds;
}

/**
 * Either one policy for every day, or a resolver keyed by Berlin day — the
 * applicable profile is a property of the DAY, not of "today", so an employee
 * who turns 18 mid-period is judged under JArbSchG before their birthday and
 * under the ArbZG profile after it.
 */
export type AutoBreakSource =
  | AutoBreakPolicy
  | ((dayKey: string) => AutoBreakPolicy | undefined);

export function resolveAutoBreak(
  source: AutoBreakSource | undefined,
  dayKey: string,
): AutoBreakPolicy | undefined {
  if (!source) return undefined;
  return typeof source === "function" ? source(dayKey) : source;
}

/**
 * How much break time the Pausenautomatik adds on top of what was recorded.
 *
 * `workedMs` is the working time AS RECORDED — presence minus the breaks that
 * were actually booked — and `recordedBreakMs` is that booked break time.
 *
 * The band is resolved against the working time that REMAINS once the break is
 * out of it, because that is the figure §4 attaches to. Taking the 45-minute
 * band off a 9:10 day would otherwise deduct a quarter of an hour more than the
 * law asks for: the day is only 8:25 long once a break has been subtracted, and
 * 8:25 requires 30 minutes, not 45.
 *
 * Returns 0 whenever no break is owed, so a four-hour shift is never touched.
 */
export function autoBreakDeductionMs(
  workedMs: number,
  recordedBreakMs: number,
  policy: AutoBreakPolicy | undefined,
): number {
  if (!policy?.enabled || workedMs <= 0) return 0;
  if (policy.deductMissingBreak === false) return 0;
  const r = policy.rules;
  if (workedMs / HOUR_MS <= r.break1AfterHours) return 0;

  // The company's fixed break is a FLOOR on the statutory one, never a ceiling.
  const target = (statutoryMinutes: number) =>
    Math.max(statutoryMinutes, policy.fixedMinutes) * MIN_MS;

  const lower = Math.max(0, target(r.break1Minutes) - recordedBreakMs);
  if ((workedMs - lower) / HOUR_MS <= r.break2AfterHours) {
    return Math.min(lower, workedMs);
  }
  return Math.min(Math.max(0, target(r.break2Minutes) - recordedBreakMs), workedMs);
}

/**
 * Give every unfinished BREAK a fixed end, so a pause somebody started and never
 * came back from is neither dropped from the figures nor left running for ever.
 *
 * Only breaks that can no longer be live are settled. While a work session that
 * began BEFORE the break is still open and within the plausibility cap, the
 * employee may genuinely still be on that break and the live view has to keep
 * counting it — cutting it short there would start crediting work time to
 * somebody sitting at lunch. Once the work session is closed, or has itself run
 * past the cap (a forgotten clock-out), the break is settled at the configured
 * length.
 *
 * The returned entries are copies; the input array is never mutated, and the
 * stored TimeEntry rows keep their open end until a human corrects them.
 */
export function closeUnfinishedBreaks(
  entries: EntryInput[],
  opts: CalcOptions,
): EntryInput[] {
  if (!opts.autoBreak) return entries;
  if (!entries.some((e) => e.type === "BREAK" && e.end === null)) return entries;

  const asOf = opts.asOf.getTime();
  const capMs = (opts.maxOpenHours ?? DEFAULT_MAX_OPEN_HOURS) * HOUR_MS;

  // The earliest still-live work session. A break that started before it belongs
  // to an older, already-abandoned session and is settled even though somebody
  // has clocked in again since.
  let liveWorkStart: number | null = null;
  for (const e of entries) {
    if (e.type !== "WORK" || e.end !== null) continue;
    const start = e.start.getTime();
    if (asOf < start || asOf - start > capMs) continue;
    if (liveWorkStart === null || start < liveWorkStart) liveWorkStart = start;
  }

  return entries.map((e) => {
    if (e.type !== "BREAK" || e.end !== null) return e;
    const start = e.start.getTime();
    if (liveWorkStart !== null && liveWorkStart <= start) return e;

    const policy = resolveAutoBreak(opts.autoBreak, berlinDayKey(e.start));
    const minutes = policy?.enabled ? policy.unfinishedBreakMinutes : 0;
    if (minutes <= 0) return e;
    return { ...e, end: new Date(start + minutes * MIN_MS), autoCompleted: true };
  });
}
