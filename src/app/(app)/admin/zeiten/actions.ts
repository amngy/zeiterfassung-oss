"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { requireActiveUser } from "@/lib/session";
import { BUSINESS_TZ } from "@/lib/time";
import { adminCorrectEntry, adminRemoveEntry, CorrectionError } from "@/lib/corrections";

export interface EntryEditState {
  ok?: boolean;
  error?: string;
  /** Echoed so the list can show the result next to the right entry. */
  entryId?: string;
}

/**
 * Parse a Berlin wall-clock "YYYY-MM-DDTHH:mm" into an instant, rejecting times
 * that don't exist or are ambiguous because of the DST switch. Same round-trip
 * check the employee correction form uses — an admin override may skip the
 * approval queue and the period lock, but it may not invent a wall-clock time
 * that never happened.
 */
function berlinInstant(local: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) {
    throw new CorrectionError(`${label}: bitte Datum und Uhrzeit angeben.`);
  }
  const instant = fromZonedTime(local, BUSINESS_TZ);
  if (formatInTimeZone(instant, BUSINESS_TZ, "yyyy-MM-dd'T'HH:mm") !== local) {
    throw new CorrectionError(
      `${label}: Diese Uhrzeit existiert an diesem Tag wegen der Zeitumstellung nicht oder ist mehrdeutig.`,
    );
  }
  return instant;
}

/**
 * Admin overrides a recorded time directly — no request, no approval, and not
 * bound by the period lock (correctionPolicy.lockAfterDays), which exists to
 * stop EMPLOYEES from reaching into a settled month. This is the deliberate
 * escape hatch for times that are simply wrong in the books and that nobody else
 * can fix: a 00:00 start from a mistyped backfill, a shift that ran past
 * midnight because the clock-out was forgotten, an import artefact.
 *
 * "Forceful" stops at the audit trail, not before it:
 *  - the original row is never touched — it is marked SUPERSEDED and the new
 *    version points back at it, so the previous value stays readable forever;
 *  - a reason is mandatory and is written to the append-only AuditLog under
 *    `timeentry.correct`, together with the old and the new interval, so the
 *    Protokoll shows exactly what an admin changed, when, and why.
 */
export async function adminCorrectEntryAction(
  _prev: EntryEditState | undefined,
  formData: FormData,
): Promise<EntryEditState> {
  const admin = await requireActiveUser();
  if (admin.role !== "ADMIN") return { error: "Nicht berechtigt." };

  const entryId = String(formData.get("entryId") ?? "").trim();
  const subjectUserId = String(formData.get("subjectUserId") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!entryId || !subjectUserId) return { error: "Kein Eintrag ausgewählt." };
  if (type !== "WORK" && type !== "BREAK") return { error: "Ungültige Art." };
  if (reason.length < 3) {
    return { entryId, error: "Bitte einen nachvollziehbaren Grund angeben (mind. 3 Zeichen)." };
  }
  if (reason.length > 500) return { entryId, error: "Höchstens 500 Zeichen." };

  try {
    const start = berlinInstant(String(formData.get("start") ?? "").trim(), "Beginn");
    const end = berlinInstant(String(formData.get("end") ?? "").trim(), "Ende");
    if (end.getTime() <= start.getTime()) {
      return { entryId, error: "Das Ende muss nach dem Beginn liegen." };
    }

    await adminCorrectEntry({
      subjectUserId,
      proposed: { type, start, end, timeEntryId: entryId },
      actorId: admin.id,
      reason,
    });
  } catch (e) {
    if (e instanceof CorrectionError) return { entryId, error: e.message };
    throw e;
  }

  revalidatePath("/admin/zeiten");
  revalidatePath("/admin/protokoll");
  revalidatePath("/zeiten");
  revalidatePath("/dashboard");
  return { ok: true, entryId };
}

/**
 * Take a recorded time out of the reckoning ("löschen" in the UI).
 *
 * Needed as its own action because correcting is not always enough: where a day
 * carries duplicate entries — the same shift recorded two or three times — every
 * correction of one of them collides with its twins, so the only way to a clean
 * day is to drop the surplus rows. The row itself is kept and marked as
 * replaced, and the reason goes into the append-only log.
 */
export async function adminRemoveEntryAction(
  _prev: EntryEditState | undefined,
  formData: FormData,
): Promise<EntryEditState> {
  const admin = await requireActiveUser();
  if (admin.role !== "ADMIN") return { error: "Nicht berechtigt." };

  const entryId = String(formData.get("entryId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!entryId) return { error: "Kein Eintrag ausgewählt." };

  try {
    await adminRemoveEntry({ entryId, actorId: admin.id, reason });
  } catch (e) {
    if (e instanceof CorrectionError) return { entryId, error: e.message };
    throw e;
  }

  revalidatePath("/admin/zeiten");
  revalidatePath("/admin/protokoll");
  revalidatePath("/zeiten");
  revalidatePath("/dashboard");
  return { ok: true, entryId };
}
