// Admin batch backfill of working time for PAST dates.
//
// Why this exists: employees who lose several days (a forgotten clock-out used
// to lock them out entirely, and the correction form only ever offered one day
// at a time) had no realistic way back. Filing twenty single-day correction
// requests is not a workflow. This tool lets an admin reconstruct a whole period
// in one reviewed, audited operation.
//
// Non-negotiables baked in here:
//  - PREVIEW FIRST. Nothing is written until the admin has seen the exact list
//    of days, including everything that will be skipped and why.
//  - NEVER overwrite. A day that already has an ACTIVE entry is skipped, not
//    replaced. Changing an existing record stays the correction flow's job.
//  - Past only. A backfill cannot create entries in the future.
//  - Every row is a normal versioned TimeEntry (source MANUAL) carrying the
//    admin's id, a shared batchId, and its own audit record with the reason.
//  - The employee's own schedule, public holidays and approved absences decide
//    which days are eligible, using the SAME calc the rest of the app uses.

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { holidayMapForRange, resolveRegion } from "@/lib/holidays";
import {
  berlinDayKey,
  berlinDayRange,
  eachDayKey,
  expectedHoursForDate,
  scheduleForDay,
  weekdayHours,
  type HolidayEffect,
  type ScheduleInput,
} from "@/lib/time";

export class BatchEntryError extends Error {}

/** Why a day in the requested range is not going to be written. */
export type SkipReason =
  | "NOT_A_WORKING_DAY"
  | "HOLIDAY"
  | "ABSENCE"
  | "ALREADY_RECORDED"
  | "IN_THE_FUTURE"
  | "BEFORE_EMPLOYMENT"
  | "AFTER_EMPLOYMENT";

export interface BatchDay {
  dayKey: string;
  /** Berlin wall-clock instants that would be written. */
  workStart: Date;
  workEnd: Date;
  breakStart?: Date;
  breakEnd?: Date;
  /** Net working hours after the break. */
  netHours: number;
  expectedHours: number;
}

export interface BatchSkip {
  dayKey: string;
  reason: SkipReason;
  detail?: string;
}

export interface BatchPreview {
  userId: string;
  userName: string;
  fromKey: string;
  toKey: string;
  days: BatchDay[];
  skipped: BatchSkip[];
  totals: { days: number; netHours: number; expectedHours: number };
  warnings: string[];
}

