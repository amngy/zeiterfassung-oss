import { createHash } from "node:crypto";
import { Prisma, type ClockChannel, type ClockEventKind } from "@prisma/client";
import { prisma } from "@/lib/db";

// ── Punches: clock in/out, break start/end ──────────────────────────────────
//
// Tamper-evidence note: a TimeEntry is "logged" once it is CLOSED. While an
// entry is open (end === null) it is an in-progress recording, so clocking out
// (setting `end` from null → now) COMPLETES the record — it is not a silent
// alteration of an already-logged time. Changing an already-closed start/end is
// a different operation that flows through the correction/approval model
// and is versioned + audited. We never guess or auto-fill an end time.
//
// Every successful punch also writes one ClockEvent in the same transaction,
// recording the channel and a coarse device label. The entry cannot carry that
// itself: its start and end are two punches that may come from two devices.
//
// Integrity guards:
//  - At most one open ACTIVE entry per (user, type) is enforced by a DB partial
//    unique index (migration 20260616120000_one_open_entry_per_type), so racing
//    double clock-ins cannot create two open shifts (a check-then-insert is not
//    race-safe under READ COMMITTED). A unique-violation surfaces as a friendly
//    "already clocked in" message.
//  - Clock-out / end-break complete the record with updateMany(..., end: null),
//    so the write only ever flips null→now and can never overwrite an end that
//    another concurrent request already set.
//  - EVERY punch below additionally runs inside `withClockLock`, a per-user
//    transaction-level advisory lock. The two guards above each protect a
//    SINGLE row; they say nothing about the invariant that spans two rows — "a
//    BREAK only ever exists inside an open WORK session". Both `clockOut` and
//    `startBreak` are check-then-act across that pair, so without the lock:
//
//        startBreak: sees an open WORK  ─┐
//        clockOut:   sees no open BREAK ─┤ both checks pass
//        clockOut:   closes the WORK    ─┤
//        startBreak: inserts the BREAK  ─┘
//
//    leaves the employee clocked OUT and permanently "on a break": the BREAK
//    runs until somebody ends it by hand, and summarizeDay then books those
//    break minutes against a period that has no work entry at all. Serialising
//    all punches per user makes each pair of checks atomic with its write,
//    so whichever action arrives second sees the first one's result and returns
//    its normal message ("Bitte zuerst die Pause beenden." /
//    "Sie müssen eingestempelt sein, um eine Pause zu starten.").

export interface ClockResult {
  ok: boolean;
  error?: string;
}

/** How a punch arrived. The server clock, never the client's, sets the time. */
export interface PunchContext {
  channel: ClockChannel;
  deviceLabel: string | null;
}

const ok: ClockResult = { ok: true };
const fail = (error: string): ClockResult => ({ ok: false, error });

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Namespace for the two-integer form of pg_advisory_xact_lock. Postgres keeps
 * that form in a different key space from the single-bigint form used by the
 * admin guard in @/lib/users, so the two locks can never collide.
 */
const CLOCK_LOCK_NAMESPACE = 20260730;

/**
 * Map a cuid to the signed 32-bit key the advisory lock takes. A hash collision
 * only means two unrelated employees briefly serialise against each other — it
 * can never produce a wrong result.
 */
function userLockKey(userId: string): number {
  return createHash("sha256").update(userId).digest().readInt32BE(0);
}

