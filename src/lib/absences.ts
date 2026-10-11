// Absence data layer (vacation, sick leave and the other kinds in
// absence-kinds.ts). Pairs the PURE vacation maths in @/lib/time (day counting,
// entitlement) with the DB and the holiday map, and enforces the leave rules:
// vacation and the other requestable kinds are approval-gated, sick leave is a
// recorded fact (never deducts vacation), and §9 BUrlG lets certified sickness
// during an approved holiday be credited back. Only VACATION touches the leave
// account.
//
// Working-day counts are computed with the SAME expectedHours logic as overtime,
// so a holiday or part-time day is interpreted identically everywhere.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { holidayMapForRange, resolveRegion } from "@/lib/holidays";
import {
  absenceDayMap,
  berlinDayKey,
  computeEntitlement,
  countVacationDays,
  scheduleForDay,
  ABSENCE_LABEL,
  REQUESTABLE_KINDS,
  type AbsenceEffect,
  type AbsenceKind,
  type AbsenceSpan,
  type EntitlementBreakdown,
  type ScheduleInput,
} from "@/lib/time";

/** Thrown for expected, user-facing guard violations (turned into messages). */
export class AbsenceError extends Error {}

// ── Date convention helpers (@db.Date = UTC midnight) ────────────────────────

function dateKeyToUtc(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}
function utcToDateKey(date: Date): string {
  return berlinDayKey(date, "UTC");
}

// ── Loaders ──────────────────────────────────────────────────────────────────

function mapSchedules(
  rows: { effectiveFrom: Date; hoursMon: number; hoursTue: number; hoursWed: number; hoursThu: number; hoursFri: number; hoursSat: number; hoursSun: number }[],
): ScheduleInput[] {
  return rows.map((r) => ({
    effectiveFrom: r.effectiveFrom,
    hours: {
      mon: r.hoursMon, tue: r.hoursTue, wed: r.hoursWed, thu: r.hoursThu,
      fri: r.hoursFri, sat: r.hoursSat, sun: r.hoursSun,
    },
  }));
}

async function loadSchedules(userId: string): Promise<ScheduleInput[]> {
  const rows = await prisma.workSchedule.findMany({
    where: { userId },
    orderBy: { effectiveFrom: "asc" },
  });
  return mapSchedules(rows);
}

/** Age (whole years) on 1 January of `year`, from a birth date; null if unknown. */
function ageOnJan1(birthDate: Date | null, year: number): number | null {
  if (!birthDate) return null;
  let age = year - birthDate.getUTCFullYear();
  // Birthday on/after Jan 1 hasn't happened yet at the very start of the year
  // only if it falls later in January+; since the reference is Jan 1, subtract a
  // year when the birthday (month/day) is after Jan 1.
  const bornAfterJan1 = birthDate.getUTCMonth() > 0 || birthDate.getUTCDate() > 1;
  if (bornAfterJan1) age -= 1;
  return age;
}

/** The working-days a leave range consumes for a user, via the shared calc. */
export async function workingDaysForRange(
  userId: string,
  fromKey: string,
  toKey: string,
  opts: { halfDayStart?: boolean; halfDayEnd?: boolean } = {},
): Promise<number> {
  const [settings, user, schedules] = await Promise.all([
    getAppSettings(),
    prisma.user.findUnique({ where: { id: userId }, select: { bundesland: true } }),
    loadSchedules(userId),
  ]);
  const region = resolveRegion(user?.bundesland, settings);
  const holidays = await holidayMapForRange(region, fromKey, toKey);
  return countVacationDays(schedules, fromKey, toKey, holidays, opts);
}

// ── Vacation account ──────────────────────────────────────────────────────────

export interface VacationAccount {
  year: number;
  entitlement: EntitlementBreakdown;
  /** Approved vacation working-days taken this year. */
  taken: number;
  /** Pending (not yet approved) vacation working-days. */
  planned: number;
  /** total − taken (what's left, ignoring still-pending requests). */
  remaining: number;
  /** total − taken − planned (safely requestable). */
  available: number;
  /** Approved sick working-days this year (never affects the balance). */
  sickDays: number;
  /** Approved "Kind krank" working-days this year (§ 45 SGB V; shown, not enforced). */
  childSickDays: number;
  carryOverReminderSentAt: Date | null;
}

