// DSGVO / GDPR subject rights.
//  - Art. 15 (Auskunft): export ALL data held about one person as JSON.
//  - Art. 17 (Löschung): anonymise a person rather than hard-delete, because
//    working-time records carry statutory retention duties (ArbZG/MiLoG ≥ 2y,
//    social-insurance ≈ 4y, payroll up to ~10y).
//
// WHAT `anonymizeUser` SCRUBS — all of it in ONE transaction:
//
//   User                          name, email → placeholders; passwordHash → an
//                                 unusable value; birthDate, bundesland and the
//                                 Schwerbehinderung flag/dates → null/false;
//                                 second factor and terminal PIN → cleared,
//                                 recovery codes deleted; active → false;
//                                 anonymizedAt → now
//   TimeEntry.note                → null  (their rows)
//   ClockEvent.deviceLabel        → null  (their punches; channel + time stay)
//   Absence.note                  → null  (their rows — sick notes are Art. 9
//                                 health data)
//   CorrectionRequest.reason      → "[anonymisiert]"  (column is NOT NULL)
//   CorrectionRequest.decisionNote→ null
//   WorkSchedule.note             → null
//   AuditLog                      on rows ABOUT them (their User row, their
//                                 entries / absences / corrections / schedules /
//                                 batches, or a payload carrying their id):
//                                 `name`, `email` and every free-text key inside
//                                 oldValue/newValue → "[anonymisiert]", and the
//                                 whole `reason` column → "[anonymisiert]".
//                                 That column is where the sick-leave note was
//                                 COPIED to (absences.ts), so health data left
//                                 in the trail is removed with it.
//                                 On rows they merely ACTED on — those describe a
//                                 COLLEAGUE's record — only stray mentions of
//                                 their own name/e-mail are scrubbed out of the
//                                 text; blanking those payloads would destroy
//                                 someone else's history.
//
// WHAT DELIBERATELY SURVIVES, and why:
//   - every AuditLog ROW, with action, targetType, targetId, actorUserId and
//     createdAt. The trail must still prove THAT a change happened and when
//     (GoBD, § 147 AO, ArbZG § 16(2)). The ids are pseudonymous: they now
//     resolve to the anonymisation placeholder, not to a person.
//   - the working-time FACTS (start/end/type/status), absence dates, day counts
//     and entitlement figures — statutory retention beats erasure,
//     Art. 17(3)(b) DSGVO.
//   - free text on OTHER people's records that happens to mention this person by
//     name is not searchable and is not touched. Text on records the subject
//     acted on is scrubbed literally (see above); anything beyond that needs a
//     manual review.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { REDACTED, redactAuditForSubject, writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { lockClock } from "@/lib/clock";
import { UserError } from "@/lib/users";

/** Full personal-data export for one subject (Art. 15). JSON-serializable. */
export async function exportUserData(userId: string): Promise<unknown> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { schedules: { orderBy: { effectiveFrom: "asc" } } },
  });
  if (!user) throw new UserError("Konto nicht gefunden.");

  const [timeEntries, clockEvents, corrections, absences] = await Promise.all([
    prisma.timeEntry.findMany({ where: { userId }, orderBy: { start: "asc" } }),
    prisma.clockEvent.findMany({
      where: { userId },
      orderBy: { at: "asc" },
      include: { terminal: { select: { label: true } } },
    }),
    prisma.correctionRequest.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.absence.findMany({ where: { userId }, orderBy: { startDate: "asc" } }),
  ]);

  // Audit entries about this person: actions they performed OR records that are
  // theirs (their User row, their time entries / corrections / absences).
  const targetIds = [
    userId,
    ...timeEntries.map((e) => e.id),
    ...corrections.map((c) => c.id),
    ...absences.map((a) => a.id),
  ];
  const auditLog = await prisma.auditLog.findMany({
    where: { OR: [{ actorUserId: userId }, { targetId: { in: targetIds } }] },
    orderBy: { createdAt: "asc" },
  });

  // Strip the password hash, the second-factor secrets and the terminal PIN
  // (they are login credentials, not information about the person); everything
  // else is theirs.
  const {
    passwordHash: _passwordHash,
    totpSecret: _totpSecret,
    totpPendingSecret: _totpPendingSecret,
    kioskPinHash: _kioskPinHash,
    ...profile
  } = user;

  return {
    exportKind: "DSGVO Art. 15 Auskunft",
    generatedAt: new Date().toISOString(),
    subject: { id: user.id, name: user.name, email: user.email },
    profile,
    workSchedules: user.schedules,
    timeEntries,
    clockEvents,
    correctionRequests: corrections,
    absences,
    auditLog,
  };
}

/** JSON bytes for a downloadable Art. 15 export. */
export async function exportUserDataBytes(userId: string): Promise<Uint8Array> {
  const data = await exportUserData(userId);
  return new TextEncoder().encode(JSON.stringify(data, null, 2));
}

/**
 * Anonymise a person (Art. 17). See the module header for the exact list of
 * columns that are scrubbed and of facts that deliberately survive — that list
 * is the statement the operator needs for their Verarbeitungsverzeichnis.
 *
 * Everything happens in one transaction: a half-anonymised person (User row
 * scrubbed, audit trail still naming them) would be the worst of both worlds.
 */
