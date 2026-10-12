// Arbeitszeitkonto (#22) — rules in @/lib/time/overtime. The balance is never
// stored: it is the daily Saldo from the account's first day plus the
// bookings, computed on every read, so a correction to an old day shows up in
// the account at once.

import { Prisma, type OvertimeBookingKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getAppSettings } from "@/lib/settings";
import { getPeriodSummary } from "@/lib/timesheet";
import {
  addDaysToKey,
  berlinDayKey,
  bookedMs,
  isMonthStart,
  limitExcess,
  MAX_BOOKING_HOURS,
  signedBookingMinutes,
  type ManualOvertimeKind,
} from "@/lib/time";

export class OvertimeError extends Error {}

/** "YYYY-MM-DD" of a @db.Date column (stored as UTC midnight). */
const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export interface OvertimeBookingRow {
  id: string;
  kind: OvertimeBookingKind;
  dayKey: string;
  minutes: number;
  note: string | null;
  createdAt: Date;
  createdByName: string | null;
  /** This booking reverses another one. */
  reversesId: string | null;
  /** Another booking reverses this one. */
  reversed: boolean;
}

export interface OvertimeAccount {
  fromKey: string;
  /** Daily Saldo from the first day up to today (as on the timesheet). */
  workMs: number;
  bookedMs: number;
  balanceMs: number;
  overCapMs: number;
  underFloorMs: number;
  /** Newest first. */
  bookings: OvertimeBookingRow[];
}

async function loadBookings(userId: string): Promise<OvertimeBookingRow[]> {
  const rows = await prisma.overtimeBooking.findMany({
    where: { userId },
    orderBy: [{ day: "desc" }, { createdAt: "desc" }],
    include: { reversedBy: { select: { id: true } } },
  });
  const authorIds = [...new Set(rows.map((r) => r.createdById).filter((id): id is string => !!id))];
  const authors = new Map(
    (await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })).map((u) => [
      u.id,
      u.name,
    ]),
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    dayKey: dateKey(r.day),
    minutes: r.minutes,
    note: r.note,
    createdAt: r.createdAt,
    createdByName: r.createdById ? (authors.get(r.createdById) ?? null) : null,
    reversesId: r.reversesId,
    reversed: !!r.reversedBy,
  }));
}

/** Daily Saldo over [fromKey, toKey], or 0 for an empty range. */
async function workBalanceMs(userId: string, fromKey: string, toKey: string, asOf: Date): Promise<number> {
  if (toKey < fromKey) return 0;
  return (await getPeriodSummary(userId, fromKey, toKey, asOf)).balanceMs;
}

/** The person's account as of `asOf`, or null if none is kept. */
export async function getOvertimeAccount(userId: string, asOf: Date = new Date()): Promise<OvertimeAccount | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { overtimeAccountFrom: true } });
  if (!user?.overtimeAccountFrom) return null;
  const fromKey = dateKey(user.overtimeAccountFrom);
  const todayKey = berlinDayKey(asOf);
  const [settings, bookings, workMs] = await Promise.all([
    getAppSettings(),
    loadBookings(userId),
    workBalanceMs(userId, fromKey, todayKey, asOf),
  ]);
  const booked = bookedMs(bookings, undefined, todayKey);
  const balanceMs = workMs + booked;
  return { fromKey, workMs, bookedMs: booked, balanceMs, ...limitExcess(balanceMs, settings.overtimeLimits), bookings };
}

export interface OvertimeOverviewRow {
  userId: string;
  name: string;
  fromKey: string;
  balanceMs: number;
  overCapMs: number;
  underFloorMs: number;
}

