// Correction & approval flow — the tamper-evident heart of the system.
//
// Records are immutable: a correction NEVER overwrites a TimeEntry. Instead a
// NEW row is created that `supersedes` the original, and the original is marked
// SUPERSEDED (not deleted). Every change carries a mandatory reason and is
// written to the append-only audit trail. Employees submit correction requests
// that stay PENDING until an admin approves; admins can also correct directly
// (still versioned + audited — admins cannot silently overwrite either).

import { Prisma } from "@prisma/client";
import type { EntryType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";

export interface ProposedEntry {
  type: EntryType;
  start: Date;
  end: Date; // corrections always close the record (no open manual entries)
  /** Existing entry to supersede; omit/null → create a brand-new entry. */
  timeEntryId?: string | null;
}

/**
 * What the requester said about breaks for a corrected WORK time.
 *
 * `null` as a whole means the question was not put to them (admin corrections,
 * and every request written before this existed) — deliberately distinct from
 * `{ taken: false }`, which is somebody actively stating there was no break.
 * Only the latter is a declaration the record can rely on.
 */
export type BreakDeclaration =
  | { taken: true; start: Date; end: Date }
  | { taken: false };

/**
 * Period lock (correctionPolicy.lockAfterDays). Entries older than N days are
 * closed to employee corrections so an exported/payroll-settled month cannot be
 * changed underneath the books. 0 disables it.
 *
 * Two deliberate exemptions:
 *  - admins are never locked out (that is what makes the backfill tool possible);
 *  - COMPLETING AN OPEN ENTRY is always allowed at any age. An entry with no end
 *    is not a logged time, it is an unfinished recording — and locking it would
 *    permanently trap the employee behind the one-open-entry index.
 */
export function periodLockCutoff(lockAfterDays: number, asOf: Date): Date | null {
  if (!lockAfterDays || lockAfterDays <= 0) return null;
  return new Date(asOf.getTime() - lockAfterDays * 86_400_000);
}

function assertNotLocked(
  target: Date,
  lockAfterDays: number,
  asOf: Date = new Date(),
): void {
  const cutoff = periodLockCutoff(lockAfterDays, asOf);
  if (cutoff && target.getTime() < cutoff.getTime()) {
    throw new CorrectionError(
      `Dieser Zeitraum ist gesperrt (Korrekturen sind nur ${lockAfterDays} Tage rückwirkend möglich). Bitte an die Verwaltung wenden.`,
    );
  }
}

function entrySnapshot(e: {
  type: EntryType;
  start: Date;
  end: Date | null;
}): Prisma.InputJsonValue {
  return { type: e.type, start: e.start.toISOString(), end: e.end ? e.end.toISOString() : null };
}

function clockRange(start: Date, end: Date | null): string {
  const part = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", ...opts }).format(d);
  const day = (d: Date) => part(d, { day: "2-digit", month: "2-digit" });
  const time = (d: Date) => part(d, { hour: "2-digit", minute: "2-digit" });

  if (!end) return `${day(start)}, ${time(start)}–offen`;
  // Repeating the date on both sides of a same-day range just adds noise.
  return day(start) === day(end)
    ? `${day(start)}, ${time(start)}–${time(end)}`
    : `${day(start)}, ${time(start)}–${day(end)}, ${time(end)}`;
}

/**
 * Refuse an interval that would sit on top of an existing ACTIVE entry of the
 * SAME type for that person.
 *
 * Why this is a hard guard rather than a warning: nothing else in the system
 * stops two ACTIVE rows from covering the same minutes, and the way people hit
 * it is not exotic. An entry that was never clocked out cannot be picked as a
 * correction target, so the form leaves only "Neuer Eintrag (nachtragen)" — and
 * choosing that used to ADD a second entry next to the broken one instead of
 * replacing it. The times then look right in the day view while the original
 * stays ACTIVE, keeps its "offen" flag and keeps blocking the next clock-in.
 * That is the "the correction never switches the entry" report.
 *
 * WORK and BREAK deliberately do overlap (a break sits inside a work session),
 * so the check is per type. An open entry (end === null) conflicts with
 * everything after its start — it has no end to stay clear of.
 */
async function assertNoOverlap(
  db: Prisma.TransactionClient | typeof prisma,
  args: {
    userId: string;
    type: EntryType;
    start: Date;
    end: Date;
    /** The entry being replaced — it may of course overlap itself. */
    excludeId?: string | null;
    /** Correcting an existing row rather than adding one — changes the advice. */
    isCorrection?: boolean;
  },
): Promise<void> {
  const clash = await db.timeEntry.findFirst({
    where: {
      userId: args.userId,
      type: args.type,
      status: "ACTIVE",
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
      start: { lt: args.end },
      OR: [{ end: null }, { end: { gt: args.start } }],
    },
    orderBy: { start: "asc" },
    select: { start: true, end: true },
  });
  if (!clash) return;

  const what = args.type === "BREAK" ? "Pause" : "Arbeitszeit";
  const which = `${what} ${clockRange(clash.start, clash.end)}`;

  // When an existing row is being corrected, "correct the existing one instead"
  // is useless advice — that is exactly what is being attempted. The real fix is
  // to get rid of the surplus row, so say so.
  throw new CorrectionError(
    args.isCorrection
      ? `Dieser Zeitraum überschneidet sich mit einem weiteren aktiven Eintrag (${which}). Solange beide aktiv sind, stünde die Zeit doppelt in den Auswertungen. Bitte den überzähligen Eintrag zuerst über „Entfernen" aus der Wertung nehmen.`
      : clash.end === null
        ? `Für diesen Zeitraum existiert bereits ein nicht abgeschlossener Eintrag (${which}). Bitte diesen Eintrag korrigieren, statt einen neuen anzulegen — sonst stehen anschließend zwei Zeiten nebeneinander.`
        : `Für diesen Zeitraum existiert bereits eine erfasste ${what} (${clockRange(clash.start, clash.end)}). Bitte den vorhandenen Eintrag korrigieren, statt einen neuen anzulegen.`,
  );
}

/**
 * Take a recorded entry out of the reckoning.
 *
 * "Delete" in the UI sense only — the row is marked SUPERSEDED, exactly like a
 * corrected one, and stays in the raw export and the audit trail. Nothing in
 * this system hard-deletes a time record; a duplicate that was really there
 * yesterday is part of the history of the record even once it stops counting.
 *
 * This exists because the overlap guard alone left a trap: entries that were
 * duplicated BEFORE the guard shipped cannot be corrected at all, since every
 * correction of one of them collides with its twin. Removing the surplus row is
 * the only way out that does not involve raw SQL.
 */
export async function adminRemoveEntry(args: {
  entryId: string;
  actorId: string;
  reason: string;
}): Promise<{ entryId: string }> {
  const { entryId, actorId, reason } = args;
  if (reason.trim().length < 3) {
    throw new CorrectionError("Bitte einen nachvollziehbaren Grund angeben (mind. 3 Zeichen).");
  }
  if (reason.trim().length > 500) {
    throw new CorrectionError("Höchstens 500 Zeichen.");
  }

  return prisma.$transaction(async (tx) => {
    const original = await tx.timeEntry.findUnique({ where: { id: entryId } });
    if (!original) throw new CorrectionError("Der Eintrag existiert nicht.");
    if (original.status !== "ACTIVE") {
      throw new CorrectionError("Dieser Eintrag ist bereits ersetzt und wird nicht mehr gewertet.");
    }

    const claimed = await tx.timeEntry.updateMany({
      where: { id: entryId, status: "ACTIVE" },
      data: { status: "SUPERSEDED" },
    });
    if (claimed.count === 0) {
      throw new CorrectionError("Der Eintrag wurde zwischenzeitlich geändert — bitte erneut versuchen.");
    }

    await writeAudit(tx, {
      actorUserId: actorId,
      action: "timeentry.remove",
      targetType: "TimeEntry",
      targetId: entryId,
      oldValue: entrySnapshot(original),
      newValue: { status: "SUPERSEDED" },
      reason,
    });

    return { entryId };
  });
}

/** Read a stored request's break columns back into a BreakDeclaration. */
export function breakDeclarationOf(req: {
  breakDeclared: boolean | null;
  proposedBreakStart: Date | null;
  proposedBreakEnd: Date | null;
}): BreakDeclaration | null {
  if (req.breakDeclared === null) return null;
  if (!req.breakDeclared) return { taken: false };
  if (!req.proposedBreakStart || !req.proposedBreakEnd) return null;
  return { taken: true, start: req.proposedBreakStart, end: req.proposedBreakEnd };
}

/** Validate a break declaration against the work interval it belongs to. */
export function assertBreakWithinWork(
  decl: BreakDeclaration,
  work: { start: Date; end: Date },
): void {
  if (!decl.taken) return;
  if (decl.end.getTime() <= decl.start.getTime()) {
    throw new CorrectionError("Das Pausenende muss nach dem Pausenbeginn liegen.");
  }
  if (decl.start.getTime() < work.start.getTime() || decl.end.getTime() > work.end.getTime()) {
    throw new CorrectionError("Die Pause muss innerhalb der angegebenen Arbeitszeit liegen.");
  }
}

/**
 * Make the recorded breaks match what the requester declared for a corrected
 * work interval.
 *
 * Any ACTIVE break overlapping the corrected shift is superseded first — a
 * declaration is a statement about the whole shift, so leaving a stale break
 * next to it would contradict the thing that was just approved. Nothing is
 * deleted: superseded rows keep showing up in the raw export and the log.
 */
async function applyBreakDeclaration(
  tx: Prisma.TransactionClient,
  args: {
    subjectUserId: string;
    work: { start: Date; end: Date };
    decl: BreakDeclaration;
    actorId: string;
    reason: string;
  },
): Promise<void> {
  const { subjectUserId, work, decl, actorId, reason } = args;

  const stale = await tx.timeEntry.findMany({
    where: {
      userId: subjectUserId,
      type: "BREAK",
      status: "ACTIVE",
      start: { lt: work.end },
      OR: [{ end: null }, { end: { gt: work.start } }],
    },
    orderBy: { start: "asc" },
  });

  for (const old of stale) {
    const claimed = await tx.timeEntry.updateMany({
      where: { id: old.id, status: "ACTIVE" },
      data: { status: "SUPERSEDED" },
    });
    if (claimed.count === 0) {
      throw new CorrectionError("Ein Pausen-Eintrag wurde zwischenzeitlich geändert — bitte erneut versuchen.");
    }
  }

  // The version chain can only carry one predecessor (supersedesId is unique),
  // so link the new break to the first replaced one; any others are recorded as
  // removed in the audit trail below.
  const linkTo = stale[0]?.id;

  if (decl.taken) {
    const created = await tx.timeEntry.create({
      data: {
        userId: subjectUserId,
        type: "BREAK",
        start: decl.start,
        end: decl.end,
        source: "MANUAL",
        status: "ACTIVE",
        supersedesId: linkTo,
        createdById: actorId,
      },
    });
    await writeAudit(tx, {
      actorUserId: actorId,
      action: linkTo ? "timeentry.correct" : "timeentry.create",
      targetType: "TimeEntry",
      targetId: created.id,
      oldValue: stale[0] ? entrySnapshot(stale[0]) : null,
      newValue: entrySnapshot(created),
      reason,
    });
  }

  // Everything superseded and not replaced above is a removal — log each one so
  // the Protokoll shows which break disappeared and on whose statement.
  for (const old of stale.slice(decl.taken ? 1 : 0)) {
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "timeentry.break-remove",
      targetType: "TimeEntry",
      targetId: old.id,
      oldValue: entrySnapshot(old),
      reason,
    });
  }
}

