// Holiday data layer: seeds the legally-correct public Feiertage per year/region
// from the `date-holidays` library (movable feasts derive from Easter, so they
// MUST be computed per year — never a fixed list), and builds the per-day
// FULL/HALF effect map the pure calc module consumes for both overtime and
// vacation-day counting.
//
// A holiday's effect is applied per employee by their region + schedule in the
// pure layer; here we only resolve which dates carry a holiday and how strongly.

import Holidays from "date-holidays";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { berlinDayKey, parseDayKey, type HolidayEffect } from "@/lib/time";
import type { AppSettings } from "@/lib/settings";

/** Thrown for expected, user-facing guard violations (turned into messages). */
export class HolidayError extends Error {}

/** The region whose holidays apply to a user: their override, else the company default. */
export function resolveRegion(
  userBundesland: string | null | undefined,
  settings: Pick<AppSettings, "defaultBundesland">,
): string {
  return userBundesland?.trim() || settings.defaultBundesland;
}

/** A pure date (UTC midnight) for a "YYYY-MM-DD" key — how @db.Date is stored. */
function dateKeyToUtc(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

/** Read a stored @db.Date back as the "YYYY-MM-DD" calendar day it represents. */
function utcToDateKey(date: Date): string {
  return berlinDayKey(date, "UTC");
}

export interface SeedResult {
  region: string;
  year: number;
  created: number;
  skipped: number;
}

/**
 * Seed (idempotently) the public Feiertage for a Bundesland and year. Re-running
 * skips dates already present (the unique [date,name,bundesland] constraint), so
 * MANUAL overrides the operator added afterwards are never clobbered.
 */
/**
 * The statutory public holidays for a region and year, computed from the
 * `date-holidays` library rather than read from the database.
 *
 * Used as the read-time fallback for a year nobody seeded. Returns an empty list
 * (never throws) if the region code is unknown, so a bad code degrades to "no
 * derived holidays" rather than breaking every timesheet in the range.
 */
export function statutoryHolidaysFor(region: string, year: number): HolidayInfo[] {
  try {
    const hd = new Holidays("DE", region);
    return hd
      .getHolidays(year)
      .filter((h) => h.type === "public")
      .map((h) => ({
        dayKey: h.date.slice(0, 10),
        name: h.name,
        type: "PUBLIC" as const,
        fraction: "FULL" as HolidayEffect,
      }));
  } catch {
    return [];
  }
}

export async function seedPublicHolidays(
  bundesland: string,
  year: number,
  actorId?: string,
): Promise<SeedResult> {
  const hd = new Holidays("DE", bundesland);
  const list = hd.getHolidays(year).filter((h) => h.type === "public");
  if (list.length === 0) {
    throw new HolidayError(`Für „${bundesland}" konnten keine Feiertage ermittelt werden.`);
  }

  // skipDuplicates leans on the unique [date,name,bundesland] constraint, so a
  // re-seed never clobbers MANUAL overrides the operator added afterwards and
  // reports exactly how many new rows were inserted.
  const { count } = await prisma.holiday.createMany({
    data: list.map((h) => ({
      date: dateKeyToUtc(h.date.slice(0, 10)), // "YYYY-MM-DD HH:mm:ss" → date
      name: h.name,
      type: "PUBLIC" as const,
      fraction: "FULL" as const,
      bundesland,
      source: "SEEDED" as const,
    })),
    skipDuplicates: true,
  });
  if (actorId) {
    await writeAudit(prisma, {
      actorUserId: actorId,
      action: "holiday.seed",
      targetType: "Holiday",
      newValue: { region: bundesland, year, created: count },
    });
  }
  return { region: bundesland, year, created: count, skipped: list.length - count };
}

export interface HolidayInfo {
  dayKey: string;
  name: string;
  type: "PUBLIC" | "GIFTED";
  fraction: HolidayEffect;
}

/** Combine effects on a day; a full holiday always dominates a half one. */
function strongest(a: HolidayEffect | undefined, b: HolidayEffect): HolidayEffect {
  return a === "FULL" || b === "FULL" ? "FULL" : "HALF";
}

/**
 * All holidays affecting `region` within [fromKey, toKey], resolved to concrete
 * days. Combines:
 *  - PUBLIC holidays for the region (and any region-agnostic ones),
 *  - GIFTED one-off days on concrete dates,
 *  - GIFTED recurring days projected onto each year the range spans.
 * Region-agnostic gifted days (bundesland = null) apply company-wide.
 */
export async function getHolidaysInRange(
  region: string,
  fromKey: string,
  toKey: string,
): Promise<HolidayInfo[]> {
  const fromUtc = dateKeyToUtc(fromKey);
  const toUtc = dateKeyToUtc(toKey);

  const [dated, recurring] = await Promise.all([
    prisma.holiday.findMany({
      where: {
        recurringAnnually: false,
        date: { gte: fromUtc, lte: toUtc },
        OR: [{ bundesland: region }, { bundesland: null }],
      },
    }),
    // Recurring (always gifted) — projected per year below, so no date filter.
    prisma.holiday.findMany({
      where: { recurringAnnually: true, OR: [{ bundesland: region }, { bundesland: null }] },
    }),
  ]);

  // Read-time fallback for years nobody seeded.
  //
  // The seed only ever covers thisYear and thisYear+1, and railway.json runs
  // only `prisma migrate deploy` — the seed never runs on deploy. So on
  // 1 January of an unseeded year an instance silently had ZERO Feiertage: every
  // public holiday became a normal working day (−8 h undertime each) and leave
  // over it consumed extra days, with no warning anywhere, because the only
  // surface is /admin/feiertage and that defaults to the CURRENT year.
  //
  // Deriving the statutory days here means a missing seed can no longer produce
  // silently wrong hours. Seeded rows still win: they are applied after these,
  // so a manual override or a deletion continues to take precedence.
  const derived: HolidayInfo[] = [];
  const seededYears = new Set(dated.map((h) => utcToDateKey(h.date).slice(0, 4)));
  for (let y = Number(fromKey.slice(0, 4)); y <= Number(toKey.slice(0, 4)); y++) {
    if (seededYears.has(String(y))) continue;
    for (const h of statutoryHolidaysFor(region, y)) {
      if (h.dayKey >= fromKey && h.dayKey <= toKey) derived.push(h);
    }
  }

  // De-dupe per day, keeping the strongest effect and a representative name.
  const byDay = new Map<string, HolidayInfo>();
  const put = (dayKey: string, name: string, type: "PUBLIC" | "GIFTED", fraction: HolidayEffect) => {
    if (dayKey < fromKey || dayKey > toKey) return;
    const cur = byDay.get(dayKey);
    if (!cur) {
      byDay.set(dayKey, { dayKey, name, type, fraction });
    } else {
      cur.fraction = strongest(cur.fraction, fraction);
      if (type === "PUBLIC") cur.type = "PUBLIC"; // public name wins for display
    }
  };

  // Derived first, so a seeded row for the same day overrides it below.
  for (const h of derived) put(h.dayKey, h.name, h.type, h.fraction);

  for (const h of dated) {
    put(utcToDateKey(h.date), h.name, h.type, h.fraction);
  }

  const [fromYear] = parseDayKey(fromKey);
  const [toYear] = parseDayKey(toKey);
  for (const h of recurring) {
    const stored = utcToDateKey(h.date); // "YYYY-MM-DD"
    const md = stored.slice(5); // "MM-DD"
    for (let y = fromYear; y <= toYear; y++) {
      const dayKey = `${y}-${md}`;
      if (!isRealDate(dayKey)) continue; // e.g. 29 Feb in a non-leap year
      put(dayKey, h.name, h.type, h.fraction);
    }
  }

  return [...byDay.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

/** The FULL/HALF effect map the pure calc module consumes. */
export async function holidayMapForRange(
  region: string,
  fromKey: string,
  toKey: string,
): Promise<Map<string, HolidayEffect>> {
  const list = await getHolidaysInRange(region, fromKey, toKey);
  return new Map(list.map((h) => [h.dayKey, h.fraction]));
}

function isRealDate(dayKey: string): boolean {
  const [y, m, d] = parseDayKey(dayKey);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ── Admin management ──────────────────────────────────────────────────────────

/** Raw holiday rows for admin display: dated rows in the year + all recurring. */
export async function getHolidaysForYear(year: number) {
  const rows = await prisma.holiday.findMany({
    where: {
      OR: [
        { recurringAnnually: false, date: { gte: dateKeyToUtc(`${year}-01-01`), lte: dateKeyToUtc(`${year}-12-31`) } },
        { recurringAnnually: true },
      ],
    },
    orderBy: [{ date: "asc" }],
  });
  return rows.map((r) => ({ ...r, dayKey: utcToDateKey(r.date) }));
}

/** Admin adds a gifted / company holiday (Sonderfrei). Company-wide (no region). */
export async function addGiftedHoliday(args: {
  dayKey: string;
  name: string;
  fraction: HolidayEffect;
  recurringAnnually: boolean;
  actorId: string;
}): Promise<void> {
  const { dayKey, name, fraction, recurringAnnually, actorId } = args;
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.holiday.create({
        data: {
          date: dateKeyToUtc(dayKey),
          name,
          type: "GIFTED",
          fraction,
          bundesland: null, // company-wide
          recurringAnnually,
          source: "MANUAL",
        },
      });
      await writeAudit(tx, {
        actorUserId: actorId,
        action: "holiday.gifted.add",
        targetType: "Holiday",
        targetId: created.id,
        newValue: { dayKey, name, fraction, recurringAnnually },
      });
    });
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code?: string }).code === "P2002") {
      throw new HolidayError("Ein Feiertag mit diesem Datum und Namen existiert bereits.");
    }
    throw e;
  }
}

/** Admin removes a holiday (seeded or gifted). Audited. */
export async function deleteHoliday(args: { id: string; actorId: string }): Promise<void> {
  const { id, actorId } = args;
  await prisma.$transaction(async (tx) => {
    const row = await tx.holiday.findUnique({ where: { id } });
    if (!row) throw new HolidayError("Feiertag nicht gefunden.");
    await tx.holiday.delete({ where: { id } });
    await writeAudit(tx, {
      actorUserId: actorId,
      action: "holiday.delete",
      targetType: "Holiday",
      targetId: id,
      oldValue: {
        dayKey: utcToDateKey(row.date),
        name: row.name,
        type: row.type,
        fraction: row.fraction,
      },
    });
  });
}
