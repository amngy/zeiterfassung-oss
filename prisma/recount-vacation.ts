// Recompute the stored working-day count of existing vacation entries.
//
// The day count on an Absence is frozen at the moment it is created/approved.
// A leave range recorded for dates BEFORE the employee's first work-schedule
// row used to collapse to ~0 days (fixed in src/lib/time: leave now falls back
// to the earliest schedule). Entries saved before that fix keep their wrong
// value until recomputed — repairing those is what this script is FOR.
//
// Two things it must not do, and no longer does:
//
//  1. §9 BUrlG. A holiday whose count was legitimately REDUCED by a credit-back
//     (certified sickness during the holiday) differs from the raw range count
//     by exactly that credit. Recomputing the raw range and storing it took the
//     credited days back off the employee — silently, under an audit reason that
//     blamed the schedule fallback. The recount now subtracts every credit the
//     entry already received, read from the `absence.creditback` rows in the
//     audit trail (the authoritative record of what was booked), so the §9
//     figure survives. An entry that overlaps a credited sick spell but has no
//     such row is skipped rather than guessed at.
//
//  2. Rewriting settled history. The recount necessarily runs against TODAY's
//     holiday table and TODAY's schedules. A holiday added, or a schedule row
//     created, AFTER a holiday was approved would therefore rewrite approved
//     leave months later. APPROVED entries are now only touched when the
//     difference really is the schedule-fallback bug; everything else is listed
//     with its cause and left alone unless you ask for it explicitly.
//
// The dry run names the cause of every difference, so nothing is applied blind.
//
// Usage (e.g. in a Railway shell):
//   npx tsx prisma/recount-vacation.ts                  → shows what WOULD change
//   npx tsx prisma/recount-vacation.ts --yes            → applies them (audited)
//   npx tsx prisma/recount-vacation.ts --include-drift  → also offers approved
//       entries whose difference comes from a later holiday/schedule change
//
// Tip: take a backup first (see README → pg_dump).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { workingDaysForRange } from "@/lib/absences";
import { writeAudit } from "@/lib/audit";
import { resolveRegion } from "@/lib/holidays";
import { getAppSettings } from "@/lib/settings";
import { berlinDayKey, eachDayKey } from "@/lib/time";

/** A pure @db.Date column read back as the calendar day it stands for. */
const utcToKey = (d: Date) => berlinDayKey(d, "UTC");
/** A real instant (createdAt) as the Berlin calendar day it happened on. */
const instantToKey = (d: Date) => berlinDayKey(d);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Read one numeric field out of an audit payload (Json columns are `unknown`). */
function jsonNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const n = (value as Record<string, unknown>)[key];
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Why a stored count differs from what the current data produces. */
type Cause = "SCHEDULE_FALLBACK" | "SCHEDULE_DRIFT" | "HOLIDAY_DRIFT" | "UNKNOWN";

/** Operator-facing explanation (dry run). */
const CAUSE_TEXT: Record<Cause, string> = {
  SCHEDULE_FALLBACK: "Zeitraum lag vor dem ersten Arbeitszeitmodell",
  SCHEDULE_DRIFT: "Arbeitszeitmodell nach der Entscheidung angelegt",
  HOLIDAY_DRIFT: "Feiertag im Zeitraum nach der Entscheidung angelegt",
  UNKNOWN: "Ursache nicht feststellbar",
};

/** What goes into the audit trail — one accurate sentence per cause. */
const AUDIT_REASON: Record<Cause, string> = {
  SCHEDULE_FALLBACK:
    "Neuberechnung: Zeitraum lag vor dem ersten Arbeitszeitmodell (Rückfall auf das früheste Modell)",
  SCHEDULE_DRIFT:
    "Neuberechnung: Arbeitszeitmodell wurde nach der Entscheidung angelegt/geändert",
  HOLIDAY_DRIFT: "Neuberechnung: Feiertagskalender wurde nach der Entscheidung geändert",
  UNKNOWN: "Neuberechnung mit dem aktuellen Stand (Ursache der Abweichung nicht feststellbar)",
};

