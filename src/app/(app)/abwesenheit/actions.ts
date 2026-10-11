"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/session";
import {
  AbsenceError,
  createVacationRequest,
  recordSick,
  withdrawAbsence,
} from "@/lib/absences";
import { sickRecordSchema, vacationRequestSchema } from "@/lib/validation/absence";

export interface AbsenceFormState {
  ok?: boolean;
  message?: string;
  error?: string;
}

function refresh(): void {
  revalidatePath("/abwesenheit");
  revalidatePath("/dashboard");
  revalidatePath("/admin/abwesenheiten");
}

/** Employee submits a vacation request for approval. */
export async function submitVacationRequest(
  _prev: AbsenceFormState | undefined,
  formData: FormData,
): Promise<AbsenceFormState> {
  const user = await requireActiveUser();
  const parsed = vacationRequestSchema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    halfDayStart: formData.get("halfDayStart") === "on",
    halfDayEnd: formData.get("halfDayEnd") === "on",
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }
  const { startDate, endDate, halfDayStart, halfDayEnd, note } = parsed.data;

  try {
    await createVacationRequest({
      userId: user.id,
      requestedById: user.id,
      fromKey: startDate,
      toKey: endDate,
      halfDayStart,
      halfDayEnd,
      note,
    });
  } catch (e) {
    if (e instanceof AbsenceError) return { error: e.message };
    throw e;
  }
  refresh();
  return { ok: true, message: "Urlaubsantrag eingereicht. Er wird von der Verwaltung geprüft." };
}

/** Employee records their own sick leave (a recorded fact, no approval needed). */
export async function recordSickDay(
  _prev: AbsenceFormState | undefined,
  formData: FormData,
): Promise<AbsenceFormState> {
  const user = await requireActiveUser();
  const parsed = sickRecordSchema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    sickNoteOnFile: formData.get("sickNoteOnFile") === "on",
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }
  const { startDate, endDate, sickNoteOnFile, note } = parsed.data;

  let overlapsVacation = false;
  try {
    ({ overlapsVacation } = await recordSick({
      userId: user.id,
      recordedById: user.id,
      fromKey: startDate,
      toKey: endDate,
      sickNoteOnFile,
      note,
    }));
  } catch (e) {
    if (e instanceof AbsenceError) return { error: e.message };
    throw e;
  }
  refresh();
  return {
    ok: true,
    message: overlapsVacation
      ? "Krankmeldung erfasst. Sie überschneidet sich mit genehmigtem Urlaub — die Verwaltung kann die Urlaubstage nach §9 BUrlG gutschreiben."
      : "Krankmeldung erfasst.",
  };
}

/** Employee withdraws a still-pending vacation request. */
export async function withdrawRequestAction(formData: FormData): Promise<void> {
  const user = await requireActiveUser();
  const absenceId = String(formData.get("absenceId") ?? "");
  if (!absenceId) return;
  try {
    await withdrawAbsence({ absenceId, userId: user.id });
  } catch (e) {
    if (!(e instanceof AbsenceError)) throw e;
  }
  refresh();
}
