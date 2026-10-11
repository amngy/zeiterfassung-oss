import { describe, expect, it } from "vitest";
import {
  expectedHoursForDate,
  scheduleForDay,
  weeklyTargetHours,
  workingDaysPerWeek,
} from "./schedule";
import type { HolidayEffect, ScheduleInput } from "./types";

const ANNA: ScheduleInput[] = [
  {
    effectiveFrom: new Date("2022-03-01T00:00:00Z"),
    hours: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 },
  },
];

// Bilal: Mon–Thu 10h, Fri off. Monday holidays hit him; Friday's never do.
const BILAL: ScheduleInput[] = [
  {
    effectiveFrom: new Date("2021-06-15T00:00:00Z"),
    hours: { mon: 10, tue: 10, wed: 10, thu: 10, fri: 0, sat: 0, sun: 0 },
  },
];

describe("expectedHoursForDate", () => {
  it("returns contracted hours for a working weekday", () => {
    expect(expectedHoursForDate(ANNA, "2026-06-15")).toBe(8); // Monday
  });

  it("returns 0 on a non-working weekday", () => {
    expect(expectedHoursForDate(ANNA, "2026-06-20")).toBe(0); // Saturday
    expect(expectedHoursForDate(BILAL, "2026-06-19")).toBe(0); // Friday off
  });

  it("returns 0 before any schedule is effective", () => {
    expect(expectedHoursForDate(ANNA, "2020-01-01")).toBe(0);
  });

  it("opt-in fallback values a pre-schedule day on the earliest schedule (leave only)", () => {
    // 2020-01-01 is a Wednesday, before ANNA's first schedule (2022-03-01).
    // Default (overtime) still 0; with the leave-counting flag it uses the base.
    expect(expectedHoursForDate(ANNA, "2020-01-01", undefined, false)).toBe(0);
    expect(expectedHoursForDate(ANNA, "2020-01-01", undefined, true)).toBe(8);
  });

  describe("holiday handling (the key edge case)", () => {
    const fullHoliday = new Map<string, HolidayEffect>([["2026-06-15", "FULL"]]);
    const halfHoliday = new Map<string, HolidayEffect>([["2026-06-15", "HALF"]]);

    it("a full holiday on a working day makes expected hours 0", () => {
      expect(expectedHoursForDate(ANNA, "2026-06-15", fullHoliday)).toBe(0);
    });

    it("a half holiday halves expected hours", () => {
      expect(expectedHoursForDate(ANNA, "2026-06-15", halfHoliday)).toBe(4);
    });

    it("a holiday on a NON-working day is neutral (stays 0, never negative)", () => {
      // Friday is a holiday but Bilal never works Fridays → no effect.
      const friHoliday = new Map<string, HolidayEffect>([["2026-06-19", "FULL"]]);
      expect(expectedHoursForDate(BILAL, "2026-06-19", friHoliday)).toBe(0);
    });
  });
});

describe("scheduleForDay", () => {
  it("picks the most recent schedule effective on or before the day", () => {
    const schedules: ScheduleInput[] = [
      { effectiveFrom: new Date("2022-01-01T00:00:00Z"), hours: hrs(8) },
      { effectiveFrom: new Date("2025-01-01T00:00:00Z"), hours: hrs(6) },
    ];
    expect(scheduleForDay(schedules, "2024-06-01")?.hours.mon).toBe(8);
    expect(scheduleForDay(schedules, "2025-06-01")?.hours.mon).toBe(6);
    expect(scheduleForDay(schedules, "2025-01-01")?.hours.mon).toBe(6); // boundary
  });

  it("does not silently recompute the past when a schedule changes mid-year", () => {
    const schedules: ScheduleInput[] = [
      { effectiveFrom: new Date("2026-01-01T00:00:00Z"), hours: hrs(8) },
      { effectiveFrom: new Date("2026-07-01T00:00:00Z"), hours: hrs(4) },
    ];
    expect(expectedHoursForDate(schedules, "2026-06-30")).toBe(8);
    expect(expectedHoursForDate(schedules, "2026-07-01")).toBe(4);
  });

  it("returns null before the first row by default, earliest with the fallback", () => {
    const schedules: ScheduleInput[] = [
      { effectiveFrom: new Date("2025-01-01T00:00:00Z"), hours: hrs(6) },
      { effectiveFrom: new Date("2026-01-01T00:00:00Z"), hours: hrs(8) },
    ];
    expect(scheduleForDay(schedules, "2024-06-01")).toBeNull(); // default
    // With the fallback, a pre-history day resolves to the EARLIEST row (6h), not 8h.
    expect(scheduleForDay(schedules, "2024-06-01", true)?.hours.mon).toBe(6);
  });
});

describe("weeklyTargetHours / workingDaysPerWeek", () => {
  it("sums the week and counts working days", () => {
    expect(weeklyTargetHours(ANNA[0]!.hours)).toBe(40);
    expect(workingDaysPerWeek(ANNA[0]!.hours)).toBe(5);
    expect(weeklyTargetHours(BILAL[0]!.hours)).toBe(40);
    expect(workingDaysPerWeek(BILAL[0]!.hours)).toBe(4);
  });
});

function hrs(perWeekday: number) {
  return {
    mon: perWeekday, tue: perWeekday, wed: perWeekday,
    thu: perWeekday, fri: perWeekday, sat: 0, sun: 0,
  };
}