export interface BatchInput {
  userId: string;
  fromKey: string;
  toKey: string;
  /** Berlin wall-clock "HH:mm". */
  startTime: string;
  endTime: string;
  /**
   * Optional unpaid break, "HH:mm" each. Both null → no BREAK entry is written
   * at all. Exactly one of the two set is rejected rather than silently dropped.
   */
  breakStartTime?: string | null;
  breakEndTime?: string | null;
  /** Skip days that fall on a public/gifted holiday (default true). */
  skipHolidays?: boolean;
  /** Skip days covered by an approved absence — holiday or sick (default true). */
  skipAbsences?: boolean;
  /** Only write days the employee is contracted to work (default true). */
  onlyContractedDays?: boolean;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_BATCH_DAYS = 186; // ~6 months — a backfill, not a data migration

function assertHhmm(value: string, label: string): void {
  if (!HHMM.test(value)) throw new BatchEntryError(`${label} muss im Format HH:MM vorliegen.`);
}

/**
 * Build a Berlin-local instant for a day + "HH:mm". Uses berlinDayRange as the
 * anchor so the offset is the one actually in force on that date — a fixed +01:00
 * assumption would shift every summer entry by an hour.
 */
function berlinAt(dayKey: string, hhmm: string): Date {
  const parts = hhmm.split(":");
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  const { start } = berlinDayRange(dayKey);
  return new Date(start.getTime() + h * 3_600_000 + m * 60_000);
}

function mapSchedules(
  rows: {
    effectiveFrom: Date; hoursMon: number; hoursTue: number; hoursWed: number;
    hoursThu: number; hoursFri: number; hoursSat: number; hoursSun: number;
  }[],
): ScheduleInput[] {
  return rows.map((r) => ({
    effectiveFrom: r.effectiveFrom,
    hours: {
      mon: r.hoursMon, tue: r.hoursTue, wed: r.hoursWed, thu: r.hoursThu,
      fri: r.hoursFri, sat: r.hoursSat, sun: r.hoursSun,
    },
  }));
}

/**
 * Work out exactly what a batch would write, and why every other day is skipped.
 * Pure read — safe to call as often as the admin edits the form.
 */
export async function previewBatch(
  input: BatchInput,
  asOf: Date = new Date(),
): Promise<BatchPreview> {
  const {
    userId, fromKey, toKey, startTime, endTime,
    breakStartTime, breakEndTime,
    skipHolidays = true, skipAbsences = true, onlyContractedDays = true,
  } = input;

  assertHhmm(startTime, "Beginn");
  assertHhmm(endTime, "Ende");
  if (endTime <= startTime) {
    throw new BatchEntryError(
      "Das Ende muss nach dem Beginn liegen. Schichten über Mitternacht sind im Sammel-Nachtrag nicht vorgesehen — bitte einzeln nachtragen.",
    );
  }
  // A half-filled break used to be dropped without a word, so a batch could be
  // written with no break at all while the admin believed one was set.
  if (!!breakStartTime !== !!breakEndTime) {
    throw new BatchEntryError(
      "Pausenbeginn und Pausenende müssen beide angegeben werden — oder beide leer bleiben, um ohne Pause nachzutragen.",
    );
  }
  const hasBreak = !!(breakStartTime && breakEndTime);
  if (hasBreak) {
    assertHhmm(breakStartTime!, "Pausenbeginn");
    assertHhmm(breakEndTime!, "Pausenende");
    if (breakEndTime! <= breakStartTime!) {
      throw new BatchEntryError("Das Pausenende muss nach dem Pausenbeginn liegen.");
    }
    if (breakStartTime! < startTime || breakEndTime! > endTime) {
      throw new BatchEntryError("Die Pause muss innerhalb der Arbeitszeit liegen.");
    }
  }

  const dayKeys = [...eachDayKey(fromKey, toKey)];
  if (dayKeys.length === 0) throw new BatchEntryError("Das Ende darf nicht vor dem Beginn liegen.");
  if (dayKeys.length > MAX_BATCH_DAYS) {
    throw new BatchEntryError(`Der Zeitraum ist zu lang (max. ${MAX_BATCH_DAYS} Tage).`);
  }

  const [user, settings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, active: true, bundesland: true,
        employmentStart: true, employmentEnd: true,
      },
    }),
    getAppSettings(),
  ]);
  if (!user) throw new BatchEntryError("Mitarbeiter:in nicht gefunden.");

  const region = resolveRegion(user.bundesland, settings);
  const [scheduleRows, holidays, existing, absences] = await Promise.all([
    prisma.workSchedule.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } }),
    holidayMapForRange(region, fromKey, toKey),
    prisma.timeEntry.findMany({
      where: {
        userId,
        status: "ACTIVE",
        start: { lt: berlinDayRange(toKey).end },
        OR: [{ end: null }, { end: { gt: berlinDayRange(fromKey).start } }],
      },
      select: { start: true, end: true },
    }),
    prisma.absence.findMany({
      where: {
        userId,
        status: "APPROVED",
        startDate: { lte: new Date(`${toKey}T00:00:00.000Z`) },
        endDate: { gte: new Date(`${fromKey}T00:00:00.000Z`) },
      },
      select: { type: true, startDate: true, endDate: true },
    }),
  ]);

  const schedules = mapSchedules(scheduleRows);
  const warnings: string[] = [];
  if (schedules.length === 0) {
    warnings.push(
      "Für diese Person ist kein Arbeitszeitmodell hinterlegt — das Soll ist überall 0, und ohne Modell kann nicht geprüft werden, welche Tage Arbeitstage sind.",
    );
  }
  if (!user.active) warnings.push("Diese Person ist als inaktiv markiert.");

  const recordedDays = new Set(existing.map((e) => berlinDayKey(e.start)));
  const absentDays = new Set<string>();
  for (const a of absences) {
    const aFrom = berlinDayKey(a.startDate, "UTC");
    const aTo = berlinDayKey(a.endDate, "UTC");
    for (const k of eachDayKey(aFrom, aTo)) absentDays.add(k);
  }

  const employmentStartKey = user.employmentStart
    ? berlinDayKey(user.employmentStart, "UTC")
    : null;
  const employmentEndKey = user.employmentEnd ? berlinDayKey(user.employmentEnd, "UTC") : null;
  const todayKey = berlinDayKey(asOf);

  const days: BatchDay[] = [];
  const skipped: BatchSkip[] = [];

  for (const dayKey of dayKeys) {
    if (dayKey >= todayKey) {
      skipped.push({ dayKey, reason: "IN_THE_FUTURE" });
      continue;
    }
    if (employmentStartKey && dayKey < employmentStartKey) {
      skipped.push({ dayKey, reason: "BEFORE_EMPLOYMENT" });
      continue;
    }
    if (employmentEndKey && dayKey > employmentEndKey) {
      skipped.push({ dayKey, reason: "AFTER_EMPLOYMENT" });
      continue;
    }
    if (recordedDays.has(dayKey)) {
      skipped.push({
        dayKey,
        reason: "ALREADY_RECORDED",
        detail: "Es existiert bereits eine erfasste Zeit — vorhandene Einträge werden nie überschrieben.",
      });
      continue;
    }
    if (skipAbsences && absentDays.has(dayKey)) {
      skipped.push({ dayKey, reason: "ABSENCE", detail: "Genehmigte Abwesenheit (Urlaub/Krankheit)." });
      continue;
    }

    const schedule = scheduleForDay(schedules, dayKey, true);
    const contracted = schedule ? weekdayHours(schedule.hours, dayKey) : 0;
    if (onlyContractedDays && contracted <= 0) {
      skipped.push({ dayKey, reason: "NOT_A_WORKING_DAY" });
      continue;
    }

    const effect: HolidayEffect | undefined = holidays.get(dayKey);
    if (skipHolidays && effect === "FULL") {
      skipped.push({ dayKey, reason: "HOLIDAY", detail: "Ganzer Feiertag." });
      continue;
    }

    const workStart = berlinAt(dayKey, startTime);
    const workEnd = berlinAt(dayKey, endTime);
    const breakStart = hasBreak ? berlinAt(dayKey, breakStartTime!) : undefined;
    const breakEnd = hasBreak ? berlinAt(dayKey, breakEndTime!) : undefined;
    const grossMs = workEnd.getTime() - workStart.getTime();
    const breakMs = breakStart && breakEnd ? breakEnd.getTime() - breakStart.getTime() : 0;

    days.push({
      dayKey,
      workStart,
      workEnd,
      breakStart,
      breakEnd,
      netHours: round2((grossMs - breakMs) / 3_600_000),
      expectedHours: round2(expectedHoursForDate(schedules, dayKey, holidays, true)),
    });
  }

  // Surface ArbZG exposure up front rather than after the write.
  const rules = settings.ruleProfile;
  const net = days[0]?.netHours ?? 0;
  if (days.length > 0) {
    if (net > rules.maxHoursPerDay) {
      warnings.push(
        `Die eingetragene Netto-Arbeitszeit (${fmt(net)} Std.) überschreitet die im Regelprofil hinterlegte Tageshöchstarbeitszeit von ${fmt(rules.maxHoursPerDay)} Std. (§3 ArbZG).`,
      );
    }
    const requiredBreak =
      net > rules.break2AfterHours ? rules.break2Minutes
      : net > rules.break1AfterHours ? rules.break1Minutes
      : 0;
    const givenBreak = hasBreak
      ? (berlinAt(days[0]!.dayKey, breakEndTime!).getTime() -
          berlinAt(days[0]!.dayKey, breakStartTime!).getTime()) / 60_000
      : 0;
    if (requiredBreak > givenBreak) {
      // Say what will HAPPEN to the difference, not only that there is one — with
      // the Pausenautomatik on, the missing minutes are booked at calculation
      // time, so the net hours previewed above are not what the timesheet ends up
      // showing, and an admin should not have to discover that afterwards.
      const consequence = settings.breakPolicy.enabled
        ? ` Die Pausenautomatik setzt die fehlende Pausenzeit bei der Berechnung an; die tatsächlich gutgeschriebene Zeit fällt daher entsprechend geringer aus.`
        : "";
      warnings.push(
        `Bei ${fmt(net)} Std. Arbeitszeit sind mindestens ${requiredBreak} Minuten Pause vorgeschrieben (§4 ArbZG); eingetragen sind ${givenBreak}.${consequence}`,
      );
    }
  }

  return {
    userId: user.id,
    userName: user.name,
    fromKey,
    toKey,
    days,
    skipped,
    totals: {
      days: days.length,
      netHours: round2(days.reduce((s, d) => s + d.netHours, 0)),
      expectedHours: round2(days.reduce((s, d) => s + d.expectedHours, 0)),
    },
    warnings,
  };
}

