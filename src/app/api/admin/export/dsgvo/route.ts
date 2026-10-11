// DSGVO Art. 15 (Auskunft) — full personal-data export for one subject, as JSON.
//   GET /api/admin/export/dsgvo?user=<id>

import { requireAdminApi, attachment } from "@/lib/admin-api";
import { prisma } from "@/lib/db";
import { exportUserDataBytes } from "@/lib/dsgvo";
import { UserError } from "@/lib/users";

export async function GET(req: Request): Promise<Response> {
  const guard = await requireAdminApi();
  if (guard instanceof Response) return guard;

  const url = new URL(req.url);
  const userId = url.searchParams.get("user") ?? "";
  if (!userId) return new Response("Parameter user fehlt.", { status: 400 });

  let bytes: Uint8Array;
  try {
    bytes = await exportUserDataBytes(userId);
  } catch (e) {
    if (e instanceof UserError) return new Response(e.message, { status: 404 });
    throw e;
  }

  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": attachment(`DSGVO_Auskunft_${u?.name ?? userId}.json`),
    },
  });
}
