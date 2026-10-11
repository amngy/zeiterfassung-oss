// TOTP (RFC 6238 over RFC 4226 HOTP) and recovery codes for the second factor
// (#14). Pure apart from the random source; the account state lives in
// @/lib/two-factor.
//
// Parameters are the ones every authenticator app assumes when an otpauth URI
// leaves them out: HMAC-SHA1, 6 digits, 30-second steps.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Steps accepted either side of now, for clock drift and typing time. */
export const TOTP_WINDOW = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error("Ungültiges Base32-Zeichen");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** A fresh 160-bit secret (the RFC 4226 recommendation), base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The time step an instant falls into. */
export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/** The code for one time step (RFC 4226 dynamic truncation). */
export function totpCode(secret: string, step: number, digits: number = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Digits only, so "123 456" from a copy-paste still counts. */
export function normalizeTotpInput(input: string): string {
  return input.replace(/\s/g, "");
}

export function looksLikeTotp(input: string): boolean {
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(normalizeTotpInput(input));
}

/**
 * The step a code matches within the window around `at`, or null. A step at or
 * before `lastUsedStep` never matches: each code works once, so one read over
 * someone's shoulder cannot be replayed within its 30 seconds.
 */
export function matchTotp(
  secret: string,
  input: string,
  at: Date,
  lastUsedStep: number | null = null,
): number | null {
  const code = normalizeTotpInput(input);
  if (!looksLikeTotp(code)) return null;
  const now = totpStep(at);
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = totpCode(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return null;
}

/** otpauth:// URI for the enrolment QR code (Key Uri Format). */
export function otpauthUri(args: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${args.issuer}:${args.account}`);
  const params = new URLSearchParams({
    secret: args.secret,
    issuer: args.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** The secret in groups of four, for typing it into an app by hand. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

// ── Recovery codes ───────────────────────────────────────────────────────────

export const RECOVERY_CODE_COUNT = 10;

/**
 * Ten codes like "K7QX-M2PA-RT5D": 60 random bits each. They are stored as a
 * plain SHA-256 — with that much entropy a slow hash adds nothing, and the
 * login path stays cheap.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () =>
    base32Encode(randomBytes(8)).slice(0, 12).replace(/(.{4})(?=.)/g, "$1-"),
  );
}

/** Case, spaces and dashes do not matter when a code is typed back in. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export function looksLikeRecoveryCode(input: string): boolean {
  return /^[A-Z2-7]{12}$/.test(normalizeRecoveryCode(input));
}

export function hashRecoveryCode(input: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(input)).digest("hex");
}
