// Read-only preflight for the guarded constraint migration.
//
// Migration 20260730120100 applies three integrity constraints, but only when the
// existing data already satisfies them — a migration that throws is recorded as
// FAILED and blocks every subsequent `prisma migrate deploy`. This script tells
// you which rows are in the way, and finds the state that traps employees.
//
//   npx tsx prisma/check-integrity.ts
//
// It writes nothing. Ever.

import { prisma } from "@/lib/db";

type Row = Record<string, unknown>;

async function q<T = Row>(sql: string): Promise<T[]> {
   
  return (prisma as any).$queryRawUnsafe(sql) as Promise<T[]>;
}

function header(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`);
}

async function main(): Promise<void> {
  let blocking = 0;

  // 1) Stale open entries — the lockout. Not a constraint, the actual bug.
  header("Offene Einträge (blockieren das Einstempeln)");
  const open = await q(`
    SELECT e.id, u.name, u.email, e.type, e.start,
           round(EXTRACT(EPOCH FROM (now() - e.start)) / 3600)::int AS hours_open
    FROM "TimeEntry" e JOIN "User" u ON u.id = e."userId"
    WHERE e.status = 'ACTIVE' AND e."end" IS NULL
    ORDER BY e.start ASC
  `);
  if (open.length === 0) {
    console.log("  keine — niemand ist ausgesperrt.");
  } else {
    for (const r of open) {
      const h = Number(r.hours_open);
      const flag = h > 16 ? "  ⚠ GESPERRT" : "";
      console.log(`  ${String(r.name).padEnd(24)} ${r.type} seit ${String(r.start).slice(0, 16)}  (${h} Std. offen)${flag}`);
    }
    const stuck = open.filter((r) => Number(r.hours_open) > 16).length;
    if (stuck > 0) {
      console.log(`\n  ${stuck} Person(en) können sich derzeit nicht einstempeln.`);
      console.log("  → Nach dem Deploy lösen sie das selbst unter „Meine Zeiten“ auf,");
      console.log("    oder die Verwaltung trägt die Zeiten unter /admin/nachtragen nach.");
    }
  }

  // 2) Duplicate work schedules — nondeterministic contract.
  header("WorkSchedule: doppelte (userId, effectiveFrom)");
  const dupSched = await q(`
    SELECT u.name, s."effectiveFrom", count(*) AS n
    FROM "WorkSchedule" s JOIN "User" u ON u.id = s."userId"
    GROUP BY u.name, s."effectiveFrom" HAVING count(*) > 1
    ORDER BY u.name
  `);
  if (dupSched.length === 0) console.log("  keine — Constraint kann gesetzt werden.");
  else {
    blocking += dupSched.length;
    for (const r of dupSched) {
      console.log(`  ⚠ ${String(r.name).padEnd(24)} ${String(r.effectiveFrom).slice(0, 10)}  ×${r.n}`);
    }
    console.log("  → Je Gruppe die überzähligen Zeilen entfernen (die korrekte behalten).");
  }

  // 3) Overlapping absences — double-deducted leave.
  header("Absence: überlappende Einträge gleicher Art");
  const overlaps = await q(`
    SELECT u.name, a.type, a.id AS id_a, b.id AS id_b,
           a."startDate" AS a_from, a."endDate" AS a_to,
           b."startDate" AS b_from, b."endDate" AS b_to,
           a."workingDaysCount" AS a_days, b."workingDaysCount" AS b_days
    FROM "Absence" a
    JOIN "Absence" b ON a."userId" = b."userId" AND a.type = b.type AND a.id < b.id
    JOIN "User" u ON u.id = a."userId"
    WHERE a.status IN ('PENDING','APPROVED') AND b.status IN ('PENDING','APPROVED')
      AND daterange(a."startDate"::date, a."endDate"::date, '[]')
       && daterange(b."startDate"::date, b."endDate"::date, '[]')
    ORDER BY u.name
  `);
  if (overlaps.length === 0) console.log("  keine — Constraint kann gesetzt werden.");
  else {
    blocking += overlaps.length;
    for (const r of overlaps) {
      console.log(`  ⚠ ${String(r.name).padEnd(24)} ${r.type}`);
      console.log(`      ${String(r.a_from).slice(0, 10)}–${String(r.a_to).slice(0, 10)} (${r.a_days} T., ${r.id_a})`);
      console.log(`      ${String(r.b_from).slice(0, 10)}–${String(r.b_to).slice(0, 10)} (${r.b_days} T., ${r.id_b})`);
    }
    console.log("  → Doppelte Anträge im Admin-Bereich stornieren (status = 'CANCELLED'); der Urlaub wurde doppelt abgezogen.");
  }

  // 4) Duplicate company-wide holidays — the NULL-in-unique trap.
  header("Holiday: doppelte firmenweite Tage (bundesland IS NULL)");
  const dupHol = await q(`
    SELECT "date", name, count(*) AS n
    FROM "Holiday" WHERE "bundesland" IS NULL
    GROUP BY "date", name HAVING count(*) > 1 ORDER BY "date"
  `);
  if (dupHol.length === 0) console.log("  keine — Constraint kann gesetzt werden.");
  else {
    blocking += dupHol.length;
    for (const r of dupHol) {
      console.log(`  ⚠ ${String(r.date).slice(0, 10)}  ${r.name}  ×${r.n}`);
    }
    console.log("  → Je Gruppe alle bis auf eine Zeile löschen.");
  }

  // 5) Regions in use that have no holidays seeded — silently no Feiertage.
  header("Bundesländer ohne hinterlegte Feiertage");
  const regions = await q(`
    SELECT DISTINCT COALESCE(u."bundesland", '(Firmenstandard)') AS region
    FROM "User" u WHERE u.active = true
  `);
  const seeded = await q(`
    SELECT DISTINCT "bundesland" AS region, EXTRACT(YEAR FROM "date")::int AS year
    FROM "Holiday" WHERE "bundesland" IS NOT NULL
  `);
  const years = await q<{ year: number }>(`
    SELECT DISTINCT EXTRACT(YEAR FROM "date")::int AS year FROM "Holiday" ORDER BY year
  `);
  console.log(`  Feiertage vorhanden für Jahre: ${years.map((y) => y.year).join(", ") || "KEINE"}`);
  const thisYear = new Date().getFullYear();
  for (const y of [thisYear, thisYear + 1]) {
    if (!years.some((r) => Number(r.year) === y)) {
      blocking += 1;
      console.log(`  ⚠ Für ${y} sind KEINE Feiertage hinterlegt — Soll-Stunden und Urlaubstage werden für dieses Jahr falsch berechnet.`);
    }
  }
  for (const r of regions) {
    const region = String(r.region);
    if (region === "(Firmenstandard)") continue;
    if (!seeded.some((s) => s.region === region)) {
      blocking += 1;
      console.log(`  ⚠ Region ${region} ist Mitarbeitenden zugewiesen, hat aber keine eigenen Feiertage.`);
    }
  }

  header("Ergebnis");
  if (blocking === 0) {
    console.log("  Keine Blocker. Die Constraint-Migration kann vollständig greifen.");
  } else {
    console.log(`  ${blocking} Punkt(e) benötigen eine Entscheidung — siehe oben.`);
    console.log("  Die Migration läuft trotzdem durch; nicht setzbare Constraints werden übersprungen.");
  }
  console.log("");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