/** Vacation account for one user in a calendar year. */
export async function getVacationAccount(
  userId: string,
  year: number,
): Promise<VacationAccount> {
  // A stored per-year account wins over the User's current-year fields. Without
  // this, opening 2026 after the calendar rolled into 2027 showed 2027's
  // entitlement — every historical leave account was retroactively wrong.
  const stored = await prisma.vacationYear.findUnique({
    where: { userId_year: { userId, year } },
  });

  const [user, schedules, settings] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        vacationDaysPerYear: true,
        statutoryVacationDays: true,
        additionalVacationDays: true,
        vacationCarryOverDays: true,
        carryOverReminderSentAt: true,
        birthDate: true,
        isSchwerbehindert: true,
        schwerbehindertFrom: true,
        schwerbehindertTo: true,
        employmentStart: true,
        employmentEnd: true,
      },
    }),
    loadSchedules(userId),
    getAppSettings(),
  ]);

  // Schedule representative of the year (its first day; fall back to the earliest
  // schedule when employment began mid-year). Drives the working-week pro-rating.
  const yearSchedule =
    scheduleForDay(schedules, `${year}-01-01`) ?? schedules[0] ?? null;

  const entitlement = computeEntitlement({
    year,
    // Precedence: the stored per-year account, then the employee's split
    // fields, then the legacy lumped figure split on read (which reproduces the
    // pre-split total exactly, so untouched rows never move).
    statutoryDays: stored?.statutoryDays ?? user.statutoryVacationDays,
    additionalDays: stored?.additionalDays ?? user.additionalVacationDays,
    contractualDays: user.vacationDaysPerYear,
    carryOverDays: stored?.carryOverDays ?? user.vacationCarryOverDays,
    carryOverCutoff: {
      month: settings.carryOverCutoffMonth,
      day: settings.carryOverCutoffDay,
    },
    carryOverReminderSentAt: stored?.reminderSentAt ?? user.carryOverReminderSentAt,
    asOf: new Date(),
    hoursByWeekday:
      yearSchedule?.hours ?? { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    employmentStart: user.employmentStart,
    employmentEnd: user.employmentEnd,
    isSchwerbehindert: user.isSchwerbehindert,
    schwerbehindertFrom: user.schwerbehindertFrom,
    schwerbehindertTo: user.schwerbehindertTo,
    ageAtYearStart: ageOnJan1(user.birthDate, year),
  });

  const yearStart = dateKeyToUtc(`${year}-01-01`);
  const yearEnd = dateKeyToUtc(`${year}-12-31`);
  const absences = await prisma.absence.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "APPROVED"] },
      // Overlaps the year (an absence may straddle a year boundary).
      startDate: { lte: yearEnd },
      endDate: { gte: yearStart },
    },
    select: { type: true, status: true, workingDaysCount: true },
  });

  let taken = 0;
  let planned = 0;
  let sickDays = 0;
  let childSickDays = 0;
  for (const a of absences) {
    if (a.type === "VACATION") {
      if (a.status === "APPROVED") taken += a.workingDaysCount;
      else planned += a.workingDaysCount;
    } else if (a.type === "SICK" && a.status === "APPROVED") {
      sickDays += a.workingDaysCount;
    } else if (a.type === "CHILD_SICK" && a.status === "APPROVED") {
      childSickDays += a.workingDaysCount;
    }
  }

  const remaining = round2(entitlement.total - taken);
  return {
    year,
    entitlement,
    taken: round2(taken),
    planned: round2(planned),
    remaining,
    available: round2(remaining - planned),
    sickDays: round2(sickDays),
    childSickDays: round2(childSickDays),
    carryOverReminderSentAt: user.carryOverReminderSentAt,
  };
}

// ── Overlap guard ─────────────────────────────────────────────────────────────

/**
 * Existing absences overlapping [from, to] that the new one may not overlap
 * (PENDING or APPROVED). Two sick spells can't overlap, and neither can two of
 * the other kinds (a holiday and a Fortbildung on the same day, say); but
 * sickness MAY overlap any of them (the §9 credit-back case), so sickness is
 * only checked against sickness.
 */
