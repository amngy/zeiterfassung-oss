// MiLoG §17 Abs. 1: for Minijobs (and the sectors of §2a SchwarzArbG) begin,
// end and duration of the daily working time must be recorded by the end of
// the seventh calendar day after the day the work was done (#19).

import { addDaysToKey, berlinDayKey, berlinDayRange } from "./tz";
import { formatClock, formatDayKey } from "./format";

/** Days after the work day that §17 MiLoG allows for recording it. */
export const MILOG_RECORDING_DAYS = 7;

/** End of the seventh calendar day after `dayKey`, Europe/Berlin. */
export function recordingDeadline(dayKey: string): Date {
  return berlinDayRange(addDaysToKey(dayKey, MILOG_RECORDING_DAYS)).end;
}

export type RecordingState =
  /** Begin and end were on record in time. */
  | "ok"
  /** The end is still missing; the deadline has not passed yet. */
  | "open"
  /** The end is still missing and the deadline has passed. */
  | "overdue"
  /** Complete, but only after the deadline. */
  | "late";

export const RECORDING_STATE_LABEL: Record<Exclude<RecordingState, "ok">, string> = {
  open: "Frist läuft",
  overdue: "Frist abgelaufen",
  late: "verspätet erfasst",
};

/**
 * Whether the entry of `dayKey` was recorded in time. `completedAt` is when a
 * record with both begin and end first existed — null while the end is
 * missing. A correction made after a timely record does not count as late:
 * the obligation is to record, and the original stays on record.
 */
export function recordingState(args: { dayKey: string; completedAt: Date | null; asOf: Date }): RecordingState {
  const deadline = recordingDeadline(args.dayKey);
  if (args.completedAt === null) return args.asOf.getTime() < deadline.getTime() ? "open" : "overdue";
  return args.completedAt.getTime() < deadline.getTime() ? "ok" : "late";
}

/** "Arbeit 08:00–12:30 — Ende fehlt, nachtragen bis So, 11.10.2026" — for lists and reports. */
export function recordingIssueText(issue: {
  type: "WORK" | "BREAK";
  dayKey: string;
  start: Date;
  end: Date | null;
  state: Exclude<RecordingState, "ok">;
  completedAt: Date | null;
}): string {
  const entry = `${issue.type === "WORK" ? "Arbeit" : "Pause"} ${formatClock(issue.start)}–${
    issue.end ? formatClock(issue.end) : "offen"
  }`;
  const lastDay = formatDayKey(addDaysToKey(issue.dayKey, MILOG_RECORDING_DAYS));
  switch (issue.state) {
    case "open":
      return `${entry} — Ende fehlt, nachtragen bis ${lastDay}`;
    case "overdue":
      return `${entry} — Ende fehlt, Frist am ${lastDay} abgelaufen`;
    case "late":
      return `${entry} — erst am ${formatDayKey(berlinDayKey(issue.completedAt!))} vollständig erfasst, Frist war ${lastDay}`;
  }
}
