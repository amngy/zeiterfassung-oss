// Presentational, server-rendered timesheet pieces. Pure formatting over the
// PeriodSummary produced by the calc module — no client interactivity here.

import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import {
  berlinDayKey,
  formatClock,
  formatDayKey,
  formatHm,
  formatSigned,
  ABSENCE_LABEL,
  ABSENCE_TREATMENT,
  isSicknessKind,
  type DaySegment,
  type DaySummary,
  type PeriodSummary,
  type Violation,
} from "@/lib/time";

const STATUS_HINT = `Tagesstatus: „läuft“ = Erfassung noch offen/aktiv, „offen“ = nicht ausgestempelt (zählt nicht, Korrektur nötig), „Urlaub“/„Krank“ usw. = genehmigte Abwesenheit (je nach Art Gutschrift der Sollzeit, Abzug vom Überstundensaldo oder Wegfall der Sollzeit), „kein Eintrag“ = Arbeitstag mit Soll ohne Buchung, „frei“ = kein Solltag oder Feiertag. „in Prüfung“/„geprüft“ = Arbeitsende über den Webzugang an einem Tag deutlich über dem Soll, von der Verwaltung zu prüfen bzw. geprüft.`;

const REVIEW_HINT = `Der Tag endete mit einem Ausstempeln über den Webzugang und liegt deutlich über dem Soll. Die Verwaltung sieht ihn sich an; an den Zeiten ändert sich dadurch nichts.`;

/** #32: a day closed by a remote clock-out, flagged for an admin's look. */
function ReviewBadge({ state }: { state?: "open" | "reviewed" }) {
  if (state === "open") return <Badge tone="warning" title={REVIEW_HINT}>in Prüfung</Badge>;
  if (state === "reviewed") return <Badge tone="neutral" title={REVIEW_HINT}>geprüft</Badge>;
  return null;
}

const ABSENCE_HINT = `Bezahlte Zeit, die für genehmigte Abwesenheit (Urlaub, Krankheit, Sonderurlaub, Fortbildung, Dienstreise) gutgeschrieben wurde. Freizeitausgleich schreibt nichts gut; bei unbezahltem Urlaub, Elternzeit, Mutterschutz und „Kind krank“ entfällt stattdessen das Soll. Das Soll bleibt stehen — die Stunden werden nicht gestrichen, sondern ausgeglichen. Es gilt: Saldo = Ist + Abwesenheit − Soll. Ein halber Urlaubstag schreibt das halbe Tagessoll gut; wer an einem Krankheitstag noch gearbeitet hat, bekommt nur die fehlenden Stunden ergänzt.`;

/** "Urlaub", "Krank", "Elternzeit", …, plus the half-day marker when only part of it is covered. */
function absenceLabel(day: DaySummary): string | null {
  if (!day.absence) return null;
  const base = ABSENCE_LABEL[day.absence.kind];
  return day.absence.fraction < 1 ? `${base} (halbtags)` : base;
}

/**
 * How much of the shown break time nobody actually booked. Spelt out under the
 * figure rather than folded into it, so an employee comparing their timesheet
 * with their own notes can see at a glance where the difference comes from.
 */
function autoBreakHint(p: { autoBreakMs: number; unfinishedBreakMs: number }): string | undefined {
  const parts: string[] = [];
  if (p.autoBreakMs > 0) parts.push(`${formatHm(p.autoBreakMs, false)} automatisch`);
  if (p.unfinishedBreakMs > 0) parts.push(`${formatHm(p.unfinishedBreakMs, false)} nicht beendet`);
  return parts.length > 0 ? `davon ${parts.join(", ")}` : undefined;
}

