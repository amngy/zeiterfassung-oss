"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Clock3, Coffee, LogIn, LogOut, Play, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InfoHint } from "@/components/ui/info-hint";
import { formatHm, formatSigned, type LiveState } from "@/lib/time";
import type { ClockResult } from "./actions";

export interface ClockCardProps {
  state: LiveState;
  /** ISO instant the current state (work/break) began. */
  runningSinceISO: string | null;
  /** Net worked / break / expected (ms) for today, measured at render time. */
  workedMsAtRender: number;
  breakMsAtRender: number;
  expectedMs: number;
  /**
   * Paid time credited for an approved absence today (holiday / sick leave).
   * Counts toward the day's balance exactly as worked time does, so somebody on
   * leave does not watch their own card sink to minus a working day.
   */
  absenceMs: number;
  /** "Urlaub" / "Krank", when today is covered by one. */
  absenceLabel: string | null;
  /** Render instant — the client extrapolates live counters from here. */
  renderAtISO: string;
  /** Berlin end-of-day instant for the render day; the live "Heute" counters
   *  are clamped here and the card refreshes once the day rolls over. */
  dayEndsAtISO: string;
  actions: {
    clockIn: () => Promise<ClockResult>;
    clockOut: () => Promise<ClockResult>;
    startBreak: () => Promise<ClockResult>;
    endBreak: () => Promise<ClockResult>;
  };
}

const STATE_META: Record<
  LiveState,
  { label: string; tone: "lime" | "info" | "neutral" | "danger" }
> = {
  WORKING: { label: "Eingestempelt", tone: "lime" },
  ON_BREAK: { label: "In Pause", tone: "info" },
  IDLE: { label: "Ausgestempelt", tone: "neutral" },
  ANOMALY: { label: "Offener Eintrag", tone: "danger" },
};

