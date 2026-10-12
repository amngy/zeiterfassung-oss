import { describe, expect, it } from "vitest";
import { deviceLabelCutoff, effectiveRetentionYears, retentionCutoffYear } from "./retention";

describe("retentionCutoffYear", () => {
  it("keeps the configured number of full calendar years before the current one", () => {
    // 4 years on 11 Oct 2026: 2021's period ran until 31 Dec 2025, so 2021 may
    // go; 2022's runs until 31 Dec 2026.
    expect(retentionCutoffYear("2026-10-11", 4)).toBe(2022);
  });

  it("moves on only at the turn of the year", () => {
    expect(retentionCutoffYear("2026-12-31", 4)).toBe(2022);
    expect(retentionCutoffYear("2027-01-01", 4)).toBe(2023);
  });

  it("never goes below the statutory two years", () => {
    expect(retentionCutoffYear("2026-10-11", 1)).toBe(2024);
    expect(retentionCutoffYear("2026-10-11", 0)).toBe(2024);
    expect(retentionCutoffYear("2026-10-11", 2)).toBe(2024);
  });

  it("uses whole years only", () => {
    expect(effectiveRetentionYears(3.7)).toBe(3);
    expect(effectiveRetentionYears(Number.NaN)).toBe(2);
    expect(effectiveRetentionYears(10)).toBe(10);
  });
});

describe("deviceLabelCutoff", () => {
  const at = new Date("2026-10-11T12:00:00Z");
  it("goes back whole calendar months", () => {
    expect(deviceLabelCutoff(at, 3).toISOString()).toBe("2026-07-11T12:00:00.000Z");
    expect(deviceLabelCutoff(at, 12).toISOString()).toBe("2025-10-11T12:00:00.000Z");
  });
  it("lands on the last day of a shorter month", () => {
    expect(deviceLabelCutoff(new Date("2026-05-31T08:00:00Z"), 3).toISOString()).toBe("2026-02-28T08:00:00.000Z");
  });
  it("keeps to the bounds", () => {
    expect(deviceLabelCutoff(at, 0).toISOString()).toBe("2026-09-11T12:00:00.000Z");
    expect(deviceLabelCutoff(at, 99).toISOString()).toBe("2024-10-11T12:00:00.000Z");
  });
});
