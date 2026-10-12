// Punching by name + PIN at an on-site terminal (#11), for staff without a
// smartphone. The terminal is identified by its device cookie (the caller
// checks it); the person by choosing their name and entering their PIN.
//
// A six-digit PIN is only as strong as the limits on guessing it, so wrong
// PINs are counted twice: per account (MAX_PIN_FAILURES, then blocked for
// PIN_BLOCK_MINUTES) and per terminal in a rolling window
// (MAX_TERMINAL_PIN_FAILURES), so one device cannot be used to try a few PINs
// on every account. Neither block needs an operator: both expire on their own,
// and QR punching and the web app keep working meanwhile.

import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/password";
import { clockIn, clockOut, endBreak, startBreak, type ClockResult, type PunchContext } from "@/lib/clock";
import { formatClock } from "@/lib/time";
import { generatePin, PIN_RE } from "@/lib/pin";

export class KioskPinError extends Error {}

export const MAX_PIN_FAILURES = 5;
export const PIN_BLOCK_MINUTES = 15;
export const MAX_TERMINAL_PIN_FAILURES = 20;
export const TERMINAL_PIN_WINDOW_MINUTES = 15;

export const KIOSK_ACTIONS = ["clock-in", "break-start", "break-end", "clock-out"] as const;
export type KioskAction = (typeof KIOSK_ACTIONS)[number];

const PUNCH: Record<KioskAction, (userId: string, ctx: PunchContext) => Promise<ClockResult>> = {
  "clock-in": clockIn,
  "break-start": startBreak,
  "break-end": endBreak,
  "clock-out": clockOut,
};

const DONE: Record<KioskAction, string> = {
  "clock-in": "eingestempelt",
  "break-start": "Pause begonnen",
  "break-end": "Pause beendet",
  "clock-out": "ausgestempelt",
};

const minutes = (n: number) => n * 60_000;

// ── Admin: PINs and the terminal switch ─────────────────────────────────────

/** Give the person a new random PIN and return it — the only time it is shown. */
export async function issueKioskPin(args: { actorId: string; userId: string }): Promise<string> {
  const pin = generatePin();
  const pinHash = await hashPassword(pin);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: args.userId }, select: { active: true, anonymizedAt: true } });
    if (!user || !user.active || user.anonymizedAt) {
      throw new KioskPinError("Nur aktive Konten können eine Terminal-PIN bekommen.");
    }
    await tx.user.update({
      where: { id: args.userId },
      data: { kioskPinHash: pinHash, kioskPinFailures: 0, kioskPinBlockedUntil: null },
    });
    await writeAudit(tx, { actorUserId: args.actorId, action: "user.pin.set", targetType: "User", targetId: args.userId });
  });
  return pin;
}

export async function removeKioskPin(args: { actorId: string; userId: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: args.userId, kioskPinHash: { not: null } },
      data: { kioskPinHash: null, kioskPinFailures: 0, kioskPinBlockedUntil: null },
    });
    if (count === 0) return;
    await writeAudit(tx, { actorUserId: args.actorId, action: "user.pin.remove", targetType: "User", targetId: args.userId });
  });
}

export async function setTerminalPinAllowed(terminalId: string, allow: boolean, actorId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.clockTerminal.updateMany({
      where: { id: terminalId, allowPin: !allow },
      data: { allowPin: allow, pinFailures: 0, pinFailuresSince: null, pinBlockedUntil: null },
    });
    if (count === 0) return;
    await writeAudit(tx, {
      actorUserId: actorId,
      action: allow ? "terminal.pin.on" : "terminal.pin.off",
      targetType: "ClockTerminal",
      targetId: terminalId,
    });
  });
}

// ── Terminal: who can punch here, and the punch itself ───────────────────────

