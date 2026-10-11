import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

// ── On-site terminals with a rotating QR code ───────────────────────────────
//
// A terminal (a tablet at the entrance) shows a QR code for /q/<code>, where
//
//     code = <terminalId>.<window base 36>.<mac>
//     window = floor(now / 30 s)
//     mac = HMAC-SHA256(key(terminalId), "<terminalId>.<window>"), 128 bits
//
// The key is derived from AUTH_SECRET per terminal, so no QR secret is stored
// and the browser on the tablet never sees one. A code is accepted for its own
// window and the two before it (at most 90 s): enough to scan, sign in if needed
// and confirm, too short for a photo of the code to be worth keeping. It cannot
// stop a colleague relaying a live photo — like the device type, a QR punch is
// an indicator of presence, not proof.
//
// Pairing: an admin issues a one-time code (valid 15 min) and opens the pairing
// link on the tablet; confirming it there stores a random device token in a
// cookie. Code and token are kept only as SHA-256 hashes, and re-pairing
// replaces the token, which signs the previous device out.

export const QR_WINDOW_MS = 30_000;
export const QR_ACCEPT_PREVIOUS = 2;
export const PAIR_TTL_MS = 15 * 60_000;
export const TERMINAL_COOKIE = "zt_terminal";
const LAST_SEEN_RESOLUTION_MS = 5 * 60_000;

export class TerminalError extends Error {}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return secret;
}

function mac(secret: string, terminalId: string, window: number): string {
  const key = createHmac("sha256", secret)
    .update(`zeiterfassung:terminal-qr:v1:${terminalId}`)
    .digest();
  return createHmac("sha256", key)
    .update(`${terminalId}.${window}`)
    .digest("base64url")
    .slice(0, 22);
}

function qrWindow(at: Date): number {
  return Math.floor(at.getTime() / QR_WINDOW_MS);
}

/** The code a terminal shows at `at`, and how long until it changes. */
export function issueQrCode(
  terminalId: string,
  at: Date,
  secret: string = authSecret(),
): { code: string; changesInMs: number } {
  const window = qrWindow(at);
  return {
    code: `${terminalId}.${window.toString(36)}.${mac(secret, terminalId, window)}`,
    changesInMs: (window + 1) * QR_WINDOW_MS - at.getTime(),
  };
}

const CODE_RE = /^([a-z0-9]{20,40})\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{22})$/;

/**
 * The terminal a code was issued for, if it is authentic and still fresh at
 * `at`. Pure: whether that terminal is still active is the caller's question.
 */
export function checkQrCode(
  code: string,
  at: Date,
  secret: string = authSecret(),
): string | null {
  const m = CODE_RE.exec(code);
  if (!m) return null;
  const [, terminalId, encodedWindow, given] = m as unknown as [string, string, string, string];
  const window = parseInt(encodedWindow, 36);
  const now = qrWindow(at);
  if (!Number.isSafeInteger(window) || window > now || window < now - QR_ACCEPT_PREVIOUS) {
    return null;
  }
  const expected = Buffer.from(mac(secret, terminalId, window));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? terminalId
    : null;
}

export interface TerminalRef {
  id: string;
  label: string;
}

/** The active terminal behind a scanned code, or null if stale, forged or deactivated. */
export async function activeTerminalForCode(code: string, at = new Date()): Promise<TerminalRef | null> {
  const terminalId = checkQrCode(code, at);
  if (!terminalId) return null;
  return prisma.clockTerminal.findFirst({
    where: { id: terminalId, active: true },
    select: { id: true, label: true },
  });
}

/** The active, paired terminal a device cookie belongs to, or null. */
export async function terminalForCookie(value: string | undefined): Promise<TerminalRef | null> {
  const dot = value?.indexOf(".") ?? -1;
  if (!value || dot <= 0) return null;
  const id = value.slice(0, dot);
  const token = value.slice(dot + 1);
  if (!token) return null;
  const terminal = await prisma.clockTerminal.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, label: true, active: true },
  });
  if (!terminal || terminal.id !== id || !terminal.active) return null;
  return { id: terminal.id, label: terminal.label };
}

/** Record that the terminal is showing codes; written at most every 5 min. */
export async function touchTerminal(id: string, at = new Date()): Promise<void> {
  await prisma.clockTerminal.updateMany({
    where: {
      id,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(at.getTime() - LAST_SEEN_RESOLUTION_MS) } }],
    },
    data: { lastSeenAt: at },
  });
}

export interface TerminalRow {
  id: string;
  label: string;
  active: boolean;
  pairedAt: Date | null;
  lastSeenAt: Date | null;
  pairExpiresAt: Date | null;
  createdAt: Date;
  punchCount: number;
}

