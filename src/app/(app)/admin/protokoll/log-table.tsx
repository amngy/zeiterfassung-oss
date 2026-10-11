"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { InfoHint } from "@/components/ui/info-hint";
import { cn } from "@/lib/cn";
import type {
  AuditCategory,
  AuditRowView,
  BadgeTone,
} from "@/lib/audit-format";

export interface CategoryFilter {
  key: AuditCategory;
  label: string;
  count: number;
}

/** The change column: "before → after" (struck) or a single descriptive line. */
function Detail({ detail }: { detail: AuditRowView["detail"] }) {
  const { from, to, text } = detail;
  if (text) return <span className="text-ink">{text}</span>;
  if (!from && !to) return <span className="text-muted">—</span>;
  return (
    <span>
      {from && <span className="text-muted line-through">{from}</span>}
      {from && to && <span className="text-muted"> → </span>}
      {to && <span className="text-ink">{to}</span>}
    </span>
  );
}

export function LogTable({
  rows,
  filters,
}: {
  rows: AuditRowView[];
  filters: CategoryFilter[];
}) {
  const [active, setActive] = useState<AuditCategory | "all">("all");

  const visible = useMemo(
    () => (active === "all" ? rows : rows.filter((r) => r.category === active)),
    [rows, active],
  );

  const chipClass = (isActive: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      isActive
        ? "border-teal/30 bg-teal/10 text-teal"
        : "border-black/[0.08] bg-surface text-muted hover:text-ink",
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActive("all")}
          aria-pressed={active === "all"}
          className={chipClass(active === "all")}
        >
          Alle ({rows.length})
        </button>
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setActive(f.key)}
            aria-pressed={active === f.key}
            className={chipClass(active === f.key)}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06] text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1">Zeitpunkt <InfoHint>{`Zeitpunkt der Aktion in deutscher Zeit (Europe/Berlin), unabhängig vom Standort des Nutzers. Datum und Uhrzeit stammen vom Server, nicht vom Gerät.`}</InfoHint></span></th>
              <th className="px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1">Vorgang <InfoHint>{`Art der Aktion (farbiges Etikett) und darunter die Kategorie. Rote Etiketten kennzeichnen entfernende oder deaktivierende Vorgänge (z. B. Ablehnung, Konto deaktivieren, Anonymisierung, Feiertag entfernen).`}</InfoHint></span></th>
              <th className="px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1">Wer <InfoHint>{`Person, die die Aktion ausgeführt hat (nicht die betroffene Person). 'System' erscheint bei automatischen Vorgängen ohne angemeldete:n Nutzer:in.`}</InfoHint></span></th>
              <th className="px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1">Betroffen <InfoHint>{`Mitarbeiter:in, um die es im Eintrag geht (nicht die ausführende Person). Bei Feiertagen steht hier der Name des Feiertags; '—' wenn kein Bezug ermittelbar ist.`}</InfoHint></span></th>
              <th className="px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1">Was geändert wurde <InfoHint>{`Zeigt die Änderung: der durchgestrichene Wert ist der alte Stand, der Wert nach dem Pfeil der neue. Manche Vorgänge zeigen stattdessen eine kurze Beschreibung; '—' bedeutet keine Detaildaten.`}</InfoHint></span></th>
              <th className="px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1">Grund <InfoHint>{`Begründung, die bei der Aktion angegeben wurde. '—' erscheint, wenn keine Begründung gespeichert ist.`}</InfoHint></span></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  Keine Einträge in dieser Kategorie.
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.id} className="border-b border-black/[0.04] align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    <div className="text-ink">{r.dateLabel}</div>
                    <div className="text-xs">{r.timeLabel} Uhr</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={r.tone}>{r.actionLabel}</Badge>
                    <div className="mt-1 text-xs text-muted">{r.categoryLabel}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink">{r.actorName}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink">
                    {r.subjectName ?? <span className="text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Detail detail={r.detail} />
                  </td>
                  <td className="px-4 py-3 text-muted">{r.reason ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
