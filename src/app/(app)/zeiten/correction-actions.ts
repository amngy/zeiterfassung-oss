"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { requireActiveUser } from "@/lib/session";
import { BUSINESS_TZ } from "@/lib/time";
import {
  submitCorrectionRequest,
  resolveOpenEntry,
  CorrectionError,
  type BreakDeclaration,
} from "@/lib/corrections";
import { correctionFormSchema } from "@/lib/validation/correction";

export interface CorrectionFormState {
  ok?: boolean;
  error?: string;
  /** True when the change took effect at once instead of queuing for approval. */
  applied?: boolean;
}

/**
 * Parse a Berlin wall-clock "YYYY-MM-DDTHH:mm" string to an absolute instant,
 * rejecting times that don't exist or are ambiguous due to the DST switch (the
 * Zod schema only compares the raw strings lexically, so without this a
 * spring-forward gap time could collapse to an inverted/zero-duration interval).
 */
function berlinInstant(local: string): Date {
  const instant = fromZonedTime(local, BUSINESS_TZ);
  // Round-trip: a nonexistent/ambiguous wall-clock time won't reproduce `local`.
  const roundTrip = formatInTimeZone(instant, BUSINESS_TZ, "yyyy-MM-dd'T'HH:mm");
  if (roundTrip !== local) {
    throw new CorrectionError(
      "Diese Uhrzeit existiert an diesem Tag wegen der Zeitumstellung nicht oder ist mehrdeutig.",
    );
  }
  return instant;
}

/** Employee (or admin) submits a correction request for their own time entry. */
export async function submitCorrection(
  _prev: CorrectionFormState | undefined,
  formData: FormData,
): Promise<CorrectionFormState> {
  const user = await requireActiveUser();

  const parsed = correctionFormSchema.safeParse({
    timeEntryId: formData.get("timeEntryId") || undefined,
    type: formData.get("type"),
    start: formData.get("start"),
    end: formData.get("end"),
    hasBreak: formData.get("hasBreak") ?? "",
    breakStart: formData.get("breakStart") ?? "",
    breakEnd: formData.get("breakEnd") ?? "",
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const { type, start, end, reason, timeEntryId, hasBreak, breakStart, breakEnd } =
    parsed.data;

  // Only a work time carries a break statement; a BREAK correction is the break.
  let breakDeclaration: BreakDeclaration | null = null;
  if (type === "WORK" && hasBreak === "no") breakDeclaration = { taken: false };
  if (type === "WORK" && hasBreak === "yes") {
    try {
      breakDeclaration = {
        taken: true,
        start: berlinInstant(breakStart),
        end: berlinInstant(breakEnd),
      };
    } catch (e) {
      if (e instanceof CorrectionError) return { error: e.message };
      throw e;
    }
  }

  let applied = false;
  try {
    ({ applied } = await submitCorrectionRequest({
      subjectUserId: user.id,
      requestedById: user.id,
      isAdmin: user.role === "ADMIN",
      proposed: {
        type,
        start: berlinInstant(start),
        end: berlinInstant(end),
        timeEntryId: timeEntryId ?? null,
      },
      reason,
      breakDeclaration,
    }));
  } catch (e) {
    if (e instanceof CorrectionError) return { error: e.message };
    throw e;
  }

  revalidatePath("/zeiten");
  revalidatePath("/dashboard");
  revalidatePath("/admin/korrekturen");
  revalidatePath("/admin/zeiten");
  return { ok: true, applied };
}

/**
 * Close a forgotten, still-running entry so the employee is unblocked at once.
 *
 * This is the fix for the reported lockout: without it, a shift that was never
 * clocked out keeps failing every clock-in against the one-open-entry index,
 * the clock card shows no buttons in the ANOMALY state, and the correction form
 * never offered the running entry as a target — the app told people to "please
 * correct it" while offering no way to do so.
 */
export async function resolveOpenEntryAction(
  _prev: CorrectionFormState | undefined,
  formData: FormData,
): Promise<CorrectionFormState> {
  const user = await requireActiveUser();

  const entryId = String(formData.get("entryId") ?? "").trim();
  const end = String(formData.get("end") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!entryId) return { error: "Kein Eintrag ausgewählt." };
  if (!end) return { error: "Bitte das tatsächliche Ende angeben." };
  if (reason.length < 3) return { error: "Bitte einen nachvollziehbaren Grund angeben." };
  if (reason.length > 500) return { error: "Höchstens 500 Zeichen." };

  try {
    await resolveOpenEntry({
      entryId,
      actorId: user.id,
      subjectUserId: user.id,
      isAdmin: user.role === "ADMIN",
      end: berlinInstant(end),
      reason,
    });
  } catch (e) {
    if (e instanceof CorrectionError) return { error: e.message };
    throw e;
  }

  revalidatePath("/zeiten");
  revalidatePath("/dashboard");
  return { ok: true };
}
