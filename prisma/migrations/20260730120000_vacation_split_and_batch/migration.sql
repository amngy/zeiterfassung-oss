-- Vacation entitlement split (BUrlG §3 vs. contractual extras) + batch backfill id.
--
-- SAFETY NOTE — this migration runs against a POPULATED PRODUCTION DATABASE.
-- Everything here is strictly ADDITIVE:
--   * only nullable columns with no DEFAULT are added, so PostgreSQL records a
--     catalog-only change (no table rewrite, no long ACCESS EXCLUSIVE lock);
--   * no column is dropped, retyped, or made NOT NULL;
--   * no row is updated or deleted.
-- Existing rows therefore keep NULL in the new columns, and the application
-- falls back to splitting the legacy `vacationDaysPerYear` on read — so every
-- employee's visible total is byte-for-byte unchanged until an admin (or the
-- audited backfill script) explicitly sets the split.
--
-- Integrity constraints that COULD fail on existing data are deliberately NOT
-- in this file. See the next migration, which applies them only when the data
-- already satisfies them, and prisma/check-integrity.ts, which reports conflicts.

-- Split entitlement -----------------------------------------------------------
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "statutoryVacationDays" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "additionalVacationDays" DOUBLE PRECISION;

-- Batch backfill correlation id ------------------------------------------------
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "batchId" TEXT;

CREATE INDEX IF NOT EXISTS "TimeEntry_batchId_idx" ON "TimeEntry" ("batchId");
