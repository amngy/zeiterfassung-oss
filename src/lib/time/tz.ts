// Europe/Berlin calendar helpers.
//
// All clock punches are stored as absolute instants (UTC). The *business day*,
// weekday and "expected hours for a date" must be evaluated in the company's
// local timezone, otherwise a punch just before/after midnight, or a day during
// a DST switch, lands in the wrong bucket. Durations themselves are computed
// from the raw instants, so they are inherently DST-correct (a clock-change day
// genuinely has 23 or 25 hours and the worked time reflects that).

import { fromZonedTime, toZonedTime } from "date-fns-tz";

export const BUSINESS_TZ = "Europe/Berlin";

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar day ("YYYY-MM-DD") that an instant falls on, in Europe/Berlin. */
export function berlinDayKey(instant: Date, tz: string = BUSINESS_TZ): string {
  const zoned = toZonedTime(instant, tz);
  const y = zoned.getFullYear();
  const m = zoned.getMonth() + 1;
  const d = zoned.getDate();
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** [start, end) absolute instants bounding a Berlin calendar day. */
export function berlinDayRange(
  dayKey: string,
  tz: string = BUSINESS_TZ,
): { start: Date; end: Date } {
  assertDayKey(dayKey);
  const start = fromZonedTime(`${dayKey}T00:00:00`, tz);
  const next = addDaysToKey(dayKey, 1);
  const end = fromZonedTime(`${next}T00:00:00`, tz);
  return { start, end };
}

/** Parse a "YYYY-MM-DD" key into numeric [year, month (1-12), day]. */
export function parseDayKey(dayKey: string): [number, number, number] {
  assertDayKey(dayKey);
  const [y, m, d] = dayKey.split("-");
  return [Number(y), Number(m), Number(d)];
}

/**
 * Weekday of a calendar day key. Independent of timezone because the key is
 * already a local calendar date. Returns the WeekdayHours object key.
 */
export function weekdayOfKey(
  dayKey: string,
): "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" {
  const [y, m, d] = parseDayKey(dayKey);
  // Use UTC to read the weekday of a pure date without local-tz drift.
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[dow]!;
}

/** Day key N calendar days after the given key (N may be negative). */
export function addDaysToKey(dayKey: string, n: number): string {
  const [y, m, d] = parseDayKey(dayKey);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Inclusive list of day keys from `fromKey` to `toKey`. */
export function eachDayKey(fromKey: string, toKey: string): string[] {
  assertDayKey(fromKey);
  assertDayKey(toKey);
  const out: string[] = [];
  let cur = fromKey;
  // Guard against an inverted range and runaway loops (cap ~5 years).
  for (let i = 0; i < 2000 && cur <= toKey; i++) {
    out.push(cur);
    cur = addDaysToKey(cur, 1);
  }
  return out;
}

/** ISO week range (Mon–Sun) containing the given day, as day keys. */
export function weekRangeOf(dayKey: string): { from: string; to: string } {
  const wd = weekdayOfKey(dayKey);
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const offset = order.indexOf(wd); // 0 = Monday
  const from = addDaysToKey(dayKey, -offset);
  return { from, to: addDaysToKey(from, 6) };
}

/** Calendar-month range containing the given day, as day keys. */
export function monthRangeOf(dayKey: string): { from: string; to: string } {
  const [y, m] = parseDayKey(dayKey);
  const from = `${y}-${pad(m)}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  const to = `${y}-${pad(m)}-${pad(lastDay)}`;
  return { from, to };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function assertDayKey(key: string): void {
  if (!DAY_KEY_RE.test(key)) {
    throw new Error(`Invalid day key "${key}" (expected YYYY-MM-DD)`);
  }
}
