// Second factor for sign-in (#14): TOTP from an authenticator app, with
// one-time recovery codes. Required for admins — see `adminNeedsTwoFactor` in
// @/lib/session — and optional for everyone else.
//
// The factor is checked inside the credentials `authorize` (src/auth.ts), in
// the same request as the password: there is no half-signed-in state to
// protect. Wrong codes are counted per account (`totpFailures`) and block the
// second factor for a while — the password was right, so the source throttle
// in @/lib/auth-throttle would allow far too many guesses at six digits.

import QRCode from "qrcode";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { BRAND } from "@/config/brand";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  matchTotp,
  otpauthUri,
} from "@/lib/totp";

export class TwoFactorError extends Error {}

/** Wrong codes in a row before the second factor is blocked. */
export const MAX_TOTP_FAILURES = 5;
export const TOTP_BLOCK_MINUTES = 15;

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: Date | null;
  /** Enrolment started but not yet confirmed with a code. */
  pending: boolean;
  recoveryCodesLeft: number;
  /** Admins cannot switch it off. */
  required: boolean;
}

export async function getTwoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true, totpEnabledAt: true, totpPendingSecret: true },
  });
  const recoveryCodesLeft = await prisma.recoveryCode.count({ where: { userId, usedAt: null } });
  return {
    enabled: !!user.totpEnabledAt,
    enabledAt: user.totpEnabledAt,
    pending: !!user.totpPendingSecret,
    recoveryCodesLeft,
    required: user.role === "ADMIN",
  };
}

export interface PendingEnrolment {
  secret: string;
  uri: string;
  /** Server-rendered SVG of `uri`. */
  qrSvg: string;
}

/** Start (or restart) enrolment: a new secret that is not used until confirmed. */
export async function beginEnrolment(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { totpPendingSecret: generateTotpSecret() } });
}

export async function cancelEnrolment(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { totpPendingSecret: null } });
}

export async function getPendingEnrolment(userId: string): Promise<PendingEnrolment | null> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, totpPendingSecret: true },
  });
  if (!user.totpPendingSecret) return null;
  const uri = otpauthUri({ secret: user.totpPendingSecret, account: user.email, issuer: BRAND.appName });
  const qrSvg = await QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return { secret: user.totpPendingSecret, uri, qrSvg };
}

async function replaceRecoveryCodes(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await tx.recoveryCode.deleteMany({ where: { userId } });
  await tx.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })) });
  return codes;
}

/**
 * Confirm enrolment with a code from the new device. Activates the secret,
 * replaces any recovery codes and returns the new ones — the only time they
 * are ever shown.
 */
export async function confirmEnrolment(userId: string, code: string, at: Date = new Date()): Promise<string[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpPendingSecret: true, totpEnabledAt: true },
  });
  if (!user.totpPendingSecret) throw new TwoFactorError("Bitte die Einrichtung neu starten.");
  const step = matchTotp(user.totpPendingSecret, code, at);
  if (step === null) {
    throw new TwoFactorError("Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.");
  }
  const secret = user.totpPendingSecret;
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: userId, totpPendingSecret: secret },
      data: {
        totpSecret: secret,
        totpPendingSecret: null,
        totpEnabledAt: at,
        totpLastStep: step,
        totpFailures: 0,
        totpBlockedUntil: null,
      },
    });
    if (count !== 1) throw new TwoFactorError("Bitte die Einrichtung neu starten.");
    const codes = await replaceRecoveryCodes(tx, userId);
    await writeAudit(tx, {
      actorUserId: userId,
      action: user.totpEnabledAt ? "user.2fa.device" : "user.2fa.enable",
      targetType: "User",
      targetId: userId,
    });
    return codes;
  });
}

type SecondFactorResult = "ok" | "invalid" | "blocked";

/**
 * Check a second-factor input — a TOTP code or a recovery code — for an
 * account that has one, and consume it. Used at sign-in and before changes to
 * the factor itself.
 */
