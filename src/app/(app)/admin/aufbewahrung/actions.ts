"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/session";
import { UserError } from "@/lib/users";
import { purgeExpiredRecords, totalRecords, type PurgeResult } from "@/lib/retention";

const PAGE = "/admin/aufbewahrung";

/** Deletes everything past its retention period (#17). Typed confirmation. */
export async function purgeExpiredAction(formData: FormData): Promise<void> {
  const admin = await requireActiveUser();
  if (admin.role !== "ADMIN") throw new Error("forbidden");
  if (String(formData.get("confirm") ?? "").trim() !== "LÖSCHEN") {
    redirect(`${PAGE}?fehler=${encodeURIComponent("Bitte zur Bestätigung LÖSCHEN eingeben.")}`);
  }

  let result: PurgeResult;
  try {
    result = await purgeExpiredRecords(admin.id);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    redirect(`${PAGE}?fehler=${encodeURIComponent(e.message)}`);
  }
  // Every list and report may have shown deleted rows.
  revalidatePath("/", "layout");
  redirect(
    `${PAGE}?geloescht=${totalRecords(result.counts)}&geraete=${result.counts.deviceLabels}&anonymisiert=${result.anonymized}`,
  );
}
