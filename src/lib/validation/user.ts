import { z } from "zod";
import { passwordPolicy } from "./auth";

// Calendar day "YYYY-MM-DD" (same convention as the absence validation), with a
// real-date check. Empty string → undefined (an optional date left blank).
const dayKey = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datum")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
  }, "Dieses Datum gibt es nicht");

const optionalDay = dayKey.optional().or(z.literal("").transform(() => undefined));

// German federal-state code (NW, BY, …) or blank → no override (company default).
const bundesland = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}$/, "Bundesland-Kürzel, z. B. NW")
  .optional()
  .or(z.literal("").transform(() => undefined));

const hours = z.coerce.number().min(0, "≥ 0").max(24, "≤ 24");

/** Per-weekday contracted hours (Mon–Sun). Weekly target = their sum. */
export const weekdayHoursSchema = z.object({
  mon: hours,
  tue: hours,
  wed: hours,
  thu: hours,
  fri: hours,
  sat: hours,
  sun: hours,
});

export type WeekdayHoursInput = z.infer<typeof weekdayHoursSchema>;

// Fields shared by create + profile-edit. Vacation entitlement is edited on the
// absence screen (setEntitlement); here we cover identity, region and status.
const profileFields = {
  name: z.string().trim().min(2, "Bitte einen Namen angeben").max(120),
  email: z.email("Ungültige E-Mail-Adresse").transform((s) => s.toLowerCase()),
  role: z.enum(["EMPLOYEE", "ADMIN"]),
  bundesland,
  birthDate: optionalDay,
  employmentStart: optionalDay,
  employmentEnd: optionalDay,
  isMinijob: z.boolean().default(false),
  exemptFromTimeRecording: z.boolean().default(false),
  exemptFromAutoBreak: z.boolean().default(false),
};

function employmentOrder(v: { employmentStart?: string; employmentEnd?: string }): boolean {
  return !(v.employmentStart && v.employmentEnd) || v.employmentStart <= v.employmentEnd;
}

/** Admin creates a new account, including its first work schedule. */
export const createUserSchema = z
  .object({
    ...profileFields,
    password: passwordPolicy,
    vacationDaysPerYear: z.coerce.number().min(0).max(365).default(28),
    schedule: weekdayHoursSchema,
  })
  .refine(employmentOrder, {
    message: "Austritt darf nicht vor dem Eintritt liegen",
    path: ["employmentEnd"],
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Admin edits an existing account's identity / region / status flags. */
export const updateUserSchema = z
  .object({ userId: z.string().min(1), ...profileFields })
  .refine(employmentOrder, {
    message: "Austritt darf nicht vor dem Eintritt liegen",
    path: ["employmentEnd"],
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** Admin sets a (new, effective-dated) work schedule for an employee. */
export const scheduleSchema = z.object({
  userId: z.string().min(1),
  effectiveFrom: dayKey,
  ...weekdayHoursSchema.shape,
});

export type ScheduleInputForm = z.infer<typeof scheduleSchema>;

/** Admin resets an employee's password (e.g. after a forgotten login). */
export const resetPasswordSchema = z.object({
  userId: z.string().min(1),
  password: passwordPolicy,
});

/** Self-service password change (employee or admin changing their own). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Bitte aktuelles Passwort eingeben"),
    newPassword: passwordPolicy,
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Die Passwörter stimmen nicht überein",
    path: ["confirmPassword"],
  });