/**
 * Apply a proposed change inside a transaction: supersede the original (if any)
 * with a new MANUAL version and write the audit record. Returns the new entry id.
 */
async function applyEntryChange(
  tx: Prisma.TransactionClient,
  args: { subjectUserId: string; proposed: ProposedEntry; actorId: string; reason: string },
): Promise<string> {
  const { subjectUserId, proposed, actorId, reason } = args;

  // Defensive, caller-independent invariant: the immutable store must never
  // receive an inverted/zero-duration interval (e.g. a DST wall-clock collapse).
  if (!(proposed.start.getTime() < proposed.end.getTime())) {
    throw new CorrectionError("Das Ende muss nach dem Beginn liegen.");
  }

  let oldValue: Prisma.InputJsonValue | undefined;
  let supersedesId: string | undefined;

  if (proposed.timeEntryId) {
    const original = await tx.timeEntry.findUnique({ where: { id: proposed.timeEntryId } });
    if (!original) throw new CorrectionError("Der zu korrigierende Eintrag existiert nicht.");
    if (original.userId !== subjectUserId) {
      throw new CorrectionError("Eintrag gehört nicht zu dieser Person.");
    }
    oldValue = entrySnapshot(original);
    supersedesId = original.id;
    // Atomically claim the original (status guard in the WHERE), so a concurrent
    // correction of the same entry can't both supersede it — count 0 means it
    // was already superseded by another request.
    const claimed = await tx.timeEntry.updateMany({
      where: { id: original.id, status: "ACTIVE" },
      data: { status: "SUPERSEDED" },
    });
    if (claimed.count === 0) throw new CorrectionError("Eintrag wurde bereits ersetzt.");
  }

  // After the original has been claimed, so an entry never collides with the
  // very row it is replacing.
  await assertNoOverlap(tx, {
    userId: subjectUserId,
    type: proposed.type,
    start: proposed.start,
    end: proposed.end,
    excludeId: supersedesId ?? null,
    isCorrection: !!supersedesId,
  });

  const created = await tx.timeEntry.create({
    data: {
      userId: subjectUserId,
      type: proposed.type,
      start: proposed.start,
      end: proposed.end,
      source: "MANUAL",
      status: "ACTIVE",
      supersedesId,
      createdById: actorId,
    },
  });

  await writeAudit(tx, {
    actorUserId: actorId,
    action: supersedesId ? "timeentry.correct" : "timeentry.create",
    targetType: "TimeEntry",
    targetId: created.id,
    oldValue: oldValue ?? null,
    newValue: entrySnapshot(created),
    reason,
  });

  return created.id;
}

