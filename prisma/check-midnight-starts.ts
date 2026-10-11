// Read-only diagnosis for "why do some people have a start time of 00:00?".
//
//   npx tsx prisma/check-midnight-starts.ts
//
// It writes nothing. Ever.
//
// There are two completely different situations behind a displayed 00:00, and
// they need opposite fixes — so the first job is telling them apart.
//
//  A) The STORED start really is Berlin midnight. Some row genuinely has
//     start = 00:00. Only a few paths can produce that (see the classification
//     below), and each one means something different went wrong.
//
//  B) Nothing is stored at midnight at all. The entry crosses midnight — a
//     shift that ran past 24:00, most often a forgotten clock-out that was
//     later closed the next morning. The timesheet CLIPS every entry to the
//     calendar day it is showing (summarizeResolvedDay → clip(...)), so the
//     second half of that shift is rendered as "00:00 – 06:00" on the
//     following day even though no entry starts at midnight. The Rohdaten-CSV
//     shows the true start, the Monatsnachweis shows the clipped one — which
//     is exactly why the two can look like they disagree.
//
// Note on precision: the app formats clock times as HH:mm, so anything in
// [00:00:00, 00:00:59] is displayed as "00:00". This script uses the same
// one-minute window rather than an exact equality test.

import { prisma } from "@/lib/db";

type Row = Record<string, unknown>;

async function q<T = Row>(sql: string): Promise<T[]> {
  return prisma.$queryRawUnsafe(sql) as Promise<T[]>;
}

