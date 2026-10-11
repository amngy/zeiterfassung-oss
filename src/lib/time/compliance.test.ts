import { describe, expect, it } from "vitest";
import {
  checkDay,
  checkPeriod,
  countViolations,
  requiredBreakMinutes,
  type ArbZgRules,
} from "./compliance";
import { summarizeDay, summarizePeriod } from "./day";
import { eachDayKey, weekdayOfKey } from "./tz";
import type { HolidayEffect } from "./types";
import { berlin, brk, fullTimeSchedule, work } from "./test-helpers";

const H = 3_600_000;
const anna = fullTimeSchedule();
const AFTER = berlin("2026-07-01", "00:00");

// Mirrors DEFAULT_SETTINGS.ruleProfile (warn-only).
const RULES: ArbZgRules = {
  capMode: "DAILY",
  maxHoursPerDay: 10,
  maxHoursPerWeek: 48,
  break1AfterHours: 6,
  break1Minutes: 30,
  break2AfterHours: 9,
  break2Minutes: 45,
  minRestHours: 11,
  blockOnViolation: false,
};

const codes = (vs: { code: string }[]) => vs.map((v) => v.code).sort();
const dayOf = (key: string, entries: Parameters<typeof summarizeDay>[1]) =>
  summarizeDay(key, entries, anna, { asOf: AFTER });

describe("requiredBreakMinutes", () => {
  it("follows the ArbZG thresholds", () => {
    expect(requiredBreakMinutes(6, RULES)).toBe(0); // exactly 6h → none
    expect(requiredBreakMinutes(6.5, RULES)).toBe(30); // > 6h
    expect(requiredBreakMinutes(9, RULES)).toBe(30); // up to 9h
    expect(requiredBreakMinutes(9.5, RULES)).toBe(45); // > 9h
  });
});

describe("checkDay", () => {
  it("passes a normal 8h day with a 45-min break", () => {
    const d = dayOf("2026-06-15", [
      work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "17:00")),
      brk(berlin("2026-06-15", "12:00"), berlin("2026-06-15", "12:45")),
    ]);
    expect(checkDay(d, RULES)).toEqual([]);
  });

  it("flags a day over the 10h maximum", () => {
    // 06:00–17:30 (11.5h) with a 60-min break → 10.5h worked, break OK.
    const d = dayOf("2026-06-15", [
      work(berlin("2026-06-15", "06:00"), berlin("2026-06-15", "17:30")),
      brk(berlin("2026-06-15", "12:00"), berlin("2026-06-15", "13:00")),
    ]);
    expect(codes(checkDay(d, RULES))).toEqual(["MAX_DAILY_HOURS"]);
  });

  it("flags an insufficient break", () => {
    const d = dayOf("2026-06-15", [
      work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "15:30")), // 7.5h, no break
    ]);
    expect(codes(checkDay(d, RULES))).toEqual(["BREAK_INSUFFICIENT"]);
  });

  it("requires 45 min once worked time passes 9h", () => {
    const d = dayOf("2026-06-15", [
      work(berlin("2026-06-15", "07:00"), berlin("2026-06-15", "17:00")), // 10h presence
      brk(berlin("2026-06-15", "12:00"), berlin("2026-06-15", "12:30")), // only 30 min
    ]);
    // 9.5h worked → needs 45, has 30 → break flagged (and 9.5 < 10 so no max).
    expect(codes(checkDay(d, RULES))).toEqual(["BREAK_INSUFFICIENT"]);
  });

  it("flags work on a Sunday", () => {
    const d = dayOf("2026-06-21", [
      work(berlin("2026-06-21", "09:00"), berlin("2026-06-21", "13:00")), // Sunday, 4h
    ]);
    expect(codes(checkDay(d, RULES))).toEqual(["SUNDAY_WORK"]);
  });

  it("flags work on a full public holiday", () => {
    const holidays = new Map<string, HolidayEffect>([["2026-06-15", "FULL"]]);
    const d = summarizeDay(
      "2026-06-15",
      [work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "12:00"))],
      anna,
      { asOf: AFTER, holidays },
    );
    expect(codes(checkDay(d, RULES, holidays))).toEqual(["HOLIDAY_WORK"]);
  });

  it("does not flag a running or anomalous day", () => {
    const now = berlin("2026-06-16", "20:00");
    const running = summarizeDay(
      "2026-06-16",
      [work(berlin("2026-06-16", "06:00"), null)], // 14h and counting, but live
      anna,
      { asOf: now },
    );
    expect(checkDay(running, RULES)).toEqual([]);
  });

  it("hard-blocks instead of warning when the profile says so", () => {
    const strict = { ...RULES, blockOnViolation: true };
    const d = dayOf("2026-06-15", [
      work(berlin("2026-06-15", "06:00"), berlin("2026-06-15", "17:30")),
      brk(berlin("2026-06-15", "12:00"), berlin("2026-06-15", "13:00")),
    ]);
    expect(checkDay(d, strict)[0]?.severity).toBe("BLOCK");
  });
});

