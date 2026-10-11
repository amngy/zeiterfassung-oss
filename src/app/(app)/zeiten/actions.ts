"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/session";

// ── Clock actions ───────────────────────────────────────────────────────────
//
// Tamper-evidence note: a TimeEntry is "logged" once it is CLOSED. While an
// entry is open (end === null) it is an in-progress recording, so clocking out
// (setting `end` from null → now) COMPLETES the record — it is not a silent
// alteration of an already-logged time. Changing an already-closed start/end is
// a different operation that flows through the correction/approval model
// and is versioned + audited. We never guess or auto-fill an end time.
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
//  - EVERY action below additionally runs inside `withClockLock`, a per-user
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
//    all clock actions per user makes each pair of checks atomic with its write,
//    so whichever action arrives second sees the first one's result and returns
//    its normal message ("Bitte zuerst die Pause beenden." /
//    "Sie müssen eingestempelt sein, um eine Pause zu starten.").

export interface ClockResult {
  ok: boolean;
  error?: string;
}

const ok: ClockResult = { ok: true };
const fail = (error: string): ClockResult => ({ ok: false, error });

function refresh(): void {
  revalidatePath("/zeiten");
  revalidatePath("/dashboard");
}

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

/**
 * Run `body` in a transaction that holds this user's clock lock. The lock is
 * released by Postgres at COMMIT/ROLLBACK, so there is no release path to miss.
 */
function withClockLock(
  userId: string,
  body: (tx: Prisma.TransactionClient) => Promise<ClockResult>,
): Promise<ClockResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(${CLOCK_LOCK_NAMESPACE}::int, ${userLockKey(userId)}::int)
    `;
    return body(tx);
  });
}

/** Begin a work session. The DB unique index refuses a second open WORK. */
export async function clockIn(): Promise<ClockResult> {
  const user = await requireActiveUser();
  let result: ClockResult;
  try {
    result = await withClockLock(user.id, async (tx) => {
      await tx.timeEntry.create({
        data: {
          userId: user.id,
          type: "WORK",
          start: new Date(),
          source: "CLOCK",
          createdById: user.id,
        },
      });
      return ok;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("Sie sind bereits eingestempelt.");
    throw e;
  }
  if (result.ok) refresh();
  return result;
}

/** End the current work session. Requires no break to be running. */
export async function clockOut(): Promise<ClockResult> {
  const user = await requireActiveUser();

  const result = await withClockLock(user.id, async (tx) => {
    const openBreak = await tx.timeEntry.findFirst({
      where: { userId: user.id, status: "ACTIVE", type: "BREAK", end: null },
      select: { id: true },
    });
    if (openBreak) return fail("Bitte zuerst die Pause beenden.");

    // Conditional completion: only ever fills a null end, never rewrites a closed
    // one (guards against a concurrent double clock-out).
    const res = await tx.timeEntry.updateMany({
      where: { userId: user.id, status: "ACTIVE", type: "WORK", end: null },
      data: { end: new Date() },
    });
    if (res.count === 0) return fail("Sie sind nicht eingestempelt.");
    return ok;
  });

  if (result.ok) refresh();
  return result;
}

/** Start a break within the current work session. */
export async function startBreak(): Promise<ClockResult> {
  const user = await requireActiveUser();

  let result: ClockResult;
  try {
    result = await withClockLock(user.id, async (tx) => {
      const openWork = await tx.timeEntry.findFirst({
        where: { userId: user.id, status: "ACTIVE", type: "WORK", end: null },
        select: { id: true },
      });
      if (!openWork) {
        return fail("Sie müssen eingestempelt sein, um eine Pause zu starten.");
      }

      await tx.timeEntry.create({
        data: {
          userId: user.id,
          type: "BREAK",
          start: new Date(),
          source: "CLOCK",
          createdById: user.id,
        },
      });
      return ok;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("Es läuft bereits eine Pause.");
    throw e;
  }
  if (result.ok) refresh();
  return result;
}

/** End the current break. */
export async function endBreak(): Promise<ClockResult> {
  const user = await requireActiveUser();

  const result = await withClockLock(user.id, async (tx) => {
    const res = await tx.timeEntry.updateMany({
      where: { userId: user.id, status: "ACTIVE", type: "BREAK", end: null },
      data: { end: new Date() },
    });
    if (res.count === 0) return fail("Es läuft keine Pause.");
    return ok;
  });

  if (result.ok) refresh();
  return result;
}
