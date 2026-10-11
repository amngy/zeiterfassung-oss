"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export interface LoginState {
  error?: string;
}

export async function authenticate(
  _prev: LoginState | undefined,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") != null;

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // Generic message — never reveal whether the account exists.
      return { error: "E-Mail-Adresse oder Passwort ist falsch." };
    }
    throw error;
  }

  // "Angemeldet bleiben" unchecked → downgrade the 30-day persistent cookie to
  // an ephemeral session cookie that the browser drops when it closes.
  if (!remember) {
    await makeSessionCookieEphemeral();
  }

  redirect("/dashboard");
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
