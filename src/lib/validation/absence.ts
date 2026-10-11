import { z } from "zod";

// All dates arrive as "YYYY-MM-DD" calendar days from <input type="date">; an
// absence is whole calendar days (no instants), so no timezone conversion is
// needed beyond storing them at UTC midnight (the @db.Date convention).
const dayKey = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datum")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
  }, "Dieses Datum gibt es nicht");

const note = z.string().trim().max(500, "Höchstens 500 Zeichen").optional();

/** Employee requests vacation for a date range, optionally with half-day edges. */
export const vacationRequestSchema = z
  .object({
    startDate: dayKey,
    endDate: dayKey,
    halfDayStart: z.boolean().default(false),
    halfDayEnd: z.boolean().default(false),
    note,
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "Das Ende darf nicht vor dem Beginn liegen",
    path: ["endDate"],
  })
  // A half-day on both edges only makes sense across distinct days.
  .refine((v) => !(v.startDate === v.endDate && v.halfDayStart && v.halfDayEnd), {
    message: "An einem einzelnen Tag bitte nur einen halben Tag wählen",
    path: ["halfDayEnd"],
  });

export type VacationRequestInput = z.infer<typeof vacationRequestSchema>;

/** Recording sick leave (own or, by an admin, for an employee). */
export const sickRecordSchema = z
  .object({
    startDate: dayKey,
    endDate: dayKey,
    sickNoteOnFile: z.boolean().default(false),
    note,
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "Das Ende darf nicht vor dem Beginn liegen",
    path: ["endDate"],
  });

export type SickRecordInput = z.infer<typeof sickRecordSchema>;

/**
 * Admin corrects an absence that is already on file — Nicole's case: a holiday
 * booked to 06.08. has to end on 30.07. because she fell ill, and the illness
 * goes on the record separately.
 *
 * The reason is REQUIRED. Changing a record after the fact is exactly the kind
 * of edit that has to be able to explain itself later, and the appended audit
 * entry is only as useful as the sentence written here.
 */
export const absenceCorrectionSchema = z
  .object({
    absenceId: z.string().min(1),
    type: z.enum(["VACATION", "SICK"]),
    startDate: dayKey,
    endDate: dayKey,
    halfDayStart: z.boolean().default(false),
    halfDayEnd: z.boolean().default(false),
    sickNoteOnFile: z.boolean().default(false),
    note,
    reason: z
      .string()
      .trim()
      .min(3, "Bitte kurz begründen, warum korrigiert wird")
      .max(500, "Höchstens 500 Zeichen"),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "Das Ende darf nicht vor dem Beginn liegen",
    path: ["endDate"],
  })
  .refine((v) => !(v.startDate === v.endDate && v.halfDayStart && v.halfDayEnd), {
    message: "An einem einzelnen Tag bitte nur einen halben Tag wählen",
    path: ["halfDayEnd"],
  });

export type AbsenceCorrectionInput = z.infer<typeof absenceCorrectionSchema>;

/** Admin withdraws an absence that was already in force. */
export const absenceCancelSchema = z.object({
  absenceId: z.string().min(1),
  reason: z
    .string()
    .trim()
    .min(3, "Bitte kurz begründen, warum storniert wird")
    .max(500, "Höchstens 500 Zeichen"),
});

/** Admin decision on a pending absence request. */
export const absenceDecisionSchema = z.object({
  absenceId: z.string().min(1),
  approve: z.boolean(),
});

/** Admin adds a gifted / company holiday (Sonderfrei). */
export const giftedHolidaySchema = z.object({
  date: dayKey,
  name: z.string().trim().min(2, "Bitte einen Namen angeben").max(120),
  fraction: z.enum(["FULL", "HALF"]),
  recurringAnnually: z.boolean().default(false),
});

export type GiftedHolidayInput = z.infer<typeof giftedHolidaySchema>;

/** Admin seeds the legal Feiertage for a region + year. */
export const seedHolidaysSchema = z.object({
  bundesland: z.string().trim().regex(/^[A-Z]{2}$/, "Bundesland-Kürzel, z. B. NW"),
  year: z.coerce.number().int().min(2000).max(2100),
});

/** Admin edits an employee's vacation entitlement / carry-over / disability status. */
export const entitlementSchema = z
  .object({
    userId: z.string().min(1),
    vacationDaysPerYear: z.coerce.number().min(0).max(365),
    // Split entitlement. Empty string → undefined → leave the stored value alone.
    statutoryVacationDays: z.coerce.number().min(0).max(365).optional(),
    additionalVacationDays: z.coerce.number().min(0).max(365).optional(),
    vacationCarryOverDays: z.coerce.number().min(0).max(365),
    isSchwerbehindert: z.boolean().default(false),
    schwerbehindertFrom: dayKey.optional().or(z.literal("").transform(() => undefined)),
    schwerbehindertTo: dayKey.optional().or(z.literal("").transform(() => undefined)),
  })
  .refine(
    (v) => !(v.schwerbehindertFrom && v.schwerbehindertTo) || v.schwerbehindertFrom <= v.schwerbehindertTo,
    { message: "Das Enddatum darf nicht vor dem Beginn liegen", path: ["schwerbehindertTo"] },
  );

export type EntitlementInput = z.infer<typeof entitlementSchema>;
