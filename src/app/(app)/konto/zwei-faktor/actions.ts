"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/session";
import {
  TwoFactorError,
  beginEnrolment,
  cancelEnrolment,
  confirmEnrolment,
  disableTwoFactor,
  regenerateRecoveryCodes,
} from "@/lib/two-factor";

const PAGE = "/konto/zwei-faktor";

export interface TwoFactorState {
  error?: string;
  /** Freshly generated recovery codes — shown once, never stored in clear. */
  codes?: string[];
  message?: string;
}

export async function beginEnrolmentAction(): Promise<void> {
  const user = await requireActiveUser();
  await beginEnrolment(user.id);
  redirect(PAGE);
}

export async function cancelEnrolmentAction(): Promise<void> {
  const user = await requireActiveUser();
  await cancelEnrolment(user.id);
  redirect(PAGE);
}

async function run(fn: () => Promise<TwoFactorState>): Promise<TwoFactorState> {
  try {
    const state = await fn();
    revalidatePath("/", "layout");
    return state;
  } catch (e) {
    if (e instanceof TwoFactorError) return { error: e.message };
    throw e;
  }
}

const code = (formData: FormData) => String(formData.get("code") ?? "").trim();

export async function confirmEnrolmentAction(_prev: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  const user = await requireActiveUser();
  return run(async () => ({ codes: await confirmEnrolment(user.id, code(formData)) }));
}

export async function regenerateCodesAction(_prev: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  const user = await requireActiveUser();
  return run(async () => ({ codes: await regenerateRecoveryCodes(user.id, code(formData)) }));
}

export async function disableTwoFactorAction(_prev: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  const user = await requireActiveUser();
  return run(async () => {
    await disableTwoFactor(user.id, code(formData));
    return { message: "Die Zwei-Faktor-Anmeldung ist abgeschaltet." };
  });
}
