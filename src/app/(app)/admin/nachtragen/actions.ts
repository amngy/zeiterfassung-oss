"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/session";
import {
  BatchEntryError,
  applyBatch,
  previewBatch,
  revertBatch,
  type BatchInput,
  type BatchPreview,
} from "@/lib/batch-entry";

export interface BatchState {
  ok?: boolean;
  error?: string;
  message?: string;
  preview?: BatchPreview;
  /** Echoed back so the confirm step re-submits the exact same parameters. */
  input?: BatchInput;
}

async function requireAdmin() {
  const admin = await requireActiveUser();
  if (admin.role !== "ADMIN") throw new Error("forbidden");
  return admin;
}

function refresh(): void {
  revalidatePath("/admin/nachtragen");
  revalidatePath("/admin/zeiten");
  revalidatePath("/zeiten");
  revalidatePath("/dashboard");
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function readInput(formData: FormData): BatchInput {
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const fromKey = s("fromKey");
  const toKey = s("toKey");
  if (!DAY_KEY.test(fromKey) || !DAY_KEY.test(toKey)) {
    throw new BatchEntryError("Bitte gültige Datumswerte angeben.");
  }
  // The checkbox decides whether a break is recorded at all; unchecked means the
  // days are backfilled without any BREAK entry, whatever the (disabled) time
  // fields still contain.
  const withBreak = formData.get("withBreak") !== null;
  const breakStartTime = withBreak ? s("breakStartTime") || null : null;
  const breakEndTime = withBreak ? s("breakEndTime") || null : null;
  if (withBreak && !(breakStartTime && breakEndTime)) {
    throw new BatchEntryError(
      "Bitte Pausenbeginn und Pausenende angeben — oder „Pause eintragen“ abwählen, um ohne Pause nachzutragen.",
    );
  }
  return {
    userId: s("userId"),
    fromKey,
    toKey,
    startTime: s("startTime"),
    endTime: s("endTime"),
    breakStartTime,
    breakEndTime,
    skipHolidays: formData.get("skipHolidays") !== null,
    skipAbsences: formData.get("skipAbsences") !== null,
    onlyContractedDays: formData.get("onlyContractedDays") !== null,
  };
}

/** Step 1 — show exactly what would be written. Reads only. */
export async function previewBatchAction(
  _prev: BatchState | undefined,
  formData: FormData,
): Promise<BatchState> {
  await requireAdmin();
  try {
    const input = readInput(formData);
    const preview = await previewBatch(input);
    return { ok: true, preview, input };
  } catch (e) {
    if (e instanceof BatchEntryError) return { error: e.message };
    throw e;
  }
}

/** Step 2 — write the batch. Re-previews server-side; the browser cannot lie. */
export async function applyBatchAction(
  _prev: BatchState | undefined,
  formData: FormData,
): Promise<BatchState> {
  const admin = await requireAdmin();
  try {
    const input = readInput(formData);
    const reason = String(formData.get("reason") ?? "").trim();
    const expectedDayCount = Number(formData.get("expectedDayCount") ?? -1);
    const res = await applyBatch({ input, actorId: admin.id, reason, expectedDayCount });
    refresh();
    return {
      ok: true,
      message: `${res.written} Tag(e) nachgetragen, ${res.skipped} übersprungen. Sammel-Kennung: ${res.batchId}`,
    };
  } catch (e) {
    if (e instanceof BatchEntryError) return { error: e.message };
    throw e;
  }
}

/** Undo a batch — marks its rows SUPERSEDED, never deletes them. */
export async function revertBatchAction(
  _prev: BatchState | undefined,
  formData: FormData,
): Promise<BatchState> {
  const admin = await requireAdmin();
  try {
    const res = await revertBatch({
      batchId: String(formData.get("batchId") ?? "").trim(),
      actorId: admin.id,
      reason: String(formData.get("reason") ?? "").trim(),
    });
    refresh();
    return { ok: true, message: `${res.reverted} Eintrag/Einträge zurückgenommen.` };
  } catch (e) {
    if (e instanceof BatchEntryError) return { error: e.message };
    throw e;
  }
}
