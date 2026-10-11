// Server-side data layer for time tracking: reads TimeEntry/WorkSchedule rows
// from the database and feeds them to the PURE calc module in @/lib/time.
//
// Keep the impure (Prisma) code here and the maths in @/lib/time — the boundary
// is what lets the calculation logic be unit-tested without a database.

import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { absenceEffectsForRange } from "@/lib/absences";
import { holidayMapForRange, resolveRegion } from "@/lib/holidays";
import {
  berlinDayKey,
  berlinDayRange,
  checkDay,
  checkPeriod,
  liveStatus,
  monthRangeOf,
  parseDayKey,
  summarizeDay,
  summarizePeriod,
  weekRangeOf,
  type AbsenceEffect,
  type ArbZgRules,
  type AutoBreakPolicy,
  type AutoBreakSource,
  type DaySummary,
  type EntryInput,
  type HolidayEffect,
  type LiveStatus,
  type PeriodSummary,
  type ScheduleInput,
  type Violation,
} from "@/lib/time";

export type TimesheetView = "day" | "week" | "month";

const DAY_MS = 86_400_000;
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/**
 * True if the person is under 18 on `asOf` (drives the stricter JArbSchG
 * profile). Compared on Berlin calendar days: birthDate is a @db.Date (UTC
 * midnight), so its UTC parts are the calendar date, and the transition to
 * adulthood happens at the start of the 18th birthday in Berlin local time.
 */
