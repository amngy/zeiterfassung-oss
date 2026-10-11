// Low-level interval arithmetic. Pure number-crunching on millisecond instants.

export interface MsInterval {
  start: number; // epoch ms, inclusive
  end: number; // epoch ms, exclusive
}

/** Total length of a set of intervals after merging any overlaps. */
export function totalMs(intervals: MsInterval[]): number {
  return mergeIntervals(intervals).reduce((sum, i) => sum + (i.end - i.start), 0);
}

/**
 * Merge overlapping/adjacent intervals into a minimal non-overlapping set.
 * Zero-length and inverted intervals are dropped. This makes the worked-time
 * math robust even if two overlapping entries somehow exist.
 */
export function mergeIntervals(intervals: MsInterval[]): MsInterval[] {
  const valid = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const out: MsInterval[] = [];
  for (const cur of valid) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Subtract `holes` from `base`, returning the remaining pieces. Used to carve
 * break intervals out of the presence interval(s) when a different worked-time
 * model is needed; the default day model subtracts totals, but this keeps the
 * primitive available and tested.
 */
export function subtractIntervals(
  base: MsInterval[],
  holes: MsInterval[],
): MsInterval[] {
  const merged = mergeIntervals(base);
  const cuts = mergeIntervals(holes);
  const out: MsInterval[] = [];
  for (const seg of merged) {
    let cursor = seg.start;
    for (const hole of cuts) {
      if (hole.end <= cursor || hole.start >= seg.end) continue;
      if (hole.start > cursor) out.push({ start: cursor, end: hole.start });
      cursor = Math.max(cursor, hole.end);
      if (cursor >= seg.end) break;
    }
    if (cursor < seg.end) out.push({ start: cursor, end: seg.end });
  }
  return out;
}

/** Length of the overlap between two intervals (0 if they don't overlap). */
export function overlapMs(a: MsInterval, b: MsInterval): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return Math.max(0, end - start);
}

/** Clip `interval` to the [start, end) window, or null if no overlap remains. */
export function clip(interval: MsInterval, window: MsInterval): MsInterval | null {
  const start = Math.max(interval.start, window.start);
  const end = Math.min(interval.end, window.end);
  return end > start ? { start, end } : null;
}
