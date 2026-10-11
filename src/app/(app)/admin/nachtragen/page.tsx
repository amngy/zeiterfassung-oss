import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getRecentBatches } from "@/lib/batch-entry";
import { addDaysToKey, berlinDayKey, formatDayKey } from "@/lib/time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoHint } from "@/components/ui/info-hint";
import { BatchForm } from "./batch-form";
import { RevertBatchForm } from "./revert-form";

export const metadata: Metadata = { title: "Zeiten nachtragen" };

export default async function NachtragenPage() {
  await requireAdmin();

  const [employees, batches] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, active: true },
    }),
    getRecentBatches(15),
  ]);

  const todayKey = berlinDayKey(new Date());
  const defaultTo = addDaysToKey(todayKey, -1);
  const defaultFrom = addDaysToKey(todayKey, -7);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-ink">Zeiten nachtragen</h1>
        <p className="text-sm text-muted">
          Sammel-Nachtrag von Arbeitszeiten für zurückliegende Tage — mit Vorschau,
          Begründungspflicht und vollständiger Protokollierung.
        </p>
      </header>

      <div className="rounded-xl border border-teal/20 bg-surface px-4 py-3 text-sm text-ink">
        <p className="font-medium">Wie dieser Nachtrag arbeitet</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted">
          <li>
            Es wird <strong>nie etwas überschrieben</strong>. Tage, an denen bereits eine
            Zeit erfasst ist, werden übersprungen und in der Vorschau aufgeführt.
          </li>
          <li>
            Es werden <strong>nur zurückliegende Tage</strong> erfasst — der heutige Tag
            und die Zukunft bleiben ausgenommen.
          </li>
          <li>
            Jeder erzeugte Eintrag ist ein <strong>manueller Eintrag mit Ihrer Kennung</strong>,
            trägt den angegebenen Grund und steht im Änderungsprotokoll.
          </li>
          <li>
            Der gesamte Vorgang erhält eine <strong>Sammel-Kennung</strong> und kann darüber
            wieder zurückgenommen werden (die Einträge werden dann als ersetzt markiert,
            nicht gelöscht).
          </li>
        </ul>
      </div>

      <BatchForm employees={employees} defaultFrom={defaultFrom} defaultTo={defaultTo} />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Letzte Sammel-Nachträge</CardTitle>
            <InfoHint>{`Alle über diese Seite durchgeführten Sammel-Nachträge. „Aktiv" zeigt, wie viele der erzeugten Einträge derzeit noch gewertet werden — nach einer Rücknahme ist der Wert 0.`}</InfoHint>
          </div>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              Bisher wurden keine Sammel-Nachträge durchgeführt.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Wann</th>
                    <th className="py-2 pr-3 font-medium">Zeitraum</th>
                    <th className="py-2 pr-3 font-medium">Grund</th>
                    <th className="py-2 pr-3 text-right font-medium">Tage</th>
                    <th className="py-2 pr-3 text-right font-medium">Aktiv</th>
                    <th className="py-2 font-medium">Rücknahme</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map(({ log, activeRows }) => {
                    const v = (log.newValue ?? {}) as Record<string, unknown>;
                    return (
                      <tr key={log.id} className="border-b border-black/5 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {formatDayKey(berlinDayKey(log.createdAt))}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {String(v.from ?? "?")} – {String(v.to ?? "?")}
                        </td>
                        <td className="py-2 pr-3 text-muted">{log.reason ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {String(v.days ?? "—")}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Badge tone={activeRows > 0 ? "lime" : "neutral"}>{activeRows}</Badge>
                        </td>
                        <td className="py-2">
                          {activeRows > 0 && log.targetId ? (
                            <RevertBatchForm batchId={log.targetId} />
                          ) : (
                            <span className="text-xs text-muted">zurückgenommen</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
