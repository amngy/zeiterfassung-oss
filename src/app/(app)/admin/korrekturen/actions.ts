"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/session";
import { decideCorrection, CorrectionError } from "@/lib/corrections";
import { markRemoteReviewed, PunchReviewError } from "@/lib/punch-review";

export interface DecisionState {
  ok?: boolean;
  error?: string;
}

/** Admin approves or rejects a pending correction request. */
export async function decideCorrectionAction(
  _prev: DecisionState | undefined,
  formData: FormData,
): Promise<DecisionState> {
  const admin = await requireActiveUser();
  if (admin.role !== "ADMIN") return { error: "Nicht berechtigt." };

  const correctionId = String(formData.get("correctionId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const decisionNote = String(formData.get("decisionNote") ?? "").trim() || undefined;
  if (!correctionId || (decision !== "approve" && decision !== "reject")) {
    return { error: "Ungültige Eingabe." };
  }

  try {
    await decideCorrection({
      correctionId,
      decidedById: admin.id,
      approve: decision === "approve",
      decisionNote,
    });
  } catch (e) {
    if (e instanceof CorrectionError) return { error: e.message };
    throw e;
  }

  revalidatePath("/admin/korrekturen");
  revalidatePath("/zeiten");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Admin marks a flagged remote clock-out as reviewed (#32). */
export async function markPunchReviewedAction(formData: FormData): Promise<void> {
  const admin = await requireActiveUser();
  if (admin.role !== "ADMIN") return;
  const eventId = String(formData.get("eventId") ?? "");
  if (!eventId) return;
  try {
    await markRemoteReviewed(eventId, admin.id);
  } catch (e) {
    // Already reviewed (e.g. in another tab) or gone: the refreshed list says so.
    if (!(e instanceof PunchReviewError)) throw e;
  }
  revalidatePath("/admin/korrekturen");
  revalidatePath("/admin/zeiten");
  revalidatePath("/zeiten");
}