async function findOverlap(
  userId: string,
  type: AbsenceKind,
  fromKey: string,
  toKey: string,
  /** The row being edited, which must not collide with itself. */
  excludeId?: string,
): Promise<{ id: string } | null> {
  return prisma.absence.findFirst({
    where: {
      userId,
      type: type === "SICK" ? "SICK" : { not: "SICK" },
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: dateKeyToUtc(toKey) },
      endDate: { gte: dateKeyToUtc(fromKey) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
}

/** "Urlaub", "Fortbildung", … for messages. */
export function absenceLabel(type: AbsenceKind): string {
  return ABSENCE_LABEL[type];
}

function overlapMessage(type: AbsenceKind, other = false): string {
  return type === "SICK"
    ? `Für diesen Zeitraum besteht bereits eine ${other ? "andere " : ""}Krankmeldung.`
    : `Für diesen Zeitraum besteht bereits ein ${other ? "anderer " : ""}Abwesenheitseintrag (Urlaub o. Ä.).`;
}

const MAX_RANGE_DAYS = 366;

function assertSaneRange(fromKey: string, toKey: string): void {
  const days = (dateKeyToUtc(toKey).getTime() - dateKeyToUtc(fromKey).getTime()) / 86_400_000;
  if (days < 0) throw new AbsenceError("Das Ende darf nicht vor dem Beginn liegen.");
  if (days > MAX_RANGE_DAYS) throw new AbsenceError("Der Zeitraum ist zu lang (max. 1 Jahr).");
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Employee (or admin on their behalf) requests leave or another requestable
 * absence (Sonderurlaub, Fortbildung, …). Stays PENDING until decided.
 */
export async function createAbsenceRequest(args: {
  type: AbsenceKind;
  userId: string;
  requestedById: string;
  fromKey: string;
  toKey: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  note?: string;
}): Promise<void> {
  const { type, userId, requestedById, fromKey, toKey, halfDayStart, halfDayEnd, note } = args;
  if (!REQUESTABLE_KINDS.includes(type)) throw new AbsenceError("Diese Abwesenheit wird nicht beantragt.");
  assertSaneRange(fromKey, toKey);

  const days = await workingDaysForRange(userId, fromKey, toKey, { halfDayStart, halfDayEnd });
  if (days <= 0) {
    throw new AbsenceError(
      "In diesem Zeitraum liegen keine Arbeitstage (nur Wochenende/Feiertage).",
    );
  }
  if (await findOverlap(userId, type, fromKey, toKey)) {
    throw new AbsenceError(overlapMessage(type));
  }

  await prisma.$transaction(async (tx) => {
    const created = await tx.absence.create({
      data: {
        userId,
        type,
        startDate: dateKeyToUtc(fromKey),
        endDate: dateKeyToUtc(toKey),
        halfDayStart,
        halfDayEnd,
        workingDaysCount: days,
        status: "PENDING",
        note: note ?? null,
        createdById: requestedById,
      },
    });
    await writeAudit(tx, {
      actorUserId: requestedById,
      action: type === "VACATION" ? "absence.vacation.request" : "absence.request",
      targetType: "Absence",
      targetId: created.id,
      newValue: { type, from: fromKey, to: toKey, days, halfDayStart, halfDayEnd },
      reason: note ?? null,
    });
  });
}

/** Record sick leave. A recorded fact → APPROVED immediately; never deducts vacation. */
export async function recordSick(args: {
  userId: string;
  recordedById: string;
  fromKey: string;
  toKey: string;
  sickNoteOnFile: boolean;
  note?: string;
}): Promise<{ overlapsVacation: boolean }> {
  const { userId, recordedById, fromKey, toKey, sickNoteOnFile, note } = args;
  assertSaneRange(fromKey, toKey);

  if (await findOverlap(userId, "SICK", fromKey, toKey)) {
    throw new AbsenceError(overlapMessage("SICK"));
  }
  const days = await workingDaysForRange(userId, fromKey, toKey);

  // §9 BUrlG: certified sickness during approved holiday can be credited back —
  // flag it so an admin can review and credit the days (see creditBackSick).
  const overlappingVacation = await prisma.absence.findFirst({
    where: {
      userId,
      type: "VACATION",
      status: "APPROVED",
      startDate: { lte: dateKeyToUtc(toKey) },
      endDate: { gte: dateKeyToUtc(fromKey) },
    },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    const created = await tx.absence.create({
      data: {
        userId,
        type: "SICK",
        startDate: dateKeyToUtc(fromKey),
        endDate: dateKeyToUtc(toKey),
        workingDaysCount: days,
        status: "APPROVED",
        sickNoteOnFile,
        note: note ?? null,
        createdById: recordedById,
        decidedById: recordedById,
        decidedAt: new Date(),
      },
    });
    await writeAudit(tx, {
      actorUserId: recordedById,
      action: "absence.sick.record",
      targetType: "Absence",
      targetId: created.id,
      newValue: { from: fromKey, to: toKey, days, sickNoteOnFile, overlapsApprovedVacation: !!overlappingVacation },
      reason: note ?? null,
    });
  });

  return { overlapsVacation: !!overlappingVacation };
}

/** Admin approves or rejects a pending vacation request (re-counts working days). */
export async function decideAbsence(args: {
  absenceId: string;
  decidedById: string;
  approve: boolean;
}): Promise<void> {
  const { absenceId, decidedById, approve } = args;

  const absence = await prisma.absence.findUnique({ where: { id: absenceId } });
  if (!absence) throw new AbsenceError("Antrag nicht gefunden.");
  if (absence.status !== "PENDING") throw new AbsenceError("Antrag wurde bereits entschieden.");

  // Recompute the consumed days at decision time so a schedule/holiday change
  // since the request is reflected in the approved figure.
  let days = absence.workingDaysCount;
  if (approve) {
    days = await workingDaysForRange(
      absence.userId,
      utcToDateKey(absence.startDate),
      utcToDateKey(absence.endDate),
      { halfDayStart: absence.halfDayStart, halfDayEnd: absence.halfDayEnd },
    );
  }

  await prisma.$transaction(async (tx) => {
    // Atomic claim guarded on PENDING, so two concurrent decisions can't both apply.
    const claimed = await tx.absence.updateMany({
      where: { id: absenceId, status: "PENDING" },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        workingDaysCount: days,
        decidedById,
        decidedAt: new Date(),
      },
    });
    if (claimed.count === 0) throw new AbsenceError("Antrag wurde bereits entschieden.");
    await writeAudit(tx, {
      actorUserId: decidedById,
      action: approve ? "absence.approve" : "absence.reject",
      targetType: "Absence",
      targetId: absenceId,
      oldValue: { status: absence.status, days: absence.workingDaysCount },
      newValue: { status: approve ? "APPROVED" : "REJECTED", days },
    });
  });
}

/** Employee withdraws their own still-pending vacation request. */
export async function withdrawAbsence(args: {
  absenceId: string;
  userId: string;
}): Promise<void> {
  const { absenceId, userId } = args;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.absence.updateMany({
      where: { id: absenceId, userId, status: "PENDING" },
      data: { status: "REJECTED", decidedById: userId, decidedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new AbsenceError("Antrag kann nicht mehr zurückgezogen werden.");
    }
    await writeAudit(tx, {
      actorUserId: userId,
      action: "absence.withdraw",
      targetType: "Absence",
      targetId: absenceId,
    });
  });
}

/**
 * §9 BUrlG credit-back: an admin credits a certified sick spell that overlaps an
 * approved holiday, reducing that holiday's consumed days by the overlapping
 * working-days so they return to the employee's balance.
 */
export async function creditBackSick(args: {
  sickId: string;
  actorId: string;
}): Promise<void> {
  const { sickId, actorId } = args;
  const sick = await prisma.absence.findUnique({ where: { id: sickId } });
  if (!sick || sick.type !== "SICK") throw new AbsenceError("Krankmeldung nicht gefunden.");
  if (!sick.sickNoteOnFile) {
    throw new AbsenceError("Eine Gutschrift setzt eine vorliegende AU-Bescheinigung voraus.");
  }
  if (sick.creditedBackFromVacation) throw new AbsenceError("Bereits gutgeschrieben.");

  const sickFrom = utcToDateKey(sick.startDate);
  const sickTo = utcToDateKey(sick.endDate);

  const vacations = await prisma.absence.findMany({
    where: {
      userId: sick.userId,
      type: "VACATION",
      status: "APPROVED",
      startDate: { lte: sick.endDate },
      endDate: { gte: sick.startDate },
    },
  });
  if (vacations.length === 0) throw new AbsenceError("Kein überschneidender genehmigter Urlaub.");

  // Compute every credit BEFORE opening the transaction: workingDaysForRange
  // uses the root client, so calling it inside an interactive transaction would
  // run on a different pooled connection and see uncommitted state incorrectly.
  const credits = await Promise.all(
    vacations.map(async (vac) => {
      const vacFrom = utcToDateKey(vac.startDate);
      const vacTo = utcToDateKey(vac.endDate);
      const overlapFrom = maxKey(sickFrom, vacFrom);
      const overlapTo = minKey(sickTo, vacTo);
      // Credit exactly what the holiday charged for these days: a boundary day
      // the employee only took as a HALF day was deducted at 0.5, so crediting
      // it back at a full day would hand back half a day too much.
      const credit = await workingDaysForRange(sick.userId, overlapFrom, overlapTo, {
        halfDayStart: vac.halfDayStart && overlapFrom === vacFrom,
        halfDayEnd: vac.halfDayEnd && overlapTo === vacTo,
      });
      return { vac, credit };
    }),
  );

  await prisma.$transaction(async (tx) => {
    // Claim the sick row FIRST, guarded on the flag, so a double-click cannot
    // run the credit twice (this was the one mutation without a claim guard).
    const claimedSick = await tx.absence.updateMany({
      where: { id: sickId, creditedBackFromVacation: false },
      data: { creditedBackFromVacation: true },
    });
    if (claimedSick.count === 0) throw new AbsenceError("Bereits gutgeschrieben.");

    for (const { vac, credit } of credits) {
      const newCount = Math.max(0, round2(vac.workingDaysCount - credit));
      // Guard on the value we read, so a concurrent recount/decision cannot be
      // silently overwritten with a stale figure.
      const claimed = await tx.absence.updateMany({
        where: { id: vac.id, workingDaysCount: vac.workingDaysCount },
        data: { workingDaysCount: newCount },
      });
      if (claimed.count === 0) {
        throw new AbsenceError(
          "Der Urlaubseintrag wurde zwischenzeitlich geändert — bitte erneut versuchen.",
        );
      }
      await writeAudit(tx, {
        actorUserId: actorId,
        action: "absence.creditback",
        targetType: "Absence",
        targetId: vac.id,
        oldValue: { days: vac.workingDaysCount },
        newValue: { days: newCount, creditedFromSick: sickId, credit },
        reason: "Krankheit während des Urlaubs (§9 BUrlG)",
      });
    }
  });
}

/**
 * Admin records an absence directly for an employee. The admin's entry is the
 * decision, so it is created APPROVED (vacation booked, or sick recorded).
 */
export async function adminCreateAbsence(args: {
  userId: string;
  actorId: string;
  type: AbsenceKind;
  fromKey: string;
  toKey: string;
  halfDayStart?: boolean;
  halfDayEnd?: boolean;
  sickNoteOnFile?: boolean;
  note?: string;
}): Promise<void> {
  const { userId, actorId, type, fromKey, toKey } = args;
  assertSaneRange(fromKey, toKey);
  if (await findOverlap(userId, type, fromKey, toKey)) {
    throw new AbsenceError(overlapMessage(type));
  }
  const halfDayStart = type !== "SICK" ? !!args.halfDayStart : false;
  const halfDayEnd = type !== "SICK" ? !!args.halfDayEnd : false;
  const days = await workingDaysForRange(userId, fromKey, toKey, { halfDayStart, halfDayEnd });
  if (type !== "SICK" && days <= 0) {
    throw new AbsenceError("In diesem Zeitraum liegen keine Arbeitstage.");
  }

  await prisma.$transaction(async (tx) => {
    const created = await tx.absence.create({
      data: {
        userId,
        type,
        startDate: dateKeyToUtc(fromKey),
        endDate: dateKeyToUtc(toKey),
        halfDayStart,
        halfDayEnd,
        workingDaysCount: days,
        status: "APPROVED",
        sickNoteOnFile: type === "SICK" ? !!args.sickNoteOnFile : false,
        note: args.note ?? null,
        createdById: actorId,
        decidedById: actorId,
        decidedAt: new Date(),
      },
    });
    await writeAudit(tx, {
      actorUserId: actorId,
      action:
        type === "VACATION"
          ? "absence.admin.vacation"
          : type === "SICK"
            ? "absence.admin.sick"
            : "absence.admin.create",
      targetType: "Absence",
      targetId: created.id,
      newValue: { for: userId, type, from: fromKey, to: toKey, days },
      reason: args.note ?? null,
    });
  });
}

/** Admin sets an employee's entitlement, carry-over and disability status. */
export async function setEntitlement(args: {
  userId: string;
  actorId: string;
  vacationDaysPerYear: number;
  vacationCarryOverDays: number;
  /** Gesetzlicher Mindesturlaub (BUrlG §3). Undefined → leave as stored. */
  statutoryVacationDays?: number;
  /** Zusätzliche vertragliche Tage. Undefined → leave as stored. */
  additionalVacationDays?: number;
  isSchwerbehindert: boolean;
  schwerbehindertFrom?: string;
  schwerbehindertTo?: string;
}): Promise<void> {
  const { userId, actorId } = args;
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      vacationDaysPerYear: true,
      statutoryVacationDays: true,
      additionalVacationDays: true,
      vacationCarryOverDays: true,
      isSchwerbehindert: true,
      schwerbehindertFrom: true,
      schwerbehindertTo: true,
    },
  });

  // Keep the legacy lumped field in step with the split so exports, older code
  // paths and anything reading `vacationDaysPerYear` stay consistent.
  const statutory = args.statutoryVacationDays ?? before.statutoryVacationDays ?? null;
  const additional = args.additionalVacationDays ?? before.additionalVacationDays ?? null;
  const lumped =
    statutory != null || additional != null
      ? (statutory ?? 0) + (additional ?? 0)
      : args.vacationDaysPerYear;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        vacationDaysPerYear: lumped,
        statutoryVacationDays: statutory,
        additionalVacationDays: additional,
        vacationCarryOverDays: args.vacationCarryOverDays,
        isSchwerbehindert: args.isSchwerbehindert,
        schwerbehindertFrom: args.schwerbehindertFrom ? dateKeyToUtc(args.schwerbehindertFrom) : null,
        schwerbehindertTo: args.schwerbehindertTo ? dateKeyToUtc(args.schwerbehindertTo) : null,
      },
    });
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "user.entitlement.update",
      targetType: "User",
      targetId: userId,
      oldValue: {
        vacationDaysPerYear: before.vacationDaysPerYear,
        vacationCarryOverDays: before.vacationCarryOverDays,
        isSchwerbehindert: before.isSchwerbehindert,
      },
      newValue: {
        vacationDaysPerYear: args.vacationDaysPerYear,
        vacationCarryOverDays: args.vacationCarryOverDays,
        isSchwerbehindert: args.isSchwerbehindert,
      },
    });
  });
}

