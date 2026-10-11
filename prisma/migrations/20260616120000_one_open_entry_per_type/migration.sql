-- At most one OPEN (not-yet-clocked-out) ACTIVE entry per user per type.
--
-- This invariant cannot be expressed in schema.prisma (Prisma has no partial
-- unique index), so it lives as a raw migration. It is the race-proof backstop
-- for the clock actions: a check-then-insert in application code is not
-- serializable under PostgreSQL's default READ COMMITTED isolation, so two
-- concurrent clock-ins could otherwise both create an open WORK row. The unique
-- index makes the second insert fail with P2002, which the action turns into a
-- friendly "Sie sind bereits eingestempelt." message.
--
-- (userId, type) — not just userId — so an employee can legitimately have one
-- open WORK and one open BREAK at the same time (clocked in AND on a break).
CREATE UNIQUE INDEX "TimeEntry_one_open_per_type"
  ON "TimeEntry" ("userId", "type")
  WHERE "end" IS NULL AND "status" = 'ACTIVE';
