// Admin user-management data layer. Creating accounts, editing the
// identity / region / status flags, setting effective-dated work schedules,
// resetting passwords and (de)activating accounts. Every mutation is written to
// the append-only audit trail; password values are NEVER logged.
//
// Accounts are deactivated, never hard-deleted (retention duties) — see the
// DSGVO layer (@/lib/dsgvo) for anonymisation after the retention period.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/password";
import { berlinDayKey, weeklyTargetHours, type WeekdayHours } from "@/lib/time";

/** Thrown for expected, user-facing guard violations (turned into messages). */
export class UserError extends Error {}

function dateKeyToUtc(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}
function utcToKey(date: Date | null): string {
  return date ? berlinDayKey(date, "UTC") : "";
}

function scheduleToHours(s: {
  hoursMon: number; hoursTue: number; hoursWed: number; hoursThu: number;
  hoursFri: number; hoursSat: number; hoursSun: number;
}): WeekdayHours {
  return {
    mon: s.hoursMon, tue: s.hoursTue, wed: s.hoursWed, thu: s.hoursThu,
    fri: s.hoursFri, sat: s.hoursSat, sun: s.hoursSun,
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

export interface UserListRow {
  id: string;
  name: string;
  email: string;
  role: "EMPLOYEE" | "ADMIN";
  active: boolean;
  isMinijob: boolean;
  exemptFromTimeRecording: boolean;
  exemptFromAutoBreak: boolean;
  bundesland: string | null;
  /** Sum of the currently-effective schedule's weekday hours. */
  weeklyHours: number;
  vacationDaysPerYear: number;
}

/** All accounts with their current weekly target, for the admin list. */
export async function listUsersWithDetails(): Promise<UserListRow[]> {
  const todayKey = berlinDayKey(new Date());
  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true, name: true, email: true, role: true, active: true,
      isMinijob: true, exemptFromTimeRecording: true, exemptFromAutoBreak: true,
      bundesland: true,
      vacationDaysPerYear: true,
      schedules: { orderBy: { effectiveFrom: "asc" } },
    },
  });
  return users.map((u) => {
    // The schedule in effect today: greatest effectiveFrom that is ≤ today.
    const effective = [...u.schedules]
      .reverse()
      .find((s) => utcToKey(s.effectiveFrom) <= todayKey) ?? u.schedules.at(-1);
    return {
      id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
      isMinijob: u.isMinijob, exemptFromTimeRecording: u.exemptFromTimeRecording,
      exemptFromAutoBreak: u.exemptFromAutoBreak,
      bundesland: u.bundesland,
      weeklyHours: effective ? weeklyTargetHours(scheduleToHours(effective)) : 0,
      vacationDaysPerYear: u.vacationDaysPerYear,
    };
  });
}

export interface UserDetail {
  id: string;
  name: string;
  email: string;
  role: "EMPLOYEE" | "ADMIN";
  active: boolean;
  bundesland: string;
  birthDate: string;
  employmentStart: string;
  employmentEnd: string;
  isMinijob: boolean;
  exemptFromTimeRecording: boolean;
  exemptFromAutoBreak: boolean;
  vacationDaysPerYear: number;
  vacationCarryOverDays: number;
  anonymizedAt: Date | null;
  twoFactorEnabled: boolean;
  /** A terminal PIN is set (#11); when PIN punching is blocked after wrong PINs. */
  kioskPinSet: boolean;
  kioskPinBlockedUntil: Date | null;
  schedules: {
    id: string;
    effectiveFrom: string;
    hours: WeekdayHours;
    weekly: number;
    note: string | null;
  }[];
}

