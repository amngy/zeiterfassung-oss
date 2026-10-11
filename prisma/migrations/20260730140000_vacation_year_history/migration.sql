-- Per-year leave accounts.
--
-- WHY: `User.vacationDaysPerYear` and `vacationCarryOverDays` are single
-- CURRENT-year fields. Once the calendar rolls over, opening last year shows
-- THIS year's entitlement — historical leave accounts are retroactively wrong,
-- and there is no record of what was actually granted or carried forward. There
-- was also no year-end rollover process at all; carry-over was a manual edit.
--
-- SAFETY AGAINST A POPULATED PRODUCTION DATABASE
-- Purely additive: one new table plus its indexes, all `IF NOT EXISTS`. No
-- existing table is read, rewritten or locked. A year with no row falls back to
-- the User fields, so every current figure is unchanged until the rollover
-- (prisma/vacation-rollover.ts) is run deliberately.

CREATE TABLE IF NOT EXISTS "VacationYear" (
    "id"                  TEXT             NOT NULL,
    "userId"              TEXT             NOT NULL,
    "year"                INTEGER          NOT NULL,
    "statutoryDays"       DOUBLE PRECISION NOT NULL,
    "additionalDays"      DOUBLE PRECISION NOT NULL,
    "carryOverDays"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "disabilityBonusDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "forfeitedDays"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reminderSentAt"      TIMESTAMP(3),
    "teilurlaubReason"    TEXT,
    "note"                TEXT,
    "closedAt"            TIMESTAMP(3),
    "createdById"         TEXT,
    "createdAt"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VacationYear_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VacationYear_userId_year_key"
    ON "VacationYear" ("userId", "year");

CREATE INDEX IF NOT EXISTS "VacationYear_year_idx" ON "VacationYear" ("year");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VacationYear_userId_fkey'
  ) THEN
    ALTER TABLE "VacationYear"
      ADD CONSTRAINT "VacationYear_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