describe("checkPeriod — rest between days", () => {
  it("flags < 11h rest between consecutive worked days", () => {
    const p = summarizePeriod(
      "2026-06-15",
      "2026-06-16",
      [
        work(berlin("2026-06-15", "14:00"), berlin("2026-06-15", "22:00")), // ends 22:00
        work(berlin("2026-06-16", "06:00"), berlin("2026-06-16", "14:00")), // starts 06:00 → 8h gap
      ],
      anna,
      { asOf: AFTER },
    );
    const rest = checkPeriod(p, RULES).filter((v) => v.code === "REST_INSUFFICIENT");
    expect(rest).toHaveLength(1);
    expect(rest[0]?.date).toBe("2026-06-16");
  });

  it("does not flag a normal 14h overnight rest", () => {
    const p = summarizePeriod(
      "2026-06-15",
      "2026-06-16",
      [
        work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "16:30")),
        brk(berlin("2026-06-15", "12:00"), berlin("2026-06-15", "12:30")),
        work(berlin("2026-06-16", "08:00"), berlin("2026-06-16", "16:30")),
        brk(berlin("2026-06-16", "12:00"), berlin("2026-06-16", "12:30")),
      ],
      anna,
      { asOf: AFTER },
    );
    expect(checkPeriod(p, RULES).some((v) => v.code === "REST_INSUFFICIENT")).toBe(false);
  });

  it("does NOT flag a continuous shift that crosses midnight (no shift-vs-itself)", () => {
    // Regression: the day-clipped segments abut at midnight (gap 0) — one shift.
    const p = summarizePeriod(
      "2026-06-15",
      "2026-06-16",
      [work(berlin("2026-06-15", "22:00"), berlin("2026-06-16", "02:00"))],
      anna,
      { asOf: AFTER },
    );
    expect(checkPeriod(p, RULES).some((v) => v.code === "REST_INSUFFICIENT")).toBe(false);
  });
});

describe("checkPeriod — weekly cap mode", () => {
  const weekly = { ...RULES, capMode: "WEEKLY" as const };

  function busyWeek() {
    const entries = [];
    for (const day of [
      "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19", "2026-06-20",
    ]) {
      entries.push(work(berlin(day, "08:00"), berlin(day, "17:45"))); // 9.75h presence
      entries.push(brk(berlin(day, "12:00"), berlin(day, "12:45"))); // − 45 → 9h worked
    }
    return summarizePeriod("2026-06-15", "2026-06-21", entries, anna, { asOf: AFTER });
  }

  it("flags a week over the weekly maximum only in WEEKLY mode", () => {
    const p = busyWeek(); // 6 × 9h = 54h > 48h
    expect(checkPeriod(p, weekly).some((v) => v.code === "MAX_WEEKLY_HOURS")).toBe(true);
    expect(checkPeriod(p, RULES).some((v) => v.code === "MAX_WEEKLY_HOURS")).toBe(false);
  });

  it("does NOT falsely flag a normal month (weekly cap is evaluated per ISO week)", () => {
    // Mon–Fri 8h all of June 2026: ~168h for the month, but every week ≤ 40h.
    const entries = [];
    for (const day of eachDayKey("2026-06-01", "2026-06-30")) {
      const wd = weekdayOfKey(day);
      if (wd === "sat" || wd === "sun") continue;
      entries.push(work(berlin(day, "08:00"), berlin(day, "16:45")));
      entries.push(brk(berlin(day, "12:00"), berlin(day, "12:45")));
    }
    const p = summarizePeriod("2026-06-01", "2026-06-30", entries, anna, { asOf: AFTER });
    expect(p.workedMs).toBeGreaterThan(48 * H); // month total exceeds a weekly cap
    expect(checkPeriod(p, weekly).some((v) => v.code === "MAX_WEEKLY_HOURS")).toBe(false);
  });
});

describe("countViolations", () => {
  it("tallies warn/block/total", () => {
    const vs = [
      { code: "X", severity: "WARN", date: "", message: "" },
      { code: "Y", severity: "BLOCK", date: "", message: "" },
      { code: "Z", severity: "WARN", date: "", message: "" },
    ] as const;
    expect(countViolations(vs as never)).toEqual({ warn: 2, block: 1, total: 3 });
  });
});