export async function listTerminals(): Promise<TerminalRow[]> {
  const rows = await prisma.clockTerminal.findMany({
    orderBy: [{ active: "desc" }, { label: "asc" }],
    select: {
      id: true, label: true, active: true, pairedAt: true, lastSeenAt: true,
      pairExpiresAt: true, createdAt: true, _count: { select: { clockEvents: true } },
    },
  });
  return rows.map(({ _count, ...r }) => ({ ...r, punchCount: _count.clockEvents }));
}

function cleanLabel(label: string): string {
  const trimmed = label.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2 || trimmed.length > 60) {
    throw new TerminalError("Bitte eine Bezeichnung mit 2–60 Zeichen angeben, z. B. „Eingang Büro“.");
  }
  return trimmed;
}

/** Register a terminal and return a pairing code for it. */
export async function createTerminal(
  label: string,
  actorId: string,
  at = new Date(),
): Promise<{ id: string; pairCode: string }> {
  const name = cleanLabel(label);
  const pairCode = randomToken(18);
  const terminal = await prisma.$transaction(async (tx) => {
    const created = await tx.clockTerminal.create({
      data: {
        label: name,
        createdById: actorId,
        pairCodeHash: sha256(pairCode),
        pairExpiresAt: new Date(at.getTime() + PAIR_TTL_MS),
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "terminal.create",
      targetType: "ClockTerminal",
      targetId: created.id,
      newValue: { label: name },
    });
    return created;
  });
  return { id: terminal.id, pairCode };
}

/**
 * A fresh pairing code for an existing terminal, e.g. for a replaced tablet.
 * The current device keeps working until the new code is used.
 */
export async function issuePairCode(terminalId: string, actorId: string, at = new Date()): Promise<string> {
  const pairCode = randomToken(18);
  await prisma.$transaction(async (tx) => {
    const res = await tx.clockTerminal.updateMany({
      where: { id: terminalId, active: true },
      data: { pairCodeHash: sha256(pairCode), pairExpiresAt: new Date(at.getTime() + PAIR_TTL_MS) },
    });
    if (res.count === 0) throw new TerminalError("Terminal nicht gefunden oder deaktiviert.");
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "terminal.pair-code",
      targetType: "ClockTerminal",
      targetId: terminalId,
    });
  });
  return pairCode;
}

/** The terminal a pairing code would pair, for the confirmation screen. */
export async function terminalForPairCode(pairCode: string, at = new Date()): Promise<TerminalRef | null> {
  if (!pairCode) return null;
  return prisma.clockTerminal.findFirst({
    where: { pairCodeHash: sha256(pairCode), pairExpiresAt: { gt: at }, active: true },
    select: { id: true, label: true },
  });
}

/**
 * Use a pairing code: the device gets a new token (returned once, for its
 * cookie) and the code is spent. Replaces any earlier device's token.
 */
export async function pairTerminal(
  pairCode: string,
  at = new Date(),
): Promise<{ terminal: TerminalRef; cookieValue: string }> {
  const terminal = await terminalForPairCode(pairCode, at);
  if (!terminal) throw new TerminalError("Der Kopplungslink ist abgelaufen oder wurde bereits verwendet.");
  const token = randomToken(32);
  await prisma.$transaction(async (tx) => {
    // The hash in the WHERE makes the code single-use even under a race.
    const res = await tx.clockTerminal.updateMany({
      where: { id: terminal.id, pairCodeHash: sha256(pairCode), pairExpiresAt: { gt: at }, active: true },
      data: { pairCodeHash: null, pairExpiresAt: null, tokenHash: sha256(token), pairedAt: at, lastSeenAt: at },
    });
    if (res.count === 0) {
      throw new TerminalError("Der Kopplungslink ist abgelaufen oder wurde bereits verwendet.");
    }
    await writeAudit(tx, {
      actorUserId: null,
      action: "terminal.pair",
      targetType: "ClockTerminal",
      targetId: terminal.id,
    });
  });
  return { terminal, cookieValue: `${terminal.id}.${token}` };
}

/** Deactivate (signs the device out, codes stop working) or reactivate. */
export async function setTerminalActive(terminalId: string, active: boolean, actorId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const res = await tx.clockTerminal.updateMany({
      where: { id: terminalId, active: !active },
      // Deactivating also drops the device token and any open pairing code, so
      // reactivating needs a fresh pairing — a stolen tablet stays locked out.
      data: active ? { active } : { active, tokenHash: null, pairCodeHash: null, pairExpiresAt: null },
    });
    if (res.count === 0) return;
    await writeAudit(tx, {
      actorUserId: actorId,
      action: active ? "terminal.activate" : "terminal.deactivate",
      targetType: "ClockTerminal",
      targetId: terminalId,
    });
  });
}
