import { describe, expect, it } from "vitest";
import { bookedMs, isMonthStart, limitExcess, parseHoursInput, signedBookingMinutes } from "./overtime";

describe("parseHoursInput", () => {
  it("reads h:mm and decimal hours, with a sign", () => {
    expect(parseHoursInput("12:30")).toBe(750);
    expect(parseHoursInput("-1:15")).toBe(-75);
    expect(parseHoursInput("−0:45")).toBe(-45);
    expect(parseHoursInput("+2,5")).toBe(150);
    expect(parseHoursInput("3")).toBe(180);
    expect(parseHoursInput(" 1.25 h ")).toBe(75);
  });

  it("refuses anything else", () => {
    for (const bad of ["", "abc", "1:75", "1:5", "1,234", "--1", "12345"]) {
      expect(parseHoursInput(bad)).toBeNull();
    }
  });
});

describe("signedBookingMinutes", () => {
  it("payouts and forfeitures always reduce the balance", () => {
    expect(signedBookingMinutes("PAYOUT", 600)).toBe(-600);
    expect(signedBookingMinutes("FORFEIT", -120)).toBe(-120);
  });

  it("corrections and opening balances keep their sign", () => {
    expect(signedBookingMinutes("ADJUSTMENT", -30)).toBe(-30);
    expect(signedBookingMinutes("OPENING", 90)).toBe(90);
  });
});

describe("isMonthStart", () => {
  it("accepts only the 1st", () => {
    expect(isMonthStart("2026-11-01")).toBe(true);
    expect(isMonthStart("2026-11-02")).toBe(false);
    expect(isMonthStart("2026-11")).toBe(false);
  });
});

describe("limitExcess", () => {
  const h = 3_600_000;
  it("reports how far beyond each limit the balance is", () => {
    expect(limitExcess(45 * h, { capHours: 40, floorHours: 20 })).toEqual({ overCapMs: 5 * h, underFloorMs: 0 });
    expect(limitExcess(-25 * h, { capHours: 40, floorHours: 20 })).toEqual({ overCapMs: 0, underFloorMs: 5 * h });
    expect(limitExcess(10 * h, { capHours: 40, floorHours: 20 })).toEqual({ overCapMs: 0, underFloorMs: 0 });
  });

  it("treats 0 as no limit", () => {
    expect(limitExcess(500 * h, { capHours: 0, floorHours: 0 })).toEqual({ overCapMs: 0, underFloorMs: 0 });
    expect(limitExcess(-500 * h, { capHours: 0, floorHours: 0 })).toEqual({ overCapMs: 0, underFloorMs: 0 });
  });
});

describe("bookedMs", () => {
  const bookings = [
    { dayKey: "2026-10-01", minutes: 600 },
    { dayKey: "2026-10-15", minutes: -120 },
    { dayKey: "2026-11-01", minutes: -60 },
  ];
  it("sums the bookings inside the bounds", () => {
    expect(bookedMs(bookings)).toBe(420 * 60_000);
    expect(bookedMs(bookings, "2026-10-01", "2026-10-31")).toBe(480 * 60_000);
    expect(bookedMs(bookings, undefined, "2026-09-30")).toBe(0);
    expect(bookedMs(bookings, "2026-10-02")).toBe(-180 * 60_000);
  });
});