export async function verifySecondFactor(
  userId: string,
  input: string,
  at: Date = new Date(),
): Promise<SecondFactorResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true, totpBlockedUntil: true },
  });
  if (!user?.totpSecret || !user.totpEnabledAt) return "invalid";
  if (user.totpBlockedUntil && user.totpBlockedUntil > at) return "blocked";

  const step = matchTotp(user.totpSecret, input, at, user.totpLastStep);
  if (step !== null) {
    // Conditional on the step, so two requests with the same code cannot both win.
    const { count } = await prisma.user.updateMany({
      where: {
        id: userId,
        totpSecret: user.totpSecret,
        OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
      },
      data: { totpLastStep: step, totpFailures: 0, totpBlockedUntil: null },
    });
    if (count === 1) return "ok";
  } else if (looksLikeRecoveryCode(input)) {
    const ok = await prisma.$transaction(async (tx) => {
      const { count } = await tx.recoveryCode.updateMany({
        where: { userId, codeHash: hashRecoveryCode(input), usedAt: null },
        data: { usedAt: at },
      });
      if (count !== 1) return false;
      await tx.user.update({ where: { id: userId }, data: { totpFailures: 0, totpBlockedUntil: null } });
      await writeAudit(tx, {
        actorUserId: userId,
        action: "user.2fa.recovery.use",
        targetType: "User",
        targetId: userId,
      });
      return true;
    });
    if (ok) return "ok";
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { totpFailures: { increment: 1 } },
    select: { totpFailures: true },
  });
  if (updated.totpFailures >= MAX_TOTP_FAILURES) {
    await prisma.user.update({
      where: { id: userId },
      data: { totpFailures: 0, totpBlockedUntil: new Date(at.getTime() + TOTP_BLOCK_MINUTES * 60_000) },
    });
    return "blocked";
  }
  return "invalid";
}

function refusal(result: SecondFactorResult): TwoFactorError {
  return new TwoFactorError(
    result === "blocked"
      ? `Zu viele falsche Codes. Bitte in ${TOTP_BLOCK_MINUTES} Minuten erneut versuchen.`
      : "Der Code stimmt nicht.",
  );
}

/** New recovery codes; the old ones stop working. Needs a current code. */
export async function regenerateRecoveryCodes(userId: string, code: string): Promise<string[]> {
  const result = await verifySecondFactor(userId, code);
  if (result !== "ok") throw refusal(result);
  return prisma.$transaction(async (tx) => {
    const codes = await replaceRecoveryCodes(tx, userId);
    await writeAudit(tx, { actorUserId: userId, action: "user.2fa.recovery.renew", targetType: "User", targetId: userId });
    return codes;
  });
}

const CLEARED = {
  totpSecret: null,
  totpPendingSecret: null,
  totpEnabledAt: null,
  totpLastStep: null,
  totpFailures: 0,
  totpBlockedUntil: null,
} satisfies Prisma.UserUpdateInput;

/** Switch the second factor off for oneself (not possible for admins). */
export async function disableTwoFactor(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
  if (user.role === "ADMIN") {
    throw new TwoFactorError("Für Administrationskonten ist die Zwei-Faktor-Anmeldung Pflicht.");
  }
  const result = await verifySecondFactor(userId, code);
  if (result !== "ok") throw refusal(result);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: CLEARED });
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await writeAudit(tx, { actorUserId: userId, action: "user.2fa.disable", targetType: "User", targetId: userId });
  });
}

/**
 * An admin removes someone else's second factor (lost phone, no recovery codes
 * left). They set it up again at their next sign-in; for an admin that is
 * enforced. For the last admin, prisma/reset-two-factor.ts does the same.
 */
export async function resetTwoFactor(args: { actorId: string | null; userId: string }): Promise<void> {
  const { actorId, userId } = args;
  if (actorId === userId) {
    throw new TwoFactorError("Das eigene Konto bitte unter „Mein Konto“ verwalten.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: CLEARED });
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await writeAudit(tx, { actorUserId: actorId, action: "user.2fa.reset", targetType: "User", targetId: userId });
  });
}
