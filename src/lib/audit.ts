// Append-only audit trail (revisionssicher). Every create/correct/decision is
// recorded here with actor, timestamp, old→new value and a mandatory reason.
// The AuditLog table has NO foreign keys, so the history survives user
// anonymisation/erasure (DSGVO Art. 17 vs. retention duties).
//
// There is intentionally no update helper and no delete helper — the trail is
// write-once, with ONE narrow exception: `redactAuditForSubject` below, which
// DSGVO Art. 17 requires. It never deletes a row and never touches `action`,
// `targetType`, `targetId`, `actorUserId` or `createdAt`; it only overwrites the
// personal data inside `oldValue`/`newValue`/`reason` with a marker, so the log
// still proves THAT a change happened and when — which is exactly what the
// retention duties (GoBD, § 147 AO, ArbZG § 16(2)) need it for.

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

// Accept either the root client or a transaction client, so an audit row can be
// written atomically inside the same transaction as the change it records.
type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditInput {
  actorUserId: string | null;
  action: string; // e.g. "timeentry.correct", "correction.approve"
  targetType: string; // e.g. "TimeEntry", "CorrectionRequest"
  targetId?: string | null;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  reason?: string | null;
}

/** Write one append-only audit record. */
export async function writeAudit(db: Db, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      oldValue: input.oldValue ?? undefined,
      newValue: input.newValue ?? undefined,
      reason: input.reason ?? null,
    },
  });
}

// ── DSGVO Art. 17 redaction ──────────────────────────────────────────────────

/** Written in place of personal data removed by an Art. 17 anonymisation. */
export const REDACTED = "[anonymisiert]";

/**
 * Payload keys that carry a person's identity. Only redacted on rows whose
 * `targetType` is "User" — a `name` inside a Holiday payload is a public
 * calendar fact, not personal data, and must survive.
 */
const IDENTITY_KEYS = new Set(["name", "email"]);

/** Payload keys that carry free text somebody typed (can contain anything). */
const FREE_TEXT_KEYS = new Set(["note", "reason", "decisionNote", "comment"]);

/** A literal shorter than this is not scrubbed — too likely to hit real words. */
const MIN_LITERAL_LENGTH = 3;

export interface AuditRedactionScope {
  /** The person being anonymised. */
  userId: string;
  /**
   * Ids of the records that belong to them. Audit rows about someone's working
   * time are keyed by the ENTRY id (TimeEntry / Absence / CorrectionRequest /
   * WorkSchedule / batch id), never by the user id, so without these the rows
   * carrying their notes cannot be found at all.
   */
  targetIds: readonly string[];
  /** Literals to remove from free text anywhere (their name, their e-mail). */
  literals: readonly string[];
}

interface RedactOptions {
  /** Replace `name`/`email` values (only for rows about a User). */
  identity: boolean;
  /** Replace free-text values. */
  freeText: boolean;
  literals: readonly string[];
}

/** Case-insensitive literal replace — no regex, so names with `.`/`+` are safe. */
function replaceLiteral(haystack: string, needle: string): string {
  const hay = haystack.toLowerCase();
  const pin = needle.toLowerCase();
  let out = "";
  let from = 0;
  for (;;) {
    const at = hay.indexOf(pin, from);
    if (at === -1) return out + haystack.slice(from);
    out += haystack.slice(from, at) + REDACTED;
    from = at + needle.length;
  }
}

function scrubLiterals(text: string, literals: readonly string[]): string {
  let out = text;
  for (const literal of literals) out = replaceLiteral(out, literal);
  return out;
}

/** Redact one JSON payload in place-preserving fashion (shape stays identical). */
function redactValue(value: unknown, opts: RedactOptions): unknown {
  if (Array.isArray(value)) return value.map((v) => redactValue(v, opts));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const isPersonal =
        (opts.identity && IDENTITY_KEYS.has(key)) || (opts.freeText && FREE_TEXT_KEYS.has(key));
      // A null stays null: "nothing was recorded here" is itself a fact, and the
      // marker would wrongly suggest something had been removed.
      out[key] = isPersonal && v !== null ? REDACTED : redactValue(v, opts);
    }
    return out;
  }
  if (typeof value === "string") return scrubLiterals(value, opts.literals);
  return value;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Redact the personal data one subject left in the audit trail (DSGVO Art. 17).
 * Rows are UPDATED, never removed, and only their payload/reason change.
 *
 * Two different scopes, deliberately:
 *  - rows ABOUT the subject (their User row, their entries/absences/corrections/
 *    schedules, or a payload referencing their id) lose every identity and
 *    free-text value plus the whole `reason` column;
 *  - rows they merely ACTED on describe a COLLEAGUE's record — blanking those
 *    would punch holes in someone else's history, so only stray mentions of the
 *    subject's own name or e-mail are scrubbed out of the text there.
 *
 * Returns the number of rows actually changed.
 */