function header(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`);
}

// TimeEntry.start is TIMESTAMP(3) without time zone holding UTC, so it has to be
// re-interpreted as UTC before being read as Berlin wall-clock.
const BERLIN = `AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Berlin'`;

async function main(): Promise<void> {
  // ── A) Rows whose stored start really is midnight ──────────────────────────
  header("A) Einträge, die TATSÄCHLICH um 00:00 beginnen");
  const stored = await q(`
    SELECT e.id, u.name, e.type, e.source, e.status,
           (e."start" ${BERLIN}) AS start_berlin,
           (e."end"   ${BERLIN}) AS end_berlin,
           e."batchId" IS NOT NULL AS from_batch,
           e."supersedesId" IS NOT NULL AS is_correction,
           e.note
    FROM "TimeEntry" e JOIN "User" u ON u.id = e."userId"
    WHERE e.status = 'ACTIVE'
      AND (e."start" ${BERLIN})::time < '00:01:00'
    ORDER BY u.name, e."start"
  `);

  if (stored.length === 0) {
    console.log("  keine — kein einziger Eintrag ist um Mitternacht gespeichert.");
    console.log("  → Ein im Nachweis sichtbares 00:00 stammt dann aus Abschnitt B.");
  } else {
    console.log(`  ${stored.length} Eintrag/Einträge beginnen um Mitternacht:\n`);
    for (const r of stored) {
      const origin =
        r.from_batch ? "Sammel-Nachtrag (/admin/nachtragen, Beginn = 00:00 eingegeben)"
        : r.is_correction ? "Korrektur/Nachtrag (00:00 im Formular eingetragen)"
        : r.source === "MANUAL" ? "manuell angelegt"
        : "Stempeluhr — in der ersten Minute nach Mitternacht eingestempelt";
      console.log(`  ${String(r.name).padEnd(24)} ${r.type} ${String(r.start_berlin).slice(0, 16)}` +
        ` → ${r.end_berlin ? String(r.end_berlin).slice(0, 16) : "OFFEN"}`);
      console.log(`      Herkunft: ${origin}`);
      if (r.note) console.log(`      Grund:    ${r.note}`);
      console.log(`      id:       ${r.id}`);
    }
    // A CLOCK row at midnight is the only genuinely surprising case: nobody
    // stamps in during the first minute of a day by accident.
    const clockRows = stored.filter((r) => r.source === "CLOCK");
    if (clockRows.length > 0) {
      console.log(`\n  ⚠ ${clockRows.length} davon stammen von der Stempeluhr (source = CLOCK).`);
      console.log("    Das ist nur plausibel bei echter Nachtschicht — sonst bitte prüfen.");
    }
  }

  // ── B) Entries that merely LOOK like they start at midnight ────────────────
  header("B) Einträge über Mitternacht (Anzeige beginnt am Folgetag mit 00:00)");
  const crossing = await q(`
    SELECT e.id, u.name, e.type, e.source,
           (e."start" ${BERLIN}) AS start_berlin,
           (e."end"   ${BERLIN}) AS end_berlin,
           round(EXTRACT(EPOCH FROM (e."end" - e."start")) / 3600.0, 2) AS hours
    FROM "TimeEntry" e JOIN "User" u ON u.id = e."userId"
    WHERE e.status = 'ACTIVE'
      AND e."end" IS NOT NULL
      AND (e."start" ${BERLIN})::date <> (e."end" ${BERLIN})::date
    ORDER BY u.name, e."start"
  `);

  if (crossing.length === 0) {
    console.log("  keine — kein abgeschlossener Eintrag läuft über Mitternacht.");
  } else {
    console.log(`  ${crossing.length} Eintrag/Einträge laufen über Mitternacht.`);
    console.log("  Im Monatsnachweis erscheint der zweite Teil am Folgetag als „00:00 – …“,");
    console.log("  obwohl gespeichert der Vorabend steht (Rohdaten-CSV zeigt den echten Beginn).\n");
    for (const r of crossing) {
      const h = Number(r.hours);
      const flag = h > 12 ? "  ⚠ unplausibel lang — vermutlich vergessenes Ausstempeln" : "";
      console.log(`  ${String(r.name).padEnd(24)} ${r.type} ${String(r.start_berlin).slice(0, 16)}` +
        ` → ${String(r.end_berlin).slice(0, 16)}  (${h} Std.)${flag}`);
      console.log(`      id: ${r.id}`);
    }
  }

  // ── B2) Still-open entries: same visual effect, and they block clock-in ─────
  header("B2) Noch offene Einträge (erzeugen ab dem Folgetag ebenfalls 00:00)");
  const open = await q(`
    SELECT e.id, u.name, e.type,
           (e."start" ${BERLIN}) AS start_berlin,
           round(EXTRACT(EPOCH FROM (now() - e."start")) / 3600)::int AS hours_open
    FROM "TimeEntry" e JOIN "User" u ON u.id = e."userId"
    WHERE e.status = 'ACTIVE' AND e."end" IS NULL
    ORDER BY e."start"
  `);
  if (open.length === 0) {
    console.log("  keine.");
  } else {
    for (const r of open) {
      const h = Number(r.hours_open);
      console.log(`  ${String(r.name).padEnd(24)} ${r.type} seit ${String(r.start_berlin).slice(0, 16)}` +
        `  (${h} Std. offen)${h > 16 ? "  ⚠ zählt nicht mehr, sperrt das Einstempeln" : ""}`);
      console.log(`      id: ${r.id}`);
    }
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  header("Ergebnis");
  if (stored.length === 0 && crossing.length === 0 && open.length === 0) {
    console.log("  Nichts gefunden — es gibt derzeit keine 00:00-Startzeiten.");
  } else {
    console.log(`  A) echt um 00:00 gespeichert:      ${stored.length}`);
    console.log(`  B) über Mitternacht (nur Anzeige): ${crossing.length}`);
    console.log(`  B2) noch offen:                    ${open.length}`);
    console.log("");
    console.log("  Korrektur für A und B: /admin/zeiten → Monat wählen → „Ändern“ am Eintrag.");
    console.log("  Der alte Wert bleibt als ersetzte Version erhalten, der Grund steht im Protokoll.");
    console.log("  Korrektur für B2: den offenen Eintrag zuerst abschließen (unter „Meine Zeiten“");
    console.log("  durch die Person selbst, danach ggf. über /admin/zeiten richtigstellen).");
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