/** Every active person's account, by name — for the admin overview. */
export async function listOvertimeAccounts(asOf: Date = new Date()): Promise<OvertimeOverviewRow[]> {
  const users = await prisma.user.findMany({
    where: { active: true, overtimeAccountFrom: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const rows: OvertimeOverviewRow[] = [];
  // One person at a time: each account reads its whole history.
  for (const u of users) {
    const a = await getOvertimeAccount(u.id, asOf);
    if (a) rows.push({ userId: u.id, name: u.name, fromKey: a.fromKey, balanceMs: a.balanceMs, overCapMs: a.overCapMs, underFloorMs: a.underFloorMs });
  }
  return rows;
}

export interface OvertimeMonth {
  /** Balance at the end of the previous month (0 in the account's first month). */
  carryInMs: number;
  /** Bookings dated in the month, oldest first. */
  bookings: OvertimeBookingRow[];
  bookedMs: number;
}

/**
 * The account's side of a monthly report for [monthFrom, monthTo]: what came
 * in from before and what was booked in the month. Null when no account was
 * kept in that month. The month's own Saldo comes from the report itself, so
 * carry-in + Saldo + bookings add up on paper.
 */
export async function overtimeForMonth(
  userId: string,
  monthFrom: string,
  monthTo: string,
  asOf: Date = new Date(),
): Promise<OvertimeMonth | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { overtimeAccountFrom: true } });
  if (!user?.overtimeAccountFrom) return null;
  const fromKey = dateKey(user.overtimeAccountFrom);
  if (fromKey > monthTo) return null;
  const bookings = await loadBookings(userId);
  const before = addDaysToKey(monthFrom, -1);
  const carryInMs =
    fromKey < monthFrom ? (await workBalanceMs(userId, fromKey, before, asOf)) + bookedMs(bookings, undefined, before) : 0;
  const inMonth = bookings.filter((b) => b.dayKey >= monthFrom && b.dayKey <= monthTo).reverse();
  return { carryInMs, bookings: inMonth, bookedMs: bookedMs(inMonth) };
}

// ── Admin: starting an account and booking on it ─────────────────────────────

const MAX_MINUTES = MAX_BOOKING_HOURS * 60;

function checkMinutes(minutes: number, allowZero: boolean): void {
  if (!Number.isInteger(minutes) || Math.abs(minutes) > MAX_MINUTES || (!allowZero && minutes === 0)) {
    throw new OvertimeError(`Bitte Stunden zwischen 0:01 und ${MAX_BOOKING_HOURS}:00 angeben.`);
  }
}

function checkNote(note: string): string {
  const n = note.trim();
  if (n.length < 3) throw new OvertimeError("Bitte eine Begründung angeben.");
  return n.slice(0, 500);
}

/**
 * Keep an account from `fromKey` (the 1st of this or an earlier month), with
 * an optional opening balance — e.g. the hours carried over from paper.
 */
export async function startOvertimeAccount(args: {
  actorId: string;
  userId: string;
  fromKey: string;
  openingMinutes: number;
  note: string;
  asOf?: Date;
}): Promise<void> {
  const todayKey = berlinDayKey(args.asOf ?? new Date());
  if (!isMonthStart(args.fromKey) || args.fromKey > todayKey) {
    throw new OvertimeError("Das Konto beginnt am 1. dieses oder eines früheren Monats.");
  }
  checkMinutes(args.openingMinutes, true);
  const note = args.openingMinutes !== 0 ? checkNote(args.note) : args.note.trim().slice(0, 500) || null;

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: args.userId, active: true, anonymizedAt: null, overtimeAccountFrom: null },
      data: { overtimeAccountFrom: new Date(args.fromKey) },
    });
    if (count === 0) throw new OvertimeError("Für dieses Konto läuft bereits ein Arbeitszeitkonto, oder es ist nicht aktiv.");
    if (args.openingMinutes !== 0) {
      await tx.overtimeBooking.create({
        data: {
          userId: args.userId,
          kind: "OPENING",
          day: new Date(args.fromKey),
          minutes: args.openingMinutes,
          note,
          createdById: args.actorId,
        },
      });
    }
    await writeAudit(tx, {
      actorUserId: args.actorId,
      action: "overtime.start",
      targetType: "User",
      targetId: args.userId,
      newValue: { from: args.fromKey, openingMinutes: args.openingMinutes },
    });
  });
}

/** A payout, forfeiture or correction, dated between the account's start and today. */
export async function bookOvertime(args: {
  actorId: string;
  userId: string;
  kind: ManualOvertimeKind;
  dayKey: string;
  minutes: number;
  note: string;
  asOf?: Date;
}): Promise<void> {
  checkMinutes(args.minutes, false);
  const note = checkNote(args.note);
  const minutes = signedBookingMinutes(args.kind, args.minutes);
  const todayKey = berlinDayKey(args.asOf ?? new Date());

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: args.userId }, select: { overtimeAccountFrom: true } });
    if (!user?.overtimeAccountFrom) throw new OvertimeError("Für diese Person wird kein Arbeitszeitkonto geführt.");
    const fromKey = dateKey(user.overtimeAccountFrom);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dayKey) || args.dayKey < fromKey || args.dayKey > todayKey) {
      throw new OvertimeError("Das Datum muss zwischen dem Beginn des Kontos und heute liegen.");
    }
    const booking = await tx.overtimeBooking.create({
      data: { userId: args.userId, kind: args.kind, day: new Date(args.dayKey), minutes, note, createdById: args.actorId },
    });
    await writeAudit(tx, {
      actorUserId: args.actorId,
      action: "overtime.book",
      targetType: "OvertimeBooking",
      targetId: booking.id,
      newValue: { userId: args.userId, kind: args.kind, day: args.dayKey, minutes },
      reason: note,
    });
  });
}

