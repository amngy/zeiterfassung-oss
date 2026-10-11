"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AuthError, CredentialsSignin } from "next-auth";
import { signIn } from "@/auth";
import { safeInternalPath } from "@/lib/safe-redirect";

export interface LoginState {
  error?: string;
  /** Password accepted; the account needs its second factor (#14). */
  step?: "code";
  email?: string;
}

const CODE_ERRORS: Record<string, string | undefined> = {
  "2fa_required": undefined,
  "2fa_invalid": "Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.",
  "2fa_blocked": "Zu viele falsche Codes. Bitte in 15 Minuten erneut versuchen.",
};

export async function authenticate(
  _prev: LoginState | undefined,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") != null;
  const code = String(formData.get("code") ?? "").trim();

  try {
    await signIn("credentials", { email, password, code, redirect: false });
  } catch (error) {
    if (error instanceof CredentialsSignin && error.code in CODE_ERRORS) {
      return { step: "code", email, error: CODE_ERRORS[error.code] };
    }
    if (error instanceof AuthError) {
      // Generic message — never reveal whether the account exists.
      return {
        error: "E-Mail-Adresse oder Passwort ist falsch.",
        ...(code ? { step: "code" as const, email } : {}),
      };
    }
    throw error;
  }

  // "Angemeldet bleiben" unchecked → downgrade the 30-day persistent cookie to
  // an ephemeral session cookie that the browser drops when it closes.
  if (!remember) {
    await makeSessionCookieEphemeral();
  }

  // Re-validated here: the hidden field is client input.
  redirect(safeInternalPath(formData.get("next")) ?? "/dashboard");
}

async function makeSessionCookieEphemeral(): Promise<void> {
  const store = await cookies();
  const sessionCookie = store
    .getAll()
    .find((c) => c.name.endsWith("authjs.session-token"));
  if (!sessionCookie) return;
  store.set(sessionCookie.name, sessionCookie.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // no maxAge / expires → ephemeral session cookie
  });
}
