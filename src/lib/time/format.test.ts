import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatDayKey,
  formatHm,
  formatMonth,
  formatSigned,
  msToMinutes,
} from "./format";
import { berlin } from "./test-helpers";

const H = 3_600_000;
const MIN = 60_000;

describe("formatHm", () => {
  it("formats hours and minutes", () => {
    expect(formatHm(8 * H + 15 * MIN)).toBe("8:15 h");
    expect(formatHm(0)).toBe("0:00 h");
    expect(formatHm(45 * MIN, false)).toBe("0:45");
  });
  it("uses a real minus sign for negatives", () => {
    expect(formatHm(-1 * H)).toBe("−1:00 h");
  });
});

describe("formatSigned", () => {
  it("always shows a sign, and ± for zero", () => {
    expect(formatSigned(15 * MIN)).toBe("+0:15 h");
    expect(formatSigned(-90 * MIN)).toBe("−1:30 h");
    expect(formatSigned(0)).toBe("±0:00 h");
  });
});

describe("formatClock", () => {
  it("shows Berlin wall-clock time", () => {
    expect(formatClock(berlin("2026-06-16", "08:05"))).toBe("08:05");
    // 22:30 UTC in summer is 00:30 Berlin.
    expect(formatClock(new Date("2026-07-15T22:30:00Z"))).toBe("00:30");
  });
});

describe("date formatting", () => {
  it("formats a German short date with weekday", () => {
    expect(formatDayKey("2026-06-16")).toBe("Di, 16.06.2026");
  });
  it("formats a German month", () => {
    expect(formatMonth("2026-06-16")).toBe("Juni 2026");
  });
});

describe("msToMinutes", () => {
  it("rounds to the nearest minute", () => {
    expect(msToMinutes(90 * 1000)).toBe(2); // 1.5 min → 2
    expect(msToMinutes(29 * 1000)).toBe(0);
  });
});