interface Change {
  id: string;
  name: string;
  status: string;
  from: string;
  to: string;
  old: number;
  /** Raw range count with today's schedules/holidays, before §9. */
  raw: number;
  /** §9 BUrlG days already credited back on this entry (kept, per the trail). */
  credit: number;
  /** What would be stored: raw − credit. */
  next: number;
  cause: Cause;
  /** Concrete evidence for the cause, e.g. the holiday that appeared. */
  detail: string;
  /** Applying it is in scope for this run. */
  eligible: boolean;
}

const fmtDays = (n: number) => String(n).replace(".", ",");
const STATUS_DE: Record<string, string> = { PENDING: "beantragt", APPROVED: "genehmigt" };

async function main(): Promise<void> {
  const apply = process.argv.includes("--yes");
  const includeDrift = process.argv.includes("--include-drift");

  const vacations = await prisma.absence.findMany({
    where: { type: "VACATION", status: { in: ["PENDING", "APPROVED"] } },
    include: { user: { select: { name: true, bundesland: true } } },
    orderBy: { startDate: "asc" },
  });

  const userIds = [...new Set(vacations.map((a: { userId: string }) => a.userId))];
  const settings = await getAppSettings();

  // Every §9 credit-back that has already been granted. A vacation overlapping
  // one of these carries a REDUCED count on purpose.
  const creditedSick = await prisma.absence.findMany({
    where: {
      userId: { in: userIds },
      type: "SICK",
      status: "APPROVED",
      creditedBackFromVacation: true,
    },
    select: { userId: true, startDate: true, endDate: true },
  });
  const sickByUser = new Map<string, { from: string; to: string }[]>();
  for (const s of creditedSick) {
    const list = sickByUser.get(s.userId) ?? [];
    list.push({ from: utcToKey(s.startDate), to: utcToKey(s.endDate) });
    sickByUser.set(s.userId, list);
  }

  // How much each holiday was actually reduced by, taken from the audit trail —
  // the authoritative record. Recomputing the overlap against today's data would
  // be a second guess, and would wrongly credit a PENDING request that overlaps
  // the same sick spell but was never credited (creditBackSick only ever touches
  // APPROVED holidays).
  const creditRows = await prisma.auditLog.findMany({
    where: {
      action: "absence.creditback",
      targetType: "Absence",
      targetId: { in: vacations.map((a: { id: string }) => a.id) },
    },
    select: { targetId: true, oldValue: true, newValue: true },
  });
  const creditByAbsence = new Map<string, number>();
  for (const r of creditRows) {
    if (!r.targetId) continue;
    const before = jsonNumber(r.oldValue, "days");
    const after = jsonNumber(r.newValue, "days");
    // The booked reduction; `credit` is the payload's own figure and only used
    // when an older row does not carry both day counts.
    const amount =
      before !== null && after !== null
        ? round2(before - after)
        : (jsonNumber(r.newValue, "credit") ?? 0);
    if (amount > 0) {
      creditByAbsence.set(r.targetId, round2((creditByAbsence.get(r.targetId) ?? 0) + amount));
    }
  }

  // Schedules, for the "range predates the first model" and "model added later"
  // diagnoses. A model EDITED in place cannot be detected (WorkSchedule has no
  // updatedAt) — those differences end up as "Ursache nicht feststellbar".
  const schedules = await prisma.workSchedule.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, effectiveFrom: true, createdAt: true },
    orderBy: { effectiveFrom: "asc" },
  });
  const schedulesByUser = new Map<string, { effectiveFrom: string; createdAt: Date }[]>();
  for (const s of schedules) {
    const list = schedulesByUser.get(s.userId) ?? [];
    list.push({ effectiveFrom: utcToKey(s.effectiveFrom), createdAt: s.createdAt });
    schedulesByUser.set(s.userId, list);
  }

  const changes: Change[] = [];
  const unreconstructable: { name: string; from: string; to: string; old: number }[] = [];
  let credited = 0;

  for (const a of vacations) {
    const from = utcToKey(a.startDate);
    const to = utcToKey(a.endDate);

    // Re-apply the §9 credit this entry already received, so the recount cannot
    // hand the sick days back. Without this the raw range count ALWAYS differs
    // from the (legitimately reduced) stored figure and always overwrote it.
    const credit = creditByAbsence.get(a.id) ?? 0;
    if (credit > 0) credited += 1;

    // A credited sick spell overlaps this holiday, but the trail no longer says
    // how much was credited to THIS entry (e.g. the Protokoll was cleared).
    // Recomputing would be guesswork, so the entry is left alone.
    const overlapsCredited = (sickByUser.get(a.userId) ?? []).some(
      (s) => !(s.from > to || s.to < from),
    );
    if (credit === 0 && overlapsCredited) {
      unreconstructable.push({ name: a.user.name, from, to, old: a.workingDaysCount });
      continue;
    }

    const raw = await workingDaysForRange(a.userId, from, to, {
      halfDayStart: a.halfDayStart,
      halfDayEnd: a.halfDayEnd,
    });
    const next = Math.max(0, round2(raw - credit));
    if (Math.abs(next - a.workingDaysCount) <= 1e-9) continue;

    const { cause, detail } = await diagnose(a, from, to, settings, schedulesByUser);
    // PENDING requests are re-counted at approval anyway, so recomputing them is
    // never a rewrite of history. An APPROVED entry is only corrected when the
    // cause is the bug this script exists for.
    const eligible = a.status === "PENDING" || cause === "SCHEDULE_FALLBACK" || includeDrift;

    changes.push({
      id: a.id,
      name: a.user.name,
      status: a.status,
      from,
      to,
      old: a.workingDaysCount,
      raw,
      credit,
      next,
      cause,
      detail,
      eligible,
    });
  }

  const todo = changes.filter((c) => c.eligible);
  const held = changes.filter((c) => !c.eligible);

  console.log(`Urlaubseinträge geprüft   : ${vacations.length}`);
  console.log(`Mit §9-Gutschrift         : ${credited} (Gutschrift bleibt erhalten)`);
  console.log(`Abweichende Tageszahlen   : ${changes.length}\n`);

  if (unreconstructable.length > 0) {
    console.log("ÜBERSPRUNGEN (§9-Gutschrift vorhanden, Höhe im Protokoll nicht auffindbar):");
    for (const s of unreconstructable) {
      console.log(
        `  ${s.name.slice(0, 22).padEnd(22)} ${s.from} – ${s.to}   ${fmtDays(s.old)} Tage — unverändert`,
      );
    }
    console.log("  Diese Einträge werden nicht angefasst; eine Neuberechnung wäre geraten.\n");
  }

  if (todo.length > 0) {
    console.log("Wird korrigiert:");
    for (const c of todo) printChange(c);
    console.log("");
  }
  if (held.length > 0) {
    console.log("NICHT angefasst (genehmigter Urlaub, Abweichung durch spätere Änderung):");
    for (const c of held) printChange(c);
    console.log("  Genehmigter Urlaub wird nicht rückwirkend überschrieben.");
    console.log("  Wenn das gewollt ist: erneut mit --include-drift starten.\n");
  }

  if (changes.length === 0) {
    console.log(
      unreconstructable.length > 0
        ? "Nichts zu tun — bis auf die übersprungenen Einträge sind alle Tageszahlen korrekt."
        : "Nichts zu tun — alle Tageszahlen sind bereits korrekt.",
    );
    return;
  }
  if (todo.length === 0) {
    console.log("Nichts anzuwenden — siehe oben.");
    return;
  }

  if (!apply) {
    console.log("Vorschau (nichts geändert). Zum Anwenden erneut mit --yes starten:");
    console.log(`  npx tsx prisma/recount-vacation.ts --yes${includeDrift ? " --include-drift" : ""}`);
    return;
  }

  // A system actor id for the audit trail (no interactive user in a shell run).
  const actor =
    (await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, select: { id: true } }))?.id ??
    "system";

  let updated = 0;
  for (const c of todo) {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.absence.updateMany({
        where: { id: c.id, workingDaysCount: c.old },
        data: { workingDaysCount: c.next },
      });
      if (claimed.count === 0) return; // changed underneath us; skip
      await writeAudit(tx, {
        actorUserId: actor,
        action: "absence.recount",
        targetType: "Absence",
        targetId: c.id,
        oldValue: { days: c.old },
        newValue: {
          days: c.next,
          from: c.from,
          to: c.to,
          rangeDays: c.raw,
          creditBackDays: c.credit,
          cause: c.cause,
        },
        reason:
          c.credit > 0
            ? `${AUDIT_REASON[c.cause]}; §9-Gutschrift von ${fmtDays(c.credit)} Tag(en) beibehalten`
            : AUDIT_REASON[c.cause],
      });
      updated += 1;
    });
  }

  console.log(`✓ ${updated} Urlaubseintrag/-einträge neu berechnet und protokolliert.`);
}

