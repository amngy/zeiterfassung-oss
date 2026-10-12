"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { requireActiveUser } from "@/lib/session";
import { requestOrigin } from "@/lib/request-context";
import {
  createTerminal,
  issuePairCode,
  PAIR_TTL_MS,
  setTerminalActive,
  TerminalError,
} from "@/lib/terminals";
import { setTerminalPinAllowed } from "@/lib/kiosk-pin";

export interface PairLink {
  label: string;
  url: string;
  svg: string;
  expiresAtISO: string;
}

export interface TerminalFormState {
  ok?: boolean;
  error?: string;
  pair?: PairLink;
}

async function requireAdmin() {
  const admin = await requireActiveUser();
  if (admin.role !== "ADMIN") throw new Error("forbidden");
  return admin;
}

async function pairLink(label: string, code: string): Promise<PairLink> {
  const url = `${await requestOrigin()}/terminal/einrichten?code=${encodeURIComponent(code)}`;
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return { label, url, svg, expiresAtISO: new Date(Date.now() + PAIR_TTL_MS).toISOString() };
}

/** Register a terminal and hand back its first pairing link. */
export async function createTerminalAction(
  _prev: TerminalFormState | undefined,
  formData: FormData,
): Promise<TerminalFormState> {
  const admin = await requireAdmin();
  const label = String(formData.get("label") ?? "");
  try {
    const { pairCode } = await createTerminal(label, admin.id);
    revalidatePath("/admin/terminals");
    return { ok: true, pair: await pairLink(label.trim(), pairCode) };
  } catch (e) {
    if (e instanceof TerminalError) return { error: e.message };
    throw e;
  }
}

/** A new pairing link for an existing terminal (new or replaced device). */
export async function pairCodeAction(
  _prev: TerminalFormState | undefined,
  formData: FormData,
): Promise<TerminalFormState> {
  const admin = await requireAdmin();
  const terminalId = String(formData.get("terminalId") ?? "");
  const label = String(formData.get("label") ?? "");
  try {
    const pairCode = await issuePairCode(terminalId, admin.id);
    revalidatePath("/admin/terminals");
    return { ok: true, pair: await pairLink(label, pairCode) };
  } catch (e) {
    if (e instanceof TerminalError) return { error: e.message };
    throw e;
  }
}

export async function setTerminalActiveAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  await setTerminalActive(
    String(formData.get("terminalId") ?? ""),
    formData.get("active") === "true",
    admin.id,
  );
  revalidatePath("/admin/terminals");
}

/** Switch punching by name + PIN on or off for one terminal (#11). */
export async function setTerminalPinAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  await setTerminalPinAllowed(String(formData.get("terminalId") ?? ""), formData.get("allowPin") === "true", admin.id);
  revalidatePath("/admin/terminals");
}
