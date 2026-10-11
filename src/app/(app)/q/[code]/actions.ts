"use server";

import { revalidatePath } from "next/cache";
import * as clock from "@/lib/clock";
import type { ClockResult, PunchContext } from "@/lib/clock";
import { punchDeviceLabel } from "@/lib/request-context";
import { requireActiveUser } from "@/lib/session";
import { activeTerminalForCode } from "@/lib/terminals";

// Punches from a scanned terminal code (channel QR). The code is checked again
// here, at the moment of the punch — the page only showed it was valid then.
// `code` arrives from the client (a bound argument), so it is untrusted input.

type Punch = (userId: string, ctx: PunchContext) => Promise<ClockResult>;

async function punchViaCode(code: unknown, punch: Punch): Promise<ClockResult> {
  const user = await requireActiveUser();
  const terminal = typeof code === "string" ? await activeTerminalForCode(code) : null;
  if (!terminal) {
    return { ok: false, error: "Der Code ist abgelaufen. Bitte am Terminal erneut scannen." };
  }
  const result = await punch(user.id, {
    channel: "QR",
    deviceLabel: await punchDeviceLabel(),
    terminalId: terminal.id,
  });
  if (result.ok) {
    // The clock card re-renders in place with the new state.
    revalidatePath("/q/[code]", "page");
    revalidatePath("/zeiten");
    revalidatePath("/dashboard");
  }
  return result;
}

export async function qrClockIn(code: string): Promise<ClockResult> {
  return punchViaCode(code, clock.clockIn);
}

export async function qrClockOut(code: string): Promise<ClockResult> {
  return punchViaCode(code, clock.clockOut);
}

export async function qrStartBreak(code: string): Promise<ClockResult> {
  return punchViaCode(code, clock.startBreak);
}

export async function qrEndBreak(code: string): Promise<ClockResult> {
  return punchViaCode(code, clock.endBreak);
}
