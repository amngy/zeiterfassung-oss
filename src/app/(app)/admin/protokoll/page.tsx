import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import { getAuditLog } from "@/lib/audit";
import {
  CATEGORY_META,
  toAuditRowView,
  type AuditCategory,
} from "@/lib/audit-format";
import { LogTable, type CategoryFilter } from "./log-table";

export const metadata: Metadata = { title: "Protokoll" };

// Order categories are offered in the filter bar (only non-empty ones show).
const CATEGORY_ORDER: AuditCategory[] = [
  "zeit",
  "korrektur",
  "abwesenheit",
  "konto",
  "feiertag",
  "einstellung",
  "system",
];

export default async function AuditLogPage() {
  await requireAdmin();
  const rows = (await getAuditLog(200)).map(toAuditRowView);

  const counts = new Map<AuditCategory, number>();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const filters: CategoryFilter[] = CATEGORY_ORDER.filter((c) => counts.has(c)).map(
    (c) => ({ key: c, label: CATEGORY_META[c].label, count: counts.get(c) ?? 0 }),
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-medium tracking-tight text-ink">Protokoll</h1>
        <p className="max-w-2xl text-sm text-muted">
          Wer hat wann was geändert – und warum. Jede Änderung an Zeiten,
          Abwesenheiten, Konten und Einstellungen wird hier verständlich
          festgehalten. Einträge werden nur angefügt und nie verändert oder
          gelöscht (revisionssicher).
        </p>
        {rows.length > 0 && (
          <p className="text-xs text-muted">
            {rows.length === 200
              ? "Die 200 neuesten Einträge"
              : `${rows.length} ${rows.length === 1 ? "Eintrag" : "Einträge"}`}
            , neueste zuerst.
          </p>
        )}
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] bg-surface px-4 py-12 text-center text-muted shadow-card">
          Noch keine Protokolleinträge. Sobald Zeiten, Abwesenheiten oder Konten
          bearbeitet werden, erscheinen die Änderungen hier.
        </div>
      ) : (
        <LogTable rows={rows} filters={filters} />
      )}
    </div>
  );
}
