// Version history of a time entry (#33). A correction never overwrites: it
// marks the row SUPERSEDED and creates a new ACTIVE row whose `supersedesId`
// points back. Walking that chain from the ACTIVE row yields every earlier
// version — with its original punches, which the new row (not punched) lacks.

export type PunchEdge = "Beginn" | "Ende";

export interface VersionRow {
  id: string;
  supersedesId: string | null;
  type: "WORK" | "BREAK";
  start: Date;
  end: Date | null;
  source: "CLOCK" | "MANUAL";
  createdAt: Date;
  punches: { edge: PunchEdge; via: string }[];
}

/** The change that created a version — read from the audit log. */
export interface VersionChange {
  /** Display name, null when unknown (e.g. the account was deleted). */
  actor: string | null;
  at: Date;
  reason: string | null;
}

export interface EntryVersion {
  id: string;
  type: "WORK" | "BREAK";
  start: Date;
  end: Date | null;
  source: "CLOCK" | "MANUAL";
  punches: { edge: PunchEdge; via: string }[];
  /** When, by whom and why this version was replaced by the next newer one. */
  replaced: VersionChange;
}

/**
 * Earlier versions of `headId`, newest first. `changes` is keyed by the id of
 * the version a change CREATED; a missing change falls back to that version's
 * creation time with no actor or reason. Stops at a missing link or a loop.
 */
export function versionChain(
  headId: string,
  rows: ReadonlyMap<string, VersionRow>,
  changes: ReadonlyMap<string, VersionChange>,
): EntryVersion[] {
  const out: EntryVersion[] = [];
  const seen = new Set<string>([headId]);
  let current = rows.get(headId);
  while (current?.supersedesId && !seen.has(current.supersedesId)) {
    const previous = rows.get(current.supersedesId);
    if (!previous) break;
    seen.add(previous.id);
    out.push({
      id: previous.id,
      type: previous.type,
      start: previous.start,
      end: previous.end,
      source: previous.source,
      punches: previous.punches,
      replaced: changes.get(current.id) ?? { actor: null, at: current.createdAt, reason: null },
    });
    current = previous;
  }
  return out;
}
