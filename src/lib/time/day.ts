// Per-day and per-period aggregation — the worked/break/overtime maths that the
// today view, the timesheet and the overtime balance all share.

import type {
  CalcOptions,
  DaySegment,
  DaySummary,
  EntryInput,
  PeriodSummary,
  ScheduleInput,
} from "./types";
import { berlinDayKey, berlinDayRange, eachDayKey, weekdayOfKey } from "./tz";
import { clip, subtractIntervals, totalMs, type MsInterval } from "./duration";
import { expectedHoursForDate, scheduleForDay } from "./schedule";
import { closeUnfinishedBreaks } from "./breaks";
import { buildShifts } from "./shifts";

const HOUR_MS = 3_600_000;
const DEFAULT_MAX_OPEN_HOURS = 16;

interface ResolvedEntry {
  type: "WORK" | "BREAK";
  start: number;
  end: number;
  /** End is the injected `asOf` — the entry is still running. */
  running: boolean;
  /** Open far past the plausibility cap (or orphaned) — not counted. */
  anomaly: boolean;
  /** A never-ended break, given its fixed length by the Pausenautomatik. */
  autoCompleted: boolean;
  /** Berlin day the entry started on (where an anomaly must be resolved). */
  startDayKey: string;
  entryId?: string;
}

/**
 * Resolve each raw entry to a measurable interval, deciding how open entries
 * are treated:
 *  - closed entry              → its real [start, end)
 *  - open WORK within the cap  → runs up to `asOf` (the live entry)
 *  - open WORK beyond the cap  → ANOMALY, NOT counted (never guess an end time)
 *  - open BREAK without a live  → ANOMALY (a break only exists inside a work
 *    open WORK covering it          session; this mirrors liveStatus so the
 *                                   calc layer can never silently subtract a
 *                                   stray running break from logged worked time)
 *
 * When a Pausenautomatik is configured, a never-ended break is settled at its
 * fixed length BEFORE any of this, so it arrives here as an ordinary closed
 * interval instead of being dropped as an orphan.
 */
function resolveEntries(
  entries: EntryInput[],
  opts: CalcOptions,
): ResolvedEntry[] {
  const asOf = opts.asOf.getTime();
  const capMs = (opts.maxOpenHours ?? DEFAULT_MAX_OPEN_HOURS) * HOUR_MS;
  const settled = closeUnfinishedBreaks(entries, opts);

  // Is there a *live* open work session (open and within the cap)? Only then is
  // an open break legitimate.
  const hasLiveOpenWork = settled.some(
    (e) =>
      e.type === "WORK" &&
      e.end === null &&
      asOf - e.start.getTime() <= capMs &&
      asOf >= e.start.getTime(),
  );

  return settled.map((e) => {
    const start = e.start.getTime();
    const startDayKey = berlinDayKey(e.start);
    if (e.end !== null) {
      return {
        type: e.type,
        start,
        end: e.end.getTime(),
        running: false,
        anomaly: false,
        autoCompleted: e.autoCompleted === true,
        startDayKey,
        entryId: e.id,
      };
    }
    // Open entry.
    const elapsed = asOf - start;
    const tooOld = elapsed > capMs || asOf < start;
    // A break is only valid while a live work session covers it.
    const orphanedBreak = e.type === "BREAK" && !hasLiveOpenWork;
    const anomaly = tooOld || orphanedBreak;
    return {
      type: e.type,
      start,
      end: anomaly ? start : asOf,
      running: !anomaly,
      anomaly,
      autoCompleted: false,
      startDayKey,
      entryId: e.id,
    };
  });
}

/**
 * How much break the Pausenautomatik books for each Berlin day, keyed by day.
 *
 * The amount is worked out per SHIFT, not per calendar day, and attributed to
 * the day the shift begins — the same attribution §3/§4 ArbZG use. Doing it per
 * calendar day would reopen exactly the blind spot shifts.ts exists to close: an
 * 18:00→06:00 shift with no break splits into 6 h + 6 h, neither half passes the
 * six-hour threshold, and the night worker would be the one person the automatic
 * deduction never reaches.
 */
