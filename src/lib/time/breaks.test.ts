import { describe, expect, it } from "vitest";
import { autoBreakDeductionMs, closeUnfinishedBreaks, type AutoBreakPolicy } from "./breaks";
import { summarizeDay, summarizePeriod } from "./day";
import { buildShifts } from "./shifts";
import { checkDay, checkPeriod, type ArbZgRules } from "./compliance";
import { berlin, brk, fullTimeSchedule, work } from "./test-helpers";

const MIN = 60_000;
const H = 3_600_000;
const anna = fullTimeSchedule();
const AFTER = berlin("2026-07-01", "00:00");

const ARBZG = { break1AfterHours: 6, break1Minutes: 30, break2AfterHours: 9, break2Minutes: 45 };
// JArbSchG: a minor owes their break after 4½ hours, not after 6.
const JARBSCHG = { break1AfterHours: 4.5, break1Minutes: 30, break2AfterHours: 6, break2Minutes: 60 };

const RULES: ArbZgRules = {
  capMode: "DAILY",
  maxHoursPerDay: 10,
  standardHoursPerDay: 8,
  maxHoursPerWeek: 48,
  minRestHours: 11,
  blockOnViolation: false,
  ...ARBZG,
};

function policy(over: Partial<AutoBreakPolicy> = {}): AutoBreakPolicy {
  return {
    enabled: true,
    fixedMinutes: 30,
    unfinishedBreakMinutes: 30,
    rules: ARBZG,
    ...over,
  };
}

const ON = policy();

describe("autoBreakDeductionMs — how much is booked", () => {
  it("books nothing below the first threshold", () => {
    expect(autoBreakDeductionMs(5 * H, 0, ON)).toBe(0);
    expect(autoBreakDeductionMs(6 * H, 0, ON)).toBe(0); // exactly 6h needs none
  });

  it("books the first tier above six hours", () => {
    expect(autoBreakDeductionMs(9 * H, 0, ON)).toBe(30 * MIN);
  });

  it("books the second tier only when 45 min is genuinely required", () => {
    // 11 h worked stays above 9 h even after the 30-minute tier → 45 applies.
    expect(autoBreakDeductionMs(11 * H, 0, ON)).toBe(45 * MIN);
    // 9:10 falls under 9 h once 30 minutes are out of it, so 30 is what §4 asks
    // for — deducting 45 here would take a quarter-hour nobody owes.
    expect(autoBreakDeductionMs(9 * H + 10 * MIN, 0, ON)).toBe(30 * MIN);
  });

  it("tops the recorded break up instead of adding a second one", () => {
    expect(autoBreakDeductionMs(8 * H + 45 * MIN, 15 * MIN, ON)).toBe(15 * MIN);
    expect(autoBreakDeductionMs(8 * H + 30 * MIN, 30 * MIN, ON)).toBe(0);
    expect(autoBreakDeductionMs(8 * H + 15 * MIN, 45 * MIN, ON)).toBe(0);
  });

  it("treats the company's fixed break as a floor on the statutory one", () => {
    const long = policy({ fixedMinutes: 60 });
    expect(autoBreakDeductionMs(7 * H, 0, long)).toBe(60 * MIN); // 60 > 30
    expect(autoBreakDeductionMs(4 * H, 0, long)).toBe(0); // still gated by §4
    // …and can never be used to under-deduct: 0 means "the statutory minimum".
    expect(autoBreakDeductionMs(11 * H, 0, policy({ fixedMinutes: 0 }))).toBe(45 * MIN);
    expect(autoBreakDeductionMs(11 * H, 0, policy({ fixedMinutes: 5 }))).toBe(45 * MIN);
  });

  it("books nothing at all when the policy is off or absent", () => {
    expect(autoBreakDeductionMs(11 * H, 0, policy({ enabled: false }))).toBe(0);
    expect(autoBreakDeductionMs(11 * H, 0, undefined)).toBe(0);
  });
});