/**
 * Record that the statutory "take your leave" reminder (Hinweis-/Aufforderungs-
 * obliegenheit) was sent — required for unused leave to lapse (EuGH/BAG).
 */
export async function sendCarryOverReminder(args: {
  userId: string;
  actorId: string;
}): Promise<void> {
  const { userId, actorId } = args;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { carryOverReminderSentAt: new Date() },
    });
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "user.carryover.remind",
      targetType: "User",
      targetId: userId,
    });
  });
}

// ── Retroactive administrative correction ─────────────────────────────────────
//
// An Absence, unlike a TimeEntry, is a DECISION rather than a punch: it was
// granted or recorded by somebody, and when the facts turn out differently
// ("the holiday was cut short because she fell ill") the decision itself has to
// change. So the row is edited in place, and `correctedBy/At/Reason` plus the
// append-only audit log carry the accountability an immutable version chain
// carries for time entries.

/** One certified sick spell that was credited back against holiday (§9 BUrlG). */
interface CreditedSickSpan {
  id: string;
  fromKey: string;
  toKey: string;
}

/**
 * The certified sick spells whose §9 credit is in force for a user, optionally
 * with one of them replaced by the range it is being MOVED to (or dropped, when
 * `replacement` is null and it is being cancelled).
 */
async function loadCreditedSickSpans(
  userId: string,
  edited?: { id: string; replacement: { fromKey: string; toKey: string } | null },
): Promise<CreditedSickSpan[]> {
  const rows = await prisma.absence.findMany({
    where: {
      userId,
      type: "SICK",
      status: "APPROVED",
      creditedBackFromVacation: true,
    },
    select: { id: true, startDate: true, endDate: true },
  });
  const out: CreditedSickSpan[] = [];
  for (const r of rows) {
    if (edited && r.id === edited.id) {
      if (edited.replacement) {
        out.push({ id: r.id, ...edited.replacement });
      }
      continue;
    }
    out.push({ id: r.id, fromKey: utcToDateKey(r.startDate), toKey: utcToDateKey(r.endDate) });
  }
  return out;
}