/** Take this user's clock lock inside `tx`. Anonymisation takes it as well. */
export async function lockClock(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(${CLOCK_LOCK_NAMESPACE}::int, ${userLockKey(userId)}::int)
  `;
}

/**
 * Run `body` in a transaction that holds this user's clock lock. The lock is
 * released by Postgres at COMMIT/ROLLBACK, so there is no release path to miss.
 *
 * The account is re-checked under the lock: the caller's session check ran
 * before it, and anonymisation takes the same lock, so a punch that was already
 * in flight can neither land after the account was closed nor write a device
 * label behind the anonymisation that just cleared them.
 */
function withClockLock(
  userId: string,
  body: (tx: Prisma.TransactionClient) => Promise<ClockResult>,
): Promise<ClockResult> {
  return prisma.$transaction(async (tx) => {
    await lockClock(tx, userId);
    const user = await tx.user.findUnique({ where: { id: userId }, select: { active: true } });
    if (!user?.active) return fail("Ihr Konto ist nicht aktiv.");
    return body(tx);
  });
}

function recordEvent(
  tx: Prisma.TransactionClient,
  args: { userId: string; kind: ClockEventKind; at: Date; timeEntryId: string; ctx: PunchContext },
): Promise<unknown> {
  return tx.clockEvent.create({
    data: {
      userId: args.userId,
      kind: args.kind,
      at: args.at,
      channel: args.ctx.channel,
      deviceLabel: args.ctx.deviceLabel,
      timeEntryId: args.timeEntryId,
    },
  });
}

/**
 * Complete the user's open entry of `type` at `at`. Returns the entry id, or
 * null when there is none. Only ever fills a null end (see the guards above).
 */
async function closeOpen(
  tx: Prisma.TransactionClient,
  userId: string,
  type: "WORK" | "BREAK",
  at: Date,
): Promise<string | null> {
  const open = await tx.timeEntry.findFirst({
    where: { userId, status: "ACTIVE", type, end: null },
    select: { id: true },
  });
  if (!open) return null;
  // The full predicate again, not just the id: an admin may supersede the row
  // between the read and this write (those paths do not take the clock lock),
  // and the UPDATE re-evaluates its WHERE after waiting for that row lock.
  const res = await tx.timeEntry.updateMany({
    where: { id: open.id, userId, status: "ACTIVE", type, end: null },
    data: { end: at },
  });
  return res.count === 1 ? open.id : null;
}

/** Begin a work session. The DB unique index refuses a second open WORK. */
export async function clockIn(userId: string, ctx: PunchContext): Promise<ClockResult> {
  try {
    return await withClockLock(userId, async (tx) => {
      const at = new Date();
      const entry = await tx.timeEntry.create({
        data: { userId, type: "WORK", start: at, source: "CLOCK", createdById: userId },
        select: { id: true },
      });
      await recordEvent(tx, { userId, kind: "CLOCK_IN", at, timeEntryId: entry.id, ctx });
      return ok;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("Sie sind bereits eingestempelt.");
    throw e;
  }
}

/** End the current work session. Requires no break to be running. */
export function clockOut(userId: string, ctx: PunchContext): Promise<ClockResult> {
  return withClockLock(userId, async (tx) => {
    const openBreak = await tx.timeEntry.findFirst({
      where: { userId, status: "ACTIVE", type: "BREAK", end: null },
      select: { id: true },
    });
    if (openBreak) return fail("Bitte zuerst die Pause beenden.");

    const at = new Date();
    const entryId = await closeOpen(tx, userId, "WORK", at);
    if (!entryId) return fail("Sie sind nicht eingestempelt.");
    await recordEvent(tx, { userId, kind: "CLOCK_OUT", at, timeEntryId: entryId, ctx });
    return ok;
  });
}

/** Start a break within the current work session. */
export async function startBreak(userId: string, ctx: PunchContext): Promise<ClockResult> {
  try {
    return await withClockLock(userId, async (tx) => {
      const openWork = await tx.timeEntry.findFirst({
        where: { userId, status: "ACTIVE", type: "WORK", end: null },
        select: { id: true },
      });
      if (!openWork) {
        return fail("Sie müssen eingestempelt sein, um eine Pause zu starten.");
      }

      const at = new Date();
      const entry = await tx.timeEntry.create({
        data: { userId, type: "BREAK", start: at, source: "CLOCK", createdById: userId },
        select: { id: true },
      });
      await recordEvent(tx, { userId, kind: "BREAK_START", at, timeEntryId: entry.id, ctx });
      return ok;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("Es läuft bereits eine Pause.");
    throw e;
  }
}

/** End the current break. */
export function endBreak(userId: string, ctx: PunchContext): Promise<ClockResult> {
  return withClockLock(userId, async (tx) => {
    const at = new Date();
    const entryId = await closeOpen(tx, userId, "BREAK", at);
    if (!entryId) return fail("Es läuft keine Pause.");
    await recordEvent(tx, { userId, kind: "BREAK_END", at, timeEntryId: entryId, ctx });
    return ok;
  });
}

/** Channel + device label → "Browser · iPhone · Safari", for display and exports. */
export function describePunch(e: { channel: ClockChannel; deviceLabel: string | null }): string {
  const channel: Record<ClockChannel, string> = {
    WEB: "Browser",
    KIOSK: "Terminal",
    NFC: "NFC-Tag",
    QR: "QR-Code",
  };
  return [channel[e.channel], e.deviceLabel].filter(Boolean).join(" · ");
}