function eighteenthBirthdayKey(birthDate: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${birthDate.getUTCFullYear() + 18}-${p(birthDate.getUTCMonth() + 1)}-${p(
    birthDate.getUTCDate(),
  )}`;
}

interface RuleContext {
  rules: ArbZgRules;
  /** Stricter JArbSchG profile, applied per DAY before the 18th birthday. */
  minorRules: ArbZgRules;
  /** The employee's 18th birthday as a day key, or undefined if never a minor. */
  minorUntilKey?: string;
  holidays: Map<string, HolidayEffect>;
  /** Pausenautomatik, resolved per day so a minor's days use the JArbSchG tiers. */
  autoBreak: AutoBreakSource;
  /** Approved holiday / sick days in the range, credited against their Soll. */
  absences: Map<string, AbsenceEffect>;
}

/**
 * The Pausenautomatik as the pure calc layer wants it: a resolver, because the
 * §4 tiers it tops up to come from the profile in force on that DAY — a minor
 * needs their break after 4½ hours, not after 6.
 */
function autoBreakFor(
  policy: { enabled: boolean; fixedMinutes: number; unfinishedBreakMinutes: number },
  rules: ArbZgRules,
  minorRules: ArbZgRules,
  minorUntilKey?: string,
  /** This employee is exempt from the §4 top-up (see User.exemptFromAutoBreak). */
  exemptFromAutoBreak = false,
): AutoBreakSource {
  const build = (r: ArbZgRules): AutoBreakPolicy => ({
    enabled: policy.enabled,
    fixedMinutes: policy.fixedMinutes,
    unfinishedBreakMinutes: policy.unfinishedBreakMinutes,
    deductMissingBreak: !exemptFromAutoBreak,
    rules: r,
  });
  const adult = build(rules);
  if (!minorUntilKey) return adult;
  const minor = build(minorRules);
  return (dayKey: string) => (dayKey < minorUntilKey ? minor : adult);
}

/**
 * The ArbZG rule profile that applies to a user, plus the holiday map used by
 * the calc layer for expected-hours (paid holidays) and §9 (Sunday/holiday work)
 * checks. Minors fall under the stricter profile. The holiday map is resolved for
 * the employee's region (own override, else the company default) over [from, to].
 */
async function loadRuleContext(
  userId: string,
  asOf: Date,
  fromKey: string,
  toKey: string,
): Promise<RuleContext> {
  const [settings, user, absences] = await Promise.all([
    getAppSettings(),
    prisma.user.findUnique({
      where: { id: userId },
      select: { birthDate: true, bundesland: true, exemptFromAutoBreak: true },
    }),
    absenceEffectsForRange(userId, fromKey, toKey),
  ]);
  const region = resolveRegion(user?.bundesland, settings);
  // The 18th-birthday day key, so each DAY can be judged under the profile that
  // was actually in force on it. Choosing one profile from `asOf` meant a person
  // turning 18 retroactively lost every JArbSchG breach in earlier months.
  const minorUntilKey = user?.birthDate ? eighteenthBirthdayKey(user.birthDate) : undefined;
  return {
    // `rules` is the adult profile; days before minorUntilKey use minorRules.
    rules: settings.ruleProfile,
    minorRules: settings.minorRuleProfile,
    minorUntilKey,
    holidays: await holidayMapForRange(region, fromKey, toKey),
    autoBreak: autoBreakFor(
      settings.breakPolicy,
      settings.ruleProfile,
      settings.minorRuleProfile,
      minorUntilKey,
      user?.exemptFromAutoBreak ?? false,
    ),
    absences,
  };
}

/** Load all effective-dated schedules for a user (oldest first). */
async function loadSchedules(userId: string): Promise<ScheduleInput[]> {
  const rows = await prisma.workSchedule.findMany({
    where: { userId },
    orderBy: { effectiveFrom: "asc" },
  });
  return rows.map((r) => ({
    effectiveFrom: r.effectiveFrom,
    hours: {
      mon: r.hoursMon, tue: r.hoursTue, wed: r.hoursWed, thu: r.hoursThu,
      fri: r.hoursFri, sat: r.hoursSat, sun: r.hoursSun,
    },
  }));
}

/**
 * ACTIVE entries overlapping [startInstant, endInstant). Includes still-open
 * entries (end === null) regardless of age so forgotten clock-outs surface, and
 * entries that start before the window but reach into it (cross-midnight).
 */
async function loadEntries(
  userId: string,
  startInstant: Date,
  endInstant: Date,
): Promise<EntryInput[]> {
  const rows = await prisma.timeEntry.findMany({
    where: {
      userId,
      status: "ACTIVE",
      start: { lt: endInstant },
      OR: [{ end: null }, { end: { gt: startInstant } }],
    },
    orderBy: { start: "asc" },
    select: { id: true, type: true, start: true, end: true },
  });
  return rows;
}

/** All currently-open ACTIVE entries (any age) — for the live status. */
async function loadOpenEntries(userId: string): Promise<EntryInput[]> {
  const rows = await prisma.timeEntry.findMany({
    where: { userId, status: "ACTIVE", end: null },
    orderBy: { start: "asc" },
    select: { id: true, type: true, start: true, end: true },
  });
  return rows;
}

export interface TodayView {
  todayKey: string;
  live: LiveStatus;
  day: DaySummary;
  violations: Violation[];
}

/** Live clock status + today's running summary for the dashboard / today card. */
export async function getTodayView(userId: string, asOf: Date): Promise<TodayView> {
  const todayKey = berlinDayKey(asOf);
  const { start, end } = berlinDayRange(todayKey);

  const [schedules, dayEntries, openEntries, ctx] = await Promise.all([
    loadSchedules(userId),
    loadEntries(userId, start, end),
    loadOpenEntries(userId),
    loadRuleContext(userId, asOf, todayKey, todayKey),
  ]);

  // Merge open entries that started before today into the day set (deduped),
  // so the live status sees them even though they predate today's window.
  const byId = new Map<string, EntryInput>();
  for (const e of [...dayEntries, ...openEntries]) if (e.id) byId.set(e.id, e);
  const entries = [...byId.values()];

  const day = summarizeDay(todayKey, entries, schedules, {
    asOf,
    holidays: ctx.holidays,
    autoBreak: ctx.autoBreak,
    absences: ctx.absences,
  });

  return {
    todayKey,
    live: liveStatus(openEntries, asOf),
    day,
    violations: checkDay(
      day,
      ctx.minorUntilKey && todayKey < ctx.minorUntilKey ? ctx.minorRules : ctx.rules,
      ctx.holidays,
    ),
  };
}

/** Count of ArbZG violations in the user's current month (dashboard badge). */
export async function getMonthViolationCount(
  userId: string,
  asOf: Date,
): Promise<number> {
  const { from, to } = monthRangeOf(berlinDayKey(asOf));
  const { start } = berlinDayRange(from);
  const { end } = berlinDayRange(to);
  const [schedules, entries, ctx] = await Promise.all([
    loadSchedules(userId),
    loadEntries(userId, start, end),
    loadRuleContext(userId, asOf, from, to),
  ]);
  const period = summarizePeriod(from, to, entries, schedules, {
    asOf,
    holidays: ctx.holidays,
    autoBreak: ctx.autoBreak,
    absences: ctx.absences,
  });
  // Shift-based: load a day of margin so a shift that began the previous
  // evening is complete and the first rest gap is measured against something.
  const marginEntries = await loadEntries(userId, addDays(start, -1), end);
  return checkPeriod(period, ctx.rules, ctx.holidays, {
    entries: marginEntries,
    calcOpts: {
      asOf,
      holidays: ctx.holidays,
      autoBreak: ctx.autoBreak,
      absences: ctx.absences,
    },
    minorRules: ctx.minorRules,
    minorUntilKey: ctx.minorUntilKey,
  }).length;
}

export interface TimesheetResult {
  view: TimesheetView;
  /** Day key the period is anchored on (within the period). */
  anchorKey: string;
  range: { from: string; to: string };
  period: PeriodSummary;
  /** ArbZG violations across the period (warnings unless the profile blocks). */
  violations: Violation[];
  /** Anchor keys for navigating to the previous/next period. */
  prevAnchor: string;
  nextAnchor: string;
}

function rangeFor(view: TimesheetView, anchorKey: string): { from: string; to: string } {
  if (view === "day") return { from: anchorKey, to: anchorKey };
  if (view === "week") return weekRangeOf(anchorKey);
  return monthRangeOf(anchorKey);
}

function shiftAnchor(view: TimesheetView, anchorKey: string, dir: -1 | 1): string {
  const [y, m, d] = parseDayKey(anchorKey);
  if (view === "day") {
    const t = new Date(Date.UTC(y, m - 1, d + dir));
    return iso(t);
  }
  if (view === "week") {
    const t = new Date(Date.UTC(y, m - 1, d + 7 * dir));
    return iso(t);
  }
  // month: keep the day-of-month at 1 to stay inside the target month.
  const t = new Date(Date.UTC(y, m - 1 + dir, 1));
  return iso(t);
}

function iso(t: Date): string {
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** A timesheet for the chosen view/anchor, with prev/next navigation anchors. */
export async function getTimesheet(
  userId: string,
  view: TimesheetView,
  anchorKey: string,
  asOf: Date,
): Promise<TimesheetResult> {
  const range = rangeFor(view, anchorKey);
  const { start } = berlinDayRange(range.from);
  const { end } = berlinDayRange(range.to);

  const [schedules, entries, marginEntries, ctx] = await Promise.all([
    loadSchedules(userId),
    loadEntries(userId, start, end),
    // One day earlier, so a shift starting the previous evening is whole and
    // the period's first rest gap is measured against a real predecessor.
    loadEntries(userId, addDays(start, -1), end),
    loadRuleContext(userId, asOf, range.from, range.to),
  ]);

  const period = summarizePeriod(range.from, range.to, entries, schedules, {
    asOf,
    holidays: ctx.holidays,
    autoBreak: ctx.autoBreak,
    absences: ctx.absences,
  });

  return {
    view,
    anchorKey,
    range,
    period,
    violations: checkPeriod(period, ctx.rules, ctx.holidays, {
      entries: marginEntries,
      calcOpts: {
        asOf,
        holidays: ctx.holidays,
        autoBreak: ctx.autoBreak,
        absences: ctx.absences,
      },
      minorRules: ctx.minorRules,
      minorUntilKey: ctx.minorUntilKey,
    }),
    prevAnchor: shiftAnchor(view, anchorKey, -1),
    nextAnchor: shiftAnchor(view, anchorKey, 1),
  };
}
