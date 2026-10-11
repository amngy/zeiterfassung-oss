import type { Metadata } from "next";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Database } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { describePunch } from "@/lib/clock";
import { getTimesheet } from "@/lib/timesheet";
import {
  addDaysToKey,
  berlinDayKey,
  berlinDayRange,
  BUSINESS_TZ,
  formatClock,
  formatDayKey,
  formatMonth,
  monthRangeOf,
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
import { PeriodTotals, TimesheetTable, ViolationList } from "../../zeiten/views";
import { EntryEditor, type EditableEntry } from "./entry-editor";

export const metadata: Metadata = { title: "Alle Zeiten" };

/** Berlin wall-clock "YYYY-MM-DDTHH:mm" — the format <input datetime-local> wants. */
function berlinLocal(instant: Date): string {
  return formatInTimeZone(instant, BUSINESS_TZ, "yyyy-MM-dd'T'HH:mm");
}

/**
 * The month's ACTIVE entries as raw, UN-CLIPPED rows for the override list.
 *
 * Deliberately NOT the timesheet's day segments: those are clipped to the
 * calendar day being displayed, which is precisely what turns a shift running
 * past midnight into a "00:00" start on the following day. An admin correcting
 * such an entry has to see and edit its true bounds, not the clipped view.
 */
async function loadEditableEntries(
  userId: string,
  fromKey: string,
  toKey: string,
): Promise<EditableEntry[]> {
  const rows = await prisma.timeEntry.findMany({
    where: {
      userId,
      status: "ACTIVE",
      start: { gte: berlinDayRange(fromKey).start, lt: berlinDayRange(toKey).end },
    },
    orderBy: { start: "asc" },
    select: {
      id: true, userId: true, type: true, start: true, end: true,
      source: true, note: true,
      clockEvents: {
        orderBy: { at: "asc" },
        select: { kind: true, channel: true, deviceLabel: true, terminal: { select: { label: true } } },
      },
    },
  });

  return rows.map((r) => {
    const startKey = berlinDayKey(r.start);
    return {
      id: r.id,
      userId: r.userId,
      type: r.type,
      startLocal: berlinLocal(r.start),
      endLocal: r.end ? berlinLocal(r.end) : null,
      dayLabel: formatDayKey(startKey),
      startClock: formatClock(r.start),
      endClock: r.end ? formatClock(r.end) : "offen",
      crossesMidnight: r.end !== null && berlinDayKey(r.end) !== startKey,
      // Clock times are rendered as HH:mm, so the whole first minute of a Berlin
      // day reads as "00:00" — flag the same window the display collapses.
      startsAtMidnight: r.start.getTime() - berlinDayRange(startKey).start.getTime() < 60_000,
      note: r.note,
      source: r.source,
      punches: r.clockEvents.map((p) => ({
        edge: p.kind === "CLOCK_IN" || p.kind === "BREAK_START" ? ("Beginn" as const) : ("Ende" as const),
        via: describePunch(p),
      })),
      startMs: r.start.getTime(),
      endMs: r.end ? r.end.getTime() : null,
    };
  });
}

export default async function AdminTimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; monat?: string }>;
}) {
  await requireAdmin();
  const { user, monat } = await searchParams;

  const employees = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, active: true },
  });

  const selectedId = employees.find((e) => e.id === user)?.id ?? employees[0]?.id ?? "";
  const todayKey = berlinDayKey(new Date());
  const monthKey = /^\d{4}-\d{2}$/.test(monat ?? "") ? monat! : todayKey.slice(0, 7);
  const anchor = `${monthKey}-01`;
  const { from, to } = monthRangeOf(anchor);

  const prevMonth = addDaysToKey(from, -1).slice(0, 7);
  const nextMonth = addDaysToKey(to, 1).slice(0, 7);

  const [timesheet, editableEntries] = selectedId
    ? await Promise.all([
        getTimesheet(selectedId, "month", anchor, new Date()),
        loadEditableEntries(selectedId, from, to),
      ])
    : [null, []];

  const linkFor = (m: string) => `/admin/zeiten?user=${selectedId}&monat=${m}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-ink">Alle Zeiten</h1>
        <p className="text-sm text-muted">
          Monatsnachweise aller Mitarbeitenden ansehen und als CSV/PDF exportieren.
        </p>
      </header>

      {/* ── Filter ── */}
      <Card>
        <CardContent className="pt-5">
          <form className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="inline-flex items-center gap-1 text-sm font-medium text-ink">
                <label htmlFor="admin-zeiten-user">Mitarbeiter:in</label>
                <InfoHint>{`Wählt die Person, deren Monatsnachweis angezeigt wird. Auch inaktive/ausgeschiedene Beschäftigte (mit „(inaktiv)“) bleiben wählbar, damit ihre Nachweise weiter einsehbar und exportierbar sind.`}</InfoHint>
              </span>
              <select
                id="admin-zeiten-user"
                name="user"
                defaultValue={selectedId}
                className="h-10 min-w-56 rounded-xl border border-black/10 bg-white px-3 text-sm text-ink shadow-sm"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.active ? "" : " (inaktiv)"}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Monat</span>
              <input
                type="month"
                name="monat"
                defaultValue={monthKey}
                className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm text-ink shadow-sm"
              />
            </label>
            <button className="h-10 rounded-xl bg-teal px-4 text-sm font-medium text-white hover:bg-teal-dark">
              Anzeigen
            </button>
          </form>
        </CardContent>
      </Card>

      {!timesheet ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted">
            Keine Mitarbeitenden vorhanden.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Month header + nav + exports ── */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">{formatMonth(anchor)}</CardTitle>
                <div className="flex items-center gap-1">
                  <Link href={linkFor(prevMonth)} className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label="Vormonat">
                    <ChevronLeft className="h-4 w-4" />
                  </Link>
                  <Link href={linkFor(nextMonth)} className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label="Folgemonat">
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <PeriodTotals period={timesheet.period} />
              <div className="flex flex-wrap gap-2">
                <ExportLink
                  href={`/api/admin/export/monat?user=${selectedId}&monat=${monthKey}&format=pdf`}
                  icon={<FileText className="h-4 w-4" />}
                  label="Monats-PDF"
                  info={`Aufbereiteter Monats-Zeitnachweis dieser Person als PDF: Ist/Soll/Saldo je Tag, Abwesenheiten und ArbZG-Hinweise – für Lohnabrechnung und Ablage.`}
                />
                <ExportLink
                  href={`/api/admin/export/monat?user=${selectedId}&monat=${monthKey}&format=csv`}
                  icon={<FileSpreadsheet className="h-4 w-4" />}
                  label="Monats-CSV"
                  info={`Derselbe Monatsbericht wie das PDF, aber als CSV (Semikolon, Dezimalkomma, UTF-8-BOM, Excel-tauglich). Stunden als Dezimalwerte – für die Weiterverarbeitung in der Lohnabrechnung.`}
                />
                <ExportLink
                  href={`/api/admin/export/roh?user=${selectedId}&monat=${monthKey}`}
                  icon={<Database className="h-4 w-4" />}
                  label="Rohdaten-CSV"
                  info={`Einzelne Stempelungen dieser Person im Monat: Von/Bis je Intervall, Art (Arbeit/Pause), Erfassung (manuell/Stempeluhr) und Status (aktiv/ersetzt) – für Prüfung und Dokumentationspflicht.`}
                />
                <ExportLink
                  href={`/api/admin/export/roh?monat=${monthKey}`}
                  icon={<Database className="h-4 w-4" />}
                  label="Alle Rohdaten-CSV"
                  info={`Rohdaten aller Mitarbeitenden für den Monat in einer Datei. Enthält personenbezogene Daten – nur zweckgebunden verwenden und sicher aufbewahren (DSGVO).`}
                />
              </div>
            </CardContent>
          </Card>

          {timesheet.period.hasOpenAnomaly && (
            <div className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
              <Badge tone="danger">offen</Badge>
              <span>
                In diesem Monat gibt es einen offenen Eintrag (vermutlich vergessenes Ausstempeln) —
                bitte über eine Korrektur richtigstellen.
              </span>
            </div>
          )}

          <TimesheetTable period={timesheet.period} violations={timesheet.violations} />
          <ViolationList violations={timesheet.violations} />

          {/* ── Per-entry admin override ── */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Einzelne Zeiten korrigieren</CardTitle>
                <InfoHint>{`Die tatsächlich gespeicherten Stempelungen dieses Monats — nicht die auf den Kalendertag zugeschnittene Tabellenansicht. Hier kann die Verwaltung eine falsch erfasste Zeit direkt richtigstellen, auch rückwirkend und ohne Antrag der betroffenen Person.`}</InfoHint>
              </div>
              <CardDescription>
                Zeigt jede erfasste Stempelung mit ihrem echten Beginn und Ende. Eine Änderung
                wirkt sofort, überschreibt aber nichts: der bisherige Wert bleibt als ersetzte
                Version erhalten und die Änderung steht mit Grund im{" "}
                <Link href="/admin/protokoll" className="text-teal underline underline-offset-2">
                  Änderungsprotokoll
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-3 rounded-xl border border-teal/20 bg-surface px-4 py-3 text-xs text-muted">
                <strong className="text-ink">Beginn 00:00 im Monatsnachweis?</strong> Zwei
                verschiedene Ursachen: Ein Eintrag mit dem Kennzeichen{" "}
                <em>{`„über Mitternacht“`}</em> beginnt in Wahrheit am Vorabend — der Nachweis
                schneidet ihn nur am Tageswechsel ab und zeigt für den Folgetag 00:00 an
                (typischerweise vergessenes Ausstempeln). Nur ein Eintrag mit dem Kennzeichen{" "}
                <em>{`„Beginn 00:00“`}</em> ist wirklich auf Mitternacht gespeichert.
              </div>
              <EntryEditor entries={editableEntries} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ExportLink({
  href,
  icon,
  label,
  info,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  info?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link
        href={href}
        className="inline-flex items-center gap-2 rounded-xl border border-teal/30 bg-white px-3.5 py-2 text-sm font-medium text-teal hover:bg-surface"
      >
        {icon}
        {label}
      </Link>
      {info && <InfoHint>{info}</InfoHint>}
    </span>
  );
}