/**
 * Apply a previewed batch. Re-runs the preview inside the call so the write is
 * based on freshly-read state, never on numbers the browser sent back — and so a
 * day that gained an entry between preview and submit is still skipped.
 */
export async function applyBatch(args: {
  input: BatchInput;
  actorId: string;
  reason: string;
  /** Number of days the admin saw in the preview; a mismatch aborts. */
  expectedDayCount: number;
}): Promise<{ batchId: string; written: number; skipped: number }> {
  const { input, actorId, reason, expectedDayCount } = args;
  if (reason.trim().length < 3) {
    throw new BatchEntryError("Bitte einen nachvollziehbaren Grund angeben (mind. 3 Zeichen).");
  }

  const preview = await previewBatch(input);
  if (preview.days.length !== expectedDayCount) {
    throw new BatchEntryError(
      `Die Daten haben sich seit der Vorschau geändert (jetzt ${preview.days.length} statt ${expectedDayCount} Tage). Bitte die Vorschau erneut prüfen.`,
    );
  }
  if (preview.days.length === 0) {
    throw new BatchEntryError("Es gibt keine Tage zum Nachtragen.");
  }

  const batchId = randomUUID();

  await prisma.$transaction(async (tx) => {
    for (const day of preview.days) {
      const work = await tx.timeEntry.create({
        data: {
          userId: input.userId,
          type: "WORK",
          start: day.workStart,
          end: day.workEnd,
          source: "MANUAL",
          status: "ACTIVE",
          createdById: actorId,
          batchId,
          note: reason,
        },
      });
      await writeAudit(tx, {
        actorUserId: actorId,
        action: "timeentry.batch-create",
        targetType: "TimeEntry",
        targetId: work.id,
        newValue: {
          for: input.userId,
          type: "WORK",
          start: day.workStart.toISOString(),
          end: day.workEnd.toISOString(),
          batchId,
        },
        reason,
      });

      if (day.breakStart && day.breakEnd) {
        const brk = await tx.timeEntry.create({
          data: {
            userId: input.userId,
            type: "BREAK",
            start: day.breakStart,
            end: day.breakEnd,
            source: "MANUAL",
            status: "ACTIVE",
            createdById: actorId,
            batchId,
            note: reason,
          },
        });
        await writeAudit(tx, {
          actorUserId: actorId,
          action: "timeentry.batch-create",
          targetType: "TimeEntry",
          targetId: brk.id,
          newValue: {
            for: input.userId,
            type: "BREAK",
            start: day.breakStart.toISOString(),
            end: day.breakEnd.toISOString(),
            batchId,
          },
          reason,
        });
      }
    }

    await writeAudit(tx, {
      actorUserId: actorId,
      action: "timeentry.batch-apply",
      targetType: "TimeEntry",
      targetId: batchId,
      newValue: {
        for: input.userId,
        from: preview.fromKey,
        to: preview.toKey,
        days: preview.days.length,
        netHours: preview.totals.netHours,
        skipped: preview.skipped.length,
        batchId,
      },
      reason,
    });
  }, { timeout: 30_000 });

  return { batchId, written: preview.days.length, skipped: preview.skipped.length };
}

