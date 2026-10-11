// Year-end leave rollover.
//
//   npx tsx prisma/vacation-rollover.ts 2026          → dry run, changes nothing
//   npx tsx prisma/vacation-rollover.ts 2026 --yes    → writes the accounts (audited)
//
// WHAT IT DOES
// For every active employee it closes the given year and opens the next one:
//   1. computes the year's entitlement under §5 BUrlG (see src/lib/time/vacation.ts);
//   2. subtracts the approved leave actually taken;
//   3. carries the remainder into the following year's VacationYear row.
//
// WHY IT EXISTS
// There was no rollover at all. `User.vacationCarryOverDays` was a single field
// an admin edited by hand, and `vacationDaysPerYear` is a CURRENT-year value, so
// once the calendar rolled over every past year silently displayed this year's
// entitlement. A leave account is a per-year fact; this writes it down.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not forfeit anything. Under §7(3) BUrlG as read by the EuGH (C-684/16)
// and the BAG (9 AZR 541/15), unused STATUTORY leave only lapses if the employer
// demonstrably told the employee to take it. The script reports who has an
// unmet duty-to-warn and carries their full balance; forfeiting is a decision a
// human makes per employee, not a batch job.

import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getVacationAccount } from "@/lib/absences";

function fmt(n: number): string {
  return n.toFixed(1).replace(".", ",").padStart(6);
}

async function main(): Promise<void> {
  const year = Number(process.argv[2]);
  const apply = process.argv.includes("--yes");

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    console.error("\nAufruf: npx tsx prisma/vacation-rollover.ts <Jahr> [--yes]\n");
    process.exit(1);
  }
  const nextYear = year + 1;

  const users = await prisma.user.findMany({
    where: { active: true, anonymizedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, carryOverReminderSentAt: true },
  });

  console.log(`\nJahresabschluss ${year} → Übertrag nach ${nextYear}\n`);
  console.log(
    "Name                     Anspruch  genommen  Rest   Hinweispflicht",
  );
  console.log("─".repeat(78));

  const plan: {
    userId: string;
    name: string;
    account: Awaited<ReturnType<typeof getVacationAccount>>;
    remaining: number;
    reminderOk: boolean;
  }[] = [];

  for (const u of users) {
    const account = await getVacationAccount(u.id, year);
    const remaining = Math.max(0, Math.round((account.entitlement.total - account.taken) * 100) / 100);
    const reminderOk = u.carryOverReminderSentAt != null;
    plan.push({ userId: u.id, name: u.name, account, remaining, reminderOk });

    console.log(
      `${u.name.slice(0, 22).padEnd(24)} ${fmt(account.entitlement.total)}  ` +
        `${fmt(account.taken)}  ${fmt(remaining)}   ` +
        (reminderOk ? "erfüllt" : "⚠ NICHT dokumentiert"),
    );
  }

  const missingReminder = plan.filter((p) => p.remaining > 0 && !p.reminderOk);
  if (missingReminder.length > 0) {
    console.log(
      `\n⚠ ${missingReminder.length} Person(en) mit Resturlaub, für die keine Aufforderung`,
    );
    console.log(
      "  dokumentiert ist. Deren gesetzlicher Urlaub kann nicht verfallen (EuGH C-684/16,",
    );
    console.log(
      "  BAG 9 AZR 541/15) — der volle Rest wird übertragen. Hinweis nachholen und im",
    );
    console.log("  Mitarbeiterprofil dokumentieren.");
  }

  if (!apply) {
    console.log("\nVorschau (nichts geändert). Zum Anwenden:");
    console.log(`  npx tsx prisma/vacation-rollover.ts ${year} --yes\n`);
    return;
  }

  const actor =
    (await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, select: { id: true } }))
      ?.id ?? "system";

  let written = 0;
  for (const p of plan) {
    const e = p.account.entitlement;
    await prisma.$transaction(async (tx) => {
      // Close the year that just ended.
      await tx.vacationYear.upsert({
        where: { userId_year: { userId: p.userId, year } },
        create: {
          userId: p.userId,
          year,
          statutoryDays: e.statutory,
          additionalDays: e.additional,
          carryOverDays: e.carryOver,
          disabilityBonusDays: e.schwerbehindertBonus,
          teilurlaubReason: e.teilurlaub,
          closedAt: new Date(),
          createdById: actor,
        },
        update: { closedAt: new Date() },
      });

      // Open the next year with the remainder carried forward. `update` only
      // touches the carry-over, so a next-year row an admin already adjusted
      // keeps its entitlement figures.
      await tx.vacationYear.upsert({
        where: { userId_year: { userId: p.userId, year: nextYear } },
        create: {
          userId: p.userId,
          year: nextYear,
          statutoryDays: e.statutoryFull,
          additionalDays: e.additionalFull,
          carryOverDays: p.remaining,
          disabilityBonusDays: 0,
          createdById: actor,
        },
        update: { carryOverDays: p.remaining },
      });

      await writeAudit(tx, {
        actorUserId: actor,
        action: "vacation.rollover",
        targetType: "User",
        targetId: p.userId,
        oldValue: { year, entitlement: e.total, taken: p.account.taken },
        newValue: { year: nextYear, carryOver: p.remaining, reminderDocumented: p.reminderOk },
        reason: `Jahresabschluss ${year}: ${p.remaining} Tag(e) übertragen`,
      });
      written += 1;
    });
  }

  console.log(`\n✓ ${written} Urlaubskonto/-konten abgeschlossen und übertragen.\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
