"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { requireActiveUser } from "@/lib/session";
import { setSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  generalSettingsSchema,
  ruleProfileSchema,
  breakPolicySchema,
  correctionPolicySchema,
  punchPolicySchema,
} from "@/lib/validation/settings";

// Every save below writes its setting(s) AND its audit record inside a single
// prisma.$transaction.
//
// Previously the general form fanned its seven upserts out over `Promise.all`
// (i.e. seven separate transactions) and then wrote the audit row in an eighth.
// A rejection anywhere in that fan-out made Promise.all reject with some of the
// settings already COMMITTED and no audit row written at all: the company was
// left running on a half-applied rule set — say a new carry-over cut-off but the
// old retention period — with nothing in the append-only trail to say it had
// happened or who did it. In a system whose whole premise is a revisionssicher
// audit trail, an unrecorded partial write is the worst of the failure modes.
// One transaction per action makes each save all-or-nothing and always audited.
//
// The upserts are awaited sequentially rather than with Promise.all: an
// interactive transaction is a single connection, so concurrent writes on it
// would only queue anyway, and firing several upserts against the same table at
// once is a needless deadlock risk.

export interface SettingsState {
  ok?: boolean;
  message?: string;
  error?: string;
  section?: string;
}

async function requireAdmin() {
  const admin = await requireActiveUser();
  if (admin.role !== "ADMIN") throw new Error("forbidden");
  return admin;
}

function refresh(): void {
  revalidatePath("/admin/einstellungen");
}

function num(formData: FormData, key: string): unknown {
  return formData.get(key);
}

/** Company-wide parameters (each stored as its own top-level Setting key). */
export async function saveGeneralAction(
  _prev: SettingsState | undefined,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireAdmin();
  const parsed = generalSettingsSchema.safeParse({
    companyName: formData.get("companyName"),
    defaultBundesland: formData.get("defaultBundesland"),
    defaultVacationDays: num(formData, "defaultVacationDays"),
    carryOverCutoffMonth: num(formData, "carryOverCutoffMonth"),
    carryOverCutoffDay: num(formData, "carryOverCutoffDay"),
    retentionYears: num(formData, "retentionYears"),
    auRequiredFromDay: num(formData, "auRequiredFromDay"),
  });
  if (!parsed.success) return { section: "general", error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const d = parsed.data;
  await prisma.$transaction(async (tx) => {
    await setSetting("companyName", d.companyName, tx);
    await setSetting("defaultBundesland", d.defaultBundesland, tx);
    await setSetting("defaultVacationDays", d.defaultVacationDays, tx);
    await setSetting("carryOverCutoffMonth", d.carryOverCutoffMonth, tx);
    await setSetting("carryOverCutoffDay", d.carryOverCutoffDay, tx);
    await setSetting("retentionYears", d.retentionYears, tx);
    await setSetting("auRequiredFromDay", d.auRequiredFromDay, tx);
    await audit(tx, admin.id, "settings.general", d);
  });
  refresh();
  return { section: "general", ok: true, message: "Allgemeine Einstellungen gespeichert." };
}

function readRuleProfile(formData: FormData) {
  return ruleProfileSchema.safeParse({
    capMode: formData.get("capMode"),
    maxHoursPerDay: num(formData, "maxHoursPerDay"),
    standardHoursPerDay: num(formData, "standardHoursPerDay"),
    maxHoursPerWeek: num(formData, "maxHoursPerWeek"),
    break1AfterHours: num(formData, "break1AfterHours"),
    break1Minutes: num(formData, "break1Minutes"),
    break2AfterHours: num(formData, "break2AfterHours"),
    break2Minutes: num(formData, "break2Minutes"),
    minRestHours: num(formData, "minRestHours"),
    blockOnViolation: formData.get("blockOnViolation") === "on",
  });
}

export async function saveRuleProfileAction(
  _prev: SettingsState | undefined,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireAdmin();
  const parsed = readRuleProfile(formData);
  if (!parsed.success) return { section: "ruleProfile", error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  await prisma.$transaction(async (tx) => {
    await setSetting("ruleProfile", parsed.data, tx);
    await audit(tx, admin.id, "settings.ruleProfile", parsed.data);
  });
  refresh();
  return { section: "ruleProfile", ok: true, message: "Regelprofil gespeichert." };
}

export async function saveMinorRuleProfileAction(
  _prev: SettingsState | undefined,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireAdmin();
  const parsed = readRuleProfile(formData);
  if (!parsed.success) return { section: "minorRuleProfile", error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  await prisma.$transaction(async (tx) => {
    await setSetting("minorRuleProfile", parsed.data, tx);
    await audit(tx, admin.id, "settings.minorRuleProfile", parsed.data);
  });
  refresh();
  return { section: "minorRuleProfile", ok: true, message: "Jugend-Regelprofil gespeichert." };
}

export async function saveBreakPolicyAction(
  _prev: SettingsState | undefined,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireAdmin();
  const parsed = breakPolicySchema.safeParse({
    enabled: formData.get("enabled") === "on",
    fixedMinutes: num(formData, "fixedMinutes"),
    unfinishedBreakMinutes: num(formData, "unfinishedBreakMinutes"),
  });
  if (!parsed.success) return { section: "breakPolicy", error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  await prisma.$transaction(async (tx) => {
    await setSetting("breakPolicy", parsed.data, tx);
    await audit(tx, admin.id, "settings.breakPolicy", parsed.data);
  });
  refresh();
  return { section: "breakPolicy", ok: true, message: "Pausenautomatik gespeichert." };
}

export async function saveCorrectionPolicyAction(
  _prev: SettingsState | undefined,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireAdmin();
  const parsed = correctionPolicySchema.safeParse({
    allowSelfCreate: formData.get("allowSelfCreate") === "on",
    selfCorrectionRequiresApproval: formData.get("selfCorrectionRequiresApproval") === "on",
    lockAfterDays: num(formData, "lockAfterDays"),
    autoLockOnMonthExport: formData.get("autoLockOnMonthExport") === "on",
  });
  if (!parsed.success) return { section: "correctionPolicy", error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  await prisma.$transaction(async (tx) => {
    await setSetting("correctionPolicy", parsed.data, tx);
    await audit(tx, admin.id, "settings.correctionPolicy", parsed.data);
  });
  refresh();
  return { section: "correctionPolicy", ok: true, message: "Governance-Einstellungen gespeichert." };
}

export async function savePunchPolicyAction(
  _prev: SettingsState | undefined,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireAdmin();
  const parsed = punchPolicySchema.safeParse({
    recordDeviceType: formData.get("recordDeviceType") === "on",
  });
  if (!parsed.success) return { section: "punchPolicy", error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  await prisma.$transaction(async (tx) => {
    await setSetting("punchPolicy", parsed.data, tx);
    await audit(tx, admin.id, "settings.punchPolicy", parsed.data);
  });
  refresh();
  return { section: "punchPolicy", ok: true, message: "Stempel-Einstellungen gespeichert." };
}

async function audit(
  db: Prisma.TransactionClient,
  actorId: string,
  action: string,
  value: unknown,
): Promise<void> {
  await writeAudit(db, {
    actorUserId: actorId,
    action,
    targetType: "Setting",
    newValue: value as Prisma.InputJsonObject,
  });
}