export async function redactAuditForSubject(
  db: Db,
  scope: AuditRedactionScope,
): Promise<number> {
  const { userId } = scope;
  const ownTargetIds = [...new Set([userId, ...scope.targetIds])];
  const literals = scope.literals
    .map((l) => l.trim())
    .filter((l) => l.length >= MIN_LITERAL_LENGTH);

  // Payload-embedded references (a batch summary carries `for: <userId>`) are
  // found with a text scan. The id is a cuid, so a substring match is exact.
  const referenced: { id: string }[] = await db.$queryRaw`
    SELECT "id" FROM "AuditLog"
    WHERE "oldValue"::text LIKE ${`%${userId}%`}
       OR "newValue"::text LIKE ${`%${userId}%`}
  `;
  const referencedIds = new Set(referenced.map((r) => r.id));

  const rows: {
    id: string;
    targetType: string;
    targetId: string | null;
    oldValue: unknown;
    newValue: unknown;
    reason: string | null;
  }[] = await db.auditLog.findMany({
    where: {
      OR: [
        { actorUserId: userId },
        { targetId: { in: ownTargetIds } },
        { id: { in: [...referencedIds] } },
      ],
    },
    select: {
      id: true,
      targetType: true,
      targetId: true,
      oldValue: true,
      newValue: true,
      reason: true,
    },
  });

  const ownTargets = new Set(ownTargetIds);
  let changed = 0;

  for (const row of rows) {
    const aboutSubject =
      (row.targetId !== null && ownTargets.has(row.targetId)) || referencedIds.has(row.id);
    const opts: RedactOptions = {
      identity: aboutSubject && row.targetType === "User",
      freeText: aboutSubject,
      literals,
    };
    const oldValue = redactValue(row.oldValue, opts);
    const newValue = redactValue(row.newValue, opts);
    const reason =
      row.reason === null
        ? null
        : aboutSubject
          ? REDACTED
          : scrubLiterals(row.reason, literals);

    const data: Record<string, unknown> = {};
    if (!sameJson(oldValue, row.oldValue)) data.oldValue = oldValue;
    if (!sameJson(newValue, row.newValue)) data.newValue = newValue;
    if (reason !== null && reason !== row.reason) data.reason = reason;
    if (Object.keys(data).length === 0) continue;

    await db.auditLog.update({ where: { id: row.id }, data });
    changed += 1;
  }

  return changed;
}

export interface AuditRow {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  /** Name of the employee this entry is about (target subject), if resolvable. */
  subjectName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  createdAt: Date;
}

/** Recent audit entries (admin view), newest first, with actor names resolved. */
export async function getAuditLog(limit = 200): Promise<AuditRow[]> {
  const rows = await prisma.auditLog.findMany({
    // `id` is a stable secondary key so rows written in the same transaction
    // (which share a transaction-time createdAt) always order deterministically.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return resolveActors(rows);
}

/** Audit history for one target object (e.g. an employee's own entry). */
export async function getAuditForTarget(
  targetType: string,
  targetId: string,
): Promise<AuditRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: { targetType, targetId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return resolveActors(rows);
}

/** Pull a holiday name out of an audit payload (holidays have no user subject). */
function holidayName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

async function resolveActors(
  rows: Awaited<ReturnType<typeof prisma.auditLog.findMany>>,
): Promise<AuditRow[]> {
  // Most targets are related to an employee, but the audit row only stores the
  // target's own id (e.g. an Absence id). Batch-resolve those to their userId
  // so the log can show *who* an action was about, not just who performed it.
  const absenceIds = new Set<string>();
  const correctionIds = new Set<string>();
  const timeEntryIds = new Set<string>();
  for (const r of rows) {
    if (!r.targetId) continue;
    if (r.targetType === "Absence") absenceIds.add(r.targetId);
    else if (r.targetType === "CorrectionRequest") correctionIds.add(r.targetId);
    else if (r.targetType === "TimeEntry") timeEntryIds.add(r.targetId);
  }

  const [absences, corrections, entries] = await Promise.all([
    absenceIds.size
      ? prisma.absence.findMany({ where: { id: { in: [...absenceIds] } }, select: { id: true, userId: true } })
      : Promise.resolve([]),
    correctionIds.size
      ? prisma.correctionRequest.findMany({ where: { id: { in: [...correctionIds] } }, select: { id: true, userId: true } })
      : Promise.resolve([]),
    timeEntryIds.size
      ? prisma.timeEntry.findMany({ where: { id: { in: [...timeEntryIds] } }, select: { id: true, userId: true } })
      : Promise.resolve([]),
  ]);

  const subjectUserByTarget = new Map<string, string>();
  for (const row of [...absences, ...corrections, ...entries]) {
    subjectUserByTarget.set(row.id, row.userId);
  }

  const subjectUserId = (r: (typeof rows)[number]): string | null => {
    if (r.targetType === "User") return r.targetId;
    if (r.targetId) return subjectUserByTarget.get(r.targetId) ?? null;
    return null;
  };

  // One user lookup for both actors and subjects.
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.actorUserId) userIds.add(r.actorUserId);
    const subj = subjectUserId(r);
    if (subj) userIds.add(subj);
  }
  const users = userIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return rows.map((r) => {
    const subj = subjectUserId(r);
    let subjectName: string | null = subj ? nameById.get(subj) ?? null : null;
    // Holidays have no employee subject — fall back to the holiday's own name.
    if (!subjectName && r.targetType === "Holiday") {
      subjectName = holidayName(r.newValue) ?? holidayName(r.oldValue);
    }
    return {
      id: r.id,
      actorUserId: r.actorUserId,
      actorName: r.actorUserId ? (nameById.get(r.actorUserId) ?? null) : null,
      subjectName,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      oldValue: r.oldValue,
      newValue: r.newValue,
      reason: r.reason,
      createdAt: r.createdAt,
    };
  });
}