/**
 * What a holiday range should be charged to the leave account: its working days
 * MINUS every §9 credit still in force over it.
 *
 * Recomputing the raw range alone would quietly hand back credits that were
 * already granted — shortening a holiday would undo the sick days credited
 * against it. Deriving the charge from the ranges instead of adjusting it in
 * steps means the figure is correct no matter which side moves, and re-running
 * the same edit twice cannot drift.
 */
async function vacationChargeAfterCredits(
  userId: string,
  vac: { fromKey: string; toKey: string; halfDayStart: boolean; halfDayEnd: boolean },
  sickSpans: CreditedSickSpan[],
): Promise<number> {
  const base = await workingDaysForRange(userId, vac.fromKey, vac.toKey, {
    halfDayStart: vac.halfDayStart,
    halfDayEnd: vac.halfDayEnd,
  });
  let credited = 0;
  for (const sick of sickSpans) {
    const overlapFrom = maxKey(sick.fromKey, vac.fromKey);
    const overlapTo = minKey(sick.toKey, vac.toKey);
    if (overlapFrom > overlapTo) continue;
    // Credit exactly what those days were charged — a half-day edge gave back
    // half a day, so it may only take half a day back.
    credited += await workingDaysForRange(userId, overlapFrom, overlapTo, {
      halfDayStart: vac.halfDayStart && overlapFrom === vac.fromKey,
      halfDayEnd: vac.halfDayEnd && overlapTo === vac.toKey,
    });
  }
  return Math.max(0, round2(base - credited));
}

