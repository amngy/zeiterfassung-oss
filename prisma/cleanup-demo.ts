// One-off cleanup for demo/test accounts in a real deployment.
//
// Usage (e.g. in a Railway shell):
//   npx tsx prisma/cleanup-demo.ts
//     → removes the seed demo employees: anna@, bilal@, carla@ (firma.de)
//   npx tsx prisma/cleanup-demo.ts admin@firma.de extra@firma.de
//     → removes exactly the e-mails you list instead
//
// Deleting a user cascades their schedules, time entries, absences and
// correction requests (FK onDelete: Cascade). Audit-log rows have no FK, so we
// remove the ones that reference the user explicitly. The last active admin is
// never deleted (so you cannot lock yourself out).

import { prisma } from "@/lib/db";

const DEFAULT_DEMO = ["anna@firma.de", "bilal@firma.de", "carla@firma.de"];

// SAFETY GUARD (added after review) ------------------------------------------
// This script HARD-DELETES user rows, and every WorkSchedule, TimeEntry,
// CorrectionRequest and Absence cascades with them — plus every AuditLog row
// where the account was the ACTOR, which punches holes in *other* employees'
// change history. It previously ran with no confirmation at all: a bare
// `npx tsx prisma/cleanup-demo.ts` in a production shell destroyed the accounts
// named below instantly. ArbZG/MiLoG require these records to be retained, and
// the rest of the codebase deactivates or anonymises rather than deleting.
function assertConfirmed(): void {
  if (!process.argv.includes("--yes-delete-permanently")) {
    console.error(
      [
        "",
        "REFUSED — this permanently deletes accounts and all their working-time,",
        "absence and audit records. There is no undo.",
        "",
        "  DATABASE_URL currently points at:",
        "    " + (process.env.DATABASE_URL ?? "(unset)").replace(/:[^:@/]+@/, ":****@"),
        "",
        "  If that is the PRODUCTION database, stop now. Prefer deactivating the",
        "  account in the admin UI, or anonymising it (DSGVO Art. 17) — both keep",
        "  the statutory retention intact.",
        "",
        "  To proceed anyway, re-run with --yes-delete-permanently",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  assertConfirmed();
  const requested = process.argv.slice(2);
  const emails = (requested.length ? requested : DEFAULT_DEMO).map((e) => e.toLowerCase());

  const all = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, active: true },
    orderBy: { email: "asc" },
  });

  console.log(`Users before (${all.length}):`);
  for (const u of all) {
    console.log(`  ${u.email}  [${u.role}${u.active ? "" : ", inaktiv"}]  ${u.name}`);
  }
  console.log("");

  let remainingActiveAdmins = all.filter((u) => u.role === "ADMIN" && u.active).length;
  let removed = 0;

  for (const email of emails) {
    const u = all.find((x) => x.email.toLowerCase() === email);
    if (!u) {
      console.log(`–  skip ${email}: kein solches Konto`);
      continue;
    }
    if (u.role === "ADMIN" && u.active && remainingActiveAdmins <= 1) {
      console.log(`–  skip ${email}: letztes aktives Admin-Konto wird nicht gelöscht`);
      continue;
    }
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorUserId: u.id }, { targetId: u.id }] },
    });
    await prisma.user.delete({ where: { id: u.id } });
    if (u.role === "ADMIN" && u.active) remainingActiveAdmins -= 1;
    removed += 1;
    console.log(`✓  gelöscht: ${email}`);
  }

  const after = await prisma.user.count();
  console.log(`\nFertig. ${removed} entfernt, ${after} Konten verbleiben.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
