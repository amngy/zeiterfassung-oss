import { describe, expect, it } from "vitest";
import {
  assessTeilurlaub,
  computeEntitlement,
  countVacationDays,
  fullCalendarMonthsCovered,
  minorMinimumDays,
  statutoryMinimumDays,
  vacationDayFraction,
  wartezeitCompletedOn,
} from "./vacation";
import type { HolidayEffect, ScheduleInput } from "./types";

// Anna: classic 5-day full-timer.
const ANNA: ScheduleInput[] = [
  {
    effectiveFrom: new Date("2020-01-01T00:00:00Z"),
    hours: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 },
  },
];

// Bilal: Mon–Thu 10h, Fri off. Friday holidays never affect him.
const BILAL: ScheduleInput[] = [
  {
    effectiveFrom: new Date("2020-01-01T00:00:00Z"),
    hours: { mon: 10, tue: 10, wed: 10, thu: 10, fri: 0, sat: 0, sun: 0 },
  },
];

function holidays(...entries: [string, HolidayEffect][]): Map<string, HolidayEffect> {
  return new Map(entries);
}

describe("vacationDayFraction", () => {
  it("is 1 on a normal contracted working day", () => {
    expect(vacationDayFraction(ANNA, "2026-06-15")).toBe(1); // Monday
  });
  it("is 0 on a non-working weekday", () => {
    expect(vacationDayFraction(ANNA, "2026-06-20")).toBe(0); // Saturday
    expect(vacationDayFraction(BILAL, "2026-06-19")).toBe(0); // Bilal's Friday off
  });
  it("is 0 on a full public holiday (paid, but costs no vacation)", () => {
    expect(vacationDayFraction(ANNA, "2026-06-15", holidays(["2026-06-15", "FULL"]))).toBe(0);
  });
  it("is 0.5 on a gifted half-day holiday", () => {
    expect(vacationDayFraction(ANNA, "2026-06-15", holidays(["2026-06-15", "HALF"]))).toBe(0.5);
  });

  it("values a day before the first schedule row on the earliest schedule", () => {
    // Regression: an admin records leave for a working day that predates the
    // employee's first schedule effective-date. It must still cost a full day
    // (baseline pattern), not silently 0.
    const late: ScheduleInput[] = [
      {
        effectiveFrom: new Date("2026-08-20T00:00:00Z"),
        hours: { mon: 10, tue: 10, wed: 10, thu: 10, fri: 0, sat: 0, sun: 0 },
      },
    ];
    expect(vacationDayFraction(late, "2026-08-03")).toBe(1); // a Monday before it
    expect(vacationDayFraction(late, "2026-08-07")).toBe(0); // a Friday (off) before it
  });
});

describe("countVacationDays", () => {
  it("counts only contracted working days across a weekend (acceptance criterion)", () => {
    // Fri 2026-06-12 .. Wed 2026-06-17 → Fri, (Sat, Sun excluded), Mon, Tue, Wed = 4
    expect(countVacationDays(ANNA, "2026-06-12", "2026-06-17")).toBe(4);
  });

  it("excludes a public holiday inside the range", () => {
    // Make Monday 2026-06-15 a public holiday → 3 working days instead of 4.
    expect(
      countVacationDays(ANNA, "2026-06-12", "2026-06-17", holidays(["2026-06-15", "FULL"])),
    ).toBe(3);
  });

  it("counts a single half-day request as 0.5", () => {
    expect(countVacationDays(ANNA, "2026-06-15", "2026-06-15", undefined, { halfDayStart: true })).toBe(0.5);
  });

  it("halves only the boundary day of a multi-day half-day request", () => {
    // Mon–Wed = 3 working days; afternoon of Wed worked → 2.5
    expect(
      countVacationDays(ANNA, "2026-06-15", "2026-06-17", undefined, { halfDayEnd: true }),
    ).toBe(2.5);
  });

  it("counts a gifted half-day holiday inside the range as 0.5", () => {
    // Tue is a gifted half day → 1 + 0.5 + 1 = 2.5 over Mon–Wed
    expect(
      countVacationDays(ANNA, "2026-06-15", "2026-06-17", holidays(["2026-06-16", "HALF"])),
    ).toBe(2.5);
  });

  it("does not collapse a multi-week range that predates the first schedule row", () => {
    // The exact reported bug: 3 weeks (12 working days on a Mon–Thu week) recorded
    // for dates before the schedule's effective-from must count 12, not ~1.
    const late: ScheduleInput[] = [
      {
        effectiveFrom: new Date("2026-08-20T00:00:00Z"),
        hours: { mon: 10, tue: 10, wed: 10, thu: 10, fri: 0, sat: 0, sun: 0 },
      },
    ];
    expect(countVacationDays(late, "2026-08-03", "2026-08-21")).toBe(12);
  });

  it("is per-employee: a Friday holiday costs Bilal nothing but Anna a day", () => {
    // Karfreitag-style Friday 2026-04-03.
    const friday = holidays(["2026-04-03", "FULL"]);
    // Range Thu–Fri.
    expect(countVacationDays(ANNA, "2026-04-02", "2026-04-03", friday)).toBe(1); // only Thu
    expect(countVacationDays(BILAL, "2026-04-02", "2026-04-03", friday)).toBe(1); // Thu; Fri already off
    // Without the holiday Anna would consume 2, Bilal still 1 (Fri off).
    expect(countVacationDays(ANNA, "2026-04-02", "2026-04-03")).toBe(2);
    expect(countVacationDays(BILAL, "2026-04-02", "2026-04-03")).toBe(1);
  });
});

