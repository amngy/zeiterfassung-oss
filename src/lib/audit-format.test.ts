import { describe, expect, it } from "vitest";
import {
  describeAction,
  summarizeDetail,
  toAuditRowView,
  type AuditRowInput,
} from "./audit-format";

describe("describeAction", () => {
  it("maps known actions to a German label + category", () => {
    expect(describeAction("user.deactivate")).toEqual({
      label: "Konto deaktiviert",
      category: "konto",
    });
    expect(describeAction("absence.approve").category).toBe("abwesenheit");
    // Leave-related user actions are grouped under Abwesenheiten, not Konten.
    expect(describeAction("user.entitlement.update").category).toBe("abwesenheit");
  });

  it("falls back gracefully for unknown keys", () => {
    expect(describeAction("settings.future")).toEqual({
      label: "Settings · Future",
      category: "einstellung",
    });
    expect(describeAction("mystery.action")).toEqual({
      label: "Mystery · Action",
      category: "system",
    });
  });
});

describe("summarizeDetail", () => {
  it("renders a time entry as a readable span", () => {
    const snap = {
      type: "WORK",
      start: "2026-06-15T06:00:00.000Z", // 08:00 Berlin (CEST)
      end: "2026-06-15T15:00:00.000Z", // 17:00 Berlin
    };
    expect(summarizeDetail("timeentry.create", null, snap)).toEqual({
      to: "Arbeit 15.06.2026 08:00–17:00",
    });
    expect(summarizeDetail("timeentry.correct", snap, { ...snap, end: null })).toEqual({
      from: "Arbeit 15.06.2026 08:00–17:00",
      to: "Arbeit 15.06.2026 08:00–offen",
    });
  });

  it("summarizes absences with range, days and note status", () => {
    expect(
      summarizeDetail("absence.vacation.request", null, {
        from: "2026-06-15",
        to: "2026-06-19",
        days: 5,
      }),
    ).toEqual({ text: "15.06.2026–19.06.2026 · 5 Tage" });

    expect(
      summarizeDetail("absence.sick.record", null, {
        from: "2026-06-15",
        to: "2026-06-15",
        days: 1,
        sickNoteOnFile: false,
      }),
    ).toEqual({ text: "15.06.2026 · 1 Tag · ohne AU" });

    expect(
      summarizeDetail(
        "absence.approve",
        { status: "PENDING", days: 5 },
        { status: "APPROVED", days: 5 },
      ),
    ).toEqual({ from: "beantragt", to: "genehmigt" });

    expect(
      summarizeDetail("absence.creditback", { days: 5 }, { days: 3, credit: 2 }),
    ).toEqual({ from: "5 Tage", to: "3 Tage" });
  });

  it("diffs only the fields that actually changed on a user update", () => {
    const before = {
      name: "Anna",
      email: "anna@firma.de",
      role: "EMPLOYEE",
      bundesland: "NW",
      isMinijob: false,
      exemptFromTimeRecording: false,
    };
    expect(
      summarizeDetail("user.update", before, { ...before, role: "ADMIN" }),
    ).toEqual({ text: "Rolle: Mitarbeiter:in → Administrator:in" });
  });

  it("describes new accounts, schedules and holidays", () => {
    expect(
      summarizeDetail("user.create", null, {
        name: "Max Muster",
        email: "max@firma.de",
        role: "EMPLOYEE",
        bundesland: "NW",
        weeklyHours: 40,
      }),
    ).toEqual({ text: "Max Muster · max@firma.de · Mitarbeiter:in · 40 h/Woche" });

    expect(
      summarizeDetail("user.schedule.add", null, {
        effectiveFrom: "2026-07-01",
        hours: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 },
        weekly: 40,
      }),
    ).toEqual({ text: "ab 01.07.2026 · 40 h/Woche (Mo 8 · Di 8 · Mi 8 · Do 8 · Fr 8)" });

    expect(
      summarizeDetail("holiday.gifted.add", null, {
        dayKey: "2026-06-16",
        name: "Betriebsausflug",
        fraction: "FULL",
        recurringAnnually: false,
      }),
    ).toEqual({ text: "16.06.2026 · Betriebsausflug · ganzer Tag" });

    // Bundesland code is localized and "Feiertag(e)" is pluralized correctly.
    expect(
      summarizeDetail("holiday.seed", null, { region: "NW", year: 2026, created: 11 }),
    ).toEqual({ text: "Nordrhein-Westfalen 2026 · 11 Feiertage" });
    expect(
      summarizeDetail("holiday.seed", null, { region: "BY", year: 2026, created: 1 }),
    ).toEqual({ text: "Bayern 2026 · 1 Feiertag" });
  });

  it("uses singular/plural for half-day vacation requests", () => {
    const range = { from: "2026-06-15", to: "2026-06-19", days: 4.5 };
    expect(
      summarizeDetail("absence.vacation.request", null, { ...range, halfDayStart: true, halfDayEnd: false }),
    ).toEqual({ text: "15.06.2026–19.06.2026 · 4,5 Tage · mit halbem Tag" });
    expect(
      summarizeDetail("absence.vacation.request", null, { ...range, halfDayStart: true, halfDayEnd: true }),
    ).toEqual({ text: "15.06.2026–19.06.2026 · 4,5 Tage · mit halben Tagen" });
  });

  it("flips activation state", () => {
    expect(
      summarizeDetail("user.deactivate", { active: true }, { active: false }),
    ).toEqual({ from: "aktiv", to: "inaktiv" });
  });

  it("returns nothing to show for payload-free actions", () => {
    expect(summarizeDetail("user.password.reset", null, null)).toEqual({});
    expect(summarizeDetail("correction.approve", null, null)).toEqual({});
  });
});

describe("toAuditRowView", () => {
  const base: AuditRowInput = {
    id: "a1",
    createdAt: new Date("2026-06-16T06:30:00.000Z"), // 08:30 Berlin
    action: "timeentry.create",
    actorName: "Admin",
    subjectName: "Anna",
    oldValue: null,
    newValue: { type: "WORK", start: "2026-06-16T06:00:00.000Z", end: null },
    reason: null,
  };

  it("formats timestamps in Europe/Berlin and keeps the category tone", () => {
    const vm = toAuditRowView(base);
    expect(vm.dateLabel).toBe("Di, 16.06.2026");
    expect(vm.timeLabel).toBe("08:30");
    expect(vm.tone).toBe("teal");
    expect(vm.actionLabel).toBe("Eintrag angelegt");
  });

  it("tints destructive actions red and defaults a missing actor to System", () => {
    const vm = toAuditRowView({
      ...base,
      action: "user.deactivate",
      actorName: null,
      oldValue: { active: true },
      newValue: { active: false },
    });
    expect(vm.tone).toBe("danger");
    expect(vm.actorName).toBe("System");
  });
});
