// Raw recorded-entries CSV for a month — whole company or one employee.
//   GET /api/admin/export/roh?monat=YYYY-MM[&user=<id>][&versionen=1]
// With versionen=1 the file also holds the versions replaced by corrections
// and removed entries (status "ersetzt"), not only the ACTIVE ones.

import { requireAdminApi, attachment } from "@/lib/admin-api";
import { prisma } from "@/lib/db";
import { loadRawEntries } from "@/lib/exports/report";
import { rawEntriesCsv, csvBytes } from "@/lib/exports/csv";
import { monthRangeOf } from "@/lib/time";

export async function GET(req: Request): Promise<Response> {
  const guard = await requireAdminApi();
  if (guard instanceof Response) return guard;

  const url = new URL(req.url);
  const monthKey = url.searchParams.get("monat") ?? "";
  const userId = url.searchParams.get("user") ?? "";
  const withVersions = url.searchParams.get("versionen") === "1";
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return new Response("Ungültiger Monat (monat=YYYY-MM).", { status: 400 });
  }

  const { from, to } = monthRangeOf(`${monthKey}-01`);
  const rows = await loadRawEntries(from, to, { userId: userId || undefined, includeSuperseded: withVersions });

  let scope = "alle";
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    scope = u?.name ?? "unbekannt";
  }

  const bytes = csvBytes(rawEntriesCsv(rows));
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachment(`Rohdaten_${scope}_${monthKey}${withVersions ? "_mit-Versionen" : ""}.csv`),
    },
  });
}
