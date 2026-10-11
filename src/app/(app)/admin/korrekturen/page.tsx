import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import { getPendingCorrections } from "@/lib/corrections";
import { berlinDayKey, formatClock, formatDayKey } from "@/lib/time";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CorrectionDecision } from "./decision";

export const metadata: Metadata = { title: "Korrekturen" };

function proposed(start: Date | null, end: Date | null): string {
  if (!start || !end) return "—";
  return `${formatDayKey(berlinDayKey(start))}, ${formatClock(start)}–${formatClock(end)}`;
}

export default async function AdminCorrectionsPage() {
  await requireAdmin();
  const pending = await getPendingCorrections();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-ink">
          Korrekturanträge
        </h1>
        <p className="text-sm text-muted">
          {pending.length} {pending.length === 1 ? "offener Antrag" : "offene Anträge"}.
          Genehmigte Korrekturen erzeugen eine neue Version des Eintrags; das
          Original bleibt erhalten und alles wird im Protokoll vermerkt.
        </p>
      </header>

      {pending.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted">
            Keine offenen Korrekturanträge.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pending.map((r) => (
            <Card key={r.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{r.user.name}</CardTitle>
                  <Badge tone={r.timeEntryId ? "info" : "teal"}>
                    {r.timeEntryId ? "Korrektur" : "Nachtrag"}
                  </Badge>
                </div>
                <CardDescription>{r.user.email}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>
                  <span className="text-muted">Vorgeschlagen: </span>
                  <span className="font-medium text-ink">
                    {r.proposedType === "BREAK" ? "Pause" : "Arbeit"} ·{" "}
                    {proposed(r.proposedStart, r.proposedEnd)}
                  </span>
                </p>
                {r.proposedType === "WORK" && (
                  <p>
                    <span className="text-muted">Pause: </span>
                    {r.breakDeclared === null ? (
                      <span className="text-muted">keine Angabe</span>
                    ) : r.breakDeclared ? (
                      <span className="font-medium text-ink">
                        ja · {proposed(r.proposedBreakStart, r.proposedBreakEnd)}
                      </span>
                    ) : (
                      <span className="font-medium text-ink">
                        nein — laut Angabe wurde keine Pause gemacht
                      </span>
                    )}
                  </p>
                )}
                <p>
                  <span className="text-muted">Grund: </span>
                  <span className="text-ink">{r.reason}</span>
                </p>
                <p className="text-xs text-muted">
                  Eingereicht am {formatDayKey(berlinDayKey(r.createdAt))} um{" "}
                  {formatClock(r.createdAt)}
                </p>
                <CorrectionDecision correctionId={r.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
