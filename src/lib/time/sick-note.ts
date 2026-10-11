// When a doctor's certificate (AU/eAU) is due for a sick spell.
//
// EFZG §5(1): if incapacity lasts longer than three calendar days, the
// certificate is due on the following working day; the employer may require it
// earlier. The setting `auRequiredFromDay` is that day N (default 4), counted
// in calendar days from the first day of the spell.

import { addDaysToKey } from "./tz";

export interface SickSpell {
  /** Inclusive first calendar day, "YYYY-MM-DD". */
  fromKey: string;
  /** Inclusive last calendar day, "YYYY-MM-DD". */
  toKey: string;
  sickNoteOnFile: boolean;
}

/** Calendar day on which the certificate becomes due, or null if the spell ends before it. */
export function sickNoteDueKey(spell: SickSpell, requiredFromDay: number): string | null {
  const dueKey = addDaysToKey(spell.fromKey, Math.max(1, requiredFromDay) - 1);
  return spell.toKey >= dueKey ? dueKey : null;
}

/** The spell has reached day N, that day has come, and no certificate is on file. */
export function sickNoteDue(spell: SickSpell, requiredFromDay: number, todayKey: string): boolean {
  if (spell.sickNoteOnFile) return false;
  const dueKey = sickNoteDueKey(spell, requiredFromDay);
  return dueKey !== null && todayKey >= dueKey;
}
