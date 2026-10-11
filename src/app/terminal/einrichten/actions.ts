"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pairTerminal, TerminalError, TERMINAL_COOKIE } from "@/lib/terminals";

export interface PairState {
  error?: string;
}

/**
 * Pair THIS device as a terminal. A button press rather than the link itself,
 * so a link preview or prefetch can never spend the one-time code.
 */
export async function pairTerminalAction(
  _prev: PairState | undefined,
  formData: FormData,
): Promise<PairState> {
  const code = String(formData.get("code") ?? "");
  try {
    const { cookieValue } = await pairTerminal(code);
    (await cookies()).set(TERMINAL_COOKIE, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/terminal",
      maxAge: 400 * 24 * 60 * 60,
    });
  } catch (e) {
    if (e instanceof TerminalError) return { error: e.message };
    throw e;
  }
  redirect("/terminal");
}
