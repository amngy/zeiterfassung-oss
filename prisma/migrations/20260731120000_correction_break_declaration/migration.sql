-- Break declaration on a correction request (§4 ArbZG).
--
-- Employees correcting a work time must state whether they took a break. All
-- three columns are nullable so existing rows stay valid: NULL in
-- "breakDeclared" means "was never asked", which is what every request written
-- before this migration is.
ALTER TABLE "CorrectionRequest"
  ADD COLUMN "breakDeclared"      BOOLEAN,
  ADD COLUMN "proposedBreakStart" TIMESTAMP(3),
  ADD COLUMN "proposedBreakEnd"   TIMESTAMP(3);

-- A declared break must be complete, and a declared "no break" must not carry
-- times. Guards the invariant regardless of which code path writes the row.
ALTER TABLE "CorrectionRequest"
  ADD CONSTRAINT "CorrectionRequest_break_declaration_consistent" CHECK (
    ("breakDeclared" IS NULL
       AND "proposedBreakStart" IS NULL AND "proposedBreakEnd" IS NULL)
    OR ("breakDeclared" = false
       AND "proposedBreakStart" IS NULL AND "proposedBreakEnd" IS NULL)
    OR ("breakDeclared" = true
       AND "proposedBreakStart" IS NOT NULL AND "proposedBreakEnd" IS NOT NULL
       AND "proposedBreakEnd" > "proposedBreakStart")
  );
