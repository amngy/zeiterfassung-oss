"use server";

import { revalidatePath } from "next/cache";
import * as clock from "@/lib/clock";
import type { ClockResult, PunchContext } from "@/lib/clock";
import { punchDeviceLabel } from "@/lib/request-context";
import { requireActiveUser } from "@/lib/session";

// Thin server-action wrappers around @/lib/clock, which holds the punch logic,
// its integrity guards and the ClockEvent record. Every punch from here arrives
// through a browser, so the channel is WEB; the device type is recorded only
// when the operator has switched it on (Einstellungen → Stempeln).

export type { ClockResult };

async function webContext(): Promise<PunchContext> {
  return { channel: "WEB", deviceLabel: await punchDeviceLabel() };
}

function done(result: ClockResult): ClockResult {
  if (result.ok) {
    revalidatePath("/zeiten");
    revalidatePath("/dashboard");
  }
  return result;
}

/** Begin a work session. */
export async function clockIn(): Promise<ClockResult> {
  const user = await requireActiveUser();
  return done(await clock.clockIn(user.id, await webContext()));
}

/** End the current work session. */
export async function clockOut(): Promise<ClockResult> {
  const user = await requireActiveUser();
  return done(await clock.clockOut(user.id, await webContext()));
}

/** Start a break within the current work session. */
export async function startBreak(): Promise<ClockResult> {
  const user = await requireActiveUser();
  return done(await clock.startBreak(user.id, await webContext()));
}

/** End the current break. */
export async function endBreak(): Promise<ClockResult> {
  const user = await requireActiveUser();
  return done(await clock.endBreak(user.id, await webContext()));
}
