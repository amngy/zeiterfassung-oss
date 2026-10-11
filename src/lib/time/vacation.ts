// Pure vacation/leave maths — kept framework- and DB-independent so it can be
// exhaustively unit-tested, and so the SAME `expectedHoursForDate` logic drives
// BOTH the overtime/undertime calculation AND vacation-day counting. The two can
// therefore never diverge (a hard requirement of the spec).
//
// Everything here implements *sensible, configurable technical defaults* for
// German leave law (BUrlG, JArbSchG §19, SGB IX §208). The operator must confirm
// specifics with their advisor — see the README / Verfahrensdokumentation.
//
// ── Entitlement model (since the §5 BUrlG correction) ────────────────────────
// An employee's annual leave is modelled as TWO components, because German law
// treats them differently:
//
//   statutory  (gesetzlicher Mindesturlaub, BUrlG §3)
//       - may NOT be reduced below the floor (§13 — deviations are void);
//       - is pro-rated (Zwölftelung) ONLY in the three §5(1) cases;
//       - fractions of ≥ half a day round UP to full days (§5(2));
//       - lapses only if the employer met the EuGH/BAG duty to warn.
//
//   additional (zusätzliche/vertragliche Urlaubstage)
//       - freely pro-ratable and freely forfeitable if the contract says so.
//
// Storing a single lumped figure makes those rules impossible to apply, which is
// why `EntitlementInput` takes them apart. A legacy single `contractualDays`
// value is still accepted and split on the fly, so existing rows keep working
// and keep their exact total.

import type { HolidayEffect, ScheduleInput } from "./types";
import { eachDayKey } from "./tz";
import {
  expectedHoursForDate,
  scheduleForDay,
  weekdayHours,
  workingDaysPerWeek,
} from "./schedule";

const DAY_MS = 86_400_000;

// ── Day counting ─────────────────────────────────────────────────────────────

/**
 * How much of a vacation day a single date consumes for an employee:
 *   0   → not a contracted working day (weekend / off day) or a full holiday,
 *   0.5 → a gifted HALF-day holiday on a working day,
 *   1   → a normal contracted working day.
 *
 * Derived as expectedHours / contractedHours, so it tracks the overtime calc
 * exactly: a public/gifted holiday that zeroes expected hours also costs zero
 * vacation, and a halved holiday costs half a day.
 */
export function vacationDayFraction(
  schedules: ScheduleInput[],
  dayKey: string,
  holidays?: Map<string, HolidayEffect>,
): number {
  // Value the day on the schedule in effect, falling back to the earliest
  // schedule on record for a day that predates the first schedule row. Without
  // this, leave an admin records for dates before an employee's first schedule
  // effective-date silently counted as 0 — a 3-week holiday could collapse to a
  // fraction of a day. Mirrors the entitlement calc's `?? schedules[0]`.
  const schedule = scheduleForDay(schedules, dayKey, true);
  if (!schedule) return 0;
  const base = weekdayHours(schedule.hours, dayKey);
  if (base <= 0) return 0;
  return expectedHoursForDate(schedules, dayKey, holidays, true) / base;
}

export interface HalfDayOptions {
  /** The first day is taken as a half day (afternoon off / morning off). */
  halfDayStart?: boolean;
  /** The last day is taken as a half day. */
  halfDayEnd?: boolean;
}

/**
 * Count the contracted working days a leave range [fromKey, toKey] consumes,
 * auto-excluding weekends, public and gifted holidays via {@link vacationDayFraction}.
 * Half-day flags halve the respective boundary day; a single-day range with either
 * half flag set counts as 0.5.
 */
export function countVacationDays(
  schedules: ScheduleInput[],
  fromKey: string,
  toKey: string,
  holidays?: Map<string, HolidayEffect>,
  opts: HalfDayOptions = {},
): number {
  // Single day: a half flag means exactly half a day (avoid double-halving).
  if (fromKey === toKey) {
    const frac = vacationDayFraction(schedules, fromKey, holidays);
    return opts.halfDayStart || opts.halfDayEnd ? frac * 0.5 : frac;
  }

  let total = 0;
  for (const key of eachDayKey(fromKey, toKey)) {
    let frac = vacationDayFraction(schedules, key, holidays);
    if (key === fromKey && opts.halfDayStart) frac *= 0.5;
    if (key === toKey && opts.halfDayEnd) frac *= 0.5;
    total += frac;
  }
  // Tidy floating-point dust so totals stay on the 0.5 grid (e.g. 4.499999 → 4.5).
  return Math.round(total * 2) / 2;
}

// ── Rounding ─────────────────────────────────────────────────────────────────

/** Round to the nearest half day (the app's leave granularity); halves round up. */
export function roundHalfDay(days: number): number {
  return Math.round(days * 2) / 2;
}

