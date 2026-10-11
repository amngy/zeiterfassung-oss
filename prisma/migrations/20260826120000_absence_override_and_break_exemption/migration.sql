-- Retroactive absence correction + a per-person exemption from the Pausenautomatik.
--
-- Two independent changes, one migration because they ship together:
--
--  1. An absence that was already in force can now be corrected or withdrawn by
--     an administrator (a holiday cut short because the person fell ill, a spell
--     recorded under the wrong type, a wrong date). Unlike TimeEntry — which is
--     an immutable punch and is corrected by superseding it — an Absence is a
--     DECISION, so it is edited in place and the three columns below plus the
--     append-only audit log are what keep the change accountable afterwards.
--
--  2. `exemptFromAutoBreak` takes one person out of the automatic §4 break
--     deduction. It exists for contracts whose daily target sits at or below the
--     six-hour threshold: a day that runs slightly over would otherwise cost
--     them 30 minutes the company never intended to deduct.

-- ── 1. Cancelling an absence ────────────────────────────────────────────────
--
-- CANCELLED is deliberately NOT the same as REJECTED. REJECTED means the request
-- was never granted; CANCELLED means it WAS in force and an administrator
-- withdrew it afterwards. Every query that counts leave already filters on
-- IN ('PENDING','APPROVED'), so a cancelled row drops out of the balance, the
-- calendars and the timesheet credit without any of them being touched.
--
-- Postgres only allows ADD VALUE outside a transaction on pre-12 servers; from
-- 12 on it is transactional as long as the new value is not USED in the same
-- transaction — which it is not here.
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- ── 2. Correction bookkeeping on the absence row ────────────────────────────
ALTER TABLE "Absence"
  ADD COLUMN "correctedById"    TEXT,
  ADD COLUMN "correctedAt"      TIMESTAMP(3),
  ADD COLUMN "correctionReason" TEXT;

-- ── 3. Per-person exemption from the automatic break deduction ──────────────
ALTER TABLE "User"
  ADD COLUMN "exemptFromAutoBreak" BOOLEAN NOT NULL DEFAULT false;
