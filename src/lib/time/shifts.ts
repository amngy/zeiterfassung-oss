// Shift reconstruction — the unit the ArbZG actually regulates.
//
// WHY THIS MODULE EXISTS
// The compliance checks used to run on day-clipped `DaySummary` values. That is
// wrong for anyone who works past midnight: a single 12-hour break-free shift
// from 18:00 to 06:00 was split into 6 h + 6 h, so the §3 daily maximum never
// tripped and the §4 break requirement was assessed against 6 h (which needs no
// break at all) instead of 12 h (which needs 45 minutes). A 12-hour night shift
// with no break was reported as fully compliant. Night workers are precisely the
// population §§3–5 exist to protect, and they were the population every check
// silently skipped.
//
// §3 ArbZG regulates "werktägliche Arbeitszeit" — the working time of a shift,
// attributed to the day it begins — not the clock time falling inside a calendar
// date. §5 regulates the uninterrupted rest BETWEEN two such shifts. So the
// checks need shifts, and this module rebuilds them from the raw entries.

import type { CalcOptions, EntryInput } from "./types";
import { berlinDayKey } from "./tz";
import { autoBreakDeductionMs, closeUnfinishedBreaks, resolveAutoBreak } from "./breaks";

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

/**
 * A gap between two WORK intervals that is shorter than this is treated as a
 * break inside one shift; anything longer starts a new shift.
 *
 * Three hours is deliberately chosen to sit in the empty space between the two
 * things a gap can be: no break the ArbZG requires is longer than 45 minutes,
 * and no rest period it recognises is shorter than 11 hours. A 30-minute gap
 * between two manually-entered blocks is obviously lunch, not the end of a
 * working day; an 8-hour gap is obviously not lunch, and is exactly the case
 * §5 is meant to catch. Anything in between is genuinely ambiguous, and 3 h
 * errs toward treating the day as continuous, which is the stricter reading
 * for §3 and §4.
 */
export const MAX_INTRA_SHIFT_GAP_HOURS = 3;

/**
 * §4(1) ArbZG: the mandatory rest break may be split, but only into blocks of
 * at least 15 minutes. Shorter interruptions do not count toward it.
 */
export const MIN_COUNTABLE_BREAK_MINUTES = 15;

export interface ShiftBreak {
  start: Date;
  end: Date;
  ms: number;
  /** Whether this block counts toward the §4 minimum (≥ 15 minutes). */
  counts: boolean;
  /** A never-ended break, settled at its fixed length by the Pausenautomatik. */
  autoCompleted?: boolean;
}

export interface Shift {
  /** Berlin day the shift BEGINS on — the day §3 attributes it to. */
  dayKey: string;
  start: Date;
  end: Date;
  /** Gross presence: end − start. */
  presenceMs: number;
  /** Net working time: presence minus all break blocks. */
  workedMs: number;
  /** Total break time, whether or not each block counts toward §4. */
  breakMs: number;
  /** Break time in blocks of ≥ 15 min — the only part §4 accepts. */
  countableBreakMs: number;
  /** The recorded part of `breakMs` (blocks and gaps that are really in the record). */
  recordedBreakMs: number;
  /** The part of `breakMs` the Pausenautomatik added on top (§4 shortfall). */
  autoBreakMs: number;
  /** The part of `recordedBreakMs` that came from a never-ended break. */
  unfinishedBreakMs: number;
  breaks: ShiftBreak[];
  /** A still-running entry contributed to this shift; figures are not final. */
  running: boolean;
  /** An unresolved open entry (forgotten clock-out) — cannot be assessed. */
  anomaly: boolean;
}

interface Interval {
  start: number;
  end: number;
  running: boolean;
  autoCompleted?: boolean;
}

