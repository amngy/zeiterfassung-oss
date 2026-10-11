// Backfill the statutory / additional vacation split, and show exactly how the
// §5 BUrlG correction changes each employee's entitlement.
//
//   npx tsx prisma/split-vacation-entitlement.ts          → dry run, changes nothing
//   npx tsx prisma/split-vacation-entitlement.ts --yes    → writes the split (audited)
//
// The dry run is the important half: it prints, per employee and per year, the
// OLD entitlement (unconditional Zwölftelung) next to the NEW one (§5 BUrlG), so
// you can see every balance that moves before anything is committed. Nobody's
// figure changes just from deploying — the app falls back to splitting the legacy
// lumped value on read, which reproduces the old total exactly. It changes when
// you run this with --yes, or edit an employee in the admin UI.
//
// Take a backup first (README → pg_dump).

import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getVacationAccount } from "@/lib/absences";
import {
  computeEntitlement,
  splitLegacyEntitlement,
  statutoryMinimumDays,
  workingDaysPerWeek,
  type ScheduleInput,
} from "@/lib/time";

const YEARS = [new Date().getFullYear() - 1, new Date().getFullYear()];

function fmt(n: number): string {
  return n.toFixed(1).replace(".", ",").padStart(5);
}

const REASON_TEXT: Record<string, string> = {
  NONE: "voller Jahresanspruch (Wartezeit erfüllt)",
  WARTEZEIT_NOT_MET: "§5(1)a — Wartezeit im Jahr nicht erfüllt",
  LEFT_BEFORE_WARTEZEIT: "§5(1)b — Austritt vor Ablauf der Wartezeit",
  LEFT_IN_FIRST_HALF: "§5(1)c — Austritt in der ersten Jahreshälfte",
};

async function main(): Promise<void> {
  const apply = process.argv[2] === "--yes";

  const users = await prisma.user.findMany({
    where: { anonymizedAt: null },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true, name: true, active: true,
      vacationDaysPerYear: true,
      statutoryVacationDays: true,
      additionalVacationDays: true,
      vacationCarryOverDays: true,
      birthDate: true, employmentStart: true, employmentEnd: true,
      isSchwerbehindert: true, schwerbehindertFrom: true, schwerbehindertTo: true,
      schedules: { orderBy: { effectiveFrom: "asc" } },
    },
  });

  const planned: { id: string; name: string; statutory: number; additional: number }[] = [];

  console.log(`\nMitarbeitende: ${users.length}\n`);
  console.log(
    "Name                     Jahr  Eintritt    alt    neu   Δ   Grund",
  );
  console.log("─".repeat(96));

  for (const u of users) {
    const schedules: ScheduleInput[] = u.schedules.map((r) => ({
      effectiveFrom: r.effectiveFrom,
      hours: {
        mon: r.hoursMon, tue: r.hoursTue, wed: r.hoursWed, thu: r.hoursThu,
        fri: r.hoursFri, sat: r.hoursSat, sun: r.hoursSun,
      },
    }));
    const hours = schedules[0]?.hours ?? {
      mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0,
    };
    const wd = workingDaysPerWeek(hours);
    const floor = statutoryMinimumDays(wd);
    const split = splitLegacyEntitlement(u.vacationDaysPerYear, floor);

    for (const year of YEARS) {
      const common = {
        year,
        carryOverDays: 0, // compare the EARNED figure, not the balance
        hoursByWeekday: hours,
        employmentStart: u.employmentStart,
        employmentEnd: u.employmentEnd,
        isSchwerbehindert: u.isSchwerbehindert,
        schwerbehindertFrom: u.schwerbehindertFrom,
        schwerbehindertTo: u.schwerbehindertTo,
        ageAtYearStart: u.birthDate ? year - u.birthDate.getUTCFullYear() : null,
      };

      const next = computeEntitlement({
        ...common,
        statutoryDays: split.statutory,
        additionalDays: split.additional,
      });

      // Reproduce the OLD engine: unconditional Zwölftelung of the whole figure.
      const months = next.fullMonths;
      const oldEffective = Math.max(u.vacationDaysPerYear, floor);
      const oldProRated =
        months >= 12
          ? Math.round(oldEffective * 2) / 2
          : Math.round(((oldEffective * months) / 12) * 2) / 2;
      const oldAnnual = oldProRated + next.schwerbehindertBonus;

      const delta = next.annual - oldAnnual;
      if (Math.abs(delta) < 0.01 && year !== YEARS[YEARS.length - 1]) continue;

      const mark = delta > 0.01 ? " ▲" : delta < -0.01 ? " ▼" : "  ";
      console.log(
        `${u.name.slice(0, 22).padEnd(24)} ${year}  ` +
          `${u.employmentStart ? u.employmentStart.toISOString().slice(0, 10) : "—         "}  ` +
          `${fmt(oldAnnual)}  ${fmt(next.annual)} ${mark}  ${REASON_TEXT[next.teilurlaub] ?? next.teilurlaub}`,
      );
    }

    if (u.statutoryVacationDays == null && u.additionalVacationDays == null) {
      planned.push({
        id: u.id, name: u.name,
        statutory: split.statutory, additional: split.additional,
      });
    }
  }

  console.log("\n▲ = Mitarbeiter:in erhält mehr Urlaub als bisher berechnet (Unterdeckung nach §5 BUrlG behoben).");
  console.log(`\nAufzuteilen (bisher nur Gesamtwert gespeichert): ${planned.length}`);
  for (const p of planned) {
    console.log(`  ${p.name.padEnd(24)} gesetzlich ${fmt(p.statutory)}  +  zusätzlich ${fmt(p.additional)}`);
  }

  if (planned.length === 0) {
    console.log("\nNichts aufzuteilen — alle Datensätze sind bereits gesplittet.");
    return;
  }
  if (!apply) {
    console.log("\nVorschau (nichts geändert). Zum Anwenden:");
    console.log("  npx tsx prisma/split-vacation-entitlement.ts --yes\n");
    return;
  }

  const actor =
    (await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, select: { id: true } }))
      ?.id ?? "system";

  let written = 0;
  for (const p of planned) {
    await prisma.$transaction(async (tx) => {
      // Guard on "still unsplit" so a concurrent admin edit is never clobbered.
      const claimed = await tx.user.updateMany({
        where: { id: p.id, statutoryVacationDays: null, additionalVacationDays: null },
        data: { statutoryVacationDays: p.statutory, additionalVacationDays: p.additional },
      });
      if (claimed.count === 0) return;
      await writeAudit(tx, {
        actorUserId: actor,
        action: "user.entitlement.split",
        targetType: "User",
        targetId: p.id,
        newValue: { statutoryVacationDays: p.statutory, additionalVacationDays: p.additional },
        reason: "Aufteilung gesetzlicher/zusätzlicher Urlaub (BUrlG §3 vs. Vertrag)",
      });
      written += 1;
    });
  }
  console.log(`\n✓ ${written} Datensatz/Datensätze aufgeteilt und protokolliert.\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
