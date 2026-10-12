"use server";

import { cookies } from "next/headers";
import { terminalForCookie, TERMINAL_COOKIE } from "@/lib/terminals";
import { KIOSK_ACTIONS, kioskPunch, type KioskAction, type KioskPunchResult } from "@/lib/kiosk-pin";

// Punch by name + PIN on a paired terminal (#11). The device cookie identifies
// the terminal; there is no user session here.

export type KioskPunchState = KioskPunchResult | { ok?: undefined };

export async function kioskPunchAction(_prev: KioskPunchState, formData: FormData): Promise<KioskPunchState> {
  const terminal = await terminalForCookie((await cookies()).get(TERMINAL_COOKIE)?.value);
  if (!terminal) return { ok: false, error: "Dieses Gerät ist nicht als Terminal gekoppelt." };

  const userId = String(formData.get("userId") ?? "").slice(0, 64);
  const pin = String(formData.get("pin") ?? "").slice(0, 16);
  const action = String(formData.get("action") ?? "");
  if (!userId || !(KIOSK_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, error: "Bitte Namen und Aktion wählen." };
  }
  return kioskPunch({ terminalId: terminal.id, userId, pin, action: action as KioskAction });
}