/**
 * Employee (or admin) submits a correction request.
 *
 * It stays PENDING until an admin decides — UNLESS the operator has switched
 * `correctionPolicy.selfCorrectionRequiresApproval` off, in which case a
 * correction of one's own time takes effect straight away. That setting is
 * offered in the admin parameter screen and was previously read, stored and
 * then ignored by every code path: whatever it said, a correction was queued.
 * An operator who had turned approval off saw their people file corrections
 * that never changed anything — the request simply sat in the queue.
 *
 * Applying directly is not a shortcut around the audit model: the request row
 * is still written (marked APPROVED, decided by the requester), the entry is
 * still versioned rather than overwritten, and both the submission and the
 * change are in the append-only log.
 *
 * Returns whether the change was applied immediately, so the UI can say which
 * of the two things actually happened.
 */
export async function submitCorrectionRequest(args: {
  subjectUserId: string;
  requestedById: string;
  isAdmin: boolean;
  proposed: ProposedEntry;
  reason: string;
  /** Break statement for a WORK correction; null → the question was not put. */
  breakDeclaration?: BreakDeclaration | null;
}): Promise<{ applied: boolean }> {
  const { subjectUserId, requestedById, isAdmin, proposed, reason } = args;
  const settings = await getAppSettings();

  const isSelf = requestedById === subjectUserId;
  if (isSelf && !isAdmin && !settings.correctionPolicy.allowSelfCreate) {
    throw new CorrectionError(
      "Eigene Zeit­korrekturen sind in den Einstellungen deaktiviert. Bitte an die Verwaltung wenden.",
    );
  }

  // A break statement only makes sense alongside a work time — a BREAK
  // correction IS the break. Drop it rather than storing something meaningless.
  const decl = proposed.type === "WORK" ? (args.breakDeclaration ?? null) : null;

  // Employees state whether they took a break; admins are not forced to,
  // because they also correct entries one at a time from /admin/zeiten where
  // the break is its own row.
  if (!isAdmin && proposed.type === "WORK" && !decl) {
    throw new CorrectionError(
      "Bitte angeben, ob in dieser Zeit eine Pause gemacht wurde.",
    );
  }
  if (decl) assertBreakWithinWork(decl, proposed);

  // Verify ownership HERE, not only at approval time. Previously any employee
  // could queue a request against another person's entry id; it could not
  // corrupt data (approval re-checked and rolled back) but it polluted the
  // admin queue with requests that could never be approved.
  if (proposed.timeEntryId) {
    const target = await prisma.timeEntry.findUnique({
      where: { id: proposed.timeEntryId },
      select: { userId: true, status: true, end: true, start: true },
    });
    if (!target) throw new CorrectionError("Der zu korrigierende Eintrag existiert nicht.");
    if (target.userId !== subjectUserId) {
      throw new CorrectionError("Eintrag gehört nicht zu dieser Person.");
    }
    if (target.status !== "ACTIVE") {
      throw new CorrectionError("Dieser Eintrag wurde bereits ersetzt.");
    }
    // An OPEN entry may always be completed, however old it is (see above).
    if (target.end !== null && !isAdmin) {
      assertNotLocked(target.start, settings.correctionPolicy.lockAfterDays);
    }
  } else if (!isAdmin) {
    assertNotLocked(proposed.start, settings.correctionPolicy.lockAfterDays);
  }

  // Tell the requester NOW that this would land on top of an existing entry.
  // applyEntryChange re-checks at approval time and is the authoritative guard;
  // without this pre-check the request is accepted, sits in the queue looking
  // fine, and only fails when an admin tries to approve it — by which time
  // nobody remembers what was meant.
  await assertNoOverlap(prisma, {
    userId: subjectUserId,
    type: proposed.type,
    start: proposed.start,
    end: proposed.end,
    excludeId: proposed.timeEntryId ?? null,
    isCorrection: !!proposed.timeEntryId,
  });

  // Self-corrections may be configured to take effect without an approval step.
  // Someone else's time always goes through the queue, whoever asks.
  const applyNow = isSelf && !settings.correctionPolicy.selfCorrectionRequiresApproval;

  try {
    await prisma.$transaction(async (tx) => {
      const req = await tx.correctionRequest.create({
        data: {
          userId: subjectUserId,
          timeEntryId: proposed.timeEntryId ?? null,
          proposedType: proposed.type,
          proposedStart: proposed.start,
          proposedEnd: proposed.end,
          reason,
          requestedById,
          status: applyNow ? "APPROVED" : "PENDING",
          ...(applyNow ? { decidedById: requestedById, decidedAt: new Date() } : {}),
          breakDeclared: decl ? decl.taken : null,
          proposedBreakStart: decl?.taken ? decl.start : null,
          proposedBreakEnd: decl?.taken ? decl.end : null,
        },
      });
      await writeAudit(tx, {
        actorUserId: requestedById,
        action: "correction.submit",
        targetType: "CorrectionRequest",
        targetId: req.id,
        newValue: entrySnapshot(proposed),
        reason,
      });

      if (applyNow) {
        await applyEntryChange(tx, {
          subjectUserId,
          proposed,
          actorId: requestedById,
          reason,
        });
        if (decl) {
          await applyBreakDeclaration(tx, {
            subjectUserId,
            work: { start: proposed.start, end: proposed.end },
            decl,
            actorId: requestedById,
            reason,
          });
        }
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new CorrectionError("Konflikt bei gleichzeitiger Bearbeitung — bitte erneut versuchen.");
    }
    throw e;
  }

  return { applied: applyNow };
}

/** Admin approves or rejects a pending request. Approval applies the change. */
export async function decideCorrection(args: {
  correctionId: string;
  decidedById: string;
  approve: boolean;
  decisionNote?: string;
}): Promise<void> {
  const { correctionId, decidedById, approve, decisionNote } = args;

  try {
    await prisma.$transaction(async (tx) => {
      const req = await tx.correctionRequest.findUnique({ where: { id: correctionId } });
      if (!req) throw new CorrectionError("Antrag nicht gefunden.");
      if (req.status !== "PENDING") {
        throw new CorrectionError("Antrag wurde bereits entschieden.");
      }
      if (approve && (!req.proposedStart || !req.proposedEnd || !req.proposedType)) {
        throw new CorrectionError("Antrag ist unvollständig.");
      }

      // Atomically claim the request (status guard in the WHERE) BEFORE applying
      // the change, so two concurrent decisions can't both apply it — for a
      // new-entry request there is no other unique backstop.
      const claimed = await tx.correctionRequest.updateMany({
        where: { id: correctionId, status: "PENDING" },
        data: {
          status: approve ? "APPROVED" : "REJECTED",
          decidedById,
          decidedAt: new Date(),
          decisionNote: decisionNote ?? null,
        },
      });
      if (claimed.count === 0) throw new CorrectionError("Antrag wurde bereits entschieden.");

      if (approve) {
        const proposed = {
          type: req.proposedType!,
          start: req.proposedStart!,
          end: req.proposedEnd!,
          timeEntryId: req.timeEntryId,
        };
        await applyEntryChange(tx, {
          subjectUserId: req.userId,
          proposed,
          actorId: decidedById,
          reason: req.reason,
        });

        // Carry the requester's break statement into the record. Approving
        // "08:30–15:00, no break" has to remove a break still sitting inside
        // that shift, otherwise the approved times and the stored breaks say
        // different things.
        const decl = breakDeclarationOf(req);
        if (decl) {
          assertBreakWithinWork(decl, proposed);
          await applyBreakDeclaration(tx, {
            subjectUserId: req.userId,
            work: { start: proposed.start, end: proposed.end },
            decl,
            actorId: decidedById,
            reason: req.reason,
          });
        }
      }

      await writeAudit(tx, {
        actorUserId: decidedById,
        action: approve ? "correction.approve" : "correction.reject",
        targetType: "CorrectionRequest",
        targetId: req.id,
        reason: decisionNote ?? req.reason,
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new CorrectionError("Konflikt bei gleichzeitiger Bearbeitung — bitte erneut versuchen.");
    }
    throw e;
  }
}

/**
 * Close a forgotten, still-running entry at a stated end time.
 *
 * This is the escape hatch from the lockout the review found: a partial unique
 * index allows only one open ACTIVE entry per (user, type), so an entry that was
 * never clocked out blocks every future clock-in. The live status flips to
 * ANOMALY after 16 h, the clock card then renders no buttons at all, and the
 * correction form used to exclude running entries — leaving the employee with
 * no path back in. Only raw SQL could fix it.
 *
 * Completing an unfinished record is NOT a retroactive alteration of a logged
 * time (the same reasoning the clock-out path already documents), so it applies
 * immediately rather than waiting for approval — otherwise the employee stays
 * locked out until an admin happens to look. It is still versioned (a new row
 * supersedes the open one), carries a mandatory reason, and is written to the
 * audit trail under its own action so the Protokoll shows every self-resolution.
 */
export async function resolveOpenEntry(args: {
  entryId: string;
  actorId: string;
  /** Subject employee — for a self-service fix this equals actorId. */
  subjectUserId: string;
  isAdmin: boolean;
  end: Date;
  reason: string;
  asOf?: Date;
}): Promise<{ entryId: string; type: EntryType; start: Date; end: Date }> {
  const { entryId, actorId, subjectUserId, isAdmin, end, reason } = args;
  const asOf = args.asOf ?? new Date();

  const original = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!original) throw new CorrectionError("Der Eintrag existiert nicht.");
  if (!isAdmin && original.userId !== subjectUserId) {
    throw new CorrectionError("Eintrag gehört nicht zu dieser Person.");
  }
  if (original.status !== "ACTIVE") {
    throw new CorrectionError("Dieser Eintrag wurde bereits ersetzt.");
  }
  if (original.end !== null) {
    throw new CorrectionError("Dieser Eintrag ist bereits abgeschlossen.");
  }
  if (end.getTime() <= original.start.getTime()) {
    throw new CorrectionError("Das Ende muss nach dem Beginn liegen.");
  }
  // Refuse a future end — a record may be completed, never predated forward.
  if (end.getTime() > asOf.getTime() + 60_000) {
    throw new CorrectionError("Das Ende darf nicht in der Zukunft liegen.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const claimed = await tx.timeEntry.updateMany({
        where: { id: entryId, status: "ACTIVE", end: null },
        data: { status: "SUPERSEDED" },
      });
      if (claimed.count === 0) {
        throw new CorrectionError("Der Eintrag wurde zwischenzeitlich geändert.");
      }

      const created = await tx.timeEntry.create({
        data: {
          userId: original.userId,
          type: original.type,
          start: original.start,
          end,
          source: "MANUAL",
          status: "ACTIVE",
          supersedesId: original.id,
          createdById: actorId,
          note: original.note,
        },
      });

      await writeAudit(tx, {
        actorUserId: actorId,
        action: "timeentry.resolve-open",
        targetType: "TimeEntry",
        targetId: created.id,
        oldValue: entrySnapshot(original),
        newValue: entrySnapshot(created),
        reason,
      });

      return { entryId: created.id, type: created.type, start: created.start, end };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new CorrectionError("Konflikt bei gleichzeitiger Bearbeitung — bitte erneut versuchen.");
    }
    throw e;
  }
}

/** Every still-open ACTIVE entry for a user — the set that can block a clock-in. */
export async function getOpenEntries(userId: string) {
  return prisma.timeEntry.findMany({
    where: { userId, status: "ACTIVE", end: null },
    orderBy: { start: "asc" },
    select: { id: true, type: true, start: true },
  });
}

/** Admin makes a direct correction (no request) — still versioned + audited. */
export async function adminCorrectEntry(args: {
  subjectUserId: string;
  proposed: ProposedEntry;
  actorId: string;
  reason: string;
}): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await applyEntryChange(tx, args);
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new CorrectionError("Konflikt bei gleichzeitiger Bearbeitung — bitte erneut versuchen.");
    }
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getPendingCorrectionCount(): Promise<number> {
  return prisma.correctionRequest.count({ where: { status: "PENDING" } });
}

export async function getPendingCorrections() {
  const rows = await prisma.correctionRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { name: true, email: true } } },
  });
  return rows;
}

/** A user's own correction requests (newest first) for their history view. */
export async function getUserCorrections(userId: string) {
  return prisma.correctionRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/** Thrown for expected, user-facing guard violations (turned into messages). */
export class CorrectionError extends Error {}