describe("fullCalendarMonthsCovered", () => {
  it("returns 12 for a year fully inside employment", () => {
    expect(fullCalendarMonthsCovered(2026, new Date("2020-01-01"), null)).toBe(12);
  });
  it("counts whole months from a first-of-month start", () => {
    // Carla: starts 2025-09-01 → Sep, Oct, Nov, Dec = 4 months in 2025.
    expect(fullCalendarMonthsCovered(2025, new Date("2025-09-01"), null)).toBe(4);
  });
  it("excludes a partial start month (mid-month start)", () => {
    // Start 2025-09-15 → Sep is not fully covered → Oct, Nov, Dec = 3.
    expect(fullCalendarMonthsCovered(2025, new Date("2025-09-15"), null)).toBe(3);
  });
  it("counts months up to a leaving date", () => {
    expect(fullCalendarMonthsCovered(2026, new Date("2020-01-01"), new Date("2026-06-30"))).toBe(6);
  });
});

describe("statutory + minor floors", () => {
  it("statutory minimum is 20 on a 5-day week, scaled by working days", () => {
    expect(statutoryMinimumDays(5)).toBe(20);
    expect(statutoryMinimumDays(4)).toBe(16);
    expect(statutoryMinimumDays(3)).toBe(12);
  });
  it("JArbSchG minor minimum scales 6-day Werktage to the working week", () => {
    expect(minorMinimumDays(15, 5)).toBe(25); // 30 × 5/6
    expect(minorMinimumDays(16, 5)).toBe(22.5); // 27 × 5/6 = 22.5
    expect(minorMinimumDays(17, 5)).toBe(21); // 25 × 5/6 = 20.83 → 21 (nearest half day)
    expect(minorMinimumDays(18, 5)).toBe(0); // not a minor
    expect(minorMinimumDays(null, 5)).toBe(0);
  });
});

describe("computeEntitlement", () => {
  const annaHours = ANNA[0]!.hours;
  const carlaHours = { mon: 0, tue: 6, wed: 6, thu: 6, fri: 0, sat: 0, sun: 0 };

  it("gives a full-time 5-day employee their contractual days + carry-over", () => {
    const e = computeEntitlement({
      year: 2026,
      contractualDays: 28,
      carryOverDays: 5,
      hoursByWeekday: annaHours,
      employmentStart: new Date("2022-03-01"),
    });
    expect(e.proRated).toBe(28);
    expect(e.schwerbehindertBonus).toBe(0);
    expect(e.annual).toBe(28);
    expect(e.total).toBe(33);
  });

  it("applies Zwölftelung in the first partial year (Carla starts Sep)", () => {
    const e = computeEntitlement({
      year: 2025,
      contractualDays: 17,
      carryOverDays: 0,
      hoursByWeekday: carlaHours,
      employmentStart: new Date("2025-09-01"),
    });
    // 4 of 12 months → 17 × 4/12 = 5.67 → 5.5 (nearest half day)
    expect(e.fullMonths).toBe(4);
    expect(e.proRated).toBe(5.5);
    expect(e.total).toBe(5.5);
  });

  it("does not pro-rate the year after a mid-year start (full year employed)", () => {
    const e = computeEntitlement({
      year: 2026,
      contractualDays: 17,
      carryOverDays: 0,
      hoursByWeekday: carlaHours,
      employmentStart: new Date("2025-09-01"),
    });
    expect(e.fullMonths).toBe(12);
    expect(e.proRated).toBe(17);
  });

  it("adds the SGB IX §208 bonus (+5 at 5-day, full year)", () => {
    const e = computeEntitlement({
      year: 2026,
      contractualDays: 28,
      carryOverDays: 0,
      hoursByWeekday: annaHours,
      employmentStart: new Date("2010-01-01"),
      isSchwerbehindert: true,
    });
    expect(e.schwerbehindertBonus).toBe(5);
    expect(e.annual).toBe(33);
  });

  it("pro-rates the SGB IX bonus by months the status is in force", () => {
    const e = computeEntitlement({
      year: 2026,
      contractualDays: 28,
      carryOverDays: 0,
      hoursByWeekday: annaHours,
      employmentStart: new Date("2010-01-01"),
      isSchwerbehindert: true,
      schwerbehindertFrom: new Date("2026-07-01"), // second half only → 6 months
    });
    // 5 × 6/12 = 2.5 → rounds up to 3 (≥ half day up)
    expect(e.schwerbehindertBonus).toBe(3);
  });

  it("raises a sub-statutory contractual figure to the BUrlG §3 floor", () => {
    const e = computeEntitlement({
      year: 2026,
      contractualDays: 10, // below the 20-day floor for a 5-day week
      carryOverDays: 0,
      hoursByWeekday: annaHours,
      employmentStart: new Date("2010-01-01"),
    });
    expect(e.statutoryFloor).toBe(20);
    expect(e.proRated).toBe(20);
  });

  it("raises a minor to the JArbSchG floor", () => {
    const e = computeEntitlement({
      year: 2026,
      contractualDays: 24,
      carryOverDays: 0,
      hoursByWeekday: annaHours,
      employmentStart: new Date("2025-01-01"),
      ageAtYearStart: 15, // <16 → 30 Werktage → 25 on a 5-day week
    });
    expect(e.minorFloor).toBe(25);
    expect(e.proRated).toBe(25);
  });
});