describe("a) a break that was started and never ended", () => {
  const openBreakDay = [
    work(berlin("2026-06-16", "08:00"), berlin("2026-06-16", "17:00"), "w1"),
    brk(berlin("2026-06-16", "14:00"), null, "b1"),
  ];

  it("used to vanish entirely — the employee was paid for the lunch", () => {
    // Unchanged behaviour without a policy, pinned so the regression is visible.
    const d = summarizeDay("2026-06-16", openBreakDay, anna, { asOf: AFTER });
    expect(d.breakMs).toBe(0);
    expect(d.workedMs).toBe(9 * H);
  });

  it("is counted at the configured fixed length", () => {
    const d = summarizeDay("2026-06-16", openBreakDay, anna, { asOf: AFTER, autoBreak: ON });
    expect(d.breakMs).toBe(30 * MIN);
    expect(d.unfinishedBreakMs).toBe(30 * MIN);
    expect(d.workedMs).toBe(8 * H + 30 * MIN);
    expect(d.presenceMs).toBe(9 * H);
    // The record is complete enough to measure, so it is no longer an anomaly…
    expect(d.hasOpenAnomaly).toBe(false);
    // …but the day still says so, and asks for the real time.
    const codes = checkDay(d, RULES).map((v) => v.code);
    expect(codes).toContain("BREAK_UNFINISHED");
  });

  it("marks the segment, so the day timeline can explain the figure", () => {
    const d = summarizeDay("2026-06-16", openBreakDay, anna, { asOf: AFTER, autoBreak: ON });
    const breakSeg = d.segments.find((s) => s.type === "BREAK");
    expect(breakSeg?.autoCompleted).toBe(true);
    expect(d.segments.filter((s) => s.type === "WORK")[0]?.autoCompleted).toBeUndefined();
  });

  it("is left running while the work session it belongs to is still live", () => {
    // The employee may simply still be at lunch — cutting the break short here
    // would start crediting them work time while they are away.
    const now = berlin("2026-06-16", "14:50");
    const entries = [
      work(berlin("2026-06-16", "08:00"), null, "w1"),
      brk(berlin("2026-06-16", "14:00"), null, "b1"),
    ];
    const d = summarizeDay("2026-06-16", entries, anna, { asOf: now, autoBreak: ON });
    expect(d.breakMs).toBe(50 * MIN); // still running, not capped at 30
    expect(d.unfinishedBreakMs).toBe(0);
    expect(d.isRunning).toBe(true);
  });

  it("is settled once a new session starts, not carried over from yesterday", () => {
    const now = berlin("2026-06-17", "09:00");
    const entries = [
      brk(berlin("2026-06-16", "12:00"), null, "b1"), // abandoned yesterday
      work(berlin("2026-06-17", "08:00"), null, "w1"), // live today
    ];
    const settled = closeUnfinishedBreaks(entries, { asOf: now, autoBreak: ON });
    expect(settled[0]!.end).toEqual(berlin("2026-06-16", "12:30"));
    expect(settled[1]!.end).toBeNull(); // today's session is untouched
  });

  it("stays open when the fixed length is set to 0", () => {
    const d = summarizeDay("2026-06-16", openBreakDay, anna, {
      asOf: AFTER,
      autoBreak: policy({ unfinishedBreakMinutes: 0 }),
    });
    expect(d.unfinishedBreakMs).toBe(0);
    expect(d.hasOpenAnomaly).toBe(true); // back to needing a correction
    // The two halves of the policy are independent: the never-ended break is not
    // counted, so the day now looks break-less and §4 is satisfied the other way.
    expect(d.autoBreakMs).toBe(30 * MIN);
    expect(checkDay(d, RULES).map((v) => v.code)).toContain("BREAK_AUTO_APPLIED");
  });
});

