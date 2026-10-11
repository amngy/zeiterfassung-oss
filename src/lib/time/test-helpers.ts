// Shared fixtures for the time-calc tests. A small DSL so the tests read like
// the real-world scenarios from the spec's acceptance criteria.

import { fromZonedTime } from "date-fns-tz";
import { BUSINESS_TZ } from "./tz";
import type { EntryInput, ScheduleInput, WeekdayHours } from "./types";

/** Build an absolute instant from a Berlin wall-clock time. */
export function berlin(dayKey: string, hm: string): Date {
  return fromZonedTime(`${dayKey}T${hm}:00`, BUSINESS_TZ);
}

export function work(start: Date, end: Date | null, id = "w"): EntryInput {
  return { id, type: "WORK", start, end };
}

export function brk(start: Date, end: Date | null, id = "b"): EntryInput {
  return { id, type: "BREAK", start, end };
}

const FULL_TIME_5DAY: WeekdayHours = {
  mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0,
};

/** A 5-day, 8h/day schedule effective since 2020. */
export function fullTimeSchedule(
  hours: WeekdayHours = FULL_TIME_5DAY,
  effectiveFrom = "2020-01-01",
): ScheduleInput[] {
  return [{ effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`), hours }];
}
