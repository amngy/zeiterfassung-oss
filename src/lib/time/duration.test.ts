import { describe, expect, it } from "vitest";
import {
  clip,
  mergeIntervals,
  overlapMs,
  subtractIntervals,
  totalMs,
} from "./duration";

const MIN = 60_000;

describe("mergeIntervals", () => {
  it("merges overlapping and adjacent intervals", () => {
    const merged = mergeIntervals([
      { start: 0, end: 10 },
      { start: 5, end: 15 },
      { start: 15, end: 20 }, // adjacent
      { start: 30, end: 40 },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 40 },
    ]);
  });

  it("drops zero-length and inverted intervals", () => {
    expect(mergeIntervals([{ start: 5, end: 5 }, { start: 10, end: 8 }])).toEqual([]);
  });
});

describe("totalMs", () => {
  it("sums non-overlapping intervals", () => {
    expect(totalMs([{ start: 0, end: 10 }, { start: 20, end: 25 }])).toBe(15);
  });
  it("does not double-count overlaps", () => {
    expect(totalMs([{ start: 0, end: 10 }, { start: 5, end: 15 }])).toBe(15);
  });
});

describe("subtractIntervals", () => {
  it("carves a hole out of the middle", () => {
    expect(subtractIntervals([{ start: 0, end: 100 }], [{ start: 40, end: 60 }])).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ]);
  });

  it("only subtracts the part of a hole that overlaps the base", () => {
    // A break that lies entirely outside presence must not reduce worked time.
    const remaining = subtractIntervals(
      [{ start: 100, end: 200 }],
      [{ start: 0, end: 50 }],
    );
    expect(totalMs(remaining)).toBe(100);
  });

  it("a 45-minute break inside a 9-hour shift leaves 8:15", () => {
    const presence = [{ start: 0, end: 9 * 60 * MIN }];
    const breaks = [{ start: 4 * 60 * MIN, end: 4 * 60 * MIN + 45 * MIN }];
    expect(totalMs(subtractIntervals(presence, breaks))).toBe((8 * 60 + 15) * MIN);
  });
});

describe("overlapMs / clip", () => {
  it("computes overlap length", () => {
    expect(overlapMs({ start: 0, end: 10 }, { start: 5, end: 20 })).toBe(5);
    expect(overlapMs({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(0);
  });
  it("clips to a window or returns null", () => {
    expect(clip({ start: 0, end: 100 }, { start: 20, end: 60 })).toEqual({
      start: 20,
      end: 60,
    });
    expect(clip({ start: 0, end: 10 }, { start: 50, end: 60 })).toBeNull();
  });
});
