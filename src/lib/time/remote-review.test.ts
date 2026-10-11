import { describe, expect, it } from "vitest";
import { needsRemoteReview } from "./remote-review";

const MIN = 60_000;
const day = (balanceMin: number, isRunning = false) => ({ balanceMs: balanceMin * MIN, isRunning });

describe("needsRemoteReview (#32)", () => {
  it("flags a web clock-out that ends a day more than N minutes over", () => {
    expect(needsRemoteReview(day(61), "WEB", 60)).toBe(true);
  });

  it("does not flag at or below the threshold", () => {
    expect(needsRemoteReview(day(60), "WEB", 60)).toBe(false);
    expect(needsRemoteReview(day(-30), "WEB", 60)).toBe(false);
  });

  it("does not flag on-site channels", () => {
    for (const channel of ["QR", "NFC", "KIOSK"]) {
      expect(needsRemoteReview(day(180), channel, 60)).toBe(false);
    }
  });

  it("waits until the day has ended", () => {
    expect(needsRemoteReview(day(180, true), "WEB", 60)).toBe(false);
  });

  it("is off with a threshold of 0 or without a closing punch", () => {
    expect(needsRemoteReview(day(600), "WEB", 0)).toBe(false);
    expect(needsRemoteReview(day(600), null, 60)).toBe(false);
  });
});
