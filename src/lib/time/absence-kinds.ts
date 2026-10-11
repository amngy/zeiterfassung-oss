// The kinds of absence and how each one books a day (#21).
//
//   CREDIT     paid time off — the day is topped up to its Soll, like leave
//              (Urlaub, Krankheit, Sonderurlaub, Fortbildung, Dienstreise).
//   NO_CREDIT  Freizeitausgleich — the Soll stays and nothing is credited, so
//              the day is drawn from the overtime balance.
//   NO_SOLL    unpaid or suspended employment — the covered share of the Soll
//              is dropped (as on a holiday) and nothing is credited, so the
//              balance is untouched (unbezahlter Urlaub, Elternzeit,
//              Mutterschutz, Kind krank § 45 SGB V).

import type { AbsenceKind } from "./types";

export type AbsenceTreatment = "CREDIT" | "NO_CREDIT" | "NO_SOLL";

export const ABSENCE_KINDS = [
  "VACATION",
  "SICK",
  "SPECIAL_LEAVE",
  "TRAINING",
  "BUSINESS_TRIP",
  "TIME_OFF_IN_LIEU",
  "UNPAID_LEAVE",
  "PARENTAL_LEAVE",
  "MATERNITY_PROTECTION",
  "CHILD_SICK",
] as const satisfies readonly AbsenceKind[];

export const ABSENCE_LABEL: Record<AbsenceKind, string> = {
  VACATION: "Urlaub",
  SICK: "Krank",
  SPECIAL_LEAVE: "Sonderurlaub",
  TRAINING: "Fortbildung",
  BUSINESS_TRIP: "Dienstreise",
  TIME_OFF_IN_LIEU: "Freizeitausgleich",
  UNPAID_LEAVE: "Unbezahlter Urlaub",
  PARENTAL_LEAVE: "Elternzeit",
  MATERNITY_PROTECTION: "Mutterschutz",
  CHILD_SICK: "Kind krank",
};

export const ABSENCE_TREATMENT: Record<AbsenceKind, AbsenceTreatment> = {
  VACATION: "CREDIT",
  SICK: "CREDIT",
  SPECIAL_LEAVE: "CREDIT",
  TRAINING: "CREDIT",
  BUSINESS_TRIP: "CREDIT",
  TIME_OFF_IN_LIEU: "NO_CREDIT",
  UNPAID_LEAVE: "NO_SOLL",
  PARENTAL_LEAVE: "NO_SOLL",
  MATERNITY_PROTECTION: "NO_SOLL",
  CHILD_SICK: "NO_SOLL",
};

/** What a request for this kind does to the time account, for form hints. */
export const ABSENCE_EFFECT_TEXT: Record<AbsenceTreatment, string> = {
  CREDIT: "Die Sollzeit des Tages wird gutgeschrieben.",
  NO_CREDIT: "Keine Gutschrift — die Sollzeit wird aus dem Überstundensaldo genommen.",
  NO_SOLL: "Die Sollzeit entfällt; es gibt weder Gutschrift noch Minusstunden.",
};

/**
 * Kinds that are applied for and approved like leave. Sickness is not on the
 * list: it is a fact that is recorded, not a request.
 */
export const REQUESTABLE_KINDS: readonly AbsenceKind[] = ABSENCE_KINDS.filter((k) => k !== "SICK");

export function isAbsenceKind(value: unknown): value is AbsenceKind {
  return typeof value === "string" && (ABSENCE_KINDS as readonly string[]).includes(value);
}

/**
 * Which absence decides a day two of them cover. Suspended employment wins
 * over sickness (no continued pay during Elternzeit or Mutterschutz), and
 * sickness wins over everything else (§ 9 BUrlG: illness during leave).
 */
export function absenceRank(kind: AbsenceKind): number {
  if (ABSENCE_TREATMENT[kind] === "NO_SOLL" && kind !== "CHILD_SICK") return 3;
  if (kind === "SICK") return 2;
  return 1;
}

/** Sick-type absences, shown in the sickness colour in calendars. */
export function isSicknessKind(kind: AbsenceKind): boolean {
  return kind === "SICK" || kind === "CHILD_SICK";
}
