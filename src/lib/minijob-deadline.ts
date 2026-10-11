// Watches the MiLoG §17 recording deadline for Minijob accounts (#19) — see
// @/lib/time/minijob. Computed on every read from the stored entries, so
// nothing has to be kept in sync.

import type { ClockEventKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { berlinDayKey, berlinDayRange, recordingDeadline, recordingState } from "@/lib/time";

export interface RecordingIssue {
  entryId: string;
  userId: string;
  userName: string;
  type: "WORK" | "BREAK";
  /** Berlin day the work was done (the entry's start). */
  dayKey: string;
  start: Date;
  end: Date | null;
  state: "open" | "overdue" | "late";
  deadline: Date;
  /** When begin and end were first on record; null while the end is missing. */
  completedAt: Date | null;
}

const END_KINDS: ClockEventKind[] = ["CLOCK_OUT", "BREAK_END"];

/** Chains longer than this are cut off (a guard, not an expected case). */
const MAX_DEPTH = 50;

interface Version {
  id: string;
  supersedesId: string | null;
  end: Date | null;
  createdAt: Date;
  clockEvents: { at: Date }[];
}

/**
 * When this version held both begin and end. A punched entry gets its end in
 * place, so that is the clock-out's time; any other version was written
 * complete, at its creation.
 */
function completedAt(v: Version): Date | null {
  if (!v.end) return null;
  return v.clockEvents[0]?.at ?? v.createdAt;
}

const VERSION_SELECT = {
  id: true,
  supersedesId: true,
  end: true,
  createdAt: true,
  clockEvents: { where: { kind: { in: END_KINDS } }, orderBy: { at: "asc" }, take: 1, select: { at: true } },
} satisfies Prisma.TimeEntrySelect;

/**
 * Minijob entries in [fromKey, toKey] (by start day) whose recording is not
 * in order: end still missing ("open" within the deadline, "overdue" after
 * it) or completed only after the deadline ("late"). Oldest first.
 *
 * An entry counts as recorded when ANY of its versions was complete: a later
 * correction of a timely record is not a late recording.
 */
export async function findMinijobRecordingIssues(args: {
  fromKey: string;
  toKey: string;
  userId?: string;
  asOf?: Date;
}): Promise<RecordingIssue[]> {
  const asOf = args.asOf ?? new Date();
  const entries = await prisma.timeEntry.findMany({
    where: {
      status: "ACTIVE",
      start: { gte: berlinDayRange(args.fromKey).start, lt: berlinDayRange(args.toKey).end },
      user: { isMinijob: true },
      ...(args.userId ? { userId: args.userId } : {}),
    },
    orderBy: { start: "asc" },
    select: {
      ...VERSION_SELECT,
      userId: true,
      type: true,
      start: true,
      user: { select: { name: true } },
    },
  });
  if (entries.length === 0) return [];

  // Earlier versions of corrected entries, one query per chain level.
  const versions = new Map<string, Version>(entries.map((e) => [e.id, e]));
  let frontier = entries.map((e) => e.supersedesId).filter((id): id is string => !!id);
  for (let depth = 0; frontier.length > 0 && depth < MAX_DEPTH; depth++) {
    const found = await prisma.timeEntry.findMany({ where: { id: { in: frontier } }, select: VERSION_SELECT });
    for (const v of found) versions.set(v.id, v);
    frontier = found.map((v) => v.supersedesId).filter((id): id is string => !!id && !versions.has(id));
  }

  const issues: RecordingIssue[] = [];
  for (const e of entries) {
    let first: Date | null = null;
    const seen = new Set<string>();
    for (let v: Version | undefined = e; v && !seen.has(v.id); v = v.supersedesId ? versions.get(v.supersedesId) : undefined) {
      seen.add(v.id);
      const at = completedAt(v);
      if (at && (!first || at < first)) first = at;
    }
    const dayKey = berlinDayKey(e.start);
    const state = recordingState({ dayKey, completedAt: first, asOf });
    if (state === "ok") continue;
    issues.push({
      entryId: e.id,
      userId: e.userId,
      userName: e.user.name,
      type: e.type,
      dayKey,
      start: e.start,
      end: e.end,
      state,
      deadline: recordingDeadline(dayKey),
      completedAt: first,
    });
  }
  return issues;
}
