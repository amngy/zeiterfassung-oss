-- Integrity constraints that close three check-then-act races.
--
-- SAFETY NOTE — every statement here is wrapped in a guard that first checks
-- whether existing production data already satisfies the constraint. If it does
-- not, the constraint is SKIPPED with a warning instead of failing the migration.
-- This is deliberate: `prisma migrate deploy` runs as Railway's preDeployCommand,
-- and a migration that throws is recorded as FAILED in `_prisma_migrations`,
-- which blocks every subsequent deploy until an operator manually resolves it.
-- (That is exactly how migration 20260616120000_one_open_entry_per_type can
-- brick a deploy — see the review report.)
--
-- Run `npx tsx prisma/check-integrity.ts` to list any rows that block a
-- constraint, clean them up, then re-run this migration with:
--   npx prisma migrate resolve --rolled-back 20260730120100_guarded_integrity_constraints
--   npx prisma migrate deploy

-- 1) One WorkSchedule per (user, effectiveFrom) --------------------------------
-- Without this, two rows can share an effectiveFrom and `scheduleForDay` picks
-- whichever Postgres happens to return last — a nondeterministic contract that
-- silently changes both overtime and vacation-day counting.
DO $$
DECLARE
  dupes bigint;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT 1 FROM "WorkSchedule"
    GROUP BY "userId", "effectiveFrom" HAVING count(*) > 1
  ) d;

  IF dupes = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "WorkSchedule_userId_effectiveFrom_key"
      ON "WorkSchedule" ("userId", "effectiveFrom");
    RAISE NOTICE 'WorkSchedule uniqueness applied.';
  ELSE
    RAISE WARNING 'SKIPPED WorkSchedule uniqueness: % duplicate (userId, effectiveFrom) group(s). Run prisma/check-integrity.ts.', dupes;
  END IF;
END $$;

-- 2) No two live absences of the same type may overlap for one employee --------
-- `findOverlap` in src/lib/absences.ts is a check-then-act guard with no DB
-- backstop, so a double-submit inserts two identical holidays and the balance is
-- deducted twice. Needs btree_gist for the equality parts of the key.
DO $$
DECLARE
  overlap_count bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
    RAISE WARNING 'SKIPPED Absence overlap constraint: cannot create btree_gist extension.';
    RETURN;
  END;

  SELECT count(*) INTO overlap_count
  FROM "Absence" a
  JOIN "Absence" b
    ON a."userId" = b."userId"
   AND a."type"   = b."type"
   AND a.id <> b.id
   AND a."status" IN ('PENDING','APPROVED')
   AND b."status" IN ('PENDING','APPROVED')
   AND daterange(a."startDate"::date, a."endDate"::date, '[]')
       && daterange(b."startDate"::date, b."endDate"::date, '[]');

  IF overlap_count = 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'Absence_no_overlap_per_user_type'
    ) THEN
      ALTER TABLE "Absence" ADD CONSTRAINT "Absence_no_overlap_per_user_type"
        EXCLUDE USING gist (
          "userId" WITH =,
          "type"   WITH =,
          daterange("startDate"::date, "endDate"::date, '[]') WITH &&
        ) WHERE ("status" IN ('PENDING','APPROVED'));
    END IF;
    RAISE NOTICE 'Absence overlap constraint applied.';
  ELSE
    RAISE WARNING 'SKIPPED Absence overlap constraint: % overlapping pair(s) already stored. Run prisma/check-integrity.ts.', overlap_count;
  END IF;
END $$;

-- 3) Make the Holiday uniqueness actually work for company-wide rows -----------
-- `@@unique([date, name, bundesland])` does not dedupe when bundesland IS NULL,
-- because Postgres treats NULLs as distinct. That makes the duplicate guard in
-- addGiftedHoliday unreachable dead code. PostgreSQL 15+ can fix this in place.
DO $$
DECLARE
  dupes bigint;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE WARNING 'SKIPPED Holiday NULLS NOT DISTINCT: needs PostgreSQL 15+.';
    RETURN;
  END IF;

  SELECT count(*) INTO dupes FROM (
    SELECT 1 FROM "Holiday"
    WHERE "bundesland" IS NULL
    GROUP BY "date", "name" HAVING count(*) > 1
  ) d;

  IF dupes = 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relname = 'Holiday_date_name_bundesland_nnd_key'
    ) THEN
      CREATE UNIQUE INDEX "Holiday_date_name_bundesland_nnd_key"
        ON "Holiday" ("date", "name", "bundesland") NULLS NOT DISTINCT;
    END IF;
    RAISE NOTICE 'Holiday NULLS NOT DISTINCT uniqueness applied.';
  ELSE
    RAISE WARNING 'SKIPPED Holiday NULLS NOT DISTINCT: % duplicate company-wide holiday group(s). Run prisma/check-integrity.ts.', dupes;
  END IF;
END $$;
