// Shared domain types for the pure time-calculation module.
//
// This module is intentionally framework- AND database-independent: it operates
// on plain values so the exact same logic drives the live "today" view, the
// timesheet, the overtime balance and the vacation-day counting.
// Nothing here may import Prisma, React or Next — keep it pure and unit-testable.

/** Hours contracted for each weekday (sum = weekly target). */
export interface WeekdayHours {
  mon: number;
  tue: number;
  wed: number;
  thu: number;
  fri: number;
  sat: number;
  sun: number;
}

/**
 * One effective-dated work schedule. `effectiveFrom` is a calendar date; the
 * schedule applies from that date until the next schedule's effectiveFrom.
 * Multiple schedules let a contract change over time without recomputing the
 * past (mirrors the WorkSchedule table).
 */
export interface ScheduleInput {
  effectiveFrom: Date;
  hours: WeekdayHours;
}

export type EntryType = "WORK" | "BREAK";

/**
 * A single recorded interval. `end === null` means the entry is still open
 * (clocked in, not yet clocked out). Instants are absolute (UTC under the hood);
 * the business calendar day is derived in the Europe/Berlin timezone.
 */
export interface EntryInput {
  id?: string;
  type: EntryType;
  start: Date;
  end: Date | null;
  /**
   * Set by the calc layer (never by the store): this break was started and never
   * ended, and the Pausenautomatik gave it its fixed length. The underlying
   * TimeEntry is still open and still needs a correction.
   */
  autoCompleted?: boolean;
}

/** How a public/gifted holiday reduces a day's expected hours. */
export type HolidayEffect = "FULL" | "HALF";

/** The two kinds of recorded absence. Mirrors the AbsenceType enum. */
export type AbsenceKind = "VACATION" | "SICK";

/**
 * An approved absence covering (part of) one calendar day.
 *
 * A holiday REDUCES the expected hours; an absence does not — the hours stay
 * owed and are CREDITED instead, so the month's Soll still shows the contract
 * and the day comes out level rather than as undertime. `fraction` is the share
 * of the day the absence covers: 1 for a whole day, 0.5 for a half-day edge of
 * a holiday (the same 0.5 that was charged to the leave account).
 */
export interface AbsenceEffect {
  kind: AbsenceKind;
  fraction: number;
}

/**
 * Options shared by the day/period calculators. `asOf` is "now" — the instant a
 * still-open entry is measured up to for the live view (injected, never read
 * from the clock inside the pure module, so tests are deterministic).
 */
export interface CalcOptions {
  asOf: Date;
  /** Calendar day → holiday effect (FULL = 0 expected, HALF = half). */
  holidays?: Map<string, HolidayEffect>;
  /**
   * Calendar day → the approved absence covering it (holiday or sick leave).
   * Days that carry one are credited up to their expected hours; see
   * {@link DaySummary.absenceMs}. Omitted → no day is ever credited, which is
   * how every caller behaved before absences reached the calc layer.
   */
  absences?: Map<string, AbsenceEffect>;
  /**
   * An open entry whose elapsed time exceeds this many hours is treated as a
   * forgotten clock-out (anomaly) rather than counted as worked time.
   */
  maxOpenHours?: number;
  /**
   * Pausenautomatik: the fixed break booked when a break was started but never
   * ended, or never recorded at all. Omitted → no break is ever added, which is
   * the behaviour every caller had before the policy existed. Pass a function to
   * apply the stricter JArbSchG profile to a minor's days (see AutoBreakSource).
   */
  autoBreak?: import("./breaks").AutoBreakSource;
}

/** A resolved sub-interval that falls within a single calendar day. */
export interface DaySegment {
  type: EntryType;
  /** Start of this day-clipped piece. */
  start: Date;
  /** End of this day-clipped piece. */
  end: Date;
  /** Full (un-clipped) bounds of the underlying entry — may span days. Used so
   *  a correction prefill reflects the TRUE span, not the day-clipped piece. */
  entryStart: Date;
  entryEnd: Date;
  /** True when this segment's end is the injected `asOf` (a running entry). */
  running: boolean;
  /** A never-ended break that the Pausenautomatik closed at a fixed length. */
  autoCompleted?: boolean;
  entryId?: string;
}

export interface DaySummary {
  /** Calendar day in Europe/Berlin, "YYYY-MM-DD". */
  date: string;
  /** Net worked time = presence − breaks, in milliseconds. */
  workedMs: number;
  /** Gross presence (sum of WORK intervals), in milliseconds. */
  presenceMs: number;
  /** Sum of BREAK intervals, in milliseconds — recorded plus automatic. */
  breakMs: number;
  /**
   * The part of `breakMs` the Pausenautomatik added because too little break was
   * recorded (§4 ArbZG). 0 when the policy is off or the record was complete.
   */
  autoBreakMs: number;
  /**
   * The part of `breakMs` that comes from a break which was started but never
   * ended, counted at its fixed length. Included in `breakMs`, NOT in
   * `autoBreakMs` — the two answer different questions.
   */
  unfinishedBreakMs: number;
  /** Contracted hours for this employee on this day, in milliseconds. */
  expectedMs: number;
  /**
   * Time credited because the day is covered by an approved absence — holiday
   * or sick leave. It tops the day up to `expectedMs` and never beyond, so a
   * day off comes out level and a day the person was sent home ill part-way
   * through is topped up by exactly the hours they missed. 0 on ordinary days.
   */
  absenceMs: number;
  /** The absence covering this day, for labelling. Null on ordinary days. */
  absence: AbsenceEffect | null;
  /** workedMs + absenceMs − expectedMs (positive = overtime, negative = under). */
  balanceMs: number;
  /** A live entry is currently running on this day. */
  isRunning: boolean;
  /** An open entry could not be measured (forgotten clock-out) — needs fixing. */
  hasOpenAnomaly: boolean;
  /** True if this day has no recorded entries at all. */
  isEmpty: boolean;
  /** The day is a contracted working day (expected > 0 before holiday effect). */
  isWorkingDay: boolean;
  segments: DaySegment[];
}

export interface PeriodSummary {
  from: string;
  to: string;
  days: DaySummary[];
  workedMs: number;
  presenceMs: number;
  breakMs: number;
  /** Break time added by the Pausenautomatik across the period. */
  autoBreakMs: number;
  /** Break time contributed by never-ended breaks across the period. */
  unfinishedBreakMs: number;
  /** Contracted hours across the WHOLE range (the period's Soll). */
  expectedMs: number;
  /** Contracted hours only for days up to and including today (within range). */
  expectedToDateMs: number;
  /** Absence time credited across the period (holiday + sick). */
  absenceMs: number;
  /**
   * Running overtime/undertime as of today: worked + credited absence −
   * expected, all counting only days up to today. Future days in the range are
   * excluded so a mid-month view isn't dragged negative by hours not yet owed.
   */
  balanceMs: number;
  /** Any day in the period has an unresolved open entry. */
  hasOpenAnomaly: boolean;
}