function autoBreakByDay(entries: EntryInput[], opts: CalcOptions): Map<string, number> {
  const out = new Map<string, number>();
  if (!opts.autoBreak) return out;
  for (const shift of buildShifts(entries, opts)) {
    if (shift.autoBreakMs > 0) {
      out.set(shift.dayKey, (out.get(shift.dayKey) ?? 0) + shift.autoBreakMs);
    }
  }
  return out;
}

/** Summarize a single Berlin calendar day from already-resolved entries. */
function summarizeResolvedDay(
  dayKey: string,
  resolved: ResolvedEntry[],
  schedules: ScheduleInput[],
  opts: CalcOptions,
  autoBreaks: Map<string, number>,
): DaySummary {
  const { start: winStart, end: winEnd } = berlinDayRange(dayKey);
  const window: MsInterval = {
    start: winStart.getTime(),
    end: winEnd.getTime(),
  };

  const workIntervals: MsInterval[] = [];
  const breakIntervals: MsInterval[] = [];
  /** The same breaks minus the ones the Pausenautomatik closed, for reporting. */
  const recordedBreakIntervals: MsInterval[] = [];
  const segments: DaySegment[] = [];
  let isRunning = false;
  let hasOpenAnomaly = false;
  let touched = false;

  for (const r of resolved) {
    if (r.anomaly) {
      if (r.startDayKey === dayKey) hasOpenAnomaly = true;
      continue;
    }
    const piece = clip({ start: r.start, end: r.end }, window);
    if (!piece) continue;
    touched = true;
    const runningHere = r.running && r.end >= window.start && r.end < window.end;
    if (runningHere) isRunning = true;
    (r.type === "WORK" ? workIntervals : breakIntervals).push(piece);
    if (r.type === "BREAK" && !r.autoCompleted) recordedBreakIntervals.push(piece);
    segments.push({
      type: r.type,
      start: new Date(piece.start),
      end: new Date(piece.end),
      // Full underlying entry bounds (un-clipped), so corrections target the
      // true span even when the segment is a cross-midnight slice.
      entryStart: new Date(r.start),
      entryEnd: new Date(r.end),
      running: runningHere,
      ...(r.autoCompleted ? { autoCompleted: true } : {}),
      entryId: r.entryId,
    });
  }

  const presenceMs = totalMs(workIntervals);
  // Subtract only the break time that actually overlaps presence — robust even
  // if a break sits partly outside a work interval.
  const recordedWorkedMs = totalMs(subtractIntervals(workIntervals, breakIntervals));
  // Report break as the time genuinely deducted from presence, so the displayed
  // Ist + Pause always reconciles with the presence span (presence = Ist + Pause).
  const recordedBreakMs = presenceMs - recordedWorkedMs;
  // What the never-ended break(s) contributed: the extra time deducted compared
  // with leaving them out. Measured this way, an auto-completed break that
  // overlaps a properly recorded one is counted once, not twice.
  const unfinishedBreakMs =
    recordedBreakIntervals.length === breakIntervals.length
      ? 0
      : totalMs(subtractIntervals(workIntervals, recordedBreakIntervals)) - recordedWorkedMs;

  // The §4 shortfall booked for the shift that BEGINS on this day. Clamped to
  // the day's own worked time so a deduction attributed here can never drive a
  // cross-midnight day's Ist below zero.
  const autoBreakMs = Math.min(autoBreaks.get(dayKey) ?? 0, recordedWorkedMs);
  const workedMs = recordedWorkedMs - autoBreakMs;
  const breakMs = recordedBreakMs + autoBreakMs;

  const expectedHours = expectedHoursForDate(schedules, dayKey, opts.holidays);
  const expectedMs = expectedHours * HOUR_MS;

  // An approved absence TOPS THE DAY UP to its Soll — it never reduces the Soll
  // (that is what a holiday does) and never pays beyond it. Three consequences,
  // all of them the ones the payroll figure needs:
  //   · a whole day off comes out at exactly 0, not at minus a working day;
  //   · the month's Soll still states the contract, and the credit is reported
  //     as its own figure, so nobody has to guess where the difference went;
  //   · a day somebody was sent home ill part-way through is topped up by the
  //     hours they missed, and hours worked ON a day off still show as overtime.
  const absence = opts.absences?.get(dayKey) ?? null;
  const absenceMs = absence
    ? Math.max(0, Math.min(expectedMs * absence.fraction, expectedMs - workedMs))
    : 0;

  const schedule = scheduleForDay(schedules, dayKey);
  const contracted = schedule ? schedule.hours[weekdayOfKey(dayKey)] : 0;

  segments.sort((a, b) => a.start.getTime() - b.start.getTime());

  return {
    date: dayKey,
    workedMs,
    presenceMs,
    breakMs,
    autoBreakMs,
    unfinishedBreakMs,
    expectedMs,
    absenceMs,
    absence,
    balanceMs: workedMs + absenceMs - expectedMs,
    isRunning,
    hasOpenAnomaly,
    isEmpty: !touched && !hasOpenAnomaly,
    isWorkingDay: contracted > 0,
    segments,
  };
}

