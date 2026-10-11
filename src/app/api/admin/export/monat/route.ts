// Monthly per-employee export (payroll-ready) — CSV or PDF.
//   GET /api/admin/export/monat?user=<id>&monat=YYYY-MM&format=csv|pdf

import { requireAdminApi, attachment } from "@/lib/admin-api";
import { buildMonthlyReport } from "@/lib/exports/report";
import { monthlyReportCsv, csvBytes } from "@/lib/exports/csv";
import { monthlyReportPdf } from "@/lib/exports/pdf";

export async function GET(req: Request): Promise<Response> {
  const guard = await requireAdminApi();
  if (guard instanceof Response) return guard;

  const url = new URL(req.url);
  const userId = url.searchParams.get("user") ?? "";
  const monthKey = url.searchParams.get("monat") ?? "";
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";

  if (!userId || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return new Response("Ungültige Parameter (user, monat=YYYY-MM).", { status: 400 });
  }

  const report = await buildMonthlyReport(userId, monthKey, new Date());
  if (!report) return new Response("Konto nicht gefunden.", { status: 404 });

  const base = `Zeitnachweis_${report.user.name}_${monthKey}`;

  if (format === "pdf") {
    const bytes = await monthlyReportPdf(report);
    return new Response(bytes as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": attachment(`${base}.pdf`),
      },
    });
  }

  const bytes = csvBytes(monthlyReportCsv(report));
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachment(`${base}.csv`),
    },
  });
}
