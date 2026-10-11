import { z } from "zod";

// A correction proposes a new value for an existing entry, or a brand-new entry
// (timeEntryId omitted). Times arrive as Europe/Berlin wall-clock strings from
// <input type="datetime-local"> and are converted to instants in the action.
export const correctionFormSchema = z
  .object({
    timeEntryId: z.string().trim().min(1).optional(),
    type: z.enum(["WORK", "BREAK"]),
    start: z.string().trim().min(1, "Beginn ist erforderlich"),
    end: z.string().trim().min(1, "Ende ist erforderlich"),
    // Break statement for a corrected work time. "" = not answered; the action
    // decides whether that is acceptable (it is not, for employees).
    hasBreak: z.enum(["yes", "no", ""]).default(""),
    breakStart: z.string().trim().default(""),
    breakEnd: z.string().trim().default(""),
    reason: z
      .string()
      .trim()
      .min(3, "Bitte einen nachvollziehbaren Grund angeben")
      .max(500, "Höchstens 500 Zeichen"),
  })
  .refine((v) => v.start < v.end, {
    message: "Das Ende muss nach dem Beginn liegen",
    path: ["end"],
  })
  .refine((v) => v.hasBreak !== "yes" || (v.breakStart !== "" && v.breakEnd !== ""), {
    message: "Bitte Beginn und Ende der Pause angeben",
    path: ["breakStart"],
  })
  .refine((v) => v.hasBreak !== "yes" || v.breakStart < v.breakEnd, {
    message: "Das Pausenende muss nach dem Pausenbeginn liegen",
    path: ["breakEnd"],
  });

export type CorrectionFormInput = z.infer<typeof correctionFormSchema>;

export const decisionSchema = z.object({
  correctionId: z.string().min(1),
  approve: z.boolean(),
  decisionNote: z.string().trim().max(500).optional(),
});
