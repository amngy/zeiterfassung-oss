"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/session";
import {
  HolidayError,
  addGiftedHoliday,
  deleteHoliday,
  seedPublicHolidays,
} from "@/lib/holidays";
import { giftedHolidaySchema, seedHolidaysSchema } from "@/lib/validation/absence";

export interface HolidayFormState {
  ok?: boolean;
  message?: string;
  error?: string;
}

function refresh(): void {
  revalidatePath("/admin/feiertage");
  // Holidays affect every employee's expected hours and vacation counts.
  revalidatePath("/zeiten");
  revalidatePath("/dashboard");
  revalidatePath("/abwesenheit");
}

async function requireAdmin() {
  const admin = await requireActiveUser();
  if (admin.role !== "ADMIN") throw new Error("forbidden");
  return admin;
}

/** Seed (idempotently) the legal Feiertage for a region + year. */
export async function seedHolidaysAction(
  _prev: HolidayFormState | undefined,
  formData: FormData,
): Promise<HolidayFormState> {
  const admin = await requireAdmin();
  const parsed = seedHolidaysSchema.safeParse({
    bundesland: formData.get("bundesland"),
    year: formData.get("year"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  try {
    const res = await seedPublicHolidays(parsed.data.bundesland, parsed.data.year, admin.id);
    refresh();
    return {
      ok: true,
      message: `${res.created} Feiertage für ${res.region} ${res.year} angelegt${
        res.skipped > 0 ? ` (${res.skipped} bereits vorhanden)` : ""
      }.`,
    };
  } catch (e) {
    if (e instanceof HolidayError) return { error: e.message };
    throw e;
  }
}

/** Add a gifted / company holiday (Sonderfrei). */
export async function addGiftedHolidayAction(
  _prev: HolidayFormState | undefined,
  formData: FormData,
): Promise<HolidayFormState> {
  const admin = await requireAdmin();
  const parsed = giftedHolidaySchema.safeParse({
    date: formData.get("date"),
    name: formData.get("name"),
    fraction: formData.get("fraction"),
    recurringAnnually: formData.get("recurringAnnually") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  try {
    await addGiftedHoliday({
      dayKey: parsed.data.date,
      name: parsed.data.name,
      fraction: parsed.data.fraction,
      recurringAnnually: parsed.data.recurringAnnually,
      actorId: admin.id,
    });
    refresh();
    return { ok: true, message: "Sonderfrei-Tag hinzugefügt." };
  } catch (e) {
    if (e instanceof HolidayError) return { error: e.message };
    throw e;
  }
}

/** Remove a holiday (seeded or gifted). */
export async function deleteHolidayAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await deleteHoliday({ id, actorId: admin.id });
  } catch (e) {
    if (!(e instanceof HolidayError)) throw e;
  }
  refresh();
}
