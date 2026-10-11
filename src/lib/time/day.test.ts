import { describe, expect, it } from "vitest";
import { summarizeDay, summarizePeriod } from "./day";
import { formatClock } from "./format";
import type { HolidayEffect } from "./types";
import { berlin, brk, fullTimeSchedule, work } from "./test-helpers";

const MIN = 60_000;
const H = 3_600_000;
const anna = fullTimeSchedule();
// A fixed "now" well after the June scenarios, so those days are closed/past.
const AFTER = berlin("2026-07-01", "00:00");

describe("summarizeDay — worked / break / overtime", () => {
  it("a full day with a 45-min break yields 8:15 worked, +0:15 balance", () => {
    // Acceptance: clock a full day with a break, see correct totals.
    const entries = [
      work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "17:00")),
      brk(berlin("2026-06-15", "12:00"), berlin("2026-06-15", "12:45")),
    ];
    const d = summarizeDay("2026-06-15", entries, anna, { asOf: AFTER });
    expect(d.presenceMs).toBe(9 * H);
    expect(d.breakMs).toBe(45 * MIN);
    expect(d.workedMs).toBe(8 * H + 15 * MIN);
    expect(d.expectedMs).toBe(8 * H);
    expect(d.balanceMs).toBe(15 * MIN);
    expect(d.isWorkingDay).toBe(true);
    expect(d.isRunning).toBe(false);
    expect(d.hasOpenAnomaly).toBe(false);
  });

  it("a short day under target produces a negative balance", () => {
    const entries = [work(berlin("2026-06-15", "09:00"), berlin("2026-06-15", "16:00"))];
    const d = summarizeDay("2026-06-15", entries, anna, { asOf: AFTER });
    expect(d.workedMs).toBe(7 * H);
    expect(d.balanceMs).toBe(-1 * H);
  });

  it("counts an 11h presence minus 30min break as 10:30 worked", () => {
    const entries = [
      work(berlin("2026-06-15", "07:00"), berlin("2026-06-15", "18:00")),
      brk(berlin("2026-06-15", "12:00"), berlin("2026-06-15", "12:30")),
    ];
    const d = summarizeDay("2026-06-15", entries, anna, { asOf: AFTER });
    expect(d.workedMs).toBe(10 * H + 30 * MIN);
  });

  it("reports break as the time deducted from presence (Ist + Pause = presence)", () => {
    // A break that extends past the work span only counts where it overlaps.
    const entries = [
      work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "09:00")),
      brk(berlin("2026-06-15", "08:30"), berlin("2026-06-15", "10:00")),
    ];
    const d = summarizeDay("2026-06-15", entries, anna, { asOf: AFTER });
    expect(d.presenceMs).toBe(1 * H);
    expect(d.workedMs).toBe(30 * MIN);
    expect(d.breakMs).toBe(30 * MIN); // not the full 1:30
    expect(d.breakMs + d.workedMs).toBe(d.presenceMs);
  });

  it("sums multiple work sessions and ignores the unrecorded gap between them", () => {
    const entries = [
      work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "12:00"), "w1"),
      work(berlin("2026-06-15", "13:00"), berlin("2026-06-15", "17:00"), "w2"),
    ];
    const d = summarizeDay("2026-06-15", entries, anna, { asOf: AFTER });
    expect(d.presenceMs).toBe(8 * H);
    expect(d.workedMs).toBe(8 * H);
    expect(d.breakMs).toBe(0);
    expect(d.balanceMs).toBe(0);
  });
});