/** Summarize one Berlin calendar day given the raw entries that may touch it. */
export function summarizeDay(
  dayKey: string,
  entries: EntryInput[],
  schedules: ScheduleInput[],
  opts: CalcOptions,
): DaySummary {
  return summarizeResolvedDay(
    dayKey,
    resolveEntries(entries, opts),
    schedules,
    opts,
    autoBreakByDay(entries, opts),
  );
}

/** Summarize an inclusive range of Berlin days into per-day rows plus totals. */
export function summarizePeriod(
  fromKey: string,
  toKey: string,
  entries: EntryInput[],
  schedules: ScheduleInput[],
  opts: CalcOptions,
): PeriodSummary {
  const resolved = resolveEntries(entries, opts);
  const autoBreaks = autoBreakByDay(entries, opts);
  const days = eachDayKey(fromKey, toKey).map((key) =>
    summarizeResolvedDay(key, resolved, schedules, opts, autoBreaks),
  );
  const todayKey = berlinDayKey(opts.asOf);
  const asOfMs = opts.asOf.getTime();

  const sum = (pick: (d: DaySummary) => number) =>
    days.reduce((acc, d) => acc + pick(d), 0);
  const sumToDate = (pick: (d: DaySummary) => number) =>
    days.reduce((acc, d) => (d.date <= todayKey ? acc + pick(d) : acc), 0);

  const workedToDateMs = sumToDate((d) => d.workedMs);
  const expectedToDateMs = sumToDate((d) => d.expectedMs);
  const absenceToDateMs = sumToDate((d) => d.absenceMs);

  // An unresolved open entry (anomaly) belongs to its start day, but its open
  // span [start, asOf] may stretch into this period even when it started before
  // the visible range — surface it so the period banner warns regardless.
  const rangeStartMs = berlinDayRange(fromKey).start.getTime();
  const rangeEndMs = berlinDayRange(toKey).end.getTime();
  const anomalyOverlapsRange = resolved.some(
    (r) => r.anomaly && r.start < rangeEndMs && asOfMs > rangeStartMs,
  );

  return {
    from: fromKey,
    to: toKey,
    days,
    workedMs: sum((d) => d.workedMs),
    presenceMs: sum((d) => d.presenceMs),
    breakMs: sum((d) => d.breakMs),
    autoBreakMs: sum((d) => d.autoBreakMs),
    unfinishedBreakMs: sum((d) => d.unfinishedBreakMs),
    expectedMs: sum((d) => d.expectedMs),
    expectedToDateMs,
    absenceMs: sum((d) => d.absenceMs),
    // Running overtime as of today, immune to future-dated entries
    // (corrections/manual entries): every side is measured up to today only.
    balanceMs: workedToDateMs + absenceToDateMs - expectedToDateMs,
    hasOpenAnomaly: days.some((d) => d.hasOpenAnomaly) || anomalyOverlapsRange,
  };
}
