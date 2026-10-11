"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/session";
import {
  AbsenceError,
  adminCancelAbsence,
  adminCreateAbsence,
  adminUpdateAbsence,
  creditBackSick,
  decideAbsence,
  sendCarryOverReminder,
  setEntitlement,
} from "@/lib/absences";
import {
  absenceCancelSchema,
  absenceCorrectionSchema,
  entitlementSchema,
  sickRecordSchema,
  vacationRequestSchema,
} from "@/lib/validation/absence";

export interface AdminAbsenceState {
  ok?: boolean;
  message?: string;
  error?: string;
}

function refresh(): void {
  revalidatePath("/admin/abwesenheiten");
  revalidatePath("/abwesenheit");
  revalidatePath("/dashboard");
  // An absence now credits the day's Soll, so every view that shows a balance
  // is stale the moment one changes — not just the leave screens.
  revalidatePath("/zeiten");
  revalidatePath("/admin/zeiten");
  revalidatePath("/admin/auswertung");
}

async function requireAdmin() {
  const admin = await requireActiveUser();
  if (admin.role !== "ADMIN") throw new Error("forbidden");
  return admin;
}

/** Approve or reject a pending vacation request. */
export async function decideAbsenceAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const absenceId = String(formData.get("absenceId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!absenceId || (decision !== "approve" && decision !== "reject")) return;
  try {
    await decideAbsence({ absenceId, decidedById: admin.id, approve: decision === "approve" });
  } catch (e) {
    if (!(e instanceof AbsenceError)) throw e;
  }
  refresh();
}

/** §9 BUrlG credit-back of a certified sick spell during approved holiday. */
export async function creditBackSickAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const sickId = String(formData.get("sickId") ?? "");
  if (!sickId) return;
  try {
    await creditBackSick({ sickId, actorId: admin.id });
  } catch (e) {
    if (!(e instanceof AbsenceError)) throw e;
  }
  refresh();
}

/** Mark that the carry-over / take-your-leave reminder was sent. */
export async function sendReminderAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  await sendCarryOverReminder({ userId, actorId: admin.id });
  refresh();
}

/** Update an employee's entitlement / carry-over / disability status. */
export async function updateEntitlementAction(
  _prev: AdminAbsenceState | undefined,
  formData: FormData,
): Promise<AdminAbsenceState> {
  const admin = await requireAdmin();
  const parsed = entitlementSchema.safeParse({
    userId: formData.get("userId"),
    vacationDaysPerYear: formData.get("vacationDaysPerYear"),
    vacationCarryOverDays: formData.get("vacationCarryOverDays"),
    statutoryVacationDays: formData.get("statutoryVacationDays") || undefined,
    additionalVacationDays: formData.get("additionalVacationDays") || undefined,
    isSchwerbehindert: formData.get("isSchwerbehindert") === "on",
    schwerbehindertFrom: formData.get("schwerbehindertFrom") || "",
    schwerbehindertTo: formData.get("schwerbehindertTo") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  await setEntitlement({
    userId: parsed.data.userId,
    actorId: admin.id,
    vacationDaysPerYear: parsed.data.vacationDaysPerYear,
    vacationCarryOverDays: parsed.data.vacationCarryOverDays,
    statutoryVacationDays: parsed.data.statutoryVacationDays,
    additionalVacationDays: parsed.data.additionalVacationDays,
    isSchwerbehindert: parsed.data.isSchwerbehindert,
    schwerbehindertFrom: parsed.data.schwerbehindertFrom,
    schwerbehindertTo: parsed.data.schwerbehindertTo,
  });
  refresh();
  return { ok: true, message: "Urlaubsanspruch aktualisiert." };
}

/** Record vacation or sick leave directly for an employee (admin entry). */
export async function adminRecordAbsenceAction(
  _prev: AdminAbsenceState | undefined,
  formData: FormData,
): Promise<AdminAbsenceState> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const type = String(formData.get("type") ?? "");
  if (!userId || (type !== "VACATION" && type !== "SICK")) {
    return { error: "Bitte Mitarbeiter:in und Art wählen." };
  }

  // Reuse the same field validation as the employee forms.
  const schema = type === "VACATION" ? vacationRequestSchema : sickRecordSchema;
  const parsed = schema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    halfDayStart: formData.get("halfDayStart") === "on",
    halfDayEnd: formData.get("halfDayEnd") === "on",
    sickNoteOnFile: formData.get("sickNoteOnFile") === "on",
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  try {
    await adminCreateAbsence({
      userId,
      actorId: admin.id,
      type,
      fromKey: parsed.data.startDate,
      toKey: parsed.data.endDate,
      halfDayStart: "halfDayStart" in parsed.data ? parsed.data.halfDayStart : false,
      halfDayEnd: "halfDayEnd" in parsed.data ? parsed.data.halfDayEnd : false,
      sickNoteOnFile: "sickNoteOnFile" in parsed.data ? parsed.data.sickNoteOnFile : false,
      note: parsed.data.note,
    });
  } catch (e) {
    if (e instanceof AbsenceError) return { error: e.message };
    throw e;
  }
  refresh();
  return { ok: true, message: type === "VACATION" ? "Urlaub eingetragen." : "Krankheit erfasst." };
}

/**
 * Admin corrects an absence already on file (Nicole's case: the holiday has to
 * end on 30.07. because she fell ill from 03.08.). The consumed leave days are
 * recomputed from the corrected range — see adminUpdateAbsence.
 */
export async function correctAbsenceAction(
  _prev: AdminAbsenceState | undefined,
  formData: FormData,
): Promise<AdminAbsenceState> {
  const admin = await requireAdmin();
  const parsed = absenceCorrectionSchema.safeParse({
    absenceId: formData.get("absenceId"),
    type: formData.get("type"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    halfDayStart: formData.get("halfDayStart") === "on",
    halfDayEnd: formData.get("halfDayEnd") === "on",
    sickNoteOnFile: formData.get("sickNoteOnFile") === "on",
    note: formData.get("note") || undefined,
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  try {
    await adminUpdateAbsence({
      absenceId: parsed.data.absenceId,
      actorId: admin.id,
      type: parsed.data.type,
      fromKey: parsed.data.startDate,
      toKey: parsed.data.endDate,
      halfDayStart: parsed.data.halfDayStart,
      halfDayEnd: parsed.data.halfDayEnd,
      sickNoteOnFile: parsed.data.sickNoteOnFile,
      note: parsed.data.note,
      reason: parsed.data.reason,
    });
  } catch (e) {
    if (e instanceof AbsenceError) return { error: e.message };
    throw e;
  }
  refresh();
  return { ok: true, message: "Abwesenheit korrigiert." };
}

/** Admin withdraws an absence that was already in force (kept, marked storniert). */
export async function cancelAbsenceAction(
  _prev: AdminAbsenceState | undefined,
  formData: FormData,
): Promise<AdminAbsenceState> {
  const admin = await requireAdmin();
  const parsed = absenceCancelSchema.safeParse({
    absenceId: formData.get("absenceId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  try {
    await adminCancelAbsence({
      absenceId: parsed.data.absenceId,
      actorId: admin.id,
      reason: parsed.data.reason,
    });
  } catch (e) {
    if (e instanceof AbsenceError) return { error: e.message };
    throw e;
  }
  refresh();
  return { ok: true, message: "Abwesenheit storniert." };
}
