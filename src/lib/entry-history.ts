// Loads the version history of time entries (#33) — see @/lib/time/entry-history.

import type { ClockChannel, ClockEventKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { describePunch } from "@/lib/clock";
import {
  versionChain,
  type EntryVersion,
  type PunchEdge,
  type VersionChange,
  type VersionRow,
} from "@/lib/time/entry-history";

/** Audit actions that create a new version of an entry. */
const VERSION_ACTIONS = ["timeentry.correct", "timeentry.resolve-open", "timeentry.create"];

/** Chains longer than this are cut off (a guard, not an expected case). */
const MAX_DEPTH = 50;

export const PUNCH_SELECT = {
  orderBy: { at: "asc" },
  select: { kind: true, channel: true, deviceLabel: true, terminal: { select: { label: true } } },
} as const;

/** Clock events → "Beginn über QR-Code · Eingang", for display. */
export function describePunches(
  events: { kind: ClockEventKind; channel: ClockChannel; deviceLabel: string | null; terminal: { label: string } | null }[],
): { edge: PunchEdge; via: string }[] {
  return events.map((e) => ({
    edge: e.kind === "CLOCK_IN" || e.kind === "BREAK_START" ? "Beginn" : "Ende",
    via: describePunch(e),
  }));
}

/**
 * Earlier versions of each given entry, newest first, keyed by entry id.
 * Entries that were never corrected are missing from the map. One query per
 * chain level plus one each for the audit rows and the names.
 */
export async function loadEntryHistories(
  entries: { id: string; supersedesId: string | null }[],
): Promise<Map<string, EntryVersion[]>> {
  const heads = entries.filter((e) => e.supersedesId);
  if (heads.length === 0) return new Map();

  const rows = new Map<string, VersionRow>();
  const createdBy = new Map<string, string | null>();
  let frontier = heads.map((h) => h.id);
  for (let depth = 0; frontier.length > 0 && depth <= MAX_DEPTH; depth++) {
    const found = await prisma.timeEntry.findMany({
      where: { id: { in: frontier } },
      select: {
        id: true, supersedesId: true, type: true, start: true, end: true,
        source: true, createdAt: true, createdById: true,
        clockEvents: PUNCH_SELECT,
      },
    });
    for (const r of found) {
      rows.set(r.id, {
        id: r.id,
        supersedesId: r.supersedesId,
        type: r.type,
        start: r.start,
        end: r.end,
        source: r.source,
        createdAt: r.createdAt,
        punches: describePunches(r.clockEvents),
      });
      createdBy.set(r.id, r.createdById);
    }
    frontier = found
      .map((r) => r.supersedesId)
      .filter((id): id is string => !!id && !rows.has(id));
  }

  // Every version that replaced another one: the change that created it.
  const successorIds = [...rows.values()].filter((r) => r.supersedesId).map((r) => r.id);
  const audits = await prisma.auditLog.findMany({
    where: { targetType: "TimeEntry", targetId: { in: successorIds }, action: { in: VERSION_ACTIONS } },
    orderBy: { createdAt: "asc" },
    select: { targetId: true, actorUserId: true, reason: true, createdAt: true },
  });
  const auditFor = new Map<string, (typeof audits)[number]>();
  for (const a of audits) if (a.targetId && !auditFor.has(a.targetId)) auditFor.set(a.targetId, a);

  const actorOf = (id: string) => auditFor.get(id)?.actorUserId ?? createdBy.get(id) ?? null;
  const actorIds = [...new Set(successorIds.map(actorOf).filter((id): id is string => !!id))];
  const users = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));

  const changes = new Map<string, VersionChange>();
  for (const id of successorIds) {
    const audit = auditFor.get(id);
    const actor = actorOf(id);
    changes.set(id, {
      actor: actor ? (names.get(actor) ?? null) : null,
      at: audit?.createdAt ?? rows.get(id)!.createdAt,
      reason: audit?.reason ?? null,
    });
  }

  return new Map(heads.map((h) => [h.id, versionChain(h.id, rows, changes)]));
}