export async function anonymizeUser(args: { actorId: string; userId: string }): Promise<void> {
  const { actorId, userId } = args;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    // name/email are read BEFORE the scrub: they are the literals to remove from
    // free text elsewhere in the trail.
    select: { id: true, name: true, email: true, role: true, active: true, anonymizedAt: true },
  });
  if (!user) throw new UserError("Konto nicht gefunden.");
  if (user.anonymizedAt) throw new UserError("Dieses Konto wurde bereits anonymisiert.");
  if (actorId === userId) throw new UserError("Das eigene Konto kann nicht anonymisiert werden.");
  // NOTE: the definitive last-admin guard runs INSIDE the transaction below,
  // behind the same advisory lock setUserActive/updateUserProfile take. Checking
  // here as well only gives a faster, friendlier error before the expensive
  // redaction work — on its own it is a check-then-act race that could leave the
  // installation with zero admins (verified: two concurrent calls both passed).
  if (user.role === "ADMIN") {
    const others = await prisma.user.count({
      where: { role: "ADMIN", active: true, id: { not: userId } },
    });
    if (others === 0) {
      throw new UserError("Das letzte aktive Administrationskonto kann nicht anonymisiert werden.");
    }
  }

  const shortId = userId.slice(-6);
  const placeholder = `Anonymisiert ${shortId}`;
  const unusableHash = await hashPassword(`disabled-${userId}-${shortId}`);

  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // First the person's clock lock: a punch already past its session check
      // then either commits before the device labels are cleared below, or
      // waits and finds the account inactive. Never a label written after.
      await lockClock(tx, userId);

      // Ids of everything that belongs to this person. Audit rows about their
      // working time are keyed by the ENTRY id, not by the user id, so without
      // this collection those rows (and the notes copied into them) are
      // unreachable. `batchId` covers the two batch-level rows, which are
      // targeted by the batch id rather than by any single entry.
      // Sequential, not Promise.all: inside an interactive transaction every
      // statement shares one connection, so there is nothing to win by
      // overlapping them and ordering stays obvious.
      const entries = await tx.timeEntry.findMany({
        where: { userId },
        select: { id: true, batchId: true },
      });
      const absences = await tx.absence.findMany({ where: { userId }, select: { id: true } });
      const corrections = await tx.correctionRequest.findMany({
        where: { userId },
        select: { id: true },
      });
      const schedules = await tx.workSchedule.findMany({ where: { userId }, select: { id: true } });
      const targetIds: string[] = [
        ...entries.map((e: { id: string }) => e.id),
        ...entries
          .map((e: { batchId: string | null }) => e.batchId)
          .filter((b: string | null): b is string => b !== null),
        ...absences.map((a: { id: string }) => a.id),
        ...corrections.map((c: { id: string }) => c.id),
        ...schedules.map((s: { id: string }) => s.id),
      ];

      const auditRowsRedacted = await redactAuditForSubject(tx, {
        userId,
        targetIds,
        literals: [user.name, user.email],
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          name: placeholder,
          email: `anonym+${userId}@example.invalid`,
          passwordHash: unusableHash,
          birthDate: null,
          bundesland: null,
          isSchwerbehindert: false,
          schwerbehindertFrom: null,
          schwerbehindertTo: null,
          totpSecret: null,
          totpPendingSecret: null,
          totpEnabledAt: null,
          totpLastStep: null,
          totpFailures: 0,
          totpBlockedUntil: null,
          kioskPinHash: null,
          kioskPinFailures: 0,
          kioskPinBlockedUntil: null,
          active: false,
          anonymizedAt: new Date(),
        },
      });
      await tx.recoveryCode.deleteMany({ where: { userId } });

      // Clear the free-text columns that may carry personal data; keep the time
      // facts. CorrectionRequest.reason is NOT NULL, so it gets the marker
      // rather than null — the request still shows that a reason was given.
      const entryNotes = await tx.timeEntry.updateMany({
        where: { userId, note: { not: null } },
        data: { note: null },
      });
      // `correctionReason` is free text an admin typed about this person and is
      // cleared with the note; the correction FACT (who, when) stays on file.
      const absenceNotes = await tx.absence.updateMany({
        where: { userId, OR: [{ note: { not: null } }, { correctionReason: { not: null } }] },
        data: { note: null, correctionReason: null },
      });
      const deviceLabels = await tx.clockEvent.updateMany({
        where: { userId, deviceLabel: { not: null } },
        data: { deviceLabel: null },
      });
      const scheduleNotes = await tx.workSchedule.updateMany({
        where: { userId, note: { not: null } },
        data: { note: null },
      });
      const correctionTexts = await tx.correctionRequest.updateMany({
        where: { userId },
        data: { reason: REDACTED, decisionNote: null },
      });

      await writeAudit(tx, {
        actorUserId: actorId,
        action: "user.anonymize",
        targetType: "User",
        targetId: userId,
        // Counts only — this record must not reintroduce any personal data.
        newValue: {
          auditRowsRedacted,
          timeEntryNotesCleared: entryNotes.count,
          absenceNotesCleared: absenceNotes.count,
          workScheduleNotesCleared: scheduleNotes.count,
          clockDeviceLabelsCleared: deviceLabels.count,
          correctionTextsRedacted: correctionTexts.count,
        },
        reason: "DSGVO Art. 17 — Anonymisierung",
      });
    },
    // The redaction pass touches one row at a time across the whole trail, which
    // can outlast Prisma's 5 s interactive-transaction default on a long history.
    { timeout: 120_000 },
  );
}
