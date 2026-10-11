// Pure formatting helpers for durations and instants. German conventions.

import { toZonedTime } from "date-fns-tz";
import { BUSINESS_TZ, parseDayKey } from "./tz";

/** Round milliseconds to whole minutes (worked/break totals are shown to the minute). */
export function msToMinutes(ms: number): number {
  return Math.round(ms / 60_000);
}

export function msToHours(ms: number): number {
  return ms / 3_600_000;
}

/**
 * Format a duration as "H:MM h" (e.g. 8:30 h). Negative durations get a real
 * minus sign. Rounds to the nearest minute.
 */
export function formatHm(ms: number, withUnit = true): string {
  const sign = ms < 0 ? "−" : ""; // U+2212 minus, not hyphen
  const totalMin = Math.round(Math.abs(ms) / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}${withUnit ? " h" : ""}`;
}

/** Like {@link formatHm} but always shows a leading +/− (for balances). */
export function formatSigned(ms: number, withUnit = true): string {
  if (Math.round(ms / 60_000) === 0) return `±0:00${withUnit ? " h" : ""}`;
  const sign = ms < 0 ? "−" : "+";
  const totalMin = Math.round(Math.abs(ms) / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}${withUnit ? " h" : ""}`;
}

/** Wall-clock time "HH:mm" of an instant, in Europe/Berlin. */
export function formatClock(instant: Date, tz: string = BUSINESS_TZ): string {
  const z = toZonedTime(instant, tz);
  return `${String(z.getHours()).padStart(2, "0")}:${String(
    z.getMinutes(),
  ).padStart(2, "0")}`;
}

const WEEKDAYS_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** "Mo, 16.06.2026" from a "YYYY-MM-DD" day key. */
export function formatDayKey(dayKey: string): string {
  const [y, m, d] = parseDayKey(dayKey);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS_DE[dow]!}, ${String(d).padStart(2, "0")}.${String(m).padStart(
    2,
    "0",
  )}.${y}`;
}

/** "16. Juni 2026" — long form for headers. */
export function formatDayKeyLong(dayKey: string): string {
  const [y, m, d] = parseDayKey(dayKey);
  return `${d}. ${MONTHS_DE[m - 1]!} ${y}`;
}

/** "YYYY-MM-DDTHH:mm" in Berlin wall-clock, for <input type="datetime-local">. */
export function formatLocalInput(instant: Date, tz: string = BUSINESS_TZ): string {
  const z = toZonedTime(instant, tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${z.getFullYear()}-${p(z.getMonth() + 1)}-${p(z.getDate())}T${p(
    z.getHours(),
  )}:${p(z.getMinutes())}`;
}

/** "Juni 2026" from a day key (for month headers). */
export function formatMonth(dayKey: string): string {
  const [y, m] = parseDayKey(dayKey);
  return `${MONTHS_DE[m - 1]!} ${y}`;
}

/**
 * A count of leave days in German notation: whole numbers plain, halves with a
 * decimal comma (e.g. 5 → "5", 5.5 → "5,5"). Leave is on a 0.5-day grid.
 */
export function formatDays(days: number): string {
  const rounded = Math.round(days * 2) / 2;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace(".", ",");
}
