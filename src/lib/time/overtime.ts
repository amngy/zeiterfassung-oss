// Arbeitszeitkonto (#22). The account balance is the daily Saldo (worked +
// credited absence − Soll) summed from the account's first day, plus bookings:
// an opening balance, payouts, forfeitures, corrections and the carry forward
// the retention purge writes before deleting old records. Time off in lieu
// needs no booking — a Freizeitausgleich day credits nothing, so its Soll comes
// out of the balance by itself.
//
// Caps are warnings only. Whether hours above a cap are paid out or forfeited
// is a matter of contract or works agreement, so the app never books it on its
// own: the admin does, and the booking is on record with its reason.

export type OvertimeKind = "OPENING" | "PAYOUT" | "FORFEIT" | "ADJUSTMENT" | "CARRY_FORWARD";

export const OVERTIME_KIND_LABEL: Record<OvertimeKind, string> = {
  OPENING: "Anfangssaldo",
  PAYOUT: "Auszahlung",
  FORFEIT: "Verfall / Kappung",
  ADJUSTMENT: "Korrektur",
  CARRY_FORWARD: "Saldovortrag",
};

/** What an admin can book by hand on a running account. */
export const MANUAL_OVERTIME_KINDS = ["PAYOUT", "FORFEIT", "ADJUSTMENT"] as const;
export type ManualOvertimeKind = (typeof MANUAL_OVERTIME_KINDS)[number];

/** Largest booking accepted, in hours — a typo guard, not a legal limit. */
export const MAX_BOOKING_HOURS = 2000;

/**
 * Hours as typed — "12:30", "-1:15", "+2,5", "3" — to signed whole minutes.
 * Null when it is not a number of hours.
 */
export function parseHoursInput(raw: string): number | null {
  const s = raw.trim().replace(/^−/, "-").replace(/\s*h$/i, "");
  const hm = /^([+-]?)(\d{1,4}):([0-5]\d)$/.exec(s);
  if (hm) {
    const minutes = Number(hm[2]) * 60 + Number(hm[3]);
    return hm[1] === "-" ? -minutes : minutes;
  }
  const dec = /^([+-]?)(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(s);
  if (!dec) return null;
  const minutes = Math.round(Number(`${dec[2]}.${dec[3] ?? "0"}`) * 60);
  return dec[1] === "-" ? -minutes : minutes;
}

/**
 * The signed minutes stored for a booking. Payouts and forfeitures always
 * reduce the balance, whatever sign was typed; the others keep their sign.
 */
export function signedBookingMinutes(kind: OvertimeKind, minutes: number): number {
  return kind === "PAYOUT" || kind === "FORFEIT" ? -Math.abs(minutes) : minutes;
}

/** An account starts on the 1st of a month, so monthly reports line up with it. */
export function isMonthStart(dayKey: string): boolean {
  return /^\d{4}-\d{2}-01$/.test(dayKey);
}

export interface OvertimeLimits {
  /** Upper limit in hours; 0 = none. */
  capHours: number;
  /** Lower limit (minus hours, given as a positive number); 0 = none. */
  floorHours: number;
}

/** How far the balance is beyond a limit, in ms (0 when within). */
export function limitExcess(balanceMs: number, limits: OvertimeLimits): { overCapMs: number; underFloorMs: number } {
  const hour = 3_600_000;
  return {
    overCapMs: limits.capHours > 0 ? Math.max(0, balanceMs - limits.capHours * hour) : 0,
    underFloorMs: limits.floorHours > 0 ? Math.max(0, -balanceMs - limits.floorHours * hour) : 0,
  };
}

/** Sum of the bookings dated in [fromKey, toKey] (either bound optional), in ms. */
export function bookedMs(bookings: { dayKey: string; minutes: number }[], fromKey?: string, toKey?: string): number {
  let minutes = 0;
  for (const b of bookings) {
    if (fromKey && b.dayKey < fromKey) continue;
    if (toKey && b.dayKey > toKey) continue;
    minutes += b.minutes;
  }
  return minutes * 60_000;
}