/** A holiday whose charged days have to be recomputed after a sick spell moved. */
interface VacationRecount {
  id: string;
  previousDays: number;
  days: number;
}

/**
 * Recompute every approved holiday a moving/cancelled certified sick spell
 * touches — on either its old or its new range, because a credit can be given
 * on one and taken away on the other.
 */
async function recountCreditedVacations(
  userId: string,
  touched: { fromKey: string; toKey: string }[],
  sickSpans: CreditedSickSpan[],
  /** The row being edited — it is written by the caller, never by a recount. */
  excludeId?: string,
): Promise<VacationRecount[]> {
  if (touched.length === 0) return [];
  const vacations = await prisma.absence.findMany({
    where: {
      userId,
      type: "VACATION",
      status: "APPROVED",
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: touched.map((t) => ({
        startDate: { lte: dateKeyToUtc(t.toKey) },
        endDate: { gte: dateKeyToUtc(t.fromKey) },
      })),
    },
  });
  const out: VacationRecount[] = [];
  for (const vac of vacations) {
    const days = await vacationChargeAfterCredits(
      userId,
      {
        fromKey: utcToDateKey(vac.startDate),
        toKey: utcToDateKey(vac.endDate),
        halfDayStart: vac.halfDayStart,
        halfDayEnd: vac.halfDayEnd,
      },
      sickSpans,
    );
    if (days !== vac.workingDaysCount) {
      out.push({ id: vac.id, previousDays: vac.workingDaysCount, days });
    }
  }
  return out;
}

/** Apply recomputed holiday charges, guarded on the value each was read at. */
async function applyRecounts(
  tx: Prisma.TransactionClient,
  recounts: VacationRecount[],
  actorId: string,
  reason: string,
): Promise<void> {
  for (const r of recounts) {
    const claimed = await tx.absence.updateMany({
      where: { id: r.id, workingDaysCount: r.previousDays },
      data: { workingDaysCount: r.days },
    });
    if (claimed.count === 0) {
      throw new AbsenceError(
        "Ein betroffener Urlaubseintrag wurde zwischenzeitlich geändert — bitte erneut versuchen.",
      );
    }
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "absence.recount",
      targetType: "Absence",
      targetId: r.id,
      oldValue: { days: r.previousDays },
      newValue: { days: r.days },
      reason,
    });
  }
}

export interface AdminUpdateAbsenceArgs {
  absenceId: string;
  actorId: string;
  type: AbsenceKind;
  fromKey: string;
  toKey: string;
  halfDayStart?: boolean;
  halfDayEnd?: boolean;
  sickNoteOnFile?: boolean;
  note?: string;
  /** Why the record is being changed. Required — this is the paper trail. */
  reason: string;
}

/**
 * Admin corrects an absence that is already on file: its type, its dates, its
 * half-day edges, the AU flag, the note.
 *
 * The consumed working days are always recomputed from the new range (and from
 * the §9 credits still in force over it), never carried over — the old figure
 * belongs to the old range and keeping it is how a leave balance silently goes
 * wrong.
 */
