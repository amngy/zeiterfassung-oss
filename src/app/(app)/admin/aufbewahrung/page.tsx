import type { Metadata } from "next";
import Link from "next/link";
import { Archive, Check, ShieldAlert } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { getRetentionReport, totalRecords, type RetentionCounts } from "@/lib/retention";
import { MIN_RETENTION_YEARS } from "@/lib/time/retention";
import { berlinDayKey, formatDayKey } from "@/lib/time";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { purgeExpiredAction } from "./actions";

export const metadata: Metadata = { title: "Aufbewahrung" };

const ROWS: { key: keyof RetentionCounts; label: string; info: string }[] = [
  { key: "timeEntries", label: "Zeiteinträge", info: "Arbeits- und Pausenzeiten, die vor dem Stichtag begonnen haben — auch ersetzte und stornierte Versionen." },
  { key: "clockEvents", label: "Stempelereignisse", info: "Die einzelnen Stempelungen (Zeitpunkt, Erfassungsweg) zu diesen Einträgen. Sie fallen mit ihrem Eintrag weg." },
  { key: "corrections", label: "Korrekturanträge", info: "Vor dem Stichtag gestellte Anträge, gleich ob offen, genehmigt oder abgelehnt." },
  { key: "absences", label: "Abwesenheiten", info: "Urlaub, Krankheit und andere Abwesenheiten, die vor dem Stichtag geendet haben. Eine Abwesenheit über den Stichtag hinweg bleibt." },
  { key: "vacationYears", label: "Urlaubsjahre", info: "Urlaubsanspruch, Übertrag und Verfall der Jahre vor dem Stichtag." },
  { key: "auditEntries", label: "Protokolleinträge", info: "Einträge im Änderungsprotokoll, die vor dem Stichtag geschrieben wurden. Die Löschung selbst wird protokolliert (nur Anzahl und Stichtag)." },
];

const dateDe = (key: string) => key.split("-").reverse().join(".");
const instantDe = (d: Date) => formatDayKey(berlinDayKey(d)).slice(4);

export default async function AdminRetentionPage({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string; geloescht?: string; geraete?: string; anonymisiert?: string }>;
}) {
  await requireAdmin();
  const { fehler, geloescht, geraete, anonymisiert } = await searchParams;
  const report = await getRetentionReport();
  const total = totalRecords(report.counts);
  const cutoff = dateDe(`${report.cutoffYear}-01-01`);
  const devices = report.counts.deviceLabels;
  const nothingToDo = total === 0 && devices === 0 && report.departed.length === 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-ink">Aufbewahrung &amp; Löschung</h1>
        <p className="text-sm text-muted">
          Daten, deren Aufbewahrungsfrist abgelaufen ist, sind zu löschen (Art. 5 Abs. 1 lit. e, Art. 17
          DSGVO). Die Löschung läuft nicht automatisch, sondern erst nach Ihrer Bestätigung.
        </p>
      </header>

      {geloescht !== undefined && (
        <p className="flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
          <Check className="h-4 w-4" /> {geloescht} Datensätze gelöscht, {geraete ?? 0} Gerätetypen entfernt,{" "}
          {anonymisiert ?? 0} Konten anonymisiert.
        </p>
      )}
      {fehler && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{fehler}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Archive className="h-4 w-4 text-teal" /> Abgelaufene Datensätze
            <InfoHint>{`Fristen laufen ab dem Ende des Kalenderjahres, in dem ein Datensatz entstanden ist. Bei ${report.retentionYears} Jahren darf heute alles gelöscht werden, was vor dem ${cutoff} liegt. Arbeitszeitmodelle und Feiertage bleiben, ebenso alles ab dem Stichtag.`}</InfoHint>
          </CardTitle>
          <CardDescription>
            Aufbewahrungsfrist {report.retentionYears} Jahre (
            <Link href="/admin/einstellungen" className="text-teal underline underline-offset-2">
              Einstellungen
            </Link>
            ){report.configuredYears < MIN_RETENTION_YEARS && <> — eingestellt sind {report.configuredYears}, gesetzlich gelten mindestens {MIN_RETENTION_YEARS}</>}.
            Stichtag: alles vor dem <strong>{cutoff}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <table className="w-full max-w-md text-sm">
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key} className="border-b border-black/5 last:border-0">
                  <td className="py-1.5 text-ink">
                    {r.label} <InfoHint>{r.info}</InfoHint>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{report.counts[r.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-sm text-ink">
            Gerätetypen von Stempelungen vor dem <strong>{instantDe(report.deviceCutoff)}</strong>: {devices}{" "}
            <InfoHint>{`Der Gerätetyp (z. B. „iPhone · Safari“) muss nicht aufbewahrt werden und wird nach ${report.deviceLabelMonths} Monaten entfernt (Einstellungen → Stempeln). Zeitpunkt und Erfassungsweg der Stempelung bleiben.`}</InfoHint>
          </p>

          <div>
            <p className="text-sm font-medium text-ink">
              Ausgeschiedene Konten zum Anonymisieren: {report.departed.length}{" "}
              <InfoHint>{`Deaktivierte Konten mit einem Austrittsdatum vor dem Stichtag. Sie werden wie unter Mitarbeitende → Anonymisieren behandelt: Name, E-Mail und weitere Stammdaten werden überschrieben.`}</InfoHint>
            </p>
            {report.departed.length > 0 && (
              <ul className="mt-1 text-sm text-muted">
                {report.departed.map((u) => (
                  <li key={u.id}>
                    <Link href={`/admin/mitarbeitende/${u.id}`} className="text-teal underline underline-offset-2">
                      {u.name}
                    </Link>{" "}
                    · Austritt {dateDe(u.employmentEnd)}
                  </li>
                ))}
              </ul>
            )}
            {report.inactiveWithoutEnd > 0 && (
              <p className="mt-1 text-xs text-muted">
                {report.inactiveWithoutEnd} deaktivierte Konten ohne Austrittsdatum bleiben unberührt — ohne
                Datum lässt sich die Frist nicht berechnen. Bei Bedarf das Austrittsdatum im Konto eintragen.
              </p>
            )}
          </div>

          {nothingToDo ? (
            <p className="rounded-lg bg-lime/15 px-3 py-2 text-sm text-lime-dark">
              Nichts zu tun: keine Datensätze vor dem Stichtag.
            </p>
          ) : (
            <div className="rounded-xl border border-danger/20 bg-danger/[0.04] p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-danger">
                <ShieldAlert className="h-4 w-4" /> Endgültig löschen
              </div>
              <p className="mb-3 text-xs text-muted">
                Unwiderruflich. Vorher prüfen, ob für einzelne Unterlagen längere Fristen gelten (z. B.
                Lohnunterlagen, laufende Verfahren), und eine Sicherung anlegen — in älteren Sicherungen bleiben
                die Daten bis zu deren Löschung erhalten. Zur Bestätigung <strong>LÖSCHEN</strong> eingeben.
              </p>
              <form action={purgeExpiredAction} className="flex flex-wrap items-center gap-2">
                <input
                  name="confirm"
                  placeholder="LÖSCHEN"
                  aria-label="Bestätigung"
                  className="h-9 w-44 rounded-xl border border-black/10 bg-white px-3 text-sm"
                />
                <button className="rounded-xl bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger-dark">
                  {total} Datensätze löschen
                  {devices > 0 && `, ${devices} Gerätetypen entfernen`}
                  {report.departed.length > 0 && `, ${report.departed.length} Konten anonymisieren`}
                </button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
