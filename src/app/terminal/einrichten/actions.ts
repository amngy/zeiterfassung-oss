"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  pairTerminal,
  TerminalError,
  TERMINAL_COOKIE,
  TERMINAL_COOKIE_OPTIONS,
} from "@/lib/terminals";
import { clearSessionCookies } from "@/lib/session-cookies";

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
    const store = await cookies();
    // A shared device must not stay signed in as whoever set it up (often an
    // admin who copied the link here).
    clearSessionCookies(store);
    store.set(TERMINAL_COOKIE, cookieValue, TERMINAL_COOKIE_OPTIONS);
  } catch (e) {
    if (e instanceof TerminalError) return { error: e.message };
    throw e;
  }
  redirect("/terminal");
}
