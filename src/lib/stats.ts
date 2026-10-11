// Statistics aggregation for the admin dashboard. Reuses the PURE calc
// module (@/lib/time) so the figures are identical to what each employee sees on
// their own timesheet — no second, divergent definition of "worked" or "overtime".
//
// Impure here (Prisma + holiday map); the maths stays in @/lib/time.

import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { absenceEffectsForRange } from "@/lib/absences";
import { holidayMapForRange, resolveRegion } from "@/lib/holidays";
import {
  berlinDayKey,
  berlinDayRange,
  checkPeriod,
  countViolations,
  summarizePeriod,
  type ArbZgRules,
  type EntryInput,
  type HolidayEffect,
  type ScheduleInput,
  type ViolationCode,
} from "@/lib/time";

/** True if the person is under 18 on `asOf` (drives the stricter JArbSchG profile). */
function isMinorOn(birthDate: Date, asOf: Date): boolean {
  const p = (n: number) => String(n).padStart(2, "0");
  const eighteenth = `${birthDate.getUTCFullYear() + 18}-${p(birthDate.getUTCMonth() + 1)}-${p(birthDate.getUTCDate())}`;
  return berlinDayKey(asOf) < eighteenth;
}

export interface EmployeeStat {
  userId: string;
  name: string;
  workedMs: number;
  presenceMs: number;
  breakMs: number;
  /** Contracted hours across the whole range (Soll). */
  expectedMs: number;
  /** Paid time credited for approved holiday / sick days in the range. */
  absenceMs: number;
  /** Running balance as of today (worked + absence − expected, to-date only). */
  balanceMs: number;
  /** Average worked time per day that has any recorded work. */
  avgDailyWorkedMs: number;
  /** Days in the range with recorded work. */
  daysWithWork: number;
  violations: number;
  byCode: Record<ViolationCode, number>;
  hasOpenAnomaly: boolean;
}

export interface StatsResult {
  range: { from: string; to: string };
  employees: EmployeeStat[];
  totals: {
    workedMs: number;
    expectedMs: number;
    absenceMs: number;
    balanceMs: number;
    breakMs: number;
    violations: number;
    blocking: number;
    openAnomalies: number;
    headcount: number;
  };
  /** Worked hours summed across all employees, per day — the trend chart series. */
  perDay: { dayKey: string; workedHours: number }[];
}

const HOUR_MS = 3_600_000;

function emptyByCode(): Record<ViolationCode, number> {
  return {
    MAX_DAILY_HOURS: 0,
    MAX_WEEKLY_HOURS: 0,
    BREAK_INSUFFICIENT: 0,
    BREAK_FRAGMENTED: 0,
    BREAK_AUTO_APPLIED: 0,
    BREAK_UNFINISHED: 0,
    REST_INSUFFICIENT: 0,
    AVERAGING_EXCEEDED: 0,
    SUNDAY_WORK: 0,
    HOLIDAY_WORK: 0,
  };
}

function mapSchedules(rows: {
  effectiveFrom: Date; hoursMon: number; hoursTue: number; hoursWed: number;
  hoursThu: number; hoursFri: number; hoursSat: number; hoursSun: number;
}[]): ScheduleInput[] {
  return rows.map((r) => ({
    effectiveFrom: r.effectiveFrom,
    hours: {
      mon: r.hoursMon, tue: r.hoursTue, wed: r.hoursWed, thu: r.hoursThu,
      fri: r.hoursFri, sat: r.hoursSat, sun: r.hoursSun,
    },
  }));
}

/**
 * Aggregate worked/expected/overtime/break-compliance and rule-violation counts
 * for every active employee over [fromKey, toKey], plus company-wide totals and a
 * per-day worked-hours trend.
 */