/** Full profile + schedule history for the per-employee admin page. */
export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { schedules: { orderBy: { effectiveFrom: "desc" } } },
  });
  if (!u) return null;
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
    bundesland: u.bundesland ?? "",
    birthDate: utcToKey(u.birthDate),
    employmentStart: utcToKey(u.employmentStart),
    employmentEnd: utcToKey(u.employmentEnd),
    isMinijob: u.isMinijob,
    exemptFromTimeRecording: u.exemptFromTimeRecording,
    exemptFromAutoBreak: u.exemptFromAutoBreak,
    vacationDaysPerYear: u.vacationDaysPerYear,
    vacationCarryOverDays: u.vacationCarryOverDays,
    anonymizedAt: u.anonymizedAt,
    twoFactorEnabled: !!u.totpEnabledAt,
    kioskPinSet: !!u.kioskPinHash,
    kioskPinBlockedUntil: u.kioskPinBlockedUntil,
    schedules: u.schedules.map((s) => {
      const hours = scheduleToHours(s);
      return {
        id: s.id,
        effectiveFrom: utcToKey(s.effectiveFrom),
        hours,
        weekly: weeklyTargetHours(hours),
        note: s.note,
      };
    }),
  };
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export interface CreateUserArgs {
  actorId: string;
  name: string;
  email: string;
  password: string;
  role: "EMPLOYEE" | "ADMIN";
  bundesland?: string;
  birthDate?: string;
  employmentStart?: string;
  employmentEnd?: string;
  isMinijob: boolean;
  exemptFromTimeRecording: boolean;
  exemptFromAutoBreak: boolean;
  vacationDaysPerYear: number;
  schedule: WeekdayHours;
}

/** Create an account and its first work schedule (effective from employment start, else today). */
export async function createUser(args: CreateUserArgs): Promise<string> {
  const passwordHash = await hashPassword(args.password);
  const effectiveFromKey = args.employmentStart || berlinDayKey(new Date());
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: args.name,
          email: args.email,
          passwordHash,
          role: args.role,
          bundesland: args.bundesland ?? null,
          birthDate: args.birthDate ? dateKeyToUtc(args.birthDate) : null,
          employmentStart: args.employmentStart ? dateKeyToUtc(args.employmentStart) : null,
          employmentEnd: args.employmentEnd ? dateKeyToUtc(args.employmentEnd) : null,
          isMinijob: args.isMinijob,
          exemptFromTimeRecording: args.exemptFromTimeRecording,
          exemptFromAutoBreak: args.exemptFromAutoBreak,
          vacationDaysPerYear: args.vacationDaysPerYear,
        },
      });
      await tx.workSchedule.create({
        data: {
          userId: user.id,
          effectiveFrom: dateKeyToUtc(effectiveFromKey),
          hoursMon: args.schedule.mon, hoursTue: args.schedule.tue,
          hoursWed: args.schedule.wed, hoursThu: args.schedule.thu,
          hoursFri: args.schedule.fri, hoursSat: args.schedule.sat,
          hoursSun: args.schedule.sun,
        },
      });
      await writeAudit(tx, {
        actorUserId: args.actorId,
        action: "user.create",
        targetType: "User",
        targetId: user.id,
        newValue: {
          name: args.name, email: args.email, role: args.role,
          bundesland: args.bundesland ?? null,
          weeklyHours: weeklyTargetHours(args.schedule),
        },
      });
      return user.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("Diese E-Mail-Adresse wird bereits verwendet.");
    throw e;
  }
}

export interface UpdateUserArgs {
  actorId: string;
  userId: string;
  name: string;
  email: string;
  role: "EMPLOYEE" | "ADMIN";
  bundesland?: string;
  birthDate?: string;
  employmentStart?: string;
  employmentEnd?: string;
  isMinijob: boolean;
  exemptFromTimeRecording: boolean;
  exemptFromAutoBreak: boolean;
}

