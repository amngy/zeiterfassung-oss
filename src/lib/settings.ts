import type { Prisma, PrismaClient } from "@prisma/client";
import { BRAND } from "@/config/brand";
import { prisma } from "@/lib/db";

// Accept either the root client or a transaction client, so a group of settings
// and the audit row that records them can be written in ONE transaction.
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Configurable working-time rule profile. Kept as data (not hard-coded) so the
 * expected 2026 ArbZG reform — e.g. a switch from a daily to a weekly cap — can
 * be handled by an admin changing settings, without code changes.
 */
export interface RuleProfile {
  capMode: "DAILY" | "WEEKLY";
  maxHoursPerDay: number; // ArbZG §3: 8h, extendable to 10h
  standardHoursPerDay: number; // averaging target (8h)
  maxHoursPerWeek: number; // weekly-cap mode / reform (≈48h)
  break1AfterHours: number; // > 6h worked …
  break1Minutes: number; // … requires ≥ 30 min
  break2AfterHours: number; // > 9h worked …
  break2Minutes: number; // … requires ≥ 45 min
  minRestHours: number; // ArbZG §5: ≥ 11h rest between days
  blockOnViolation: boolean; // false = warn only; true = hard-block
}

/**
 * Pausenautomatik — what the system books when the record contains no usable
 * break. Without it, two everyday mistakes silently inflate paid time: a break
 * started and never ended (it cannot be measured, so it used to be dropped) and
 * a day worked straight through with no break booked at all.
 *
 * The recorded punches are never rewritten. The break is applied when the
 * timesheet is calculated, reported as its own figure, and raises a hint asking
 * for the real time to be entered — §16(2) ArbZG wants the ACTUAL times on file,
 * so this is a stop-gap that keeps the payroll figure honest, not a substitute
 * for a correction.
 */
export interface BreakPolicy {
  /** Master switch. Off → only recorded break time is ever deducted. */
  enabled: boolean;
  /**
   * The break the company books when too little was recorded, in minutes. Never
   * applied BELOW the §4 minimum for the hours worked, so a small value cannot
   * be used to under-deduct; 0 = deduct exactly the statutory minimum.
   */
  fixedMinutes: number;
  /**
   * A break that was started and never ended counts as this many minutes.
   * 0 = leave it uncounted (and unresolved) as before.
   */
  unfinishedBreakMinutes: number;
}

/**
 * What is recorded about HOW a punch arrived. The channel (browser, terminal,
 * NFC, QR) is always kept. The coarse device type of the employee's own device
 * ("iPhone · Safari") is a technical facility suited to monitoring behaviour —
 * §87(1) Nr. 6 BetrVG co-determination and an Art. 13 notice come first — so it
 * is off until the operator switches it on (privacy by default, Art. 25(2)).
 */
export interface PunchPolicy {
  recordDeviceType: boolean;
}

export interface CorrectionPolicy {
  allowSelfCreate: boolean; // employees may record their own entries
  selfCorrectionRequiresApproval: boolean; // default: true
  lockAfterDays: number; // 0 = disabled; entries lock N days after their date
  autoLockOnMonthExport: boolean; // lock a month once exported/approved
}

export interface AppSettings {
  companyName: string;
  defaultBundesland: string; // ISO state code, e.g. "NW"
  defaultVacationDays: number; // full-time, 5-day-week entitlement
  carryOverCutoffMonth: number; // 1–12 (e.g. 3 = March)
  carryOverCutoffDay: number; // 1–31 (e.g. 31)
  retentionYears: number; // record retention (operator confirms with advisor)
  auRequiredFromDay: number; // AU/eAU required from day N of sickness
  ruleProfile: RuleProfile;
  minorRuleProfile: RuleProfile; // JArbSchG (stricter, for under-18s)
  breakPolicy: BreakPolicy; // Pausenautomatik
  correctionPolicy: CorrectionPolicy;
  punchPolicy: PunchPolicy;
}

// Sensible legal defaults. The operator can change every value in the admin UI;
// values marked below should be reviewed with a professional.
export const DEFAULT_SETTINGS: AppSettings = {
  companyName: BRAND.appName,
  defaultBundesland: "NW",
  defaultVacationDays: 28,
  carryOverCutoffMonth: 3,
  carryOverCutoffDay: 31,
  retentionYears: 4, // ArbZG/MiLoG ≥2y, social-insurance audits ≈4y → 4 is safer
  auRequiredFromDay: 4, // EFZG §5 default; employer may require earlier
  ruleProfile: {
    capMode: "DAILY",
    maxHoursPerDay: 10,
    standardHoursPerDay: 8,
    maxHoursPerWeek: 48,
    break1AfterHours: 6,
    break1Minutes: 30,
    break2AfterHours: 9,
    break2Minutes: 45,
    minRestHours: 11,
    blockOnViolation: false,
  },
  minorRuleProfile: {
    capMode: "DAILY",
    maxHoursPerDay: 8,
    standardHoursPerDay: 8,
    maxHoursPerWeek: 40,
    break1AfterHours: 4.5,
    break1Minutes: 30,
    break2AfterHours: 6,
    break2Minutes: 60,
    minRestHours: 12,
    blockOnViolation: false,
  },
  breakPolicy: {
    // On by default: leaving a legally mandatory break undeducted overstates
    // worked time and the overtime balance, which is the more harmful default of
    // the two. `fixedMinutes: 30` matches the §4 first tier, so out of the box
    // the automatic deduction IS the statutory minimum (30 min above 6 h, 45 min
    // above 9 h) — raise it if the company books a longer standard lunch.
    enabled: true,
    fixedMinutes: 30,
    unfinishedBreakMinutes: 30,
  },
  correctionPolicy: {
    allowSelfCreate: true,
    selfCorrectionRequiresApproval: true,
    lockAfterDays: 0,
    autoLockOnMonthExport: true,
  },
  punchPolicy: { recordDeviceType: false },
};

type SettingKey = keyof AppSettings;

/**
 * Load all settings, overlaying any DB overrides (one row per top-level key)
 * onto the defaults. Each row's `value` holds the JSON for that key.
 */
export async function getAppSettings(): Promise<AppSettings> {
  const rows = await prisma.setting.findMany();
  const result: AppSettings = structuredClone(DEFAULT_SETTINGS);
  const mutable = result as unknown as Record<string, unknown>;
  for (const row of rows) {
    // Rows for keys no longer in AppSettings (e.g. the removed "rounding")
    // are ignored.
    if (row.key in result) {
      // Trust seeded/admin-written shapes, but lay object values over their
      // defaults so a field added in a later release is never undefined on an
      // installation whose row predates it.
      const fallback = mutable[row.key];
      mutable[row.key] =
        isPlainObject(fallback) && isPlainObject(row.value)
          ? { ...fallback, ...row.value }
          : row.value;
    }
  }
  return result;
}

/**
 * Persist a single top-level setting (used by the admin parameter screens).
 * Pass a transaction client as `db` to make several settings and their audit
 * record commit or roll back together.
 */
export async function setSetting<K extends SettingKey>(
  key: K,
  value: AppSettings[K],
  db: Db = prisma,
): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