/**
 * Round to whole days, rounding a fraction of ≥ half a day UP — the rule BUrlG
 * §5(2) prescribes for pro-rated entitlements and SGB IX §208 for the bonus.
 */
export function roundHalfUpToFull(days: number): number {
  return Math.round(days);
}

// ── Employment periods ────────────────────────────────────────────────────────

/**
 * Number of *calendar months* of `year` fully covered by the period [from, to].
 * A month counts only if employment spans its entire length — the basis for
 * Zwölftelung (BUrlG §5) when someone starts or leaves mid-year, and for scaling
 * a Schwerbehinderung bonus that doesn't cover the whole year. `to == null` means
 * "still open" (covers every remaining month).
 *
 * Dates are pure @db.Date values stored at UTC midnight, so they are compared in
 * UTC against UTC month boundaries.
 */
export function fullCalendarMonthsCovered(
  year: number,
  from: Date | null | undefined,
  to: Date | null | undefined,
): number {
  if (!from) return 12; // no start on record → treat as covering the full year
  const fromMs = from.getTime();
  const toMs = to ? to.getTime() : Number.POSITIVE_INFINITY;
  let months = 0;
  for (let m = 0; m < 12; m++) {
    const firstDay = Date.UTC(year, m, 1);
    const lastDay = Date.UTC(year, m + 1, 0); // day 0 of next month = last day
    if (fromMs <= firstDay && toMs >= lastDay) months++;
  }
  return months;
}

/**
 * The day the six-month Wartezeit (BUrlG §4) is completed, i.e. the LAST day of
 * the six-month period — computed per §187(2)/§188(2) BGB (the period ends with
 * the day before the one matching the start day by number) and §188(3) BGB (if
 * the target month has no such day, it ends on that month's last day).
 *
 *   start 01.07.2026 → completed 31.12.2026  (the classic "join by 1 July" rule)
 *   start 02.07.2026 → completed 01.01.2027  (→ Teilurlaub in 2026)
 *   start 31.08.2026 → completed 28.02.2027  (§188(3): February has no 31st)
 */
export function wartezeitCompletedOn(start: Date): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const d = start.getUTCDate();
  const targetMonth = m + 6;
  const lastDayOfTarget = new Date(Date.UTC(y, targetMonth + 1, 0)).getUTCDate();
  if (d > lastDayOfTarget) {
    // §188(3) BGB — no matching day number: the period ends on the month's last day.
    return new Date(Date.UTC(y, targetMonth, lastDayOfTarget));
  }
  return new Date(Date.UTC(y, targetMonth, d) - DAY_MS);
}

/** Why (if at all) the statutory entitlement is pro-rated for a given year. */
export type TeilurlaubReason =
  /** Full statutory entitlement — no pro-rating (the default). */
  | "NONE"
  /** §5(1)(a): the Wartezeit is not completed within this calendar year. */
  | "WARTEZEIT_NOT_MET"
  /** §5(1)(b): employment ends before the Wartezeit is completed. */
  | "LEFT_BEFORE_WARTEZEIT"
  /** §5(1)(c): employment ends after the Wartezeit, in the first half of the year. */
  | "LEFT_IN_FIRST_HALF";

export interface TeilurlaubAssessment {
  reason: TeilurlaubReason;
  /** True when the statutory portion must be reduced to 1/12 per full month. */
  proRate: boolean;
  wartezeitCompletedOn: Date | null;
}

/**
 * Decide whether BUrlG §5(1) permits pro-rating the STATUTORY leave for `year`.
 *
 * This is the rule the previous implementation got wrong: it pro-rated every
 * partial year unconditionally. §5(1) allows Teilurlaub in exactly three cases;
 * in every other case — most importantly, an employee who joins in the first
 * half of the year and therefore completes the six-month Wartezeit before
 * 31 December — the FULL annual statutory entitlement is owed. Granting less is
 * void under §13(1) BUrlG.
 */
export function assessTeilurlaub(
  year: number,
  employmentStart: Date | null | undefined,
  employmentEnd: Date | null | undefined,
): TeilurlaubAssessment {
  if (!employmentStart) {
    return { reason: "NONE", proRate: false, wartezeitCompletedOn: null };
  }

  const completed = wartezeitCompletedOn(employmentStart);
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const midYear = new Date(Date.UTC(year, 5, 30)); // 30 June

  // §5(1)(b) — leaves before the Wartezeit is ever completed.
  if (employmentEnd && employmentEnd.getTime() < completed.getTime()) {
    return { reason: "LEFT_BEFORE_WARTEZEIT", proRate: true, wartezeitCompletedOn: completed };
  }

  // §5(1)(a) — Wartezeit is not completed within this calendar year.
  if (completed.getTime() > yearEnd.getTime()) {
    return { reason: "WARTEZEIT_NOT_MET", proRate: true, wartezeitCompletedOn: completed };
  }

  // §5(1)(c) — leaves after the Wartezeit but in the first half of the year.
  if (employmentEnd && employmentEnd.getTime() <= midYear.getTime()) {
    return { reason: "LEFT_IN_FIRST_HALF", proRate: true, wartezeitCompletedOn: completed };
  }

  return { reason: "NONE", proRate: false, wartezeitCompletedOn: completed };
}