/**
 * Reverse a batch. The rows are not deleted — they are marked SUPERSEDED, which
 * is what "immutable record" means here: a mistaken backfill stays visible in the
 * history and in the raw export, it just stops counting.
 */
export async function revertBatch(args: {
  batchId: string;
  actorId: string;
  reason: string;
}): Promise<{ reverted: number }> {
  const { batchId, actorId, reason } = args;
  if (reason.trim().length < 3) {
    throw new BatchEntryError("Bitte einen Grund für die Rücknahme angeben.");
  }

  const rows = await prisma.timeEntry.findMany({
    where: { batchId, status: "ACTIVE" },
    select: { id: true },
  });
  if (rows.length === 0) throw new BatchEntryError("Kein aktiver Sammel-Nachtrag mit dieser Kennung.");

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.timeEntry.updateMany({
      where: { batchId, status: "ACTIVE" },
      data: { status: "SUPERSEDED" },
    });
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "timeentry.batch-revert",
      targetType: "TimeEntry",
      targetId: batchId,
      oldValue: { activeRows: rows.length },
      newValue: { reverted: claimed.count, batchId },
      reason,
    });
  });

  return { reverted: rows.length };
}

/** Recent batches for the admin overview, newest first. */
export async function getRecentBatches(limit = 20) {
  const rows = await prisma.auditLog.findMany({
    where: { action: "timeentry.batch-apply" },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const batchIds = rows
    .map((r) => r.targetId)
    .filter((id): id is string => typeof id === "string");
  const activeCounts = await prisma.timeEntry.groupBy({
    by: ["batchId"],
    where: { batchId: { in: batchIds }, status: "ACTIVE" },
    _count: { _all: true },
  });
  const activeByBatch = new Map(activeCounts.map((c) => [c.batchId, c._count._all]));
  return rows.map((r) => ({
    log: r,
    activeRows: r.targetId ? (activeByBatch.get(r.targetId) ?? 0) : 0,
  }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function fmt(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

export type { Prisma };