describe("b) no break recorded at all", () => {
  it("deducts the statutory minimum from a nine-hour day", () => {
    const entries = [work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "17:00"))];
    const d = summarizeDay("2026-06-15", entries, anna, { asOf: AFTER, autoBreak: ON });
    expect(d.autoBreakMs).toBe(30 * MIN);
    expect(d.breakMs).toBe(30 * MIN);
    expect(d.workedMs).toBe(8 * H + 30 * MIN);
    expect(d.balanceMs).toBe(30 * MIN); // +0:30 instead of the old +1:00
  });

  it("leaves a short day alone", () => {
    const entries = [work(berlin("2026-06-15", "09:00"), berlin("2026-06-15", "14:00"))];
    const d = summarizeDay("2026-06-15", entries, anna, { asOf: AFTER, autoBreak: ON });
    expect(d.autoBreakMs).toBe(0);
    expect(d.workedMs).toBe(5 * H);
  });

  it("leaves a day whose break was properly recorded alone", () => {
    const entries = [
      work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "17:00")),
      brk(berlin("2026-06-15", "12:00"), berlin("2026-06-15", "12:45")),
    ];
    const d = summarizeDay("2026-06-15", entries, anna, { asOf: AFTER, autoBreak: ON });
    expect(d.autoBreakMs).toBe(0);
    expect(d.workedMs).toBe(8 * H + 15 * MIN);
  });

  it("does not touch a day that is still running", () => {
    // The break has not been missed yet — it just has not happened.
    const now = berlin("2026-06-16", "15:00");
    const entries = [work(berlin("2026-06-16", "08:00"), null)];
    const d = summarizeDay("2026-06-16", entries, anna, { asOf: now, autoBreak: ON });
    expect(d.autoBreakMs).toBe(0);
    expect(d.workedMs).toBe(7 * H);
    expect(d.isRunning).toBe(true);
  });

  it("keeps the Anwesenheit = Ist + Pause invariant", () => {
    const entries = [work(berlin("2026-06-15", "07:00"), berlin("2026-06-15", "18:00"))];
    const d = summarizeDay("2026-06-15", entries, anna, { asOf: AFTER, autoBreak: ON });
    expect(d.workedMs + d.breakMs).toBe(d.presenceMs);
    expect(d.autoBreakMs).toBe(45 * MIN); // 11 h stays over 9 h even after 30 min
  });

  it("reaches the night shift a per-day rule would miss", () => {
    // 18:00 → 06:00 splits into 6 h + 6 h; neither half passes the six-hour
    // threshold, so a calendar-day rule would book nothing for the one worker
    // §§3–5 exist to protect. The deduction is worked out per SHIFT and lands
    // on the day the shift begins, exactly as §3 attributes the shift itself.
    const entries = [work(berlin("2026-06-15", "18:00"), berlin("2026-06-16", "06:00"))];
    const p = summarizePeriod("2026-06-15", "2026-06-16", entries, anna, {
      asOf: AFTER,
      autoBreak: ON,
    });
    expect(p.autoBreakMs).toBe(45 * MIN);
    expect(p.days[0]!.autoBreakMs).toBe(45 * MIN);
    expect(p.days[1]!.autoBreakMs).toBe(0);
    expect(p.workedMs).toBe(12 * H - 45 * MIN);
  });

  it("uses the JArbSchG tiers on a minor's days", () => {
    const asMinorUntil = (dayKey: string) =>
      policy({ rules: dayKey < "2026-06-16" ? JARBSCHG : ARBZG });
    const entries = [
      work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "14:00"), "w1"),
      work(berlin("2026-06-16", "08:00"), berlin("2026-06-16", "14:00"), "w2"),
    ];
    const p = summarizePeriod("2026-06-15", "2026-06-16", entries, anna, {
      asOf: AFTER,
      autoBreak: asMinorUntil,
    });
    // Six hours: over the JArbSchG threshold of 4½, not over the ArbZG one of 6.
    expect(p.days[0]!.autoBreakMs).toBe(30 * MIN);
    expect(p.days[1]!.autoBreakMs).toBe(0);
  });
});

describe("the automatic break is never silent", () => {
  const noBreakDay = [work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "17:00"))];

  it("replaces the §4 finding with a hint that says what was booked", () => {
    const without = summarizeDay("2026-06-15", noBreakDay, anna, { asOf: AFTER });
    expect(checkDay(without, RULES).map((v) => v.code)).toContain("BREAK_INSUFFICIENT");

    const withPolicy = summarizeDay("2026-06-15", noBreakDay, anna, {
      asOf: AFTER,
      autoBreak: ON,
    });
    const violations = checkDay(withPolicy, RULES);
    expect(violations.map((v) => v.code)).toEqual(["BREAK_AUTO_APPLIED"]);
    expect(violations[0]!.severity).toBe("WARN"); // a record gap, not a breach
    expect(violations[0]!.message).toContain("30 min");
  });

  it("reports it on the shift-based check too", () => {
    const p = summarizePeriod("2026-06-15", "2026-06-15", noBreakDay, anna, {
      asOf: AFTER,
      autoBreak: ON,
    });
    const codes = checkPeriod(p, RULES, undefined, {
      entries: noBreakDay,
      calcOpts: { asOf: AFTER, autoBreak: ON },
    }).map((v) => v.code);
    expect(codes).toEqual(["BREAK_AUTO_APPLIED"]);
  });

  it("still flags a break chopped into unusable pieces", () => {
    // Six 5-minute pauses satisfy nothing under §4(1). The automatic deduction
    // tops the day up to 30 minutes of break; whether the RECORDED pieces were
    // long enough stays a separate finding rather than a second deduction.
    const entries = [
      work(berlin("2026-06-15", "08:00"), berlin("2026-06-15", "17:00"), "w1"),
      brk(berlin("2026-06-15", "10:00"), berlin("2026-06-15", "10:05"), "b1"),
      brk(berlin("2026-06-15", "11:00"), berlin("2026-06-15", "11:05"), "b2"),
    ];
    const [shift] = buildShifts(entries, { asOf: AFTER, autoBreak: ON });
    expect(shift!.recordedBreakMs).toBe(10 * MIN);
    expect(shift!.autoBreakMs).toBe(20 * MIN); // topped up to 30, not 30 on top
    expect(shift!.breakMs).toBe(30 * MIN);
    expect(shift!.countableBreakMs).toBe(20 * MIN); // only the booked block counts
  });
});