export async function adminUpdateAbsence(args: AdminUpdateAbsenceArgs): Promise<void> {
  const { absenceId, actorId, type, fromKey, toKey, reason } = args;
  assertSaneRange(fromKey, toKey);

  const before = await prisma.absence.findUnique({ where: { id: absenceId } });
  if (!before) throw new AbsenceError("Abwesenheit nicht gefunden.");
  if (before.status !== "PENDING" && before.status !== "APPROVED") {
    throw new AbsenceError(
      "Nur offene oder gebuchte Abwesenheiten können korrigiert werden. Bitte einen neuen Eintrag anlegen.",
    );
  }
  if (await findOverlap(before.userId, type, fromKey, toKey, absenceId)) {
    throw new AbsenceError(overlapMessage(type, true));
  }

  const halfDayStart = type !== "SICK" ? !!args.halfDayStart : false;
  const halfDayEnd = type !== "SICK" ? !!args.halfDayEnd : false;
  const sickNoteOnFile = type === "SICK" ? !!args.sickNoteOnFile : false;
  // §9 only ever credited a HOLIDAY. Turning a holiday into a sick spell (the
  // ordinary "she was ill, not on leave" correction) therefore also ends any
  // credit that was booked against it — the row is no longer leave to credit.
  const keepsSickCredit =
    type === "SICK" && before.type === "SICK" && before.creditedBackFromVacation;

  // Everything is computed BEFORE the transaction opens: workingDaysForRange
  // runs on the root client, so calling it inside an interactive transaction
  // would read from a different pooled connection (see creditBackSick).
  const oldFromKey = utcToDateKey(before.startDate);
  const oldToKey = utcToDateKey(before.endDate);

  // The §9 credits in force AFTER this edit: this row's own credit follows the
  // range it is moving to, or disappears when it stops being a sick spell.
  const sickSpans = await loadCreditedSickSpans(before.userId, {
    id: absenceId,
    replacement: keepsSickCredit ? { fromKey, toKey } : null,
  });

  let days = await workingDaysForRange(
    before.userId,
    fromKey,
    toKey,
    type !== "SICK" ? { halfDayStart, halfDayEnd } : {},
  );
  if (type !== "SICK" && days <= 0) {
    throw new AbsenceError("In diesem Zeitraum liegen keine Arbeitstage.");
  }
  // Only a BOOKED holiday carries §9 credits; a still-pending request is
  // re-counted at approval anyway, and crediting it there would deduct twice.
  if (type === "VACATION" && before.status === "APPROVED") {
    days = await vacationChargeAfterCredits(
      before.userId,
      { fromKey, toKey, halfDayStart, halfDayEnd },
      sickSpans,
    );
  }

  // A credit this row was granting moves with it — or ends, when the row stops
  // being sickness. Either way the holidays on both the old and the new range
  // have to be re-derived, or leave stays deducted for days nobody was on leave.
  const recounts = before.creditedBackFromVacation
    ? await recountCreditedVacations(
        before.userId,
        [
          { fromKey: oldFromKey, toKey: oldToKey },
          { fromKey, toKey },
        ],
        sickSpans,
        absenceId,
      )
    : [];

  await prisma.$transaction(async (tx) => {
    // Guarded on the state that was read, so a concurrent decision or credit is
    // never silently overwritten with a figure derived from stale values.
    const claimed = await tx.absence.updateMany({
      where: {
        id: absenceId,
        status: before.status,
        workingDaysCount: before.workingDaysCount,
        creditedBackFromVacation: before.creditedBackFromVacation,
      },
      data: {
        type,
        startDate: dateKeyToUtc(fromKey),
        endDate: dateKeyToUtc(toKey),
        halfDayStart,
        halfDayEnd,
        workingDaysCount: days,
        sickNoteOnFile,
        creditedBackFromVacation: keepsSickCredit,
        note: args.note ?? null,
        correctedById: actorId,
        correctedAt: new Date(),
        correctionReason: reason,
      },
    });
    if (claimed.count === 0) {
      throw new AbsenceError(
        "Die Abwesenheit wurde zwischenzeitlich geändert — bitte die Seite neu laden.",
      );
    }
    await applyRecounts(tx, recounts, actorId, reason);
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "absence.admin.correct",
      targetType: "Absence",
      targetId: absenceId,
      oldValue: {
        for: before.userId,
        type: before.type,
        from: oldFromKey,
        to: oldToKey,
        days: before.workingDaysCount,
        halfDayStart: before.halfDayStart,
        halfDayEnd: before.halfDayEnd,
        sickNoteOnFile: before.sickNoteOnFile,
      },
      newValue: {
        for: before.userId,
        type,
        from: fromKey,
        to: toKey,
        days,
        halfDayStart,
        halfDayEnd,
        sickNoteOnFile,
      },
      reason,
    });
  });
}

/**
 * Admin withdraws an absence that is already on file (wrongly entered, or
 * replaced by a different record). The row is kept and marked CANCELLED rather
 * than deleted: it was in force at some point, and the reason it stopped being
 * in force is part of the record.
 */
