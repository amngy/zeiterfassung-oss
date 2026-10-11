// One-off PRE-LAUNCH reset of the audit trail (Protokoll).
//
// ⚠️  The audit log is append-only and tamper-evident (revisionssicher) by law
//     (GoBD). Clearing it is only legitimate BEFORE go-live, to remove seed/test
//     noise while no real working-time data exists yet. After go-live, never
//     clear it — and NEVER wire this into the deploy pipeline (the pre-deploy
//     command runs on every release and would erase the trail each time).
//
// "Pre-launch only" used to be a comment and nothing else: one `--yes` wiped the
// whole table on any database, including production. It is now enforced — see
// assertLooksPreLaunch() below — and the confirmation has to NAME the database
// you are about to empty.
//
// Usage (e.g. in a Railway shell):
//   npx tsx prisma/reset-audit.ts                        → shows the count, does nothing
//   npx tsx prisma/reset-audit.ts --yes --confirm=<db>   → actually clears the log

import { prisma } from "@/lib/db";

// ── Schutz vor dem Produktivbetrieb ──────────────────────────────────────────
// Die Prüfung kann nicht wissen, ob eine Datenbank "die Produktion" IST — sie
// prüft, ob die Daten aussehen, als wäre das System bereits in Benutzung:
//
//   1. Alter    Der älteste Protokoll- oder Zeiteintrag ist älter als 14 Tage.
//               Vor dem Produktivstart ist alles frisch eingespielt.
//   2. Umfang   Mehr als 10 Konten. Der Seed legt 4 an; ein vollständig
//               angelegtes Team spricht für Echtbetrieb.
//   3. Zeitraum Protokolleinträge aus mehr als einem Kalendermonat. Echte
//               Erfassung läuft über Monatsgrenzen, ein Testlauf nicht.
//
// Greift eine Regel, bricht das Skript ab — ohne Umgehungsschalter. Wer wirklich
// vor dem Start steht und trotzdem anschlägt (z. B. großes Team schon angelegt),
// passt die Schwellen hier bewusst an und dokumentiert das. Die Hürde ist
// Absicht: ein geleertes Protokoll lässt sich nicht wiederherstellen.
const MAX_AGE_DAYS = 14;
const MAX_USERS = 10;

/** DATABASE_URL ohne Passwort — damit sichtbar ist, WELCHE Datenbank gemeint ist. */
function maskedDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "(DATABASE_URL ist nicht gesetzt)";
  return raw.replace(/:[^:@/]+@/, ":****@");
}

/** Name der Datenbank aus DATABASE_URL — das ist der zu bestätigende Bezeichner. */
function databaseName(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "";
  try {
    return new URL(raw).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function refuse(lines: string[]): never {
  console.error(["", ...lines, ""].join("\n"));
  process.exit(1);
}

async function assertLooksPreLaunch(): Promise<void> {
  const [users, oldestLog, newestLog, oldestEntry] = await Promise.all([
    prisma.user.count(),
    prisma.auditLog.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.auditLog.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.timeEntry.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  const findings: string[] = [];
  const now = Date.now();
  const ageDays = (d: Date) => Math.floor((now - d.getTime()) / 86_400_000);

  const oldest = [oldestLog?.createdAt, oldestEntry?.createdAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if (oldest && ageDays(oldest) > MAX_AGE_DAYS) {
    findings.push(
      `  • Die ältesten Daten sind ${ageDays(oldest)} Tage alt (Grenze: ${MAX_AGE_DAYS}).`,
    );
  }
  if (users > MAX_USERS) {
    findings.push(`  • ${users} Konten angelegt (Grenze: ${MAX_USERS}).`);
  }
  if (oldestLog && newestLog && monthKey(oldestLog.createdAt) !== monthKey(newestLog.createdAt)) {
    findings.push(
      `  • Protokolleinträge aus mehreren Kalendermonaten (${monthKey(oldestLog.createdAt)} bis ${monthKey(newestLog.createdAt)}).`,
    );
  }
  if (findings.length === 0) return;

  refuse([
    "ABGELEHNT — diese Datenbank sieht nach Produktivbetrieb aus:",
    ...findings,
    "",
    `  Datenbank: ${maskedDatabaseUrl()}`,
    "",
    "  Das Protokoll ist nach GoBD aufbewahrungspflichtig und darf im Echtbetrieb",
    "  nicht geleert werden. Einzelne Personen entfernt man über die",
    "  Anonymisierung (DSGVO Art. 17) im Verwaltungsbereich — die hält die",
    "  Aufbewahrungspflicht ein.",
  ]);
}

function assertConfirmed(): void {
  const argv = process.argv.slice(2);
  const expected = databaseName();
  const confirmed = argv
    .filter((a) => a.startsWith("--confirm="))
    .map((a) => a.slice("--confirm=".length));

  // No database name in DATABASE_URL → there is nothing to confirm against, so
  // there is no way to be sure which database this would empty. Refuse.
  if (!argv.includes("--yes") || expected === "" || confirmed[0] !== expected) {
    refuse([
      "ABGELEHNT — zum Leeren des Protokolls fehlt die Bestätigung.",
      "",
      `  Datenbank: ${maskedDatabaseUrl()}`,
      "",
      "  Erforderlich sind BEIDE Angaben — die zweite benennt ausdrücklich die",
      "  Datenbank, die geleert wird:",
      "",
      `    npx tsx prisma/reset-audit.ts --yes --confirm=${expected || "<Datenbankname>"}`,
    ]);
  }
}

async function main(): Promise<void> {
  const count = await prisma.auditLog.count();

  console.log(`Datenbank: ${maskedDatabaseUrl()}`);
  console.log(`Das Protokoll enthält ${count} Einträge.`);

  if (!process.argv.includes("--yes")) {
    console.log("Dies ist eine einmalige Aktion VOR dem Produktivstart und nicht umkehrbar.");
    console.log("Zum Leeren erneut mit --yes und der Bestätigung der Datenbank ausführen:");
    console.log(`  npx tsx prisma/reset-audit.ts --yes --confirm=${databaseName() || "<Datenbankname>"}`);
    return;
  }

  assertConfirmed();
  await assertLooksPreLaunch();

  const { count: removed } = await prisma.auditLog.deleteMany({});
  console.log(`✓ Protokoll geleert (${removed} Einträge entfernt).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
