// Retention cutoff (#17). Pure — the purge itself lives in @/lib/retention.

/**
 * The floor for any configured period: working-time records must be kept for
 * at least two years (ArbZG § 16 Abs. 2, MiLoG § 17 Abs. 1). A lower setting
 * is ignored rather than honoured.
 */
export const MIN_RETENTION_YEARS = 2;

/** The configured period, floored to whole years and to the statutory minimum. */
export function effectiveRetentionYears(configured: number): number {
  const whole = Number.isFinite(configured) ? Math.floor(configured) : 0;
  return Math.max(MIN_RETENTION_YEARS, whole);
}

/**
 * The oldest calendar year whose records must still be kept on `todayKey`.
 * Everything dated before 1 January of that year may be deleted.
 *
 * Retention runs from the END of the calendar year in which a record arose
 * (§ 147 Abs. 4 AO, § 257 Abs. 5 HGB), which is also the conservative reading
 * for the ArbZG/MiLoG periods: with four years, a record from 2021 may go once
 * 2025 has ended, a record from 2022 not before 2027.
 */
export function retentionCutoffYear(todayKey: string, configuredYears: number): number {
  return Number(todayKey.slice(0, 4)) - effectiveRetentionYears(configuredYears);
}

/** Bounds for how long a punch keeps its device type (#34). */
export const DEVICE_LABEL_MONTHS_MIN = 1;
export const DEVICE_LABEL_MONTHS_MAX = 24;

/**
 * Punches before this instant lose their device type. No law requires keeping
 * it: it only serves to check a single punch while the period is still being
 * looked at, so it goes long before the time record itself (Art. 5(1)(c), (e)
 * DSGVO). Whole calendar months back from `asOf`, clamped to the bounds; on a
 * day the earlier month lacks (31 March − 1 month) it falls on that month's
 * last day.
 */
export function deviceLabelCutoff(asOf: Date, configuredMonths: number): Date {
  const whole = Number.isFinite(configuredMonths) ? Math.floor(configuredMonths) : DEVICE_LABEL_MONTHS_MIN;
  const months = Math.min(DEVICE_LABEL_MONTHS_MAX, Math.max(DEVICE_LABEL_MONTHS_MIN, whole));
  const d = new Date(asOf);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
