import { z } from "zod";

// One Zod schema per top-level AppSettings key. The admin settings screen submits
// a section at a time; each action parses with the matching schema and persists
// it via setSetting(key, value), so a malformed section can never reach the store.

const num = (min: number, max: number) => z.coerce.number().min(min).max(max);

/** Company-wide parameters (defaults, retention, carry-over cutoff, AU day). */
export const generalSettingsSchema = z.object({
  companyName: z.string().trim().min(1, "Bitte einen Namen angeben").max(120),
  defaultBundesland: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, "Bundesland-Kürzel, z. B. NW"),
  defaultVacationDays: num(0, 365),
  carryOverCutoffMonth: num(1, 12).pipe(z.number().int()),
  carryOverCutoffDay: num(1, 31).pipe(z.number().int()),
  retentionYears: num(1, 30).pipe(z.number().int()),
  auRequiredFromDay: num(1, 14).pipe(z.number().int()),
});

/** Optional rounding rule for recorded times. */
export const roundingSchema = z.object({
  enabled: z.boolean().default(false),
  incrementMinutes: num(0, 60).pipe(z.number().int()),
});

/**
 * A working-time rule profile (ArbZG). Kept as data so the pending 2026 reform
 * (e.g. daily→weekly cap) needs no code change. Refinements keep the two break
 * thresholds and the standard/maximum daily hours internally consistent.
 */
export const ruleProfileSchema = z
  .object({
    capMode: z.enum(["DAILY", "WEEKLY"]),
    maxHoursPerDay: num(1, 24),
    standardHoursPerDay: num(1, 24),
    maxHoursPerWeek: num(1, 80),
    break1AfterHours: num(0, 24),
    break1Minutes: num(0, 240).pipe(z.number().int()),
    break2AfterHours: num(0, 24),
    break2Minutes: num(0, 240).pipe(z.number().int()),
    minRestHours: num(0, 24),
    blockOnViolation: z.boolean().default(false),
  })
  .refine((v) => v.standardHoursPerDay <= v.maxHoursPerDay, {
    message: "Standardstunden dürfen das Tagesmaximum nicht überschreiten",
    path: ["standardHoursPerDay"],
  })
  .refine((v) => v.break1AfterHours <= v.break2AfterHours, {
    message: "Die zweite Pausenschwelle muss über der ersten liegen",
    path: ["break2AfterHours"],
  });

/**
 * Pausenautomatik: the break booked when the record does not contain a usable
 * one. Both durations are capped at four hours — a "break" longer than that is
 * a data-entry slip, and one that silently swallowed half a shift would be far
 * harder to notice than a rejected form.
 */
export const breakPolicySchema = z.object({
  enabled: z.boolean().default(false),
  fixedMinutes: num(0, 240).pipe(z.number().int()),
  unfinishedBreakMinutes: num(0, 240).pipe(z.number().int()),
});

/** Governance: self-correction rights and period locking. */
export const correctionPolicySchema = z.object({
  allowSelfCreate: z.boolean().default(false),
  selfCorrectionRequiresApproval: z.boolean().default(true),
  lockAfterDays: num(0, 3650).pipe(z.number().int()),
  autoLockOnMonthExport: z.boolean().default(false),
});

export type GeneralSettingsInput = z.infer<typeof generalSettingsSchema>;
export type RoundingInput = z.infer<typeof roundingSchema>;
export type RuleProfileInput = z.infer<typeof ruleProfileSchema>;
export type BreakPolicyInput = z.infer<typeof breakPolicySchema>;
export type CorrectionPolicyInput = z.infer<typeof correctionPolicySchema>;
