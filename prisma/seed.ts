import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { seedPublicHolidays } from "@/lib/holidays";
import { adminCreateAbsence, createAbsenceRequest, recordSick } from "@/lib/absences";

interface WeekdayHours {
  mon: number;
  tue: number;
  wed: number;
  thu: number;
  fri: number;
  sat: number;
  sun: number;
}

async function seedSettings(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      // Only fill in missing keys. This used to write the defaults back on every
      // run, so re-seeding a live database — which the README says is safe —
      // silently reset everything configured under /admin/einstellungen (rule
      // profiles, break policy, correction policy…) with no audit record.
      update: {},
      create: { key, value: value as object },
    });
  }
}

async function setSchedule(
  userId: string,
  effectiveFrom: Date,
  h: WeekdayHours,
): Promise<void> {
  // NEVER wipe existing schedules. This used to `deleteMany({ where: { userId } })`
  // first, so re-running the seed — which the README explicitly calls idempotent
  // and tells operators to do in a production shell — destroyed the employee's
  // entire effective-dated contract history and silently recomputed every past
  // month's overtime and every vacation-day count against a contract they never
  // had, with no audit record. Now it only creates the row when it is missing.
  const existing = await prisma.workSchedule.findFirst({
    where: { userId, effectiveFrom },
    select: { id: true },
  });
  if (existing) return;

  await prisma.workSchedule.create({
    data: {
      userId,
      effectiveFrom,
      hoursMon: h.mon,
      hoursTue: h.tue,
      hoursWed: h.wed,
      hoursThu: h.thu,
      hoursFri: h.fri,
      hoursSat: h.sat,
      hoursSun: h.sun,
    },
  });
}

/** Seed legal Feiertage (current + next year) and a couple of gifted company days. */
async function seedHolidays(): Promise<void> {
  const region = DEFAULT_SETTINGS.defaultBundesland;
  const thisYear = new Date().getFullYear();
  await seedPublicHolidays(region, thisYear);
  await seedPublicHolidays(region, thisYear + 1);

  // Gifted half-days that recur every year (company-wide, no region). The
  // unique constraint can't de-dupe on a NULL bundesland (Postgres treats NULLs
  // as distinct), so check-then-create keeps re-seeding idempotent.
  for (const g of [
    { md: "12-24", name: "Heiligabend" },
    { md: "12-31", name: "Silvester" },
  ]) {
    const exists = await prisma.holiday.findFirst({
      where: { name: g.name, type: "GIFTED", recurringAnnually: true },
    });
    if (exists) continue;
    await prisma.holiday.create({
      data: {
        date: new Date(`${thisYear}-${g.md}T00:00:00.000Z`),
        name: g.name,
        type: "GIFTED",
        fraction: "HALF",
        recurringAnnually: true,
        source: "MANUAL",
      },
    });
  }
}

/** A few demo absences so the calendar/overview aren't empty on first run. */
async function seedDemoAbsences(
  adminId: string,
  byEmail: Map<string, string>,
): Promise<void> {
  const existing = await prisma.absence.count();
  if (existing > 0) return; // don't duplicate on re-seed

  const year = new Date().getFullYear();
  const anna = byEmail.get("anna@firma.de");
  const carla = byEmail.get("carla@firma.de");

  if (anna) {
    // An approved week of holiday and a still-pending request.
    await adminCreateAbsence({
      userId: anna,
      actorId: adminId,
      type: "VACATION",
      fromKey: `${year}-07-06`,
      toKey: `${year}-07-10`,
      note: "Sommerurlaub",
    });
    await createAbsenceRequest({
      type: "VACATION",
      userId: anna,
      requestedById: anna,
      fromKey: `${year}-08-17`,
      toKey: `${year}-08-21`,
      halfDayStart: false,
      halfDayEnd: false,
      note: "Urlaubsantrag (Demo)",
    });
  }
  if (carla) {
    await recordSick({
      userId: carla,
      recordedById: carla,
      fromKey: `${year}-06-09`,
      toKey: `${year}-06-10`,
      sickNoteOnFile: true,
      note: "Erkältung (Demo)",
    });
  }
}

