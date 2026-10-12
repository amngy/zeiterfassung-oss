// Deleting records whose retention period has run out (#17, DSGVO Art. 5(1)(e),
// Art. 17(1)(a)).
//
// Admin-run on purpose, never a cron: deletion is irreversible, so a person
// looks at the counts first and confirms. The cutoff is recomputed when the
// purge runs, never taken from the page that showed the counts.
//
// WHAT GOES — everything dated before 1 January of the cutoff year
// (see retentionCutoffYear), for every person, active or not:
//   TimeEntry          start before the cutoff — with their ClockEvents (and
//                      anything hanging off those) by cascade. A later version
//                      that superseded a deleted one loses only the link.
//   CorrectionRequest  created before the cutoff
//   Absence            ended before the cutoff (a spell running across it stays)
//   VacationYear       years before the cutoff year
//   AuditLog           rows written before the cutoff. The trail exists to
//                      prove changes during the retention period; once that
//                      period has ended for a row, so has the reason to keep it.
// Device types (#34): on punches older than the much shorter device-type
// period (Einstellungen → Stempeln) `ClockEvent.deviceLabel` is cleared; time
// and channel stay.
// Accounts: an inactive, not yet anonymised person whose Austrittsdatum lies
// before the cutoff is anonymised (anonymizeUser) — their records are gone by
// then anyway. Without an Austrittsdatum nobody can tell when the period
// started, so such accounts are listed but left alone.
//
// Arbeitszeitkonten (#22): an account that started before the cutoff would
// lose the days behind its balance, so the balance at the end of the last
// deleted day is booked as a carry forward on 1 January of the cutoff year,
// the account restarts there, and its earlier bookings go.
//
// WHAT STAYS: work schedules and holidays (the time model, not records about a
// day), active accounts, and the one audit row the purge itself writes.
//
// Backups are outside the app's reach: deleted rows live on in older dumps
// until those are rotated out.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { anonymizeUser } from "@/lib/dsgvo";
import { applyCarryForwards, carryForwardsBefore } from "@/lib/overtime";
import { getAppSettings } from "@/lib/settings";
import { berlinDayKey, berlinDayRange } from "@/lib/time";
import { deviceLabelCutoff, effectiveRetentionYears, retentionCutoffYear } from "@/lib/time/retention";

export interface RetentionCounts {
  timeEntries: number;
  clockEvents: number;
  corrections: number;
  absences: number;
  vacationYears: number;
  auditEntries: number;
  /** Punches whose device type is cleared (the punch itself stays). */
  deviceLabels: number;
}

export interface RetentionReport {
  /** Effective period in years (the setting, floored to the statutory minimum). */
  retentionYears: number;
  configuredYears: number;
  /** Oldest year that is kept; everything before 1 January of it may go. */
  cutoffYear: number;
  counts: RetentionCounts;
  deviceLabelMonths: number;
  /** Punches before this instant lose their device type. */
  deviceCutoff: Date;
  /** Inactive accounts whose Austrittsdatum lies before the cutoff. */
  departed: { id: string; name: string; employmentEnd: string }[];
  /** Inactive, not anonymised accounts without an Austrittsdatum. */
  inactiveWithoutEnd: number;
}

interface Scope {
  cutoffYear: number;
  /** Berlin midnight at the start of the cutoff year. */
  instant: Date;
  /** The same day as a @db.Date value (UTC midnight). */
  date: Date;
  deviceCutoff: Date;
}

function scopeFor(asOf: Date, configuredYears: number, deviceMonths: number): Scope {
  const cutoffYear = retentionCutoffYear(berlinDayKey(asOf), configuredYears);
  const key = `${cutoffYear}-01-01`;
  return {
    cutoffYear,
    instant: berlinDayRange(key).start,
    date: new Date(key),
    deviceCutoff: deviceLabelCutoff(asOf, deviceMonths),
  };
}

function wheres(s: Scope) {
  return {
    timeEntry: { start: { lt: s.instant } } satisfies Prisma.TimeEntryWhereInput,
    clockEvent: { timeEntry: { start: { lt: s.instant } } } satisfies Prisma.ClockEventWhereInput,
    correction: { createdAt: { lt: s.instant } } satisfies Prisma.CorrectionRequestWhereInput,
    absence: { endDate: { lt: s.date } } satisfies Prisma.AbsenceWhereInput,
    vacationYear: { year: { lt: s.cutoffYear } } satisfies Prisma.VacationYearWhereInput,
    audit: { createdAt: { lt: s.instant } } satisfies Prisma.AuditLogWhereInput,
    // Only on punches that survive the deletion above.
    deviceLabel: {
      deviceLabel: { not: null },
      at: { lt: s.deviceCutoff },
      timeEntry: { start: { gte: s.instant } },
    } satisfies Prisma.ClockEventWhereInput,
    departed: {
      active: false,
      anonymizedAt: null,
      employmentEnd: { lt: s.date },
    } satisfies Prisma.UserWhereInput,
  };
}