describe("summarizeDay — open entries (completeness)", () => {
  it("counts a still-running entry live, up to asOf", () => {
    const now = berlin("2026-06-16", "10:00"); // Tuesday
    const entries = [work(berlin("2026-06-16", "08:00"), null)];
    const d = summarizeDay("2026-06-16", entries, anna, { asOf: now });
    expect(d.workedMs).toBe(2 * H);
    expect(d.isRunning).toBe(true);
    expect(d.hasOpenAnomaly).toBe(false);
  });

  it("treats a stray open BREAK without an open WORK as an anomaly, not a live deduction", () => {
    // Regression: a running break must never carve time out of a closed day.
    const now = berlin("2026-06-16", "16:30");
    const entries = [
      work(berlin("2026-06-16", "08:00"), berlin("2026-06-16", "16:00"), "w1"),
      brk(berlin("2026-06-16", "14:00"), null, "b1"), // open, but work is closed
    ];
    const d = summarizeDay("2026-06-16", entries, anna, { asOf: now });
    expect(d.presenceMs).toBe(8 * H);
    expect(d.workedMs).toBe(8 * H); // NOT reduced by the orphaned break
    expect(d.breakMs).toBe(0);
    expect(d.hasOpenAnomaly).toBe(true);
    expect(d.isRunning).toBe(false);
  });

  it("flags a forgotten clock-out as an anomaly and does NOT count phantom hours", () => {
    const now = berlin("2026-06-16", "10:00");
    // Clocked in the previous morning, never out → ~26h open, beyond the cap.
    const entries = [work(berlin("2026-06-15", "08:00"), null)];
    const d15 = summarizeDay("2026-06-15", entries, anna, { asOf: now });
    expect(d15.hasOpenAnomaly).toBe(true);
    expect(d15.workedMs).toBe(0);
    expect(d15.isRunning).toBe(false);
    expect(d15.isEmpty).toBe(false);
    // The following day must not inherit the phantom shift either.
    const d16 = summarizeDay("2026-06-16", entries, anna, { asOf: now });
    expect(d16.workedMs).toBe(0);
    expect(d16.hasOpenAnomaly).toBe(false);
  });
});

describe("summarizeDay — non-working days and holidays", () => {
  it("a Saturday is a non-working, empty day with zero expected", () => {
    const d = summarizeDay("2026-06-20", [], anna, { asOf: AFTER });
    expect(d.isWorkingDay).toBe(false);
    expect(d.isEmpty).toBe(true);
    expect(d.expectedMs).toBe(0);
    expect(d.balanceMs).toBe(0);
  });

  it("a full public holiday on a working day: expected 0, work becomes overtime", () => {
    const holidays = new Map<string, HolidayEffect>([["2026-06-15", "FULL"]]);
    const entries = [work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "16:00"))];
    const d = summarizeDay("2026-06-15", entries, anna, { asOf: AFTER, holidays });
    expect(d.expectedMs).toBe(0);
    expect(d.workedMs).toBe(8 * H);
    expect(d.balanceMs).toBe(8 * H);
    expect(d.isWorkingDay).toBe(true); // still contractually a working weekday
  });
});

