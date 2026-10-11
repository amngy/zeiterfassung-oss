// Derives the employee's current clock state from their open entries. Pure, so
// both the server (initial render, action guards) and tests use the same logic.

import type { EntryInput } from "./types";

const HOUR_MS = 3_600_000;
const DEFAULT_MAX_OPEN_HOURS = 16;

export type LiveState = "IDLE" | "WORKING" | "ON_BREAK" | "ANOMALY";

export interface LiveStatus {
  state: LiveState;
  /** When the current state began (work start, or break start). */
  since: Date | null;
  /** Open WORK entry id — target for clock-out / start-break. */
  openWorkId?: string;
  /** Open BREAK entry id — target for end-break. */
  openBreakId?: string;
  /** An open entry older than the plausibility cap that needs resolving. */
  anomalyEntryId?: string;
}

/**
 * Determine the live clock state.
 *  - open WORK older than the cap            → ANOMALY (forgotten clock-out)
 *  - open WORK + open BREAK                   → ON_BREAK
 *  - open WORK only                           → WORKING
 *  - no open WORK                             → IDLE
 *
 * A stray open BREAK without an open WORK is itself treated as an anomaly.
 */
export function liveStatus(
  entries: EntryInput[],
  asOf: Date,
  maxOpenHours: number = DEFAULT_MAX_OPEN_HOURS,
): LiveStatus {
  const capMs = maxOpenHours * HOUR_MS;
  const now = asOf.getTime();

  const openWork = entries.find((e) => e.type === "WORK" && e.end === null);
  const openBreak = entries.find((e) => e.type === "BREAK" && e.end === null);

  if (!openWork) {
    if (openBreak) {
      return { state: "ANOMALY", since: openBreak.start, anomalyEntryId: openBreak.id };
    }
    return { state: "IDLE", since: null };
  }

  if (now - openWork.start.getTime() > capMs) {
    return { state: "ANOMALY", since: openWork.start, anomalyEntryId: openWork.id };
  }

  if (openBreak) {
    return {
      state: "ON_BREAK",
      since: openBreak.start,
      openWorkId: openWork.id,
      openBreakId: openBreak.id,
    };
  }

  return { state: "WORKING", since: openWork.start, openWorkId: openWork.id };
}