async function countAll(db: Prisma.TransactionClient | typeof prisma, s: Scope): Promise<RetentionCounts> {
  const w = wheres(s);
  const [timeEntries, clockEvents, corrections, absences, vacationYears, auditEntries, deviceLabels] =
    await Promise.all([
      db.timeEntry.count({ where: w.timeEntry }),
      db.clockEvent.count({ where: w.clockEvent }),
      db.correctionRequest.count({ where: w.correction }),
      db.absence.count({ where: w.absence }),
      db.vacationYear.count({ where: w.vacationYear }),
      db.auditLog.count({ where: w.audit }),
      db.clockEvent.count({ where: w.deviceLabel }),
    ]);
  return { timeEntries, clockEvents, corrections, absences, vacationYears, auditEntries, deviceLabels };
}

/** What a purge run now would delete and anonymise. Read-only. */
export async function getRetentionReport(asOf: Date = new Date()): Promise<RetentionReport> {
  const { retentionYears: configuredYears, punchPolicy } = await getAppSettings();
  const s = scopeFor(asOf, configuredYears, punchPolicy.deviceLabelMonths);
  const [counts, departed, inactiveWithoutEnd] = await Promise.all([
    countAll(prisma, s),
    prisma.user.findMany({
      where: wheres(s).departed,
      select: { id: true, name: true, employmentEnd: true },
      orderBy: { employmentEnd: "asc" },
    }),
    prisma.user.count({ where: { active: false, anonymizedAt: null, employmentEnd: null } }),
  ]);
  return {
    retentionYears: effectiveRetentionYears(configuredYears),
    configuredYears,
    cutoffYear: s.cutoffYear,
    counts,
    deviceLabelMonths: punchPolicy.deviceLabelMonths,
    deviceCutoff: s.deviceCutoff,
    departed: departed.map((u) => ({
      id: u.id,
      name: u.name,
      employmentEnd: u.employmentEnd!.toISOString().slice(0, 10),
    })),
    inactiveWithoutEnd,
  };
}

export interface PurgeResult {
  cutoffYear: number;
  counts: RetentionCounts;
  anonymized: number;
}

/** Rows deleted — cleared device types are counted separately. */
export function totalRecords(c: RetentionCounts): number {
  return c.timeEntries + c.clockEvents + c.corrections + c.absences + c.vacationYears + c.auditEntries;
}

/**
 * Delete every record past its retention period and anonymise departed
 * accounts. The deletions run in one transaction together with their audit
 * row; each anonymisation then runs in its own (anonymizeUser), so a failing
 * one leaves the purge itself intact and can simply be retried.
 */
export async function purgeExpiredRecords(actorId: string, asOf: Date = new Date()): Promise<PurgeResult> {
  const { retentionYears: configuredYears, punchPolicy } = await getAppSettings();
  const s = scopeFor(asOf, configuredYears, punchPolicy.deviceLabelMonths);
  const w = wheres(s);
  const cutoffKey = `${s.cutoffYear}-01-01`;
  // Read before the transaction: the balances need the records it deletes.
  const carries = await carryForwardsBefore(cutoffKey, asOf);

  const counts = await prisma.$transaction(async (tx) => {
    await applyCarryForwards(tx, cutoffKey, carries, actorId);
    // Counted first: cascaded clock events report no count of their own.
    const clockEvents = await tx.clockEvent.count({ where: w.clockEvent });
    const timeEntries = (await tx.timeEntry.deleteMany({ where: w.timeEntry })).count;
    const corrections = (await tx.correctionRequest.deleteMany({ where: w.correction })).count;
    const absences = (await tx.absence.deleteMany({ where: w.absence })).count;
    const vacationYears = (await tx.vacationYear.deleteMany({ where: w.vacationYear })).count;
    const auditEntries = (await tx.auditLog.deleteMany({ where: w.audit })).count;
    const deviceLabels = (
      await tx.clockEvent.updateMany({
        where: { deviceLabel: { not: null }, at: { lt: s.deviceCutoff } },
        data: { deviceLabel: null },
      })
    ).count;
    const c: RetentionCounts = {
      timeEntries,
      clockEvents,
      corrections,
      absences,
      vacationYears,
      auditEntries,
      deviceLabels,
    };
    // Counts and the cutoff only — the deleted content must not survive here.
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "retention.purge",
      targetType: "Retention",
      newValue: {
        cutoff: `${s.cutoffYear}-01-01`,
        retentionYears: effectiveRetentionYears(configuredYears),
        deviceCutoff: s.deviceCutoff.toISOString(),
        ...c,
      },
    });
    return c;
  });

  const departed = await prisma.user.findMany({ where: w.departed, select: { id: true } });
  for (const { id } of departed) {
    await anonymizeUser({ actorId, userId: id });
  }

  return { cutoffYear: s.cutoffYear, counts, anonymized: departed.length };
}