export async function adminCancelAbsence(args: {
  absenceId: string;
  actorId: string;
  reason: string;
}): Promise<void> {
  const { absenceId, actorId, reason } = args;

  const before = await prisma.absence.findUnique({ where: { id: absenceId } });
  if (!before) throw new AbsenceError("Abwesenheit nicht gefunden.");
  if (before.status !== "PENDING" && before.status !== "APPROVED") {
    throw new AbsenceError("Diese Abwesenheit ist bereits nicht mehr in Kraft.");
  }

  // A cancelled sick spell stops crediting the holidays it covered, so those
  // holidays owe their days again (computed outside the transaction, as above).
  const recounts = before.creditedBackFromVacation
    ? await recountCreditedVacations(
        before.userId,
        [{ fromKey: utcToDateKey(before.startDate), toKey: utcToDateKey(before.endDate) }],
        await loadCreditedSickSpans(before.userId, { id: absenceId, replacement: null }),
        absenceId,
      )
    : [];

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.absence.updateMany({
      where: { id: absenceId, status: before.status },
      data: {
        status: "CANCELLED",
        decidedById: actorId,
        decidedAt: new Date(),
        correctedById: actorId,
        correctedAt: new Date(),
        correctionReason: reason,
      },
    });
    if (claimed.count === 0) {
      throw new AbsenceError(
        "Die Abwesenheit wurde zwischenzeitlich geändert — bitte die Seite neu laden.",
      );
    }
    await applyRecounts(tx, recounts, actorId, reason);
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "absence.admin.cancel",
      targetType: "Absence",
      targetId: absenceId,
      oldValue: {
        for: before.userId,
        type: before.type,
        from: utcToDateKey(before.startDate),
        to: utcToDateKey(before.endDate),
        days: before.workingDaysCount,
        status: before.status,
      },
      newValue: { status: "CANCELLED", days: 0 },
      reason,
    });
  });
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * The approved absences covering each day of [fromKey, toKey], for the timesheet.
 *
 * Only APPROVED rows count: a holiday that has been requested but not granted
 * is not yet time off, and crediting it would pay leave the employer has not
 * agreed to. Sick leave is recorded APPROVED, so it is always included.
 */
export async function absenceEffectsForRange(
  userId: string,
  fromKey: string,
  toKey: string,
): Promise<Map<string, AbsenceEffect>> {
  const rows = await prisma.absence.findMany({
    where: {
      userId,
      status: "APPROVED",
      startDate: { lte: dateKeyToUtc(toKey) },
      endDate: { gte: dateKeyToUtc(fromKey) },
    },
    select: {
      type: true,
      startDate: true,
      endDate: true,
      halfDayStart: true,
      halfDayEnd: true,
    },
  });
  const spans: AbsenceSpan[] = rows.map((a) => ({
    kind: a.type,
    fromKey: utcToDateKey(a.startDate),
    toKey: utcToDateKey(a.endDate),
    halfDayStart: a.halfDayStart,
    halfDayEnd: a.halfDayEnd,
  }));
  return absenceDayMap(spans, fromKey, toKey);
}

/**
 * Every absence on file for one employee in a year, newest first — the list the
 * admin corrects from. Cancelled and rejected rows are included so a correction
 * that was already made is visible instead of looking like data loss.
 */
export async function getAbsencesForYear(userId: string, year: number) {
  return prisma.absence.findMany({
    where: {
      userId,
      startDate: { lte: dateKeyToUtc(`${year}-12-31`) },
      endDate: { gte: dateKeyToUtc(`${year}-01-01`) },
    },
    orderBy: [{ startDate: "desc" }],
  });
}

export async function getUserAbsences(userId: string, limit = 100) {
  return prisma.absence.findMany({
    where: { userId },
    orderBy: [{ startDate: "desc" }],
    take: limit,
  });
}

export async function getPendingAbsenceCount(): Promise<number> {
  return prisma.absence.count({ where: { type: { not: "SICK" }, status: "PENDING" } });
}

/** Open requests of every requestable kind (leave, Sonderurlaub, …), oldest first. */
export async function getPendingAbsenceRequests() {
  return prisma.absence.findMany({
    where: { type: { not: "SICK" }, status: "PENDING" },
    orderBy: { startDate: "asc" },
    include: { user: { select: { name: true, email: true } } },
  });
}

/** All approved/pending absences overlapping a range, for the team calendar. */
export async function getAbsencesInRange(fromKey: string, toKey: string) {
  return prisma.absence.findMany({
    where: {
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: dateKeyToUtc(toKey) },
      endDate: { gte: dateKeyToUtc(fromKey) },
    },
    include: { user: { select: { name: true } } },
    orderBy: { startDate: "asc" },
  });
}

/**
 * Certified sick spells this year that overlap an approved holiday and have not
 * yet been credited back — the §9 BUrlG review queue for the admin.
 */
export async function getSickCreditCandidates(year: number) {
  const yearStart = dateKeyToUtc(`${year}-01-01`);
  const yearEnd = dateKeyToUtc(`${year}-12-31`);
  const sicks = await prisma.absence.findMany({
    where: {
      type: "SICK",
      status: "APPROVED",
      sickNoteOnFile: true,
      creditedBackFromVacation: false,
      startDate: { lte: yearEnd },
      endDate: { gte: yearStart },
    },
    include: { user: { select: { name: true } } },
    orderBy: { startDate: "desc" },
  });
  const out: typeof sicks = [];
  for (const s of sicks) {
    const overlap = await prisma.absence.findFirst({
      where: {
        userId: s.userId,
        type: "VACATION",
        status: "APPROVED",
        startDate: { lte: s.endDate },
        endDate: { gte: s.startDate },
      },
      select: { id: true },
    });
    if (overlap) out.push(s);
  }
  return out;
}

/** Per-employee vacation/sick overview for the admin dashboard, for one year. */
export async function getStaffVacationOverview(year: number) {
  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
  return Promise.all(
    users.map(async (u) => ({ user: u, account: await getVacationAccount(u.id, year) })),
  );
}

// ── small utils ───────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function maxKey(a: string, b: string): string {
  return a >= b ? a : b;
}
function minKey(a: string, b: string): string {
  return a <= b ? a : b;
}
