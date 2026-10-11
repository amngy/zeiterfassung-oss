// The single source of truth for "how many hours is this person expected to
// work on this date". It also subtracts public/gifted holidays —
// the SAME function drives both overtime/undertime AND vacation-day counting,
// so the two can never diverge (a hard requirement of the spec).

import type { HolidayEffect, ScheduleInput, WeekdayHours } from "./types";
import { berlinDayKey, weekdayOfKey } from "./tz";

/**
 * Pick the schedule in effect on `dayKey`: the one with the greatest
 * effectiveFrom that is still ≤ the day. Returns null if none applies yet.
 *
 * `fallbackToEarliest` (opt-in) instead returns the earliest schedule on record
 * for a day that predates every schedule row, treating it as the employee's
 * baseline pattern. Only leave counting opts in (see {@link expectedHoursForDate}
 * and vacationDayFraction) — the overtime calc keeps the default so it never
 * invents expected hours for dates before the first schedule row.
 */
export function scheduleForDay(
  schedules: ScheduleInput[],
  dayKey: string,
  fallbackToEarliest = false,
): ScheduleInput | null {
  let best: ScheduleInput | null = null;
  let bestKey = "";
  let earliest: ScheduleInput | null = null;
  let earliestKey = "";
  for (const s of schedules) {
    // effectiveFrom is a pure date stored at UTC midnight; read it as such.
    const key = berlinDayKey(s.effectiveFrom, "UTC");
    if (key <= dayKey && key >= bestKey) {
      best = s;
      bestKey = key;
    }
    if (!earliest || key < earliestKey) {
      earliest = s;
      earliestKey = key;
    }
  }
  if (!best && fallbackToEarliest) return earliest;
  return best;
}

/** Contracted hours for a weekday from a WeekdayHours record. */
export function weekdayHours(hours: WeekdayHours, dayKey: string): number {
  return hours[weekdayOfKey(dayKey)];
}

/**
 * Expected working hours for an employee on a date.
 *  - No schedule yet → 0.
 *  - Otherwise the contracted hours for that weekday …
 *  - … reduced by any holiday: FULL → 0, HALF → half the contracted hours.
 *
 * A holiday only ever *reduces* expected hours; it never adds. A holiday on a
 * non-working day (contracted 0) stays 0 — i.e. it is neutral, exactly as the
 * spec requires for employees who never work that weekday.
 *
 * `fallbackToEarliest` is forwarded to {@link scheduleForDay}; leave counting
 * passes it so an absence recorded before the first schedule row is still valued
 * on the baseline pattern instead of silently costing 0.
 */
export function expectedHoursForDate(
  schedules: ScheduleInput[],
  dayKey: string,
  holidays?: Map<string, HolidayEffect>,
  fallbackToEarliest = false,
): number {
  const schedule = scheduleForDay(schedules, dayKey, fallbackToEarliest);
  if (!schedule) return 0;
  const base = weekdayHours(schedule.hours, dayKey);
  if (base <= 0) return 0;

  const effect = holidays?.get(dayKey);
  if (effect === "FULL") return 0;
  if (effect === "HALF") return base / 2;
  return base;
}

/** Sum of contracted hours across the week (weekly target). */
export function weeklyTargetHours(hours: WeekdayHours): number {
  return (
    hours.mon + hours.tue + hours.wed + hours.thu + hours.fri + hours.sat + hours.sun
  );
}

/** Number of distinct weekdays with contracted hours > 0 (for vacation pro-rating). */
export function workingDaysPerWeek(hours: WeekdayHours): number {
  return (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).filter(
    (d) => hours[d] > 0,
  ).length;
}