// ── §5 BUrlG regression suite ────────────────────────────────────────────────
// These cover the rule the first implementation got wrong: it pro-rated EVERY
// partial employment year, which under-grants statutory leave (void per §13).

describe("wartezeitCompletedOn (BUrlG §4 + §§187/188 BGB)", () => {
  const key = (d: Date) => d.toISOString().slice(0, 10);

  it("treats a 1 July start as completing the Wartezeit on 31 December", () => {
    expect(key(wartezeitCompletedOn(new Date("2026-07-01T00:00:00Z")))).toBe("2026-12-31");
  });

  it("pushes a 2 July start into the following year", () => {
    expect(key(wartezeitCompletedOn(new Date("2026-07-02T00:00:00Z")))).toBe("2027-01-01");
  });

  it("applies §188(3) BGB when the target month is short", () => {
    // 31 August + 6 months → February has no 31st → ends on the last day.
    expect(key(wartezeitCompletedOn(new Date("2026-08-31T00:00:00Z")))).toBe("2027-02-28");
  });

  it("handles a leap-year target month", () => {
    expect(key(wartezeitCompletedOn(new Date("2027-08-31T00:00:00Z")))).toBe("2028-02-29");
  });
});

describe("assessTeilurlaub (BUrlG §5(1))", () => {
  it("does NOT pro-rate a first-half joiner — the Wartezeit completes in-year", () => {
    const a = assessTeilurlaub(2026, new Date("2026-04-01T00:00:00Z"), null);
    expect(a.proRate).toBe(false);
    expect(a.reason).toBe("NONE");
  });

  it("pro-rates a second-half joiner — §5(1)(a)", () => {
    const a = assessTeilurlaub(2026, new Date("2026-09-01T00:00:00Z"), null);
    expect(a.proRate).toBe(true);
    expect(a.reason).toBe("WARTEZEIT_NOT_MET");
  });

  it("pro-rates someone who leaves before completing the Wartezeit — §5(1)(b)", () => {
    const a = assessTeilurlaub(
      2026,
      new Date("2026-02-01T00:00:00Z"),
      new Date("2026-05-31T00:00:00Z"),
    );
    expect(a.proRate).toBe(true);
    expect(a.reason).toBe("LEFT_BEFORE_WARTEZEIT");
  });

  it("pro-rates a first-half leaver who HAD completed the Wartezeit — §5(1)(c)", () => {
    const a = assessTeilurlaub(
      2026,
      new Date("2020-01-01T00:00:00Z"),
      new Date("2026-06-30T00:00:00Z"),
    );
    expect(a.proRate).toBe(true);
    expect(a.reason).toBe("LEFT_IN_FIRST_HALF");
  });

  it("does NOT pro-rate a second-half leaver — full year is owed", () => {
    const a = assessTeilurlaub(
      2026,
      new Date("2020-01-01T00:00:00Z"),
      new Date("2026-07-01T00:00:00Z"),
    );
    expect(a.proRate).toBe(false);
    expect(a.reason).toBe("NONE");
  });
});