describe("summarizeDay — DST and midnight", () => {
  it("computes real elapsed time across the spring-forward gap", () => {
    // 01:00 → 04:00 wall clock on 2026-03-29, but 02:00–03:00 is skipped → 2h.
    const entries = [work(berlin("2026-03-29", "01:00"), berlin("2026-03-29", "04:00"))];
    const d = summarizeDay("2026-03-29", entries, anna, { asOf: AFTER });
    expect(d.presenceMs).toBe(2 * H);
    expect(d.workedMs).toBe(2 * H);
  });

  it("splits a cross-midnight shift across both calendar days", () => {
    const entries = [work(berlin("2026-06-15", "22:00"), berlin("2026-06-16", "02:00"))];
    const p = summarizePeriod("2026-06-15", "2026-06-16", entries, anna, { asOf: AFTER });
    expect(p.days[0]!.presenceMs).toBe(2 * H); // 22:00–24:00 on the 15th
    expect(p.days[1]!.presenceMs).toBe(2 * H); // 00:00–02:00 on the 16th
    expect(p.presenceMs).toBe(4 * H);
  });

  it("each day segment carries the FULL un-clipped entry bounds", () => {
    // So a correction prefilled from a clipped slice still targets the true span.
    const entries = [work(berlin("2026-06-15", "22:00"), berlin("2026-06-16", "02:00"))];
    const p = summarizePeriod("2026-06-15", "2026-06-16", entries, anna, { asOf: AFTER });
    const full = {
      s: berlin("2026-06-15", "22:00").getTime(),
      e: berlin("2026-06-16", "02:00").getTime(),
    };
    for (const dayIdx of [0, 1]) {
      const seg = p.days[dayIdx]!.segments[0]!;
      expect(seg.entryStart.getTime()).toBe(full.s);
      expect(seg.entryEnd.getTime()).toBe(full.e);
    }
    // The clipped pieces still differ per day.
    expect(p.days[0]!.segments[0]!.end.getTime()).not.toBe(
      p.days[1]!.segments[0]!.end.getTime(),
    );
  });

  it("renders a cross-midnight shift as a 00:00 start on the FOLLOWING day", () => {
    // Why this is pinned: a "start time of 00:00" in the timesheet is usually
    // NOT a row stored at midnight. It is the second half of a shift that ran
    // past 24:00 — most often a forgotten clock-out closed the next morning.
    // The clipped slice is what gets displayed, so 00:00 appears although the
    // stored start is the previous evening. Anyone hunting midnight starts in
    // the data needs to know the display can manufacture them.
    const entries = [work(berlin("2026-06-15", "22:00"), berlin("2026-06-16", "06:00"))];
    const p = summarizePeriod("2026-06-15", "2026-06-16", entries, anna, { asOf: AFTER });

    const shown = (i: number) =>
      p.days[i]!.segments.map((s) => `${formatClock(s.start)}–${formatClock(s.end)}`);
    expect(shown(0)).toEqual(["22:00–00:00"]);
    expect(shown(1)).toEqual(["00:00–06:00"]);
    // …while the stored entry never touches midnight.
    expect(formatClock(p.days[1]!.segments[0]!.entryStart)).toBe("22:00");
  });

  it("an entry still open from yesterday also renders 00:00 today", () => {
    const entries = [work(berlin("2026-06-15", "22:00"), null)];
    const p = summarizePeriod("2026-06-15", "2026-06-16", entries, anna, {
      asOf: berlin("2026-06-16", "08:00"), // 10 h open — inside the 16 h anomaly cap
    });
    expect(p.days[1]!.segments.map((s) => formatClock(s.start))).toEqual(["00:00"]);
  });
});

describe("summarizePeriod", () => {
  it("excludes future days from the running balance but not from total Soll", () => {
    const now = berlin("2026-06-16", "12:00"); // Tuesday noon
    const entries = [
      work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "16:00")), // Mon: 8h
      work(berlin("2026-06-16", "08:00"), null), // Tue: running, 4h so far
    ];
    const p = summarizePeriod("2026-06-15", "2026-06-21", entries, anna, { asOf: now });
    expect(p.workedMs).toBe(12 * H); // 8 + 4
    expect(p.expectedMs).toBe(40 * H); // full Mon–Fri week
    expect(p.expectedToDateMs).toBe(16 * H); // Mon + Tue only
    expect(p.balanceMs).toBe(-4 * H); // 12 worked − 16 owed so far
    expect(p.days.find((d) => d.date === "2026-06-16")?.isRunning).toBe(true);
    expect(p.hasOpenAnomaly).toBe(false);
  });

  it("flags an open anomaly whose start day precedes the viewed week", () => {
    const now = berlin("2026-06-16", "12:00"); // Tuesday
    const entries = [work(berlin("2026-06-08", "09:00"), null)]; // open since last Mon
    const p = summarizePeriod("2026-06-15", "2026-06-21", entries, anna, { asOf: now });
    expect(p.hasOpenAnomaly).toBe(true); // surfaced even though it started out of range
    expect(p.workedMs).toBe(0); // never counted as worked
  });
});