// ── Floors ────────────────────────────────────────────────────────────────────

/** BUrlG §3 statutory floor: 24 Werktage on a 6-day week = 20 on a 5-day week. */
export function statutoryMinimumDays(wdPerWeek: number): number {
  return roundHalfDay((20 * wdPerWeek) / 5);
}

/**
 * JArbSchG §19 minimum for minors by age at the start of the year (Werktage on a
 * 6-day week), scaled to the employee's contracted working days. 0 if not a minor.
 */
export function minorMinimumDays(
  ageAtYearStart: number | null,
  wdPerWeek: number,
): number {
  if (ageAtYearStart == null || ageAtYearStart >= 18) return 0;
  const werktage = ageAtYearStart < 16 ? 30 : ageAtYearStart < 17 ? 27 : 25;
  return roundHalfDay((werktage * wdPerWeek) / 6);
}

// ── Entitlement ───────────────────────────────────────────────────────────────

export interface EntitlementInput {
  year: number;

  /**
   * Statutory portion (gesetzlicher Urlaub) as stored on the employee, already
   * scaled to their working week. Omit to derive it from `contractualDays`.
   */
  statutoryDays?: number | null;
  /** Contractual extra days (zusätzlicher Urlaub). Omit to derive. */
  additionalDays?: number | null;
  /**
   * LEGACY single lumped entitlement. Used only when the split above is absent;
   * it is then divided into (statutory floor) + (remainder as additional) so the
   * total is preserved exactly.
   */
  contractualDays?: number;

  carryOverDays: number;
  hoursByWeekday: ScheduleInput["hours"];
  employmentStart?: Date | null;
  employmentEnd?: Date | null;
  isSchwerbehindert?: boolean;
  schwerbehindertFrom?: Date | null;
  schwerbehindertTo?: Date | null;
  /** Employee's age on 1 January of `year` (for the JArbSchG minor minimum). */
  ageAtYearStart?: number | null;

  /**
   * Whether contractual EXTRA days are pro-rated by full months in a partial
   * employment year. Defaults to true (the common contractual arrangement).
   * The statutory portion always follows §5 BUrlG regardless of this flag.
   */
  additionalProRata?: boolean;

  /** Carry-over cutoff (§7(3) BUrlG), e.g. { month: 3, day: 31 }. */
  carryOverCutoff?: { month: number; day: number } | null;
  /** Whether the statutory reminder (EuGH/BAG Hinweispflicht) was sent. */
  carryOverReminderSentAt?: Date | null;
  /** Evaluation date — drives whether the carry-over cutoff has passed. */
  asOf?: Date | null;
}

export interface EntitlementBreakdown {
  // Full-year values, before any pro-rating.
  statutoryFull: number;
  additionalFull: number;
  /** statutoryFull + additionalFull — the contractual full-year entitlement. */
  contractualTotal: number;

  statutoryFloor: number; // BUrlG §3
  minorFloor: number; // JArbSchG §19 (0 if not a minor)

  // Pro-rating.
  fullMonths: number; // months employed in the year
  teilurlaub: TeilurlaubReason; // why (or why not) the statutory part is reduced
  wartezeitCompletedOn: Date | null;

  // This year's earned values.
  statutory: number; // statutory entitlement for the year (§5 applied)
  additional: number; // contractual extra for the year
  proRated: number; // statutory + additional
  schwerbehindertBonus: number; // SGB IX §208
  annual: number; // proRated + bonus

  // Carry-over.
  carryOver: number;
  carryOverExpiresOn: Date | null;
  carryOverExpired: boolean;
  /** Expired AND the employer met the duty to warn — only then may it lapse. */
  carryOverForfeitable: boolean;

  total: number; // annual + carryOver — the year's available balance

  /** @deprecated legacy alias of contractualTotal, kept for existing callers. */
  contractual: number;
}

/**
 * Split a legacy lumped entitlement into its statutory and contractual parts,
 * preserving the total exactly. The statutory part can never exceed the lumped
 * figure (an employee stored below the floor is raised by the floor logic in
 * {@link computeEntitlement}, not here).
 */
export function splitLegacyEntitlement(
  contractualDays: number,
  statutoryFloor: number,
): { statutory: number; additional: number } {
  const statutory = Math.min(contractualDays, statutoryFloor);
  return { statutory, additional: Math.max(0, contractualDays - statutory) };
}

