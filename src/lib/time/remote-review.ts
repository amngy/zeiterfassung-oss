// Which days an admin should look at (#32): the day was closed by a REMOTE
// clock-out — the web app, usable from anywhere — and ran clearly over its
// Soll. The concern is someone clocking out late from home to gain time;
// legitimate late shifts are not blocked, only shown for a look.
//
// Punches through an on-site channel (terminal, NFC, kiosk) are not remote.

const REMOTE_CHANNELS: ReadonlySet<string> = new Set(["WEB"]);

export function isRemoteChannel(channel: string): boolean {
  return REMOTE_CHANNELS.has(channel);
}

/**
 * True when `closingChannel` (the channel of the clock-out that ended the
 * day's work) is remote and the day's balance (Ist + Abwesenheit − Soll) is
 * more than `thresholdMinutes` over. A threshold of 0 switches the check off;
 * a day that is still running is judged once it has ended.
 */
export function needsRemoteReview(
  day: { balanceMs: number; isRunning: boolean },
  closingChannel: string | null,
  thresholdMinutes: number,
): boolean {
  if (thresholdMinutes <= 0 || closingChannel === null || day.isRunning) return false;
  return isRemoteChannel(closingChannel) && day.balanceMs > thresholdMinutes * 60_000;
}