/** Update an account's identity / region / status flags (not its schedule or entitlement). */
export async function updateUserProfile(args: UpdateUserArgs): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      // Taken unconditionally, before anything is read: whether this edit
      // removes an admin is only knowable after reading the current role, and
      // by then an interleaving transaction could already have read the same
      // "there is another admin" answer. Profile edits are rare admin actions,
      // so serialising all of them costs nothing. See lockAdminGuard.
      await lockAdminGuard(tx);

      const before = await tx.user.findUnique({
        where: { id: args.userId },
        select: {
          name: true, email: true, role: true, active: true, bundesland: true,
          birthDate: true, employmentStart: true, employmentEnd: true,
          isMinijob: true, exemptFromTimeRecording: true, exemptFromAutoBreak: true,
        },
      });
      if (!before) throw new UserError("Konto nicht gefunden.");

      // Don't allow demoting the last remaining active admin to EMPLOYEE.
      if (before.role === "ADMIN" && args.role === "EMPLOYEE") {
        await assertNotLastAdmin(tx, args.userId);
      }

      await tx.user.update({
        where: { id: args.userId },
        data: {
          name: args.name,
          email: args.email,
          role: args.role,
          bundesland: args.bundesland ?? null,
          birthDate: args.birthDate ? dateKeyToUtc(args.birthDate) : null,
          employmentStart: args.employmentStart ? dateKeyToUtc(args.employmentStart) : null,
          employmentEnd: args.employmentEnd ? dateKeyToUtc(args.employmentEnd) : null,
          isMinijob: args.isMinijob,
          exemptFromTimeRecording: args.exemptFromTimeRecording,
          exemptFromAutoBreak: args.exemptFromAutoBreak,
        },
      });
      await writeAudit(tx, {
        actorUserId: args.actorId,
        action: "user.update",
        targetType: "User",
        targetId: args.userId,
        oldValue: {
          name: before.name, email: before.email, role: before.role,
          bundesland: before.bundesland,
          isMinijob: before.isMinijob,
          exemptFromTimeRecording: before.exemptFromTimeRecording,
          exemptFromAutoBreak: before.exemptFromAutoBreak,
        },
        newValue: {
          name: args.name, email: args.email, role: args.role,
          bundesland: args.bundesland ?? null,
          isMinijob: args.isMinijob,
          exemptFromTimeRecording: args.exemptFromTimeRecording,
          exemptFromAutoBreak: args.exemptFromAutoBreak,
        },
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("Diese E-Mail-Adresse wird bereits verwendet.");
    throw e;
  }
}

/**
 * Record a NEW effective-dated work schedule. Past schedules are kept so prior
 * periods are never silently recomputed (the calc layer picks the row in effect
 * on each date). Replacing the same effectiveFrom updates that row.
 */
export async function setUserSchedule(args: {
  actorId: string;
  userId: string;
  effectiveFrom: string;
  hours: WeekdayHours;
  note?: string;
}): Promise<void> {
  const { actorId, userId, effectiveFrom, hours, note } = args;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new UserError("Konto nicht gefunden.");

  await prisma.$transaction(async (tx) => {
    const existing = await tx.workSchedule.findFirst({
      where: { userId, effectiveFrom: dateKeyToUtc(effectiveFrom) },
    });
    const data = {
      hoursMon: hours.mon, hoursTue: hours.tue, hoursWed: hours.wed, hoursThu: hours.thu,
      hoursFri: hours.fri, hoursSat: hours.sat, hoursSun: hours.sun,
      note: note ?? null,
    };
    if (existing) {
      await tx.workSchedule.update({ where: { id: existing.id }, data });
    } else {
      await tx.workSchedule.create({
        data: { userId, effectiveFrom: dateKeyToUtc(effectiveFrom), ...data },
      });
    }
    await writeAudit(tx, {
      actorUserId: actorId,
      action: existing ? "user.schedule.update" : "user.schedule.add",
      targetType: "User",
      targetId: userId,
      newValue: {
        effectiveFrom,
        hours: {
          mon: hours.mon, tue: hours.tue, wed: hours.wed, thu: hours.thu,
          fri: hours.fri, sat: hours.sat, sun: hours.sun,
        },
        weekly: weeklyTargetHours(hours),
      },
      reason: note ?? null,
    });
  });
}

