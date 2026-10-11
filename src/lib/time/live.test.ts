import { describe, expect, it } from "vitest";
import { liveStatus } from "./live";
import { berlin, brk, work } from "./test-helpers";

const now = berlin("2026-06-16", "10:00");

describe("liveStatus", () => {
  it("is IDLE with no open entries", () => {
    const s = liveStatus([work(berlin("2026-06-16", "08:00"), berlin("2026-06-16", "09:00"))], now);
    expect(s.state).toBe("IDLE");
    expect(s.since).toBeNull();
  });

  it("is WORKING with an open work entry and no open break", () => {
    const s = liveStatus([work(berlin("2026-06-16", "08:00"), null, "w1")], now);
    expect(s.state).toBe("WORKING");
    expect(s.openWorkId).toBe("w1");
    expect(s.since).toEqual(berlin("2026-06-16", "08:00"));
  });

  it("is ON_BREAK with an open work entry and an open break", () => {
    const s = liveStatus(
      [
        work(berlin("2026-06-16", "08:00"), null, "w1"),
        brk(berlin("2026-06-16", "09:30"), null, "b1"),
      ],
      now,
    );
    expect(s.state).toBe("ON_BREAK");
    expect(s.openWorkId).toBe("w1");
    expect(s.openBreakId).toBe("b1");
    expect(s.since).toEqual(berlin("2026-06-16", "09:30"));
  });

  it("flags an open work entry older than the cap as an ANOMALY", () => {
    const s = liveStatus([work(berlin("2026-06-14", "08:00"), null, "old")], now);
    expect(s.state).toBe("ANOMALY");
    expect(s.anomalyEntryId).toBe("old");
  });

  it("treats a stray open break without open work as an ANOMALY", () => {
    const s = liveStatus([brk(berlin("2026-06-16", "09:30"), null, "b1")], now);
    expect(s.state).toBe("ANOMALY");
    expect(s.anomalyEntryId).toBe("b1");
  });
});