export function ClockCard(props: ClockCardProps) {
  const {
    state, runningSinceISO, workedMsAtRender, breakMsAtRender, expectedMs, absenceMs, absenceLabel,
    renderAtISO, dayEndsAtISO, actions,
  } = props;

  const router = useRouter();
  const [now, setNow] = React.useState(() => Date.now());
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const ticking = state === "WORKING" || state === "ON_BREAK";
  React.useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  // Once the Berlin calendar day rolls over, the snapshot (which is per-day)
  // is stale — re-fetch so "Heute"/"Soll heute" re-anchor to the new day.
  const dayEndsAt = new Date(dayEndsAtISO).getTime();
  const rolledOver = now >= dayEndsAt;
  React.useEffect(() => {
    if (rolledOver) router.refresh();
  }, [rolledOver, router]);

  const renderAt = new Date(renderAtISO).getTime();
  // Clamp the live "Heute" extrapolation at the day boundary so the daily
  // counters never bleed into the next day before the refresh lands.
  const cappedNow = Math.min(now, dayEndsAt);
  const sinceLive = ticking ? Math.max(0, cappedNow - renderAt) : 0;
  // Net worked grows while WORKING; during a break it holds flat (presence and
  // break advance together). Break grows only while ON_BREAK.
  const workedMs = workedMsAtRender + (state === "WORKING" ? sinceLive : 0);
  const breakMs = breakMsAtRender + (state === "ON_BREAK" ? sinceLive : 0);
  // The credit fills the day up to its Soll and no further — the same rule the
  // server-side day summary applies, so the live card and the timesheet agree.
  const liveAbsenceMs = Math.max(0, Math.min(absenceMs, expectedMs - workedMs));
  const balanceMs = workedMs + liveAbsenceMs - expectedMs;

  const segmentElapsed =
    runningSinceISO != null ? Math.max(0, now - new Date(runningSinceISO).getTime()) : 0;

  const meta = STATE_META[state];

  function run(action: () => Promise<ClockResult>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(res.error ?? "Es ist ein Fehler aufgetreten.");
    });
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-teal" />
              <span className="text-sm font-medium text-muted">Status</span>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <InfoHint>{`„Offener Eintrag“ erscheint, wenn ein Eintrag länger als 16 Std. offen ist (meist vergessenes Ausstempeln). Diese Zeit wird nicht gezählt und muss per Korrektur richtiggestellt werden.`}</InfoHint>
            </div>
            <p
              className="mt-2 font-mono text-4xl font-semibold tabular-nums text-ink"
              aria-live="polite"
            >
              {ticking ? formatHms(segmentElapsed) : "—"}
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted">
              <span>
                {state === "WORKING" && "Aktuelle Arbeitszeit dieser Sitzung"}
                {state === "ON_BREAK" && "Aktuelle Pausendauer"}
                {state === "IDLE" && "Sie sind derzeit nicht eingestempelt."}
                {state === "ANOMALY" &&
                  "Ein Eintrag wurde nicht ordnungsgemäß beendet."}
              </span>
              <InfoHint>{`Die große Uhr zeigt nur die laufende Sitzung seit dem letzten Einstempeln bzw. Pausenstart – nicht die gesamte Tagesarbeitszeit. Den Tageswert finden Sie unten unter „Heute gearbeitet“.`}</InfoHint>
            </p>
          </div>

          <div className="flex flex-col items-stretch gap-2">{renderButtons()}</div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
            {error}
          </p>
        )}

        {state === "ANOMALY" && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Ein offener Eintrag liegt zu lange zurück (vermutlich vergessenes
              Ausstempeln). Solange er offen ist, ist kein neues Einstempeln möglich.
              Tragen Sie das tatsächliche Ende im Feld{" "}
              <strong>„Offener Eintrag“</strong> direkt unter dieser Karte nach.
            </span>
          </div>
        )}

        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Heute gearbeitet"
            value={formatHm(workedMs)}
            info={`Netto-Arbeitszeit heute: Anwesenheit abzüglich aller Pausen. Der Wert läuft nur live, während Sie eingestempelt sind, und pausiert während einer Pause.`}
          />
          <Stat
            label="Pause"
            value={formatHm(breakMs)}
            info={`Heute erfasste Pausenzeit. Sie ist von der Arbeitszeit abgezogen, sodass gilt: Anwesenheit = „Heute gearbeitet“ + „Pause“.`}
          />
          <Stat
            label={absenceLabel ? `Soll heute (${absenceLabel})` : "Soll heute"}
            value={formatHm(expectedMs)}
            info={`Vertragliche Sollarbeitszeit für heute laut hinterlegtem Arbeitszeitmodell. An Feiertagen wird das Soll reduziert (ganzer Feiertag = 0 Std., halber = Hälfte). Bei genehmigtem Urlaub oder erfasster Krankheit bleibt das Soll stehen und wird als Abwesenheit gutgeschrieben. Ohne Modell ist das Soll 0.`}
          />
          <Stat
            label="Saldo heute"
            value={formatSigned(balanceMs)}
            tone={balanceMs < 0 ? "danger" : "lime"}
            info={`„Heute gearbeitet“ plus gutgeschriebene Abwesenheit minus „Soll heute“. Positiv (grün) = Mehrarbeit, negativ (rot) = noch offene Sollzeit für heute.`}
          />
        </dl>
      </CardContent>
    </Card>
  );

  function renderButtons() {
    if (state === "IDLE") {
      return (
        <Button onClick={() => run(actions.clockIn)} disabled={pending} size="lg">
          <LogIn className="h-5 w-5" /> Einstempeln
        </Button>
      );
    }
    if (state === "WORKING") {
      return (
        <>
          <Button
            variant="outline"
            onClick={() => run(actions.startBreak)}
            disabled={pending}
          >
            <Coffee className="h-4 w-4" /> Pause starten
          </Button>
          <Button
            variant="secondary"
            onClick={() => run(actions.clockOut)}
            disabled={pending}
          >
            <LogOut className="h-4 w-4" /> Ausstempeln
          </Button>
        </>
      );
    }
    if (state === "ON_BREAK") {
      return (
        <Button onClick={() => run(actions.endBreak)} disabled={pending} size="lg">
          <Play className="h-5 w-5" /> Pause beenden
        </Button>
      );
    }
    return null; // ANOMALY: resolved via correction
  }
}

function Stat({
  label,
  value,
  tone = "ink",
  info,
}: {
  label: string;
  value: string;
  tone?: "ink" | "lime" | "danger";
  info?: React.ReactNode;
}) {
  const color =
    tone === "lime" ? "text-lime-dark" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="rounded-xl bg-white px-3 py-2.5 shadow-sm">
      <dt className="flex items-center gap-1 text-xs text-muted">
        {label}
        {info && <InfoHint>{info}</InfoHint>}
      </dt>
      <dd className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${color}`}>
        {value}
      </dd>
    </div>
  );
}

function formatHms(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