/**
 * Compute an employee's vacation entitlement for a year, applying:
 *  - the statutory (BUrlG §3) and JArbSchG §19 minor floors to the statutory part;
 *  - Zwölftelung of the STATUTORY part only in the three §5(1) BUrlG cases,
 *    rounded up per §5(2);
 *  - pro-rating of contractual EXTRA days by full months (configurable);
 *  - the SGB IX §208 Schwerbehinderung bonus (+5 days at a 5-day week, scaled to
 *    the working week and pro-rated by months the status is in force);
 *  - carry-over brought forward from the previous year, with its §7(3) cutoff and
 *    the EuGH/BAG duty-to-warn precondition reported (never silently deducted).
 */
export function computeEntitlement(input: EntitlementInput): EntitlementBreakdown {
  const wdPerWeek = workingDaysPerWeek(input.hoursByWeekday);

  const statutoryFloor = statutoryMinimumDays(wdPerWeek);
  const minorFloor = minorMinimumDays(input.ageAtYearStart ?? null, wdPerWeek);
  /** The floor that actually binds — the higher of BUrlG §3 and JArbSchG §19. */
  const bindingFloor = Math.max(statutoryFloor, minorFloor);

  // Resolve the two components. Explicit split wins; otherwise derive from the
  // legacy lumped value so existing rows keep their exact total.
  const hasSplit = input.statutoryDays != null || input.additionalDays != null;
  const legacyTotal = input.contractualDays ?? 0;
  const parts = hasSplit
    ? {
        statutory: input.statutoryDays ?? bindingFloor,
        additional: input.additionalDays ?? 0,
      }
    : splitLegacyEntitlement(legacyTotal, bindingFloor);

  // §3 BUrlG / §19 JArbSchG are floors on the STATUTORY portion. Contractual
  // extras sit on top and are never eaten by the floor.
  const statutoryFull = roundHalfDay(Math.max(parts.statutory, bindingFloor));
  const additionalFull = roundHalfDay(Math.max(0, parts.additional));
  const contractualTotal = statutoryFull + additionalFull;

  const fullMonths = fullCalendarMonthsCovered(
    input.year,
    input.employmentStart,
    input.employmentEnd,
  );
  const teil = assessTeilurlaub(input.year, input.employmentStart, input.employmentEnd);

  // Statutory: pro-rated ONLY in the §5(1) cases, and then rounded UP per §5(2).
  const statutory = teil.proRate
    ? roundHalfUpToFull((statutoryFull * fullMonths) / 12)
    : statutoryFull;

  // Contractual extras: pro-rated by full months when the contract says so.
  const additionalProRata = input.additionalProRata ?? true;
  const additional =
    additionalProRata && fullMonths < 12
      ? roundHalfDay((additionalFull * fullMonths) / 12)
      : additionalFull;

  const proRated = roundHalfDay(statutory + additional);

  let schwerbehindertBonus = 0;
  if (input.isSchwerbehindert) {
    const statusMonths = fullCalendarMonthsCovered(
      input.year,
      input.schwerbehindertFrom ?? input.employmentStart ?? null,
      input.schwerbehindertTo,
    );
    // +5 days at a 5-day week → wdPerWeek days, pro-rated by months in force.
    schwerbehindertBonus = roundHalfUpToFull((wdPerWeek * statusMonths) / 12);
  }

  const annual = proRated + schwerbehindertBonus;
  const carryOver = input.carryOverDays;

  // §7(3) BUrlG carry-over cutoff. Reported, never silently deducted: unused
  // statutory leave only lapses if the employer demonstrably told the employee
  // to take it (EuGH C-684/16, BAG 9 AZR 541/15).
  let carryOverExpiresOn: Date | null = null;
  let carryOverExpired = false;
  if (input.carryOverCutoff && carryOver > 0) {
    const { month, day } = input.carryOverCutoff;
    carryOverExpiresOn = new Date(Date.UTC(input.year, month - 1, day));
    const asOf = input.asOf ?? null;
    carryOverExpired = asOf != null && asOf.getTime() > carryOverExpiresOn.getTime() + DAY_MS - 1;
  }
  const carryOverForfeitable = carryOverExpired && input.carryOverReminderSentAt != null;

  return {
    statutoryFull,
    additionalFull,
    contractualTotal,
    statutoryFloor,
    minorFloor,
    fullMonths,
    teilurlaub: teil.reason,
    wartezeitCompletedOn: teil.wartezeitCompletedOn,
    statutory,
    additional,
    proRated,
    schwerbehindertBonus,
    annual,
    carryOver,
    carryOverExpiresOn,
    carryOverExpired,
    carryOverForfeitable,
    total: annual + carryOver,
    contractual: contractualTotal,
  };
}
