import type { Metadata } from "next";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  TrendingUp,
  Users,
  AlertTriangle,
} from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { getStatistics } from "@/lib/stats";
import { getStaffVacationOverview } from "@/lib/absences";
import { listOvertimeAccounts } from "@/lib/overtime";
import { getAppSettings } from "@/lib/settings";
import {
  addDaysToKey,
  berlinDayKey,
  formatDayKey,
  formatDays,
  formatHm,
  formatSigned,
  formatMonth,
  monthRangeOf,
} from "@/lib/time";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoHint } from "@/components/ui/info-hint";
import {
  EmployeeComparisonChart,
  WorkedTrendChart,
  type EmployeeBar,
  type DayPoint,
} from "./charts";

export const metadata: Metadata = { title: "Auswertungen" };

const ABSENCE_INFO = `Bezahlte Zeit, die für genehmigten Urlaub oder erfasste Krankheit gutgeschrieben wurde. Das Soll bleibt dabei stehen – die Stunden werden nicht gestrichen, sondern ausgeglichen. Es gilt: Saldo = Ist + Abwesenheit − Soll.`;

const HOUR_MS = 3_600_000;
const h1 = (ms: number) => Math.round((ms / HOUR_MS) * 10) / 10;

export default async function AdminStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ monat?: string }>;
}) {
  await requireAdmin();
  const { monat } = await searchParams;

  const todayKey = berlinDayKey(new Date());
  const year = Number(todayKey.slice(0, 4));
  const monthKey = /^\d{4}-\d{2}$/.test(monat ?? "") ? monat! : todayKey.slice(0, 7);
  const anchor = `${monthKey}-01`;
  const { from, to } = monthRangeOf(anchor);

  const [stats, vacation, overtime, settings] = await Promise.all([
    getStatistics(from, to, new Date()),
    getStaffVacationOverview(year),
    listOvertimeAccounts(new Date()),
    getAppSettings(),
  ]);
  const limits = settings.overtimeLimits;

  const prevMonth = addDaysToKey(from, -1).slice(0, 7);
  const nextMonth = addDaysToKey(to, 1).slice(0, 7);
  const navLink = (m: string) => `/admin/auswertung?monat=${m}`;

  const employeeBars: EmployeeBar[] = stats.employees.map((e) => ({
    name: e.name,
    worked: h1(e.workedMs),
    expected: h1(e.expectedMs),
  }));
  const dayPoints: DayPoint[] = stats.perDay.map((d) => ({
    label: `${d.dayKey.slice(8, 10)}.${d.dayKey.slice(5, 7)}.`,
    hours: d.workedHours,
  }));

  const kpis = [
    {
      label: "Ist gesamt",
      value: formatHm(stats.totals.workedMs),
      icon: Clock,
      tone: "ink" as const,
      info: `Summe der tatsächlich geleisteten Arbeitszeit aller erfassten Mitarbeitenden im Monat – ohne Pausen (die Pausenzeit ist bereits abgezogen).`,
    },
    {
      label: "Soll gesamt",
      value: formatHm(stats.totals.expectedMs),
      icon: Clock,
      tone: "muted" as const,
      info: `Vertraglich geschuldete Arbeitszeit für den gesamten Monat laut hinterlegtem Arbeitszeitmodell (Wochenstunden je Wochentag). Feiertage und Teilzeit sind berücksichtigt.`,
    },
    {
      label: "Saldo bis heute",
      value: formatSigned(stats.totals.balanceMs),
      icon: TrendingUp,
      tone: stats.totals.balanceMs < 0 ? ("danger" as const) : ("lime" as const),
      info: `Ist minus Soll, aber nur bis zum heutigen Tag gerechnet – künftige Soll-Stunden des Monats zählen noch nicht. Deshalb nicht direkt mit „Soll gesamt“ vergleichbar.`,
    },
    {
      label: "Erfasste Mitarbeitende",
      value: String(stats.totals.headcount),
      icon: Users,
      tone: "ink" as const,
      info: `Anzahl der berücksichtigten Personen: nur aktive und erfassungspflichtige Mitarbeitende. Von der Zeiterfassung befreite oder inaktive Konten sind ausgenommen.`,
    },
    {
      label: "Offene Hinweise",
      value: String(stats.totals.violations),
      icon: AlertTriangle,
      tone: stats.totals.violations > 0 ? ("warning" as const) : ("ink" as const),
      info: `Anzahl arbeitszeitrechtlicher Warnungen (z. B. Höchstarbeitszeit, Pause, Ruhezeit, Sonn-/Feiertag) nach ArbZG – bei Minderjährigen nach JArbSchG. Rechtlich zu prüfen.`,
    },
    {
      label: "Offene Einträge",
      value: String(stats.totals.openAnomalies),
      icon: AlertTriangle,
      tone: stats.totals.openAnomalies > 0 ? ("danger" as const) : ("ink" as const),
      info: `Nicht abgeschlossene Zeiteinträge – z. B. ein vergessener Stempel-Stopp oder eine offene Pause ohne laufende Arbeit. Sie zählen nicht als Arbeitszeit und müssen korrigiert werden.`,
    },
  ];

  const toneClass: Record<string, string> = {
    ink: "text-ink",
    muted: "text-muted",
    lime: "text-lime-dark",
    danger: "text-danger",
    warning: "text-amber-700",
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-ink">Auswertungen</h1>
          <p className="text-sm text-muted">{formatMonth(anchor)} · Kennzahlen, Diagramme und Urlaubsübersicht.</p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={navLink(prevMonth)} className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label="Vormonat">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link href={navLink(nextMonth)} className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label="Folgemonat">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-black/[0.06] bg-surface px-4 py-3.5 shadow-card">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
              <k.icon className="h-3.5 w-3.5" />
              {k.label}
              {k.info && <InfoHint>{k.info}</InfoHint>}
            </div>
            <div className={`font-mono text-xl font-semibold tabular-nums ${toneClass[k.tone]}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Charts ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ist vs. Soll je Mitarbeiter:in</CardTitle>
          </CardHeader>
          <CardContent>
            <EmployeeComparisonChart data={employeeBars} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gearbeitete Stunden im Verlauf</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkedTrendChart data={dayPoints} />
          </CardContent>
        </Card>
      </div>

      {/* ── Per-employee table ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detail je Mitarbeiter:in</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-black/[0.06] text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2 font-medium">Mitarbeiter:in</th>
                  <th className="px-5 py-2 text-right font-medium">Ist</th>
                  <th className="px-5 py-2 text-right font-medium">Soll</th>
                  <th className="px-5 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Saldo
                      <InfoHint>{`Ist minus Soll, nur bis heute gerechnet – künftige Soll-Stunden des Monats zählen noch nicht. Grün bei Plus, rot bei Minus.`}</InfoHint>
                    </span>
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Ø Tag
                      <InfoHint>{`Durchschnittliche Arbeitszeit je Tag mit erfasster Arbeit – gemittelt nur über Tage mit Buchungen, nicht über alle Kalender- oder Solltage.`}</InfoHint>
                    </span>
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Pause
                      <InfoHint>{`Summe der erfassten Pausenzeit im Zeitraum. Pausen zählen nicht als Arbeitszeit und sind in „Ist“ bereits herausgerechnet (Anwesenheit = Ist + Pause).`}</InfoHint>
                    </span>
                  </th>
                  <th className="px-5 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Hinweise
                      <InfoHint>{`Gelbe Zahl: arbeitszeitrechtliche Warnungen (ArbZG/JArbSchG) im Zeitraum. Badge „offen“: ein nicht abgeschlossener Zeiteintrag, der korrigiert werden muss.`}</InfoHint>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.employees.map((e) => (
                  <tr key={e.userId} className="border-b border-black/[0.04] last:border-0">
                    <td className="px-5 py-2.5 font-medium text-ink">
                      <Link href={`/admin/zeiten?user=${e.userId}&monat=${monthKey}`} className="hover:text-teal">
                        {e.name}
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums">{formatHm(e.workedMs, false)}</td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums text-muted">{formatHm(e.expectedMs, false)}</td>
                    <td className={`px-5 py-2.5 text-right font-mono tabular-nums ${e.balanceMs < 0 ? "text-danger" : "text-lime-dark"}`}>
                      {formatSigned(e.balanceMs, false)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums text-muted">{formatHm(e.avgDailyWorkedMs, false)}</td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums text-muted">{formatHm(e.breakMs, false)}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {e.violations > 0 ? <Badge tone="warning">{e.violations}</Badge> : <span className="text-muted">—</span>}
                        {e.hasOpenAnomaly && <Badge tone="danger">offen</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stats.employees.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">Keine erfassten Mitarbeitenden.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Arbeitszeitkonten (#22) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-base">
            Arbeitszeitkonten
            <InfoHint>{`Stand heute je Person mit Arbeitszeitkonto: täglicher Saldo seit Beginn des Kontos plus Buchungen. Eingerichtet und gebucht wird bei der Person (Mitarbeitende → Person). Grenzen unter Einstellungen; markiert wird nur, gebucht wird nichts automatisch.`}</InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {overtime.length === 0 ? (
            <p className="px-5 text-sm text-muted">Noch für niemanden eingerichtet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-black/[0.06] text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-5 py-2 font-medium">Mitarbeiter:in</th>
                    <th className="px-5 py-2 font-medium">Seit</th>
                    <th className="px-5 py-2 text-right font-medium">Stand heute</th>
                    <th className="px-5 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {overtime.map((o) => (
                    <tr key={o.userId} className="border-b border-black/[0.04] last:border-0">
                      <td className="px-5 py-2.5 font-medium text-ink">
                        <Link href={`/admin/mitarbeitende/${o.userId}`} className="hover:text-teal">
                          {o.name}
                        </Link>
                      </td>
                      <td className="px-5 py-2.5 text-muted">{formatDayKey(o.fromKey)}</td>
                      <td className={`px-5 py-2.5 text-right font-mono tabular-nums ${o.balanceMs < 0 ? "text-danger" : ""}`}>
                        {formatSigned(o.balanceMs)}
                      </td>
                      <td className="px-5 py-2.5">
                        {o.overCapMs > 0 && <Badge tone="warning">{formatHm(o.overCapMs)} über {limits.capHours} h</Badge>}
                        {o.underFloorMs > 0 && <Badge tone="danger">{formatHm(o.underFloorMs)} unter −{limits.floorHours} h</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Vacation / sick overview ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Urlaubs- &amp; Krankheitsübersicht {year}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-black/[0.06] text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2 font-medium">Mitarbeiter:in</th>
                  <th className="px-5 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Anspruch
                      <InfoHint>{`Jahresurlaub in Arbeitstagen inkl. Übertrag aus dem Vorjahr, anteilig bei unterjährigem Ein-/Austritt und Teilzeit. Bei Schwerbehinderung zzgl. Zusatzurlaub (§208 SGB IX).`}</InfoHint>
                    </span>
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Genommen
                      <InfoHint>{`Bereits genehmigte und damit verbrauchte Urlaubstage dieses Jahres (in Arbeitstagen). Noch offene Anträge stehen in der Spalte „Offen“.`}</InfoHint>
                    </span>
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Offen
                      <InfoHint>{`Beantragte, aber noch nicht genehmigte Urlaubstage. Sie mindern „Verbleibend“ noch nicht – erst nach Genehmigung wandern sie in „Genommen“.`}</InfoHint>
                    </span>
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Verbleibend
                      <InfoHint>{`Anspruch minus genommener Urlaub. Achtung: noch offene (beantragte) Tage sind hier NICHT abgezogen – der frei verplanbare Rest ist entsprechend geringer.`}</InfoHint>
                    </span>
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Krank
                      <InfoHint>{`Erfasste Krankheitstage dieses Jahres (in Arbeitstagen). Krankheit mindert den Urlaubsanspruch nicht; Krankheit während des Urlaubs kann nach §9 BUrlG (mit AU) gutgeschrieben werden.`}</InfoHint>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {vacation.map(({ user, account }) => (
                  <tr key={user.id} className="border-b border-black/[0.04] last:border-0">
                    <td className="px-5 py-2.5 font-medium text-ink">{user.name}</td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums">{formatDays(account.entitlement.total)}</td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums">{formatDays(account.taken)}</td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums text-muted">{formatDays(account.planned)}</td>
                    <td className={`px-5 py-2.5 text-right font-mono tabular-nums ${account.remaining < 0 ? "text-danger" : "text-lime-dark"}`}>
                      {formatDays(account.remaining)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums">{formatDays(account.sickDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 pt-3 text-xs text-muted">
            Die Auswertung berücksichtigt nur aktive, erfassungspflichtige Mitarbeitende. Hinweise
            beruhen auf dem konfigurierbaren Regelprofil und sind rechtlich zu prüfen.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