function printChange(c: Change): void {
  const credit = c.credit > 0 ? `   [§9-Gutschrift ${fmtDays(c.credit)} Tage erhalten]` : "";
  console.log(
    `  ${c.name.slice(0, 22).padEnd(22)} ${c.from} – ${c.to}   ` +
      `${fmtDays(c.old)}  →  ${fmtDays(c.next)} Tage   (${STATUS_DE[c.status] ?? c.status})${credit}`,
  );
  console.log(`      Grund: ${CAUSE_TEXT[c.cause]}${c.detail ? ` — ${c.detail}` : ""}`);
}

/**
 * Why does the stored figure differ? Ordered by how sure we can be:
 * the schedule fallback is checked against the range itself, the two "changed
 * afterwards" cases against createdAt vs. the moment the entry was decided.
 */
async function diagnose(
  absence: {
    userId: string;
    startDate: Date;
    endDate: Date;
    createdAt: Date;
    decidedAt: Date | null;
    user: { bundesland: string | null };
  },
  from: string,
  to: string,
  settings: { defaultBundesland: string },
  schedulesByUser: Map<string, { effectiveFrom: string; createdAt: Date }[]>,
): Promise<{ cause: Cause; detail: string }> {
  const own = schedulesByUser.get(absence.userId) ?? [];
  const firstEffective = own.length > 0 ? own[0]!.effectiveFrom : null;

  // The bug this script exists for: the range starts before any schedule row,
  // so the old code valued those days at zero.
  if (firstEffective === null) {
    return { cause: "SCHEDULE_FALLBACK", detail: "kein Arbeitszeitmodell hinterlegt" };
  }
  if (from < firstEffective) {
    return { cause: "SCHEDULE_FALLBACK", detail: `erstes Modell ab ${firstEffective}` };
  }

  // Everything after the entry was decided (or created, if still pending) can
  // have moved the figure without anyone touching the entry.
  const since = absence.decidedAt ?? absence.createdAt;

  const laterSchedule = own.find((s) => s.createdAt > since);
  if (laterSchedule) {
    return {
      cause: "SCHEDULE_DRIFT",
      detail: `Modell ab ${laterSchedule.effectiveFrom}, angelegt ${instantToKey(laterSchedule.createdAt)}`,
    };
  }

  const region = resolveRegion(absence.user.bundesland, settings);
  const fresh = await prisma.holiday.findMany({
    where: {
      createdAt: { gt: since },
      OR: [{ bundesland: region }, { bundesland: null }],
    },
    select: { name: true, date: true, recurringAnnually: true, createdAt: true },
  });
  if (fresh.length > 0) {
    // A recurring gifted day is stored on one concrete date but applies to the
    // same MM-DD every year, so match on the day-of-year for those.
    const days = new Set(eachDayKey(from, to));
    const monthDays = new Set([...days].map((d) => d.slice(5)));
    const hit = fresh.find((h: { date: Date; recurringAnnually: boolean }) => {
      const key = utcToKey(h.date);
      return h.recurringAnnually ? monthDays.has(key.slice(5)) : days.has(key);
    });
    if (hit) {
      return {
        cause: "HOLIDAY_DRIFT",
        detail: `${hit.name}, angelegt ${instantToKey(hit.createdAt)}`,
      };
    }
  }

  return { cause: "UNKNOWN", detail: "" };
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