describe("computeEntitlement — statutory vs. additional split", () => {
  const fullTime = { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 };

  it("grants the FULL statutory 20 days to an employee who joined 1 April", () => {
    // The old engine returned 20 × 9/12 = 15 — five statutory days short.
    const e = computeEntitlement({
      year: 2026,
      statutoryDays: 20,
      additionalDays: 0,
      carryOverDays: 0,
      hoursByWeekday: fullTime,
      employmentStart: new Date("2026-04-01T00:00:00Z"),
    });
    expect(e.teilurlaub).toBe("NONE");
    expect(e.statutory).toBe(20);
    expect(e.total).toBe(20);
  });

  it("pro-rates only the extra days for a first-half joiner (20 + 10 contract)", () => {
    const e = computeEntitlement({
      year: 2026,
      statutoryDays: 20,
      additionalDays: 10,
      carryOverDays: 0,
      hoursByWeekday: fullTime,
      employmentStart: new Date("2026-04-01T00:00:00Z"),
    });
    expect(e.statutory).toBe(20); // untouched
    expect(e.additional).toBe(7.5); // 10 × 9/12
    expect(e.total).toBe(27.5);
  });

  it("pro-rates BOTH parts for a second-half joiner, rounding statutory UP (§5(2))", () => {
    const e = computeEntitlement({
      year: 2026,
      statutoryDays: 20,
      additionalDays: 10,
      carryOverDays: 0,
      hoursByWeekday: fullTime,
      employmentStart: new Date("2026-09-01T00:00:00Z"),
    });
    expect(e.fullMonths).toBe(4);
    expect(e.teilurlaub).toBe("WARTEZEIT_NOT_MET");
    expect(e.statutory).toBe(7); // 20 × 4/12 = 6.67 → §5(2) rounds UP to 7
    expect(e.additional).toBe(3.5); // 10 × 4/12 = 3.33 → 3.5 (half-day grid)
  });

  it("keeps the contractual extra when the statutory floor rises", () => {
    // Contract stores a statutory part below the §3 floor; the extra survives.
    const e = computeEntitlement({
      year: 2026,
      statutoryDays: 15,
      additionalDays: 8,
      carryOverDays: 0,
      hoursByWeekday: fullTime,
      employmentStart: new Date("2010-01-01T00:00:00Z"),
    });
    expect(e.statutoryFull).toBe(20); // raised to the floor
    expect(e.additionalFull).toBe(8); // NOT eaten by the floor
    expect(e.total).toBe(28);
  });

  it("honours additionalProRata=false for contracts that grant extras in full", () => {
    const e = computeEntitlement({
      year: 2026,
      statutoryDays: 20,
      additionalDays: 10,
      carryOverDays: 0,
      hoursByWeekday: fullTime,
      employmentStart: new Date("2026-09-01T00:00:00Z"),
      additionalProRata: false,
    });
    expect(e.additional).toBe(10);
  });

  it("splits a legacy lumped figure without changing the total", () => {
    const e = computeEntitlement({
      year: 2026,
      contractualDays: 28,
      carryOverDays: 0,
      hoursByWeekday: fullTime,
      employmentStart: new Date("2010-01-01T00:00:00Z"),
    });
    expect(e.statutoryFull).toBe(20);
    expect(e.additionalFull).toBe(8);
    expect(e.total).toBe(28); // identical to the pre-split engine
  });

  it("reports carry-over expiry without silently deducting it", () => {
    const e = computeEntitlement({
      year: 2026,
      statutoryDays: 20,
      additionalDays: 0,
      carryOverDays: 5,
      hoursByWeekday: fullTime,
      employmentStart: new Date("2010-01-01T00:00:00Z"),
      carryOverCutoff: { month: 3, day: 31 },
      asOf: new Date("2026-04-15T00:00:00Z"),
    });
    expect(e.carryOverExpired).toBe(true);
    expect(e.carryOverForfeitable).toBe(false); // no reminder on file → cannot lapse
    expect(e.total).toBe(25); // still counted
  });

  it("marks carry-over forfeitable once the duty to warn was met", () => {
    const e = computeEntitlement({
      year: 2026,
      statutoryDays: 20,
      additionalDays: 0,
      carryOverDays: 5,
      hoursByWeekday: fullTime,
      employmentStart: new Date("2010-01-01T00:00:00Z"),
      carryOverCutoff: { month: 3, day: 31 },
      carryOverReminderSentAt: new Date("2025-11-01T00:00:00Z"),
      asOf: new Date("2026-04-15T00:00:00Z"),
    });
    expect(e.carryOverForfeitable).toBe(true);
  });
});
