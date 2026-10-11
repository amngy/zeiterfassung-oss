// Turning recorded absence SPANS into the per-day effects the timesheet needs.
//
// An Absence is stored as one row per spell ("20.07. – 06.08., Urlaub"), which
// is the right shape for the leave account but the wrong one for a timesheet:
// the day calculator asks a question per calendar day. This module does that
// expansion, and settles the two rules that decide what a day ends up being.
//
// WHY A DAY OFF IS A CREDIT AND NOT A REDUCED SOLL
// A public holiday lowers the expected hours (see schedule.ts) — nobody owes
// work on it. Leave and sickness are different: the hours stay owed and are
// PAID anyway (Entgeltfortzahlung, §11 BUrlG / §3 EFZG). Modelling them as a
// credit rather than as a hole in the Soll is what keeps the month's Soll equal
// to the contract, keeps the credit visible as its own figure instead of a
// silently smaller target, and makes a part-worked sick day come out right.

import type { AbsenceEffect, AbsenceKind } from "./types";
import { absenceRank } from "./absence-kinds";
import { eachDayKey } from "./tz";

/** One recorded absence spell, as the store holds it. */
export interface AbsenceSpan {
  kind: AbsenceKind;
  /** Inclusive first calendar day, "YYYY-MM-DD". */
  fromKey: string;
  /** Inclusive last calendar day, "YYYY-MM-DD". */
  toKey: string;
  /** The spell's first day was taken as a half day (vacation only). */
  halfDayStart?: boolean;
  /** The spell's last day was taken as a half day (vacation only). */
  halfDayEnd?: boolean;
}

/**
 * The share of a single day a span covers — mirroring exactly what the leave
 * account was charged, so a half day credits half the Soll and not a whole one.
 * A one-day spell with either half flag is half a day (never a quarter).
 */
function fractionForDay(span: AbsenceSpan, dayKey: string): number {
  if (span.fromKey === span.toKey) {
    return span.halfDayStart || span.halfDayEnd ? 0.5 : 1;
  }
  let frac = 1;
  if (dayKey === span.fromKey && span.halfDayStart) frac *= 0.5;
  if (dayKey === span.toKey && span.halfDayEnd) frac *= 0.5;
  return frac;
}

/**
 * Expand absence spells into a day → effect map for the calculator.
 *
 * Two spells can legitimately cover the same day: §9 BUrlG lets sickness fall
 * inside an approved holiday, and that day is then a SICK day whose holiday is
 * credited back. So sickness wins over leave, and between two spells of the
 * same kind the larger share wins — never the last one read, which would make
 * the result depend on row order.
 *
 * `clampFrom`/`clampTo` bound the expansion to the range being displayed, so a
 * year-long spell does not cost a year of iterations per timesheet.
 */
export function absenceDayMap(
  spans: AbsenceSpan[],
  clampFrom?: string,
  clampTo?: string,
): Map<string, AbsenceEffect> {
  const out = new Map<string, AbsenceEffect>();
  for (const span of spans) {
    const from = clampFrom && clampFrom > span.fromKey ? clampFrom : span.fromKey;
    const to = clampTo && clampTo < span.toKey ? clampTo : span.toKey;
    if (from > to) continue;
    for (const dayKey of eachDayKey(from, to)) {
      const fraction = fractionForDay(span, dayKey);
      if (fraction <= 0) continue;
      const existing = out.get(dayKey);
      if (existing && !beats({ kind: span.kind, fraction }, existing)) continue;
      out.set(dayKey, { kind: span.kind, fraction });
    }
  }
  return out;
}

/** The higher-ranked kind wins (see absenceRank); otherwise the wider cover. */
function beats(candidate: AbsenceEffect, existing: AbsenceEffect): boolean {
  const byRank = absenceRank(candidate.kind) - absenceRank(existing.kind);
  if (byRank !== 0) return byRank > 0;
  return candidate.fraction > existing.fraction;
}
