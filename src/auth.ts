import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { credentialsSchema } from "@/lib/validation/auth";
import {
  clientIp,
  isSourceBlocked,
  recordFailedLogin,
  recordSuccessfulLogin,
} from "@/lib/auth-throttle";
import { verifySecondFactor } from "@/lib/two-factor";
import { SecondFactorBlocked, SecondFactorInvalid, SecondFactorRequired } from "@/lib/auth-errors";

/**
 * Decoy hash, verified against whenever there is no real hash to verify.
 *
 * Without it the login endpoint is a timing oracle: an unknown / inactive /
 * locked account returned after a single indexed lookup (~1–3 ms) while a
 * known-active-unlocked account fell through to argon2id (~25 ms with the
 * configured 19456 KiB, t=2, p=1). An unauthenticated attacker POSTing to
 * /api/auth/callback/credentials and timing the response could enumerate which
 * corporate addresses exist, which are still active, and whether a lockout
 * attack had landed — all without ever guessing a password.
 *
 * This is an argon2id hash of a random 32-byte secret that was discarded when it
 * was generated, so it matches no password and belongs to no account; publishing
 * it costs nothing. It is a constant rather than a value hashed at import time so
 * that it cannot fail, cannot delay start-up, and cannot vary between processes.
 * Its parameters must stay in sync with ARGON2_OPTIONS in @/lib/password so that
 * a decoy verification costs exactly as much as a real one.
 */
const DECOY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$BFDyFnHCsnMuNWPxZw2beQ$n/yUXXzYvnJgJVJzbMVhWrqQ4Sv9lrs59MTrMZrdbes";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-Mail", type: "email" },
        password: { label: "Passwort", type: "password" },
        code: { label: "Code", type: "text" },
      },
      authorize: async (raw, request) => {
        const parsed = credentialsSchema.safeParse(raw);
        // Malformed input: rejected before any lookup. This leaks nothing about
        // accounts — it depends only on the shape of what was submitted.
        if (!parsed.success) return null;

        // Source throttle first, so a blocked attacker never reaches the
        // (deliberately expensive) password verification below.
        const ip = clientIp(request?.headers);
        if (await isSourceBlocked(ip)) return null;

        const email = parsed.data.email.toLowerCase().trim();
        const user = await prisma.user.findUnique({ where: { email } });

        // A user we are willing to check a password for. Inactive and locked
        // accounts are excluded here rather than returned early, so that they
        // take the identical code path — including the argon2 cost — below.
        const candidate =
          user &&
          user.active &&
          !(user.lockedUntil && user.lockedUntil > new Date())
            ? user
            : null;

        // Exactly one argon2id verification on EVERY path: unknown e-mail,
        // inactive account, locked account and wrong password all cost the same.
        // (The one remaining asymmetry is a single extra UPDATE on the
        // wrong-password path; ~1 ms against a ~25 ms hash is inside the noise.)
        const ok = await verifyPassword(
          candidate?.passwordHash ?? DECOY_PASSWORD_HASH,
          parsed.data.password,
        );

        // Same generic failure for unknown user / inactive / locked / wrong pw.
        if (!candidate || !ok) {
          // `userId` stays null for inactive/locked accounts: those attempts
          // count against the source but must never extend an existing lock.
          await recordFailedLogin({ userId: candidate?.id ?? null, ip });
          return null;
        }

        // Second factor (#14), checked in the same request as the password so
        // there is no half-signed-in state. Reaching this line already tells
        // the caller the password was right — inherent to any second step.
        // Wrong codes are counted per account inside verifySecondFactor.
        if (candidate.totpEnabledAt) {
          const code = parsed.data.code?.trim();
          if (!code) throw new SecondFactorRequired();
          const result = await verifySecondFactor(candidate.id, code);
          if (result === "blocked") throw new SecondFactorBlocked();
          if (result !== "ok") throw new SecondFactorInvalid();
        }

        await recordSuccessfulLogin({ userId: candidate.id, ip });
        return {
          id: candidate.id,
          name: candidate.name,
          email: candidate.email,
          role: candidate.role,
        };
      },
    }),
  ],
});