/**
 * Cancel a booking by a counter booking dated today — past months stay as they
 * were reported. A booking is reversed at most once; reversals and carry
 * forwards cannot be reversed.
 */
export async function reverseOvertimeBooking(args: {
  actorId: string;
  bookingId: string;
  note: string;
  asOf?: Date;
}): Promise<string> {
  const note = checkNote(args.note);
  const todayKey = berlinDayKey(args.asOf ?? new Date());
  try {
    return await prisma.$transaction(async (tx) => {
      const b = await tx.overtimeBooking.findUnique({ where: { id: args.bookingId } });
      if (!b) throw new OvertimeError("Buchung nicht gefunden.");
      if (b.reversesId || b.kind === "CARRY_FORWARD") {
        throw new OvertimeError("Diese Buchung kann nicht storniert werden.");
      }
      const reversal = await tx.overtimeBooking.create({
        data: {
          userId: b.userId,
          kind: b.kind,
          day: new Date(todayKey),
          minutes: -b.minutes,
          note,
          createdById: args.actorId,
          reversesId: b.id,
        },
      });
      await writeAudit(tx, {
        actorUserId: args.actorId,
        action: "overtime.reverse",
        targetType: "OvertimeBooking",
        targetId: b.id,
        newValue: { reversal: reversal.id, minutes: -b.minutes },
        reason: note,
      });
      return b.userId;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new OvertimeError("Diese Buchung ist bereits storniert.");
    }
    throw e;
  }
}

// ── Retention (#17): condense what is about to be deleted ────────────────────

export interface CarryForward {
  userId: string;
  minutes: number;
}

/**
 * Balances at the end of the day before `cutoffKey` for every account that
 * started earlier. Read before the purge deletes the records behind them.
 */
export async function carryForwardsBefore(cutoffKey: string, asOf: Date = new Date()): Promise<CarryForward[]> {
  const users = await prisma.user.findMany({
    where: { overtimeAccountFrom: { lt: new Date(cutoffKey) } },
    select: { id: true, overtimeAccountFrom: true },
  });
  const before = addDaysToKey(cutoffKey, -1);
  const out: CarryForward[] = [];
  for (const u of users) {
    const work = await workBalanceMs(u.id, dateKey(u.overtimeAccountFrom!), before, asOf);
    const bookings = await prisma.overtimeBooking.findMany({
      where: { userId: u.id, day: { lt: new Date(cutoffKey) } },
      select: { minutes: true },
    });
    const minutes = Math.round(work / 60_000) + bookings.reduce((sum, b) => sum + b.minutes, 0);
    out.push({ userId: u.id, minutes });
  }
  return out;
}

/**
 * Inside the purge transaction: each account restarts at the cutoff with its
 * balance as a carry forward, and the bookings before it go.
 */
export async function applyCarryForwards(
  tx: Prisma.TransactionClient,
  cutoffKey: string,
  carries: CarryForward[],
  actorId: string,
): Promise<number> {
  const cutoff = new Date(cutoffKey);
  for (const c of carries) {
    await tx.overtimeBooking.deleteMany({ where: { userId: c.userId, day: { lt: cutoff } } });
    await tx.overtimeBooking.create({
      data: {
        userId: c.userId,
        kind: "CARRY_FORWARD",
        day: cutoff,
        minutes: c.minutes,
        note: "Saldo vor dem Löschen abgelaufener Aufzeichnungen",
        createdById: actorId,
      },
    });
    await tx.user.update({ where: { id: c.userId }, data: { overtimeAccountFrom: cutoff } });
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "overtime.carry-forward",
      targetType: "User",
      targetId: c.userId,
      newValue: { day: cutoffKey, minutes: c.minutes },
    });
  }
  return carries.length;
}
