import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  berlinDayKey,
  berlinDayRange,
  eachDayKey,
  monthRangeOf,
  weekdayOfKey,
  weekRangeOf,
} from "./tz";

describe("berlinDayKey", () => {
  it("buckets an instant by the Berlin calendar day", () => {
    // 22:30 UTC on 2026-01-15 is 23:30 Berlin (CET) → still the 15th.
    expect(berlinDayKey(new Date("2026-01-15T22:30:00Z"))).toBe("2026-01-15");
    // 23:30 UTC is 00:30 Berlin on the 16th.
    expect(berlinDayKey(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-16");
  });

  it("handles summer time (CEST, UTC+2)", () => {
    // 22:30 UTC in July is 00:30 Berlin next day.
    expect(berlinDayKey(new Date("2026-07-15T22:30:00Z"))).toBe("2026-07-16");
  });
});

describe("berlinDayRange", () => {
  it("spans local midnight to local midnight (winter = 24h)", () => {
    const { start, end } = berlinDayRange("2026-01-15");
    expect(start.toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-15T23:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * 3_600_000);
  });

  it("the spring-forward day is only 23 hours long", () => {
    // Germany springs forward on the last Sunday of March (2026-03-29).
    const { start, end } = berlinDayRange("2026-03-29");
    expect(end.getTime() - start.getTime()).toBe(23 * 3_600_000);
  });

  it("the autumn day is 25 hours long", () => {
    const { start, end } = berlinDayRange("2026-10-25");
    expect(end.getTime() - start.getTime()).toBe(25 * 3_600_000);
  });
});

describe("weekdayOfKey", () => {
  it("maps dates to weekday keys", () => {
    expect(weekdayOfKey("2026-06-15")).toBe("mon");
    expect(weekdayOfKey("2026-06-20")).toBe("sat");
    expect(weekdayOfKey("2026-06-21")).toBe("sun");
  });
});

describe("addDaysToKey / eachDayKey", () => {
  it("adds across month and year boundaries", () => {
    expect(addDaysToKey("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("lists an inclusive range", () => {
    expect(eachDayKey("2026-06-15", "2026-06-18")).toEqual([
      "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18",
    ]);
  });
  it("returns empty for an inverted range", () => {
    expect(eachDayKey("2026-06-18", "2026-06-15")).toEqual([]);
  });
});

describe("weekRangeOf / monthRangeOf", () => {
  it("returns the Mon–Sun week", () => {
    // 2026-06-16 is a Tuesday.
    expect(weekRangeOf("2026-06-16")).toEqual({ from: "2026-06-15", to: "2026-06-21" });
  });
  it("returns the calendar month", () => {
    expect(monthRangeOf("2026-06-16")).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    // February in a non-leap year.
    expect(monthRangeOf("2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // February in a leap year.
    expect(monthRangeOf("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});
