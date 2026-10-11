-- Security hardening: source (IP) based login throttling.
--
-- WHY THIS TABLE EXISTS
-- The only brute-force defence used to be `User.failedLoginAttempts` /
-- `User.lockedUntil`: five bad passwords locked the ACCOUNT for 15 minutes.
-- Nothing was keyed to the *attacker*, so an unauthenticated person who knows a
-- colleague's e-mail address could keep that colleague permanently locked out by
-- re-arming the lock every 15 minutes — and aimed at every admin address it
-- locks administration out of production entirely, because every unlock path
-- (`resetUserPassword`) requires an admin who can still log in.
--
-- This table adds the missing half: a counter keyed to the request source, so
-- the attacker is rate-limited long before the victim's account is touched.
-- See src/lib/auth-throttle.ts for the thresholds and the full reasoning.
--
-- SAFETY AGAINST A POPULATED PRODUCTION DATABASE
-- Purely additive: one new table plus its indexes, all `IF NOT EXISTS`. No
-- existing table is read, rewritten or locked, so this cannot fail on live data
-- and cannot brick a later `prisma migrate deploy` (see the note in migration
-- 20260730120100 about FAILED migrations blocking every subsequent deploy).
--
-- NOTE ON SCHEMA DRIFT
-- "LoginThrottle" is deliberately NOT declared in prisma/schema.prisma — it is
-- written and read exclusively through $queryRaw/$executeRaw in
-- src/lib/auth-throttle.ts, the same way the partial unique index in
-- 20260616120000 and the exclusion constraint in 20260730120100 live only in
-- SQL. Consequence: a future `prisma migrate dev` will see the table as drift
-- and offer to DROP it. Add a matching `model LoginThrottle` to schema.prisma
-- (columns exactly as below) before running `migrate dev` again.

-- One row per (source, account) bucket:
--   ip     — client address as resolved from x-forwarded-for (IPv6 truncated to
--            its /64 prefix, so address rotation inside one subnet is one bucket)
--   userId — the account the attempt targeted, or '' when the e-mail did not
--            resolve to an account. Keeping the pair (rather than just the ip)
--            lets the login path answer two questions with one table:
--              a) how many failures has this SOURCE produced recently?
--                 → SUM(failures) over all rows with this ip
--              b) how many DISTINCT sources have failed against this account?
--                 → COUNT(*) over all rows with this userId
--            (b) is what makes the account lock un-weaponisable: it only fires
--            for genuinely distributed attacks, never for a single attacker.
CREATE TABLE IF NOT EXISTS "LoginThrottle" (
    "ip"             TEXT        NOT NULL,
    "userId"         TEXT        NOT NULL DEFAULT '',
    "failures"       INTEGER     NOT NULL DEFAULT 0,
    -- Fixed window: the bucket resets once firstFailureAt falls out of the
    -- window, so an attacker gets a predictable N failures per window rather
    -- than a block that they can extend indefinitely by keeping the pressure on.
    "firstFailureAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "lastFailureAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("ip", "userId")
);

-- Distinct-source count per account (question (b) above).
CREATE INDEX IF NOT EXISTS "LoginThrottle_userId_firstFailureAt_idx"
    ON "LoginThrottle" ("userId", "firstFailureAt");

-- Opportunistic garbage collection of expired buckets.
CREATE INDEX IF NOT EXISTS "LoginThrottle_lastFailureAt_idx"
    ON "LoginThrottle" ("lastFailureAt");