/** Ist / Soll / Saldo / Pause summary strip for a period. */
export function PeriodTotals({ period }: { period: PeriodSummary }) {
  const cells = [
    {
      label: "Ist (gearbeitet)",
      value: formatHm(period.workedMs),
      info: `Tatsächlich gearbeitete Nettozeit im Zeitraum: Anwesenheit abzüglich aller Pausen. Laufende Sitzungen zählen bis jetzt mit.`,
    },
    {
      label: "Soll (Zeitraum)",
      value: formatHm(period.expectedMs),
      info: `Vertragliche Sollzeit für den gesamten Zeitraum laut Arbeitszeitmodell. Gesetzliche Feiertage senken das Soll (ganzer Feiertag = 0, halber = die Hälfte).`,
    },
    {
      label: "Pause",
      value: formatHm(period.breakMs),
      hint: autoBreakHint(period),
      info: `Summe der Pausen, die von der Anwesenheit abgezogen wurden. Es gilt: Anwesenheit = Ist + Pause. Enthalten sind auch Pausen, die die Pausenautomatik angesetzt hat, weil eine Pause nie beendet oder gar nicht erfasst wurde — diese werden gesondert ausgewiesen und als Hinweis am jeweiligen Tag angezeigt.`,
    },
    {
      label: "Abwesenheit",
      value: formatHm(period.absenceMs),
      info: ABSENCE_HINT,
    },
    {
      label: "Saldo bis heute",
      value: formatSigned(period.balanceMs),
      tone: period.balanceMs < 0 ? "danger" : "lime",
      info: `Über-/Unterstunden: gearbeitete Zeit plus gutgeschriebene Abwesenheit minus Soll, aber nur für Tage bis einschließlich heute. Künftige Tage im Zeitraum bleiben ausgenommen, damit ein Monat nicht vorab negativ wirkt.`,
    } as const,
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((c) => (
        <div key={c.label} className="rounded-xl bg-surface px-4 py-3 shadow-sm">
          <dt className="flex items-center gap-1 text-xs text-muted">
            {c.label}
            {c.info && <InfoHint>{c.info}</InfoHint>}
          </dt>
          <dd
            className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
              "tone" in c && c.tone === "danger"
                ? "text-danger"
                : "tone" in c && c.tone === "lime"
                  ? "text-lime-dark"
                  : "text-ink"
            }`}
          >
            {c.value}
          </dd>
          {"hint" in c && c.hint && (
            <p className="mt-0.5 text-[11px] leading-tight text-muted">{c.hint}</p>
          )}
        </div>
      ))}
    </dl>
  );
}

/** First clock-in → last clock-out summary for a day's WORK segments. */
function spanLabel(day: DaySummary): string {
  const work = day.segments.filter((s) => s.type === "WORK");
  const first = work[0];
  const last = work[work.length - 1];
  if (!first || !last) return "—";
  if (last.running) return `seit ${formatClock(first.start)}`;
  return `${formatClock(first.start)} – ${formatClock(last.end)}`;
}

function DayStatusBadge({ day }: { day: DaySummary }) {
  if (day.hasOpenAnomaly) return <Badge tone="danger">offen</Badge>;
  if (day.isRunning) return <Badge tone="info">läuft</Badge>;
  // An approved absence explains an empty working day, so it is shown INSTEAD of
  // "kein Eintrag" — the day is accounted for and needs nothing from anybody.
  const absence = absenceLabel(day);
  // Unpaid kinds drop the Soll, so their working days show up here with 0 Soll.
  const dropsSoll = day.absence ? ABSENCE_TREATMENT[day.absence.kind] === "NO_SOLL" : false;
  if (absence && (day.expectedMs > 0 || (dropsSoll && day.isWorkingDay))) {
    return <Badge tone={day.absence && isSicknessKind(day.absence.kind) ? "info" : "teal"}>{absence}</Badge>;
  }
  // Only a contracted working day that still expects hours (i.e. not a holiday
  // or company day off) counts as a missing entry; an off day is just "frei".
  if (day.isEmpty && day.isWorkingDay && day.expectedMs > 0) {
    return <Badge tone="warning">kein Eintrag</Badge>;
  }
  if (day.isEmpty) return <Badge tone="neutral">frei</Badge>;
  return null;
}

/** Period-level banner shown when an unresolved open entry touches the period. */
export function OpenAnomalyBanner() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        In diesem Zeitraum gibt es einen <strong>offenen Eintrag</strong>{" "}
        (vermutlich vergessenes Ausstempeln). Bitte über eine Korrektur
        richtigstellen.
      </span>
    </div>
  );
}

/** List of ArbZG rule violations (warnings, or hard blocks) for a period/day. */
export function ViolationList({ violations }: { violations: Violation[] }) {
  if (violations.length === 0) return null;
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-danger" />
          <h3 className="text-base font-medium text-teal">
            Arbeitszeit-Hinweise ({violations.length})
          </h3>
          <InfoHint>{`Automatische Prüfhinweise nach dem hinterlegten Regelprofil (ArbZG; für Minderjährige das strengere JArbSchG-Profil). „Verstoß“ = harte Regelverletzung (BLOCK), „Hinweis“ = Warnung (WARN). Rein informativ – hier wird nichts durchgesetzt.`}</InfoHint>
        </div>
        <ul className="space-y-2">
          {violations.map((v, i) => (
            <li
              key={`${v.code}-${v.date}-${i}`}
              className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-sm"
            >
              <Badge tone={v.severity === "BLOCK" ? "danger" : "warning"}>
                {v.severity === "BLOCK" ? "Verstoß" : "Hinweis"}
              </Badge>
              <span className="flex-1">
                <span className="font-medium text-ink">{formatDayKey(v.date)}: </span>
                <span className="text-muted">{v.message}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Hinweise basieren auf dem konfigurierbaren Regelprofil (ArbZG-Vorgaben).
          Sie sind rechtlich vom Betrieb zu prüfen.
        </p>
      </CardContent>
    </Card>
  );
}

/** One row per day with worked/break/expected/balance. For week & month views. */
export function TimesheetTable({
  period,
  violations = [],
  reviewDays = {},
}: {
  period: PeriodSummary;
  violations?: Violation[];
  /** Days closed by a remote clock-out flagged for review (#32). */
  reviewDays?: Record<string, "open" | "reviewed">;
}) {
  const flaggedDays = new Set(violations.map((v) => v.date));
  return (
    <Card>
      <CardContent className="px-0 py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[0.06] text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Tag</th>
                <th className="px-4 py-2.5 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Zeiten
                    <InfoHint>{`Erste Anmeldung bis letzte Abmeldung des Tages (nur Arbeitszeiten). Bei laufender Sitzung: „seit HH:MM“. Zwischenpausen sind hier nicht dargestellt.`}</InfoHint>
                  </span>
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    Pause
                    <InfoHint>{`Vom Tag abgezogene Pausenzeit. Ein Sternchen (*) bedeutet, dass die Pausenautomatik beteiligt war — weil eine Pause nie beendet oder gar keine erfasst wurde. Der Grund steht im Arbeitszeit-Hinweis zu diesem Tag.`}</InfoHint>
                  </span>
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    Ist
                    <InfoHint>{`Netto gearbeitete Zeit des Tages (Anwesenheit minus Pausen).`}</InfoHint>
                  </span>
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    Abw.
                    <InfoHint>{ABSENCE_HINT}</InfoHint>
                  </span>
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    Soll
                    <InfoHint>{`Vertragliche Sollzeit für diesen Tag laut Arbeitszeitmodell; an gesetzlichen Feiertagen reduziert (ganz = 0, halb = Hälfte).`}</InfoHint>
                  </span>
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    Saldo
                    <InfoHint>{`Tagesbilanz: gearbeitete Zeit plus gutgeschriebene Abwesenheit minus Tages-Soll. Plus = Mehrarbeit, Minus = Minderstunden. Grün bei 0 oder mehr, Rot bei Minus.`}</InfoHint>
                  </span>
                </th>
                <th className="px-4 py-2.5 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Status
                    <InfoHint>{STATUS_HINT}</InfoHint>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {period.days.map((day) => {
                const dim = day.isEmpty && !day.isWorkingDay;
                return (
                  <tr
                    key={day.date}
                    className={`border-b border-black/[0.04] last:border-0 ${
                      dim ? "text-muted" : "text-ink"
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium">
                      {formatDayKey(day.date)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono tabular-nums">
                      {spanLabel(day)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {day.breakMs > 0 ? formatHm(day.breakMs, false) : "—"}
                      {day.autoBreakMs > 0 || day.unfinishedBreakMs > 0 ? (
                        <span title="von der Pausenautomatik angesetzt">*</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {day.presenceMs > 0 || day.workedMs > 0
                        ? formatHm(day.workedMs, false)
                        : "—"}
                    </td>
                    <td
                      className="px-4 py-2.5 text-right font-mono tabular-nums text-teal"
                      title={absenceLabel(day) ?? undefined}
                    >
                      {day.absenceMs > 0 ? formatHm(day.absenceMs, false) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted">
                      {day.expectedMs > 0 ? formatHm(day.expectedMs, false) : "—"}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono tabular-nums ${
                        day.balanceMs < 0 ? "text-danger" : "text-lime-dark"
                      }`}
                    >
                      {day.workedMs > 0 || day.expectedMs > 0
                        ? formatSigned(day.balanceMs, false)
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <DayStatusBadge day={day} />
                        <ReviewBadge state={reviewDays[day.date]} />
                        {flaggedDays.has(day.date) && (
                          <AlertTriangle
                            className="h-4 w-4 text-danger"
                            aria-label="Arbeitszeit-Hinweis"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-black/[0.08] bg-surface/60 font-medium">
                <td className="px-4 py-2.5" colSpan={2}>
                  Summe
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  {formatHm(period.breakMs, false)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  {formatHm(period.workedMs, false)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-teal">
                  {period.absenceMs > 0 ? formatHm(period.absenceMs, false) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted">
                  {formatHm(period.expectedMs, false)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-mono tabular-nums ${
                    period.balanceMs < 0 ? "text-danger" : "text-lime-dark"
                  }`}
                >
                  {formatSigned(period.balanceMs, false)}
                </td>
                <td className="px-4 py-2.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export interface CorrectionRow {
  id: string;
  /** CANCELLED only ever occurs on an Absence, but the enum is shared. */
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  proposedType: "WORK" | "BREAK" | null;
  proposedStart: Date | null;
  proposedEnd: Date | null;
  timeEntryId: string | null;
  breakDeclared: boolean | null;
  proposedBreakStart: Date | null;
  proposedBreakEnd: Date | null;
  reason: string;
  decisionNote: string | null;
  createdAt: Date;
}

const STATUS_LABEL: Record<CorrectionRow["status"], { label: string; tone: "warning" | "lime" | "danger" }> = {
  PENDING: { label: "ausstehend", tone: "warning" },
  APPROVED: { label: "genehmigt", tone: "lime" },
  REJECTED: { label: "abgelehnt", tone: "danger" },
  CANCELLED: { label: "storniert", tone: "danger" },
};

/** The signed-in employee's own correction requests with their status. */
export function MyCorrections({ rows }: { rows: CorrectionRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-3 flex items-center gap-1.5">
          <h3 className="text-base font-medium text-teal">Meine Korrekturanträge</h3>
          <InfoHint>{`„Korrektur“ ändert einen bestehenden Zeiteintrag; „Nachtrag“ legt einen vergessenen Eintrag neu an. Beides muss genehmigt werden, bevor es in die Zeiten einfließt.`}</InfoHint>
        </div>
        <ul className="space-y-2">
          {rows.map((r) => {
            const s = STATUS_LABEL[r.status];
            const when =
              r.proposedStart && r.proposedEnd
                ? `${formatDayKey(berlinDayKey(r.proposedStart))}, ${formatClock(
                    r.proposedStart,
                  )}–${formatClock(r.proposedEnd)}`
                : "—";
            return (
              <li key={r.id} className="rounded-lg bg-surface px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">
                    {r.proposedType === "BREAK" ? "Pause" : "Arbeit"} · {when}
                    {r.timeEntryId ? " (Korrektur)" : " (Nachtrag)"}
                  </span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>
                {r.proposedType === "WORK" && r.breakDeclared !== null && (
                  <p className="mt-1 text-muted">
                    Pause:{" "}
                    {r.breakDeclared && r.proposedBreakStart && r.proposedBreakEnd
                      ? `${formatClock(r.proposedBreakStart)}–${formatClock(r.proposedBreakEnd)}`
                      : "keine"}
                  </p>
                )}
                <p className="mt-1 text-muted">Grund: {r.reason}</p>
                {r.decisionNote && (
                  <p className="mt-0.5 text-muted">Anmerkung: {r.decisionNote}</p>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Detailed timeline (Kommen/Pause/Gehen) for a single day. For the day view. */
export function DayDetail({
  day,
  violations = [],
  review,
}: {
  day: DaySummary;
  violations?: Violation[];
  review?: "open" | "reviewed";
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-medium text-teal">{formatDayKey(day.date)}</h3>
          <div className="flex items-center gap-1.5">
            <DayStatusBadge day={day} />
            <ReviewBadge state={review} />
          </div>
        </div>

        {violations.length > 0 && (
          <ul className="mb-3 space-y-1.5">
            {violations.map((v, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>{v.message}</span>
              </li>
            ))}
          </ul>
        )}

        {day.hasOpenAnomaly && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Offener Eintrag — bitte über eine Korrektur richtigstellen.</span>
          </div>
        )}

        {day.segments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            Keine Einträge an diesem Tag.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {day.segments.map((seg, i) => (
              <SegmentRow key={i} seg={seg} />
            ))}
          </ol>
        )}

        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <MiniStat label="Ist" value={formatHm(day.workedMs)} />
          <MiniStat label="Pause" value={formatHm(day.breakMs)} hint={autoBreakHint(day)} />
          <MiniStat
            label="Abwesenheit"
            value={formatHm(day.absenceMs)}
            hint={absenceLabel(day) ?? undefined}
          />
          <MiniStat label="Soll" value={formatHm(day.expectedMs)} />
          <MiniStat
            label="Saldo"
            value={formatSigned(day.balanceMs)}
            tone={day.balanceMs < 0 ? "danger" : "lime"}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function SegmentRow({ seg }: { seg: DaySegment }) {
  const isWork = seg.type === "WORK";
  return (
    <li className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2 text-sm">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${
          isWork ? "bg-lime" : "bg-amber-400"
        }`}
        aria-hidden
      />
      <span className="w-20 font-medium text-ink">
        {isWork ? "Arbeit" : "Pause"}
      </span>
      <span className="font-mono tabular-nums text-muted">
        {formatClock(seg.start)} – {seg.running ? "läuft" : formatClock(seg.end)}
      </span>
      {seg.autoCompleted && (
        <span className="text-xs text-muted">
          nie beendet — automatisch angesetzt
        </span>
      )}
    </li>
  );
}

function MiniStat({
  label,
  value,
  tone = "ink",
  hint,
}: {
  label: string;
  value: string;
  tone?: "ink" | "lime" | "danger";
  hint?: string;
}) {
  const color =
    tone === "lime" ? "text-lime-dark" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="rounded-xl bg-surface px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${color}`}>
        {value}
      </dd>
      {hint && <p className="mt-0.5 text-[11px] leading-tight text-muted">{hint}</p>}
    </div>
  );
}
