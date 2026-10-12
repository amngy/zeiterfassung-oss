import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { getPendingCorrections } from "@/lib/corrections";
import { getAppSettings } from "@/lib/settings";
import { findRemoteReviewFlags } from "@/lib/punch-review";
import { findMinijobRecordingIssues } from "@/lib/minijob-deadline";
import { prisma } from "@/lib/db";
import {
  addDaysToKey,
  berlinDayKey,
  formatClock,
  formatDayKey,
  formatHm,
  formatSigned,
  recordingIssueText,
} from "@/lib/time";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoHint } from "@/components/ui/info-hint";
import { CorrectionDecision } from "./decision";
import { markPunchReviewedAction } from "./actions";

export const metadata: Metadata = { title: "Korrekturen" };

function proposed(start: Date | null, end: Date | null): string {
  if (!start || !end) return "—";
  return `${formatDayKey(berlinDayKey(start))}, ${formatClock(start)}–${formatClock(end)}`;
}

export default async function AdminCorrectionsPage() {
  await requireAdmin();
  const todayKey = berlinDayKey(new Date());
  const [pending, settings, flags, minijobAccounts, recording] = await Promise.all([
    getPendingCorrections(),
    getAppSettings(),
    // Two months back: old enough to catch a month-end review, short enough to stay cheap.
    findRemoteReviewFlags({ fromKey: addDaysToKey(todayKey, -61), toKey: todayKey }),
    prisma.user.count({ where: { isMinijob: true, active: true } }),
    findMinijobRecordingIssues({ fromKey: addDaysToKey(todayKey, -61), toKey: todayKey }),
  ]);
  const threshold = settings.punchPolicy.reviewRemoteOvertimeMinutes;
  const openFlags = flags.filter((f) => !f.reviewedAt);

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

      {threshold > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-1.5 text-base">
              Stempelungen von unterwegs prüfen
              {openFlags.length > 0 && <Badge tone="warning">{openFlags.length}</Badge>}
              <InfoHint>{`Tage der letzten zwei Monate, die mit einem Ausstempeln über den Webzugang endeten und mehr als ${threshold} Minuten über dem Soll liegen (Einstellungen → Stempeln). Ein Hinweis, kein Verdacht — lange Tage sind oft in Ordnung. An den Zeiten ändert sich nichts; „Geprüft“ wird protokolliert, und die Person sieht den Status in ihren Zeiten.`}</InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openFlags.length === 0 ? (
              <p className="text-sm text-muted">Nichts zu prüfen.</p>
            ) : (
              <ul className="space-y-2">
                {openFlags.map((f) => (
                  <li
                    key={f.eventId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-3 py-2.5 text-sm shadow-sm"
                  >
                    <div>
                      <p className="font-medium text-ink">
                        {f.userName} · {formatDayKey(f.dayKey)}
                      </p>
                      <p className="text-muted">
                        Ende {formatClock(f.at)} über Web
                        {f.deviceLabel && ` · ${f.deviceLabel}`} · Ist {formatHm(f.workedMs)} · Soll{" "}
                        {formatHm(f.expectedMs)} ·{" "}
                        <span className="font-medium text-ink">{formatSigned(f.balanceMs)}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/zeiten?user=${f.userId}&monat=${f.dayKey.slice(0, 7)}`}
                        className="text-xs font-medium text-teal hover:underline"
                      >
                        Monat ansehen
                      </Link>
                      <form action={markPunchReviewedAction}>
                        <input type="hidden" name="eventId" value={f.eventId} />
                        <button className="inline-flex items-center gap-1 rounded-lg bg-lime px-3 py-1.5 text-xs font-semibold text-white hover:bg-lime-dark">
                          <Check className="h-3.5 w-3.5" /> Geprüft
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {(minijobAccounts > 0 || recording.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-1.5 text-base">
              Minijob: Aufzeichnungsfrist (MiLoG §17)
              {recording.length > 0 && (
                <Badge tone={recording.some((r) => r.state !== "open") ? "danger" : "warning"}>
                  {recording.length}
                </Badge>
              )}
              <InfoHint>{`Für Minijob-Konten müssen Beginn, Ende und Dauer der Arbeitszeit spätestens bis zum Ablauf des siebten auf den Arbeitstag folgenden Kalendertages aufgezeichnet sein (§ 17 Abs. 1 MiLoG). Aufgeführt sind Einträge der letzten zwei Monate, deren Ende noch fehlt oder die erst nach Ablauf der Frist vollständig erfasst wurden. Eine spätere Korrektur eines rechtzeitig erfassten Eintrags gilt nicht als verspätet. Ein fehlendes Ende über „Monat ansehen“ nachtragen; verspätete Einträge lassen sich nicht mehr heilen, sie sind hier und im Monatsbericht dokumentiert.`}</InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recording.length === 0 ? (
              <p className="text-sm text-muted">Alle Minijob-Zeiten sind fristgerecht erfasst.</p>
            ) : (
              <ul className="space-y-2">
                {recording.map((r) => (
                  <li
                    key={r.entryId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-3 py-2.5 text-sm shadow-sm"
                  >
                    <div>
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                        {r.userName} · {formatDayKey(r.dayKey)}
                        <Badge tone={r.state === "open" ? "warning" : "danger"}>
                          {r.state === "open" ? "Frist läuft" : r.state === "overdue" ? "Frist abgelaufen" : "verspätet"}
                        </Badge>
                      </p>
                      <p className="text-muted">{recordingIssueText(r)}</p>
                    </div>
                    <Link
                      href={`/admin/zeiten?user=${r.userId}&monat=${r.dayKey.slice(0, 7)}`}
                      className="text-xs font-medium text-teal hover:underline"
                    >
                      Monat ansehen
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

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
