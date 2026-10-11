"use server";

import { requireActiveUser } from "@/lib/session";
import { changeOwnPassword, UserError } from "@/lib/users";
import { changePasswordSchema } from "@/lib/validation/user";

export interface AccountState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/** Signed-in user changes their own password (verifies the current one first). */
export async function changePasswordAction(
  _prev: AccountState | undefined,
  formData: FormData,
): Promise<AccountState> {
  const user = await requireActiveUser();
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  try {
    await changeOwnPassword({
      userId: user.id,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  return { ok: true, message: "Passwort geändert." };
}