/** People offered on the terminal: active accounts with a PIN, by name. */
export async function kioskPinPeople(terminalId: string): Promise<{ id: string; name: string }[] | null> {
  const terminal = await prisma.clockTerminal.findUnique({ where: { id: terminalId }, select: { allowPin: true } });
  if (!terminal?.allowPin) return null;
  return prisma.user.findMany({
    where: { active: true, anonymizedAt: null, kioskPinHash: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export type KioskPunchResult = { ok: true; message: string } | { ok: false; error: string };

const WRONG = "Name oder PIN stimmt nicht.";

/** Count a wrong PIN against the terminal's rolling window; block it when full. */
async function terminalFailure(terminalId: string, at: Date): Promise<void> {
  const windowStart = new Date(at.getTime() - minutes(TERMINAL_PIN_WINDOW_MINUTES));
  // A window that has run out starts again at this failure.
  await prisma.clockTerminal.updateMany({
    where: { id: terminalId, OR: [{ pinFailuresSince: null }, { pinFailuresSince: { lt: windowStart } }] },
    data: { pinFailures: 0, pinFailuresSince: at },
  });
  const t = await prisma.clockTerminal.update({
    where: { id: terminalId },
    data: { pinFailures: { increment: 1 } },
    select: { pinFailures: true },
  });
  if (t.pinFailures >= MAX_TERMINAL_PIN_FAILURES) {
    await prisma.clockTerminal.update({
      where: { id: terminalId },
      data: { pinFailures: 0, pinFailuresSince: null, pinBlockedUntil: new Date(at.getTime() + minutes(PIN_BLOCK_MINUTES)) },
    });
  }
}

async function accountFailure(userId: string, at: Date): Promise<boolean> {
  const u = await prisma.user.update({
    where: { id: userId },
    data: { kioskPinFailures: { increment: 1 } },
    select: { kioskPinFailures: true },
  });
  if (u.kioskPinFailures < MAX_PIN_FAILURES) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { kioskPinFailures: 0, kioskPinBlockedUntil: new Date(at.getTime() + minutes(PIN_BLOCK_MINUTES)) },
  });
  return true;
}

/**
 * Check the PIN and punch for the person at this terminal (channel KIOSK).
 * `terminalId` must come from a verified device cookie.
 */
export async function kioskPunch(args: {
  terminalId: string;
  userId: string;
  pin: string;
  action: KioskAction;
  at?: Date;
}): Promise<KioskPunchResult> {
  const at = args.at ?? new Date();
  const terminal = await prisma.clockTerminal.findUnique({
    where: { id: args.terminalId },
    select: { active: true, allowPin: true, pinBlockedUntil: true },
  });
  if (!terminal?.active || !terminal.allowPin) {
    return { ok: false, error: "An diesem Terminal ist das Stempeln mit PIN nicht eingeschaltet." };
  }
  if (terminal.pinBlockedUntil && terminal.pinBlockedUntil > at) {
    return {
      ok: false,
      error: `Zu viele falsche PINs an diesem Terminal. Bitte in ${PIN_BLOCK_MINUTES} Minuten erneut versuchen oder per QR-Code stempeln.`,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { id: true, name: true, active: true, anonymizedAt: true, kioskPinHash: true, kioskPinBlockedUntil: true },
  });
  const usable = user && user.active && !user.anonymizedAt && user.kioskPinHash;
  if (!usable || !PIN_RE.test(args.pin)) {
    await terminalFailure(args.terminalId, at);
    return { ok: false, error: WRONG };
  }
  if (user.kioskPinBlockedUntil && user.kioskPinBlockedUntil > at) {
    return { ok: false, error: `Zu viele falsche PINs. Bitte in ${PIN_BLOCK_MINUTES} Minuten erneut versuchen.` };
  }
  if (!(await verifyPassword(user.kioskPinHash!, args.pin))) {
    await terminalFailure(args.terminalId, at);
    const blocked = await accountFailure(user.id, at);
    return {
      ok: false,
      error: blocked ? `Zu viele falsche PINs. Bitte in ${PIN_BLOCK_MINUTES} Minuten erneut versuchen.` : WRONG,
    };
  }

  await prisma.user.update({ where: { id: user.id }, data: { kioskPinFailures: 0, kioskPinBlockedUntil: null } });
  const result = await PUNCH[args.action](user.id, { channel: "KIOSK", deviceLabel: null, terminalId: args.terminalId });
  if (!result.ok) return { ok: false, error: `${user.name}: ${result.error}` };
  return { ok: true, message: `${user.name}: ${DONE[args.action]} um ${formatClock(new Date())} Uhr.` };
}
