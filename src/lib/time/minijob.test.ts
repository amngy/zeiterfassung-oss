import { describe, expect, it } from "vitest";
import { recordingDeadline, recordingIssueText, recordingState } from "./minijob";

describe("recordingDeadline", () => {
  it("ends with the seventh calendar day after the work day, Berlin time", () => {
    // Monday 5 Oct 2026 → end of Monday 12 Oct (CEST, UTC+2).
    expect(recordingDeadline("2026-10-05").toISOString()).toBe("2026-10-12T22:00:00.000Z");
  });

  it("follows the clock change", () => {
    // Work on 20 Oct (CEST), deadline 27 Oct after the switch to CET (UTC+1).
    expect(recordingDeadline("2026-10-20").toISOString()).toBe("2026-10-27T23:00:00.000Z");
  });

  it("crosses month and year ends", () => {
    expect(recordingDeadline("2026-12-28").toISOString()).toBe("2027-01-04T23:00:00.000Z");
  });
});

describe("recordingState", () => {
  const day = "2026-10-05";
  const lastMinute = new Date("2026-10-12T21:59:00.000Z");
  const tooLate = new Date("2026-10-12T22:00:00.000Z");

  it("accepts a record completed up to the end of day seven", () => {
    expect(recordingState({ dayKey: day, completedAt: new Date("2026-10-05T16:00:00Z"), asOf: tooLate })).toBe("ok");
    expect(recordingState({ dayKey: day, completedAt: lastMinute, asOf: tooLate })).toBe("ok");
  });

  it("flags a record completed after the deadline", () => {
    expect(recordingState({ dayKey: day, completedAt: tooLate, asOf: tooLate })).toBe("late");
  });

  it("tells a missing end within the deadline from an overdue one", () => {
    expect(recordingState({ dayKey: day, completedAt: null, asOf: lastMinute })).toBe("open");
    expect(recordingState({ dayKey: day, completedAt: null, asOf: tooLate })).toBe("overdue");
  });
});

describe("recordingIssueText", () => {
  const base = { type: "WORK" as const, dayKey: "2026-10-05", start: new Date("2026-10-05T06:00:00Z") };

  it("names the last day for recording", () => {
    expect(recordingIssueText({ ...base, end: null, state: "open", completedAt: null })).toBe(
      "Arbeit 08:00–offen — Ende fehlt, nachtragen bis Mo, 12.10.2026",
    );
    expect(recordingIssueText({ ...base, end: null, state: "overdue", completedAt: null })).toBe(
      "Arbeit 08:00–offen — Ende fehlt, Frist am Mo, 12.10.2026 abgelaufen",
    );
  });

  it("names the day a late record was completed", () => {
    const text = recordingIssueText({
      ...base,
      end: new Date("2026-10-05T10:30:00Z"),
      state: "late",
      completedAt: new Date("2026-10-14T09:00:00Z"),
    });
    expect(text).toBe("Arbeit 08:00–12:30 — erst am Mi, 14.10.2026 vollständig erfasst, Frist war Mo, 12.10.2026");
  });
});
