"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/session";
import {
  UserError,
  createUser,
  updateUserProfile,
  setUserSchedule,
  setUserActive,
  resetUserPassword,
} from "@/lib/users";
import { anonymizeUser } from "@/lib/dsgvo";
import { TwoFactorError, resetTwoFactor } from "@/lib/two-factor";
import { issueKioskPin, KioskPinError, removeKioskPin } from "@/lib/kiosk-pin";
import {
  createUserSchema,
  updateUserSchema,
  scheduleSchema,
  resetPasswordSchema,
  weekdayHoursSchema,
} from "@/lib/validation/user";

export interface FormState {
  ok?: boolean;
  message?: string;
  error?: string;
}

async function requireAdmin() {
  const admin = await requireActiveUser();
  if (admin.role !== "ADMIN") throw new Error("forbidden");
  return admin;
}

function refresh(userId?: string): void {
  revalidatePath("/admin/mitarbeitende");
  if (userId) revalidatePath(`/admin/mitarbeitende/${userId}`);
  revalidatePath("/admin/auswertung");
}

/** Read the seven sched_* weekday fields into a WeekdayHours-shaped object. */
function readSchedule(formData: FormData, prefix = "sched_") {
  return weekdayHoursSchema.safeParse({
    mon: formData.get(`${prefix}mon`),
    tue: formData.get(`${prefix}tue`),
    wed: formData.get(`${prefix}wed`),
    thu: formData.get(`${prefix}thu`),
    fri: formData.get(`${prefix}fri`),
    sat: formData.get(`${prefix}sat`),
    sun: formData.get(`${prefix}sun`),
  });
}

export async function createUserAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const sched = readSchedule(formData);
  if (!sched.success) return { error: "Arbeitszeiten: " + (sched.error.issues[0]?.message ?? "ungültig") };

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    bundesland: formData.get("bundesland") || "",
    birthDate: formData.get("birthDate") || "",
    employmentStart: formData.get("employmentStart") || "",
    employmentEnd: formData.get("employmentEnd") || "",
    isMinijob: formData.get("isMinijob") === "on",
    exemptFromTimeRecording: formData.get("exemptFromTimeRecording") === "on",
    exemptFromAutoBreak: formData.get("exemptFromAutoBreak") === "on",
    password: formData.get("password"),
    vacationDaysPerYear: formData.get("vacationDaysPerYear"),
    schedule: sched.data,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  let newId: string;
  try {
    newId = await createUser({ actorId: admin.id, ...parsed.data });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh(newId);
  redirect(`/admin/mitarbeitende/${newId}`);
}

export async function updateUserAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = updateUserSchema.safeParse({
    userId: formData.get("userId"),
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    bundesland: formData.get("bundesland") || "",
    birthDate: formData.get("birthDate") || "",
    employmentStart: formData.get("employmentStart") || "",
    employmentEnd: formData.get("employmentEnd") || "",
    isMinijob: formData.get("isMinijob") === "on",
    exemptFromTimeRecording: formData.get("exemptFromTimeRecording") === "on",
    exemptFromAutoBreak: formData.get("exemptFromAutoBreak") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  try {
    await updateUserProfile({ actorId: admin.id, ...parsed.data });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh(parsed.data.userId);
  return { ok: true, message: "Profil gespeichert." };
}

export async function setScheduleAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const sched = readSchedule(formData);
  if (!sched.success) return { error: "Arbeitszeiten: " + (sched.error.issues[0]?.message ?? "ungültig") };
  const parsed = scheduleSchema.safeParse({
    userId: formData.get("userId"),
    effectiveFrom: formData.get("effectiveFrom"),
    ...sched.data,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const { userId, effectiveFrom, ...hours } = parsed.data;
  try {
    await setUserSchedule({
      actorId: admin.id,
      userId,
      effectiveFrom,
      hours,
      note: (formData.get("note") as string) || undefined,
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh(userId);
  return { ok: true, message: "Arbeitszeit gespeichert." };
}

export async function resetPasswordAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = resetPasswordSchema.safeParse({
    userId: formData.get("userId"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  try {
    await resetUserPassword({ actorId: admin.id, ...parsed.data });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh(parsed.data.userId);
  return { ok: true, message: "Passwort zurückgesetzt." };
}

/** Activate / deactivate (form posts the desired target state). */
export async function toggleActiveAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!userId) return;
  try {
    await setUserActive({ actorId: admin.id, userId, active });
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    // Surface the guard message via a query flag on redirect.
    refresh(userId);
    redirect(`/admin/mitarbeitende/${userId}?fehler=${encodeURIComponent(e.message)}`);
  }
  refresh(userId);
}

/** Removes someone's second factor (lost phone); they set it up again (#14). */
export async function resetTwoFactorAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  try {
    await resetTwoFactor({ actorId: admin.id, userId });
  } catch (e) {
    if (!(e instanceof TwoFactorError)) throw e;
    redirect(`/admin/mitarbeitende/${userId}?fehler=${encodeURIComponent(e.message)}`);
  }
  refresh(userId);
  redirect(`/admin/mitarbeitende/${userId}?ok=1`);
}

export async function anonymizeUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!userId) return;
  if (confirm !== "ANONYMISIEREN") {
    redirect(`/admin/mitarbeitende/${userId}?fehler=${encodeURIComponent("Bitte zur Bestätigung ANONYMISIEREN eingeben.")}`);
  }
  try {
    await anonymizeUser({ actorId: admin.id, userId });
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    redirect(`/admin/mitarbeitende/${userId}?fehler=${encodeURIComponent(e.message)}`);
  }
  refresh(userId);
  redirect(`/admin/mitarbeitende/${userId}?ok=1`);
}

export interface KioskPinState {
  pin?: string;
  error?: string;
}

/** A new random terminal PIN (#11), shown once in the form. */
export async function issueKioskPinAction(_prev: KioskPinState, formData: FormData): Promise<KioskPinState> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  try {
    const pin = await issueKioskPin({ actorId: admin.id, userId });
    revalidatePath(`/admin/mitarbeitende/${userId}`);
    return { pin };
  } catch (e) {
    if (e instanceof KioskPinError) return { error: e.message };
    throw e;
  }
}

export async function removeKioskPinAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  await removeKioskPin({ actorId: admin.id, userId });
  refresh(userId);
  redirect(`/admin/mitarbeitende/${userId}?ok=1`);
}