export async function getStatistics(
  fromKey: string,
  toKey: string,
  asOf: Date,
): Promise<StatsResult> {
  const { start } = berlinDayRange(fromKey);
  const { end } = berlinDayRange(toKey);

  const [settings, users] = await Promise.all([
    getAppSettings(),
    prisma.user.findMany({
      where: { active: true, exemptFromTimeRecording: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, bundesland: true, birthDate: true },
    }),
  ]);

  // Resolve + cache the holiday map per region so two employees in the same
  // Bundesland don't each rebuild it.
  const holidayCache = new Map<string, Map<string, HolidayEffect>>();
  const holidaysFor = async (bundesland: string | null) => {
    const region = resolveRegion(bundesland, settings);
    const cached = holidayCache.get(region);
    if (cached) return cached;
    const map = await holidayMapForRange(region, fromKey, toKey);
    holidayCache.set(region, map);
    return map;
  };

  const perDayWorked = new Map<string, number>();
  const employees: EmployeeStat[] = [];

  for (const u of users) {
    const [scheduleRows, entries, holidays, absences] = await Promise.all([
      prisma.workSchedule.findMany({ where: { userId: u.id }, orderBy: { effectiveFrom: "asc" } }),
      loadEntries(u.id, start, end),
      holidaysFor(u.bundesland),
      // Same absence credit the employee sees on their own timesheet — without
      // it a team on holiday reads as a team that stopped turning up.
      absenceEffectsForRange(u.id, fromKey, toKey),
    ]);
    const rules: ArbZgRules =
      u.birthDate && isMinorOn(u.birthDate, asOf) ? settings.minorRuleProfile : settings.ruleProfile;

    const period = summarizePeriod(fromKey, toKey, entries, mapSchedules(scheduleRows), {
      asOf,
      holidays,
      absences,
    });
    const violations = checkPeriod(period, rules, holidays);
    const { total: vTotal } = countViolations(violations);

    const byCode = emptyByCode();
    for (const v of violations) byCode[v.code] += 1;

    let daysWithWork = 0;
    for (const d of period.days) {
      if (d.workedMs > 0) {
        daysWithWork += 1;
        perDayWorked.set(d.date, (perDayWorked.get(d.date) ?? 0) + d.workedMs);
      }
    }

    employees.push({
      userId: u.id,
      name: u.name,
      workedMs: period.workedMs,
      presenceMs: period.presenceMs,
      breakMs: period.breakMs,
      expectedMs: period.expectedMs,
      absenceMs: period.absenceMs,
      balanceMs: period.balanceMs,
      avgDailyWorkedMs: daysWithWork > 0 ? period.workedMs / daysWithWork : 0,
      daysWithWork,
      violations: vTotal,
      byCode,
      hasOpenAnomaly: period.hasOpenAnomaly,
    });
  }

  const totals = employees.reduce(
    (acc, e) => {
      acc.workedMs += e.workedMs;
      acc.expectedMs += e.expectedMs;
      acc.absenceMs += e.absenceMs;
      acc.balanceMs += e.balanceMs;
      acc.breakMs += e.breakMs;
      acc.violations += e.violations;
      if (e.hasOpenAnomaly) acc.openAnomalies += 1;
      return acc;
    },
    {
      workedMs: 0, expectedMs: 0, absenceMs: 0, balanceMs: 0, breakMs: 0,
      violations: 0, blocking: 0, openAnomalies: 0,
    },
  );

  // Blocking count = violations that hard-block under the active profile. Both
  // employee profiles share `blockOnViolation`, so derive it once from settings.
  totals.blocking = settings.ruleProfile.blockOnViolation ? totals.violations : 0;

  const perDay = [...perDayWorked.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dayKey, ms]) => ({ dayKey, workedHours: round2(ms / HOUR_MS) }));

  return {
    range: { from: fromKey, to: toKey },
    employees,
    totals: { ...totals, headcount: employees.length },
    perDay,
  };
}

/** ACTIVE entries overlapping [start, end) — mirrors the timesheet loader. */
async function loadEntries(userId: string, startInstant: Date, endInstant: Date): Promise<EntryInput[]> {
  return prisma.timeEntry.findMany({
    where: {
      userId,
      status: "ACTIVE",
      start: { lt: endInstant },
      OR: [{ end: null }, { end: { gt: startInstant } }],
    },
    orderBy: { start: "asc" },
    select: { id: true, type: true, start: true, end: true },
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