function mergeOverlapping(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
      last.running = last.running || cur.running;
      last.autoCompleted = last.autoCompleted || cur.autoCompleted;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Rebuild the shifts an employee actually worked from their raw entries.
 *
 * Entries are used UN-CLIPPED, so a shift that crosses midnight stays one shift.
 * Consecutive WORK intervals are joined into the same shift when the gap between
 * them is under {@link MAX_INTRA_SHIFT_GAP_HOURS}; that gap then counts as break
 * time, which is what makes a manually-entered split day (08:00–12:00 and
 * 12:30–17:00, with no explicit BREAK entry) behave like the single 8.5-hour day
 * it plainly is.
 *
 * Open entries beyond `maxOpenHours` are flagged as anomalies and their shift is
 * marked unassessable rather than being credited with days of phantom work.
 */
export function buildShifts(entries: EntryInput[], opts: CalcOptions): Shift[] {
  const asOf = opts.asOf.getTime();
  const maxOpenMs = (opts.maxOpenHours ?? 16) * HOUR_MS;

  const work: Interval[] = [];
  const breaks: Interval[] = [];
  const anomalyStarts: number[] = [];

  // Settle any break that was started and never ended FIRST, so it enters the
  // reconstruction as a real block instead of an entry nobody can measure.
  for (const e of closeUnfinishedBreaks(entries, opts)) {
    const start = e.start.getTime();
    const open = e.end === null;
    const end = open ? asOf : e.end!.getTime();
    if (open && end - start > maxOpenMs) {
      anomalyStarts.push(start);
      continue;
    }
    if (end <= start) continue;
    (e.type === "WORK" ? work : breaks).push({
      start,
      end,
      running: open,
      autoCompleted: e.autoCompleted,
    });
  }

  const mergedWork = mergeOverlapping(work);
  const mergedBreaks = mergeOverlapping(breaks);
  if (mergedWork.length === 0) {
    return anomalyStarts.map((s) => anomalyShift(s));
  }

  // Group work intervals into shifts.
  const gapLimit = MAX_INTRA_SHIFT_GAP_HOURS * HOUR_MS;
  const groups: Interval[][] = [[mergedWork[0]!]];
  for (let i = 1; i < mergedWork.length; i++) {
    const cur = mergedWork[i]!;
    const prev = groups[groups.length - 1]!.slice(-1)[0]!;
    if (cur.start - prev.end < gapLimit) groups[groups.length - 1]!.push(cur);
    else groups.push([cur]);
  }

  const shifts: Shift[] = groups.map((group) => {
    const start = group[0]!.start;
    const end = group[group.length - 1]!.end;
    const running = group.some((g) => g.running);

    // Break blocks = explicit BREAK entries inside the shift, PLUS the unfilled
    // gaps between the shift's work intervals (time demonstrably not worked).
    const blocks: Interval[] = [];
    for (let i = 1; i < group.length; i++) {
      const gapStart = group[i - 1]!.end;
      const gapEnd = group[i]!.start;
      if (gapEnd > gapStart) blocks.push({ start: gapStart, end: gapEnd, running: false });
    }
    for (const b of mergedBreaks) {
      const s = Math.max(b.start, start);
      const e = Math.min(b.end, end);
      if (e > s) blocks.push({ start: s, end: e, running: false, autoCompleted: b.autoCompleted });
    }

    const merged = mergeOverlapping(blocks);
    const shiftBreaks: ShiftBreak[] = merged.map((b) => {
      const ms = b.end - b.start;
      return {
        start: new Date(b.start),
        end: new Date(b.end),
        ms,
        counts: ms >= MIN_COUNTABLE_BREAK_MINUTES * MIN_MS,
        autoCompleted: b.autoCompleted,
      };
    });

    const recordedBreakMs = shiftBreaks.reduce((s, b) => s + b.ms, 0);
    const countableRecordedMs = shiftBreaks.reduce((s, b) => s + (b.counts ? b.ms : 0), 0);
    const unfinishedBreakMs = shiftBreaks.reduce((s, b) => s + (b.autoCompleted ? b.ms : 0), 0);
    const presenceMs = end - start;
    const dayKey = berlinDayKey(new Date(start));

    // Top up the §4 shortfall — but only on a settled shift. An in-progress
    // shift has not had its chance to book a break yet, and deducting one from a
    // live counter would make the day's Ist jump backwards at 6 h.
    //
    // The top-up is measured against the TOTAL recorded break, not the countable
    // part: the automatic deduction exists so paid time is not overstated, while
    // whether the recorded blocks were long enough to satisfy §4(1) stays a
    // compliance finding (BREAK_FRAGMENTED) rather than a second deduction.
    const autoBreakMs = running
      ? 0
      : autoBreakDeductionMs(
          presenceMs - recordedBreakMs,
          recordedBreakMs,
          resolveAutoBreak(opts.autoBreak, dayKey),
        );
    const breakMs = recordedBreakMs + autoBreakMs;

    return {
      dayKey,
      start: new Date(start),
      end: new Date(end),
      presenceMs,
      workedMs: presenceMs - breakMs,
      breakMs,
      // The booked break is one uninterrupted block, so it counts toward §4
      // whenever it reaches the 15-minute floor §4(1) sets for a break at all.
      countableBreakMs:
        countableRecordedMs +
        (autoBreakMs >= MIN_COUNTABLE_BREAK_MINUTES * MIN_MS ? autoBreakMs : 0),
      recordedBreakMs,
      autoBreakMs,
      unfinishedBreakMs,
      breaks: shiftBreaks,
      running,
      anomaly: false,
    };
  });

  for (const s of anomalyStarts) shifts.push(anomalyShift(s));
  shifts.sort((a, b) => a.start.getTime() - b.start.getTime());
  return shifts;
}

function anomalyShift(startMs: number): Shift {
  const d = new Date(startMs);
  return {
    dayKey: berlinDayKey(d),
    start: d,
    end: d,
    presenceMs: 0,
    workedMs: 0,
    breakMs: 0,
    countableBreakMs: 0,
    recordedBreakMs: 0,
    autoBreakMs: 0,
    unfinishedBreakMs: 0,
    breaks: [],
    running: false,
    anomaly: true,
  };
}
