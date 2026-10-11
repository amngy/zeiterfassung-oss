// Guard for admin-only API route handlers (file exports). Unlike the page guards
// in @/lib/session, these return a Response on failure instead of redirecting,
// and re-validate the account against the DB (defends a stale JWT).

import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export interface AdminApiResult {
  ok: true;
  adminId: string;
}

/** Returns the admin id, or a 401/403 Response to return directly. */
export async function requireAdminApi(): Promise<AdminApiResult | Response> {
  const session = await auth();
  if (!session?.user) {
    return new Response("Nicht angemeldet.", { status: 401 });
  }
  const fresh = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { active: true, role: true },
  });
  if (!fresh || !fresh.active || fresh.role !== "ADMIN") {
    return new Response("Kein Zugriff.", { status: 403 });
  }
  return { ok: true, adminId: session.user.id };
}

/** ASCII-safe filename for Content-Disposition (umlauts → ASCII, spaces → _). */
export function safeFilename(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
      .replace(/ß/g, "ss")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "export"
  );
}

/** A Content-Disposition value with both ASCII and UTF-8 (RFC 5987) filenames. */
export function attachment(filename: string): string {
  const ascii = safeFilename(filename);
  const utf8 = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