/** Activate or deactivate an account (never a hard delete). */
export async function setUserActive(args: {
  actorId: string;
  userId: string;
  active: boolean;
}): Promise<void> {
  const { actorId, userId, active } = args;

  await prisma.$transaction(async (tx) => {
    // Read, guard and write all inside one serialised transaction — see
    // lockAdminGuard for why the guard is worthless outside it.
    await lockAdminGuard(tx);

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { active: true, role: true },
    });
    if (!user) throw new UserError("Konto nicht gefunden.");
    if (user.active === active) return; // no-op

    if (!active && user.role === "ADMIN") await assertNotLastAdmin(tx, userId);

    await tx.user.update({ where: { id: userId }, data: { active } });
    await writeAudit(tx, {
      actorUserId: actorId,
      action: active ? "user.activate" : "user.deactivate",
      targetType: "User",
      targetId: userId,
      oldValue: { active: user.active },
      newValue: { active },
    });
  });
}

/** Admin resets an employee's password. The value itself is never audited. */
export async function resetUserPassword(args: {
  actorId: string;
  userId: string;
  password: string;
}): Promise<void> {
  const { actorId, userId, password } = args;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new UserError("Konto nicht gefunden.");
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "user.password.reset",
      targetType: "User",
      targetId: userId,
    });
  });
}

/** Self-service password change: verifies the current password first. */
export async function changeOwnPassword(args: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const { userId, currentPassword, newPassword } = args;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new UserError("Konto nicht gefunden.");
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new UserError("Das aktuelle Passwort ist nicht korrekt.");
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await writeAudit(tx, {
      actorUserId: userId,
      action: "user.password.change",
      targetType: "User",
      targetId: userId,
    });
  });
}

// ── helpers ────────────────────────────────────────────────────────────────────

/**
 * Constant key for the transaction-level advisory lock that serialises every
 * operation which can remove an active administrator.
 *
 * Uses the single-bigint form of pg_advisory_xact_lock, which Postgres keeps in
 * a different key space (pg_locks.objsubid = 1) from the two-integer form used
 * for the per-user clock lock in @/lib/clock (objsubid = 2), so the two
 * can never collide. A BigInt literal rather than a number so that the value
 * Prisma binds is unambiguously int8, matching the function's signature.
 */
const ADMIN_GUARD_LOCK_KEY = 2026073001n;

/**
 * Take the admin guard lock for the rest of the current transaction.
 *
 * WHY: `assertNotLastAdmin` is a check-then-act guard. Run outside the
 * transaction that follows it (or inside it, but without serialisation) two
 * concurrent admin sessions each COUNT one other active admin, each conclude
 * "there is a spare", and each commit — leaving ZERO active administrators.
 * This is a total production lockout, recoverable only with direct database
 * access, because every path that could restore an admin needs an admin who can
 * still log in. Postgres' default READ COMMITTED isolation does not prevent it,
 * and no unique/partial index can express "at least one row must exist".
 *
 * pg_advisory_xact_lock takes a plain mutex on a constant key and releases it at
 * COMMIT or ROLLBACK — no cleanup path to forget. Every transaction that can
 * demote, deactivate or anonymise an administrator must take it BEFORE reading
 * the admin count, and must do the count with the same `tx` client.
 *
 * Exported because src/lib/dsgvo.ts `anonymizeUser` performs the same
 * check-then-act and needs the same lock.
 */
export async function lockAdminGuard(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_GUARD_LOCK_KEY})`;
}

/**
 * Guard: there must always remain at least one other ACTIVE admin.
 *
 * Only sound when called with a transaction client whose transaction already
 * holds {@link lockAdminGuard} — otherwise see the race described there.
 */
export async function assertNotLastAdmin(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const others = await tx.user.count({
    where: { role: "ADMIN", active: true, id: { not: userId } },
  });
  if (others === 0) {
    throw new UserError("Das letzte aktive Administrationskonto kann nicht entfernt werden.");
  }
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}