async function main(): Promise<void> {
  await seedSettings();

  // ── Admin (credentials from env) ───────────────────────────────────────────
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@firma.de").toLowerCase();
  const adminName = process.env.SEED_ADMIN_NAME ?? "System-Administrator";
  // The fallback password is published in this repository. Fine for a laptop,
  // never for a reachable instance: in production, insist on an explicit one.
  const envPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!envPassword && process.env.NODE_ENV === "production") {
    throw new Error(
      "SEED_ADMIN_PASSWORD ist nicht gesetzt. In Produktion wird kein Standard-Passwort verwendet.",
    );
  }
  const adminPassword = envPassword ?? "ChangeMe!2026";

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {}, // never overwrite an existing admin's password on re-seed
    create: {
      email: adminEmail,
      name: adminName,
      role: "ADMIN",
      passwordHash: await hashPassword(adminPassword),
      vacationDaysPerYear: 28,
      employmentStart: new Date("2020-01-01"),
    },
  });
  await setSchedule(admin.id, new Date("2020-01-01"), {
    mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0,
  });

  // Holidays (public Feiertage for the region + common gifted days) are useful
  // in production too, so they always seed.
  await seedHolidays();

  // ── Demo employees + sample absences — OPT-IN via SEED_DEMO=true ───────────
  // A real deployment seeds only the admin (above) + holidays, so it is never
  // cluttered with test accounts. Set SEED_DEMO=true to also create the demo
  // employees on deliberately different weekday schedules.
  const seedDemo = process.env.SEED_DEMO === "true";
  const demoPassword = seedDemo ? await hashPassword("Mitarbeiter!2026") : "";

  const employees: Array<{
    email: string;
    name: string;
    employmentStart: string;
    vacationDaysPerYear: number;
    vacationCarryOverDays?: number;
    isMinijob?: boolean;
    schedule: WeekdayHours;
  }> = [
    {
      // Classic 5-day full-timer: every weekday holiday affects her.
      email: "anna@firma.de",
      name: "Anna Becker",
      employmentStart: "2022-03-01",
      vacationDaysPerYear: 28,
      vacationCarryOverDays: 5,
      schedule: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 },
    },
    {
      // Mon–Thu 10h, Fri off (40h): Monday holidays affect him, Friday's don't.
      email: "bilal@firma.de",
      name: "Bilal Yıldız",
      employmentStart: "2021-06-15",
      vacationDaysPerYear: 22, // ≈ 28 × 4/5
      schedule: { mon: 10, tue: 10, wed: 10, thu: 10, fri: 0, sat: 0, sun: 0 },
    },
    {
      // Part-time Tue/Wed/Thu (18h), Minijob, mid-year start (tests Zwölftelung).
      email: "carla@firma.de",
      name: "Carla Meyer",
      employmentStart: "2025-09-01",
      vacationDaysPerYear: 17, // ≈ 28 × 3/5
      isMinijob: true,
      schedule: { mon: 0, tue: 6, wed: 6, thu: 6, fri: 0, sat: 0, sun: 0 },
    },
  ];

  const byEmail = new Map<string, string>();
  for (const e of seedDemo ? employees : []) {
    const user = await prisma.user.upsert({
      where: { email: e.email },
      update: {
        name: e.name,
        vacationDaysPerYear: e.vacationDaysPerYear,
        vacationCarryOverDays: e.vacationCarryOverDays ?? 0,
        isMinijob: e.isMinijob ?? false,
        employmentStart: new Date(e.employmentStart),
      },
      create: {
        email: e.email,
        name: e.name,
        role: "EMPLOYEE",
        passwordHash: demoPassword,
        vacationDaysPerYear: e.vacationDaysPerYear,
        vacationCarryOverDays: e.vacationCarryOverDays ?? 0,
        isMinijob: e.isMinijob ?? false,
        employmentStart: new Date(e.employmentStart),
      },
    });
    byEmail.set(e.email, user.id);
    await setSchedule(user.id, new Date(e.employmentStart), e.schedule);
  }

  if (seedDemo) await seedDemoAbsences(admin.id, byEmail);

  const total = await prisma.user.count();
  console.log(`✓ Seed complete. ${total} users.`);
  // Never echo a real password into (persisted, shared) deployment logs.
  console.log(
    `  Admin: ${adminEmail} / ${envPassword ? "(Passwort aus SEED_ADMIN_PASSWORD)" : adminPassword}`,
  );
  if (seedDemo) {
    console.log(`  + Demo: anna@firma.de, bilal@firma.de, carla@firma.de / Mitarbeiter!2026`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
