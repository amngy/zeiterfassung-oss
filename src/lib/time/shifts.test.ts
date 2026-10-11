import { describe, expect, it } from "vitest";
import { buildShifts } from "./shifts";
import { checkPeriod, checkRestBetweenShifts, checkShift, type ArbZgRules } from "./compliance";
import { summarizePeriod } from "./day";
import type { EntryInput, ScheduleInput } from "./types";

// Every case here was reported as FULLY COMPLIANT by the old day-clipped checks.

const RULES: ArbZgRules = {
  capMode: "DAILY",
  maxHoursPerDay: 10,
  standardHoursPerDay: 8,
  maxHoursPerWeek: 48,
  break1AfterHours: 6,
  break1Minutes: 30,
  break2AfterHours: 9,
  break2Minutes: 45,
  minRestHours: 11,
  blockOnViolation: false,
};

const SCHEDULE: ScheduleInput[] = [
  {
    effectiveFrom: new Date("2020-01-01T00:00:00Z"),
    hours: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 },
  },
];

/** Berlin wall-clock helper — June is CEST (UTC+2). */
const b = (iso: string) => new Date(`${iso}:00.000+02:00`);

const work = (from: string, to: string): EntryInput => ({
  type: "WORK",
  start: b(from),
  end: b(to),
});
const brk = (from: string, to: string): EntryInput => ({
  type: "BREAK",
  start: b(from),
  end: b(to),
});

const OPTS = { asOf: new Date("2026-07-01T12:00:00Z"), maxOpenHours: 16 };

function codesFor(entries: EntryInput[], from: string, to: string): string[] {
  const period = summarizePeriod(from, to, entries, SCHEDULE, OPTS);
  return checkPeriod(period, RULES, undefined, { entries, calcOpts: OPTS })
    .map((v) => `${v.date}:${v.code}`)
    .sort();
}

describe("buildShifts", () => {
  it("keeps a shift crossing midnight as ONE shift", () => {
    const shifts = buildShifts([work("2026-06-15T18:00", "2026-06-16T06:00")], OPTS);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.workedMs / 3_600_000).toBe(12);
    // Attributed to the day it BEGINS on (§3 "werktägliche Arbeitszeit").
    expect(shifts[0]!.dayKey).toBe("2026-06-15");
  });

  it("splits into two shifts when the gap is long enough to be a rest period", () => {
    const shifts = buildShifts(
      [work("2026-06-15T20:00", "2026-06-16T06:00"), work("2026-06-16T14:00", "2026-06-16T22:00")],
      OPTS,
    );
    expect(shifts).toHaveLength(2);
  });

  it("treats a short gap between manual blocks as a break, not a new shift", () => {
    const shifts = buildShifts(
      [work("2026-06-15T08:00", "2026-06-15T12:00"), work("2026-06-15T12:30", "2026-06-15T17:00")],
      OPTS,
    );
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.workedMs / 3_600_000).toBe(8.5);
    expect(shifts[0]!.breakMs / 60_000).toBe(30);
  });

  it("counts only break blocks of at least 15 minutes toward §4", () => {
    const entries = [work("2026-06-15T08:00", "2026-06-15T16:30")];
    for (let i = 0; i < 6; i++) {
      const h = 9 + i;
      entries.push(brk(`2026-06-15T${String(h).padStart(2, "0")}:00`, `2026-06-15T${String(h).padStart(2, "0")}:05`));
    }
    const shifts = buildShifts(entries, OPTS);
    expect(shifts[0]!.breakMs / 60_000).toBe(30);
    expect(shifts[0]!.countableBreakMs).toBe(0);
  });
});

describe("§3 ArbZG — daily maximum across midnight", () => {
  it("flags a 12 h break-free night shift (old engine: no violations at all)", () => {
    const codes = codesFor([work("2026-06-15T18:00", "2026-06-16T06:00")], "2026-06-15", "2026-06-16");
    expect(codes).toContain("2026-06-15:MAX_DAILY_HOURS");
    expect(codes).toContain("2026-06-15:BREAK_INSUFFICIENT");
  });

  it("requires 45 min (not 30) for a 12 h shift", () => {
    const shifts = buildShifts(
      [work("2026-06-15T18:00", "2026-06-16T06:30"), brk("2026-06-15T23:00", "2026-06-15T23:30")],
      OPTS,
    );
    const v = checkShift(shifts[0]!, RULES);
    const breakViolation = v.find((x) => x.code === "BREAK_INSUFFICIENT");
    expect(breakViolation).toBeDefined();
    expect(breakViolation!.message).toContain("45");
  });

  it("leaves a compliant 8 h day alone", () => {
    const codes = codesFor(
      [work("2026-06-15T08:00", "2026-06-15T16:30"), brk("2026-06-15T12:00", "2026-06-15T12:30")],
      "2026-06-15",
      "2026-06-15",
    );
    expect(codes).toEqual([]);
  });
});

describe("§4 ArbZG — the 15-minute block rule", () => {
  it("flags six 5-minute pauses that sum to a valid 30 minutes", () => {
    const entries = [work("2026-06-15T08:00", "2026-06-15T16:30")];
    for (let i = 0; i < 6; i++) {
      const h = 9 + i;
      entries.push(brk(`2026-06-15T${String(h).padStart(2, "0")}:00`, `2026-06-15T${String(h).padStart(2, "0")}:05`));
    }
    const codes = codesFor(entries, "2026-06-15", "2026-06-15");
    expect(codes).toContain("2026-06-15:BREAK_FRAGMENTED");
  });

  it("accepts two 15-minute blocks as a valid split break", () => {
    const codes = codesFor(
      [
        work("2026-06-15T08:00", "2026-06-15T16:30"),
        brk("2026-06-15T10:00", "2026-06-15T10:15"),
        brk("2026-06-15T14:00", "2026-06-15T14:15"),
      ],
      "2026-06-15",
      "2026-06-15",
    );
    expect(codes).toEqual([]);
  });
});

describe("§5 ArbZG — rest between shifts", () => {
  it("flags an 8 h gap that sits INSIDE one calendar day", () => {
    // Night shift ends 06:00, back at 14:00 the same day. The old day-to-day
    // comparison could not see this at all.
    const codes = codesFor(
      [work("2026-06-15T20:00", "2026-06-16T06:00"), work("2026-06-16T14:00", "2026-06-16T22:00")],
      "2026-06-15",
      "2026-06-16",
    );
    expect(codes).toContain("2026-06-16:REST_INSUFFICIENT");
  });

  it("does not flag a continuous cross-midnight shift against itself", () => {
    const shifts = buildShifts([work("2026-06-15T22:00", "2026-06-16T06:00")], OPTS);
    expect(checkRestBetweenShifts(shifts, RULES)).toEqual([]);
  });

  it("accepts a normal 15 h overnight rest", () => {
    // 8 h of work needs a 30-minute break (§4), so give each day one — otherwise
    // this would legitimately report BREAK_INSUFFICIENT and prove nothing.
    const codes = codesFor(
      [
        work("2026-06-15T08:00", "2026-06-15T16:30"),
        brk("2026-06-15T12:00", "2026-06-15T12:30"),
        work("2026-06-16T07:30", "2026-06-16T16:00"),
        brk("2026-06-16T12:00", "2026-06-16T12:30"),
      ],
      "2026-06-15",
      "2026-06-16",
    );
    expect(codes).toEqual([]);
  });
});
