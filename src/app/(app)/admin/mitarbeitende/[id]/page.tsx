import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Download, FileJson, ShieldAlert } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { getUserDetail } from "@/lib/users";
import { MAX_PIN_FAILURES, PIN_BLOCK_MINUTES } from "@/lib/kiosk-pin";
import { getVacationAccount } from "@/lib/absences";
import { berlinDayKey, formatClock, formatDayKey, formatDays, type WeekdayHours } from "@/lib/time";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoHint } from "@/components/ui/info-hint";
import { ProfileForm, ScheduleForm, ResetPasswordForm, KioskPinForm } from "../forms";
import { toggleActiveAction, anonymizeUserAction, resetTwoFactorAction, removeKioskPinAction } from "../actions";

export const metadata: Metadata = { title: "Konto verwalten" };

const DAY_LABELS: [keyof WeekdayHours, string][] = [
  ["mon", "Mo"], ["tue", "Di"], ["wed", "Mi"], ["thu", "Do"],
  ["fri", "Fr"], ["sat", "Sa"], ["sun", "So"],
];

function scheduleSummary(hours: WeekdayHours): string {
  return DAY_LABELS.filter(([k]) => hours[k] > 0)
    .map(([k, label]) => `${label} ${String(hours[k]).replace(".", ",")}`)
    .join(" · ") || "keine Arbeitstage";
}

export default async function AdminEmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fehler?: string; ok?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { fehler, ok } = await searchParams;

  const user = await getUserDetail(id);
  if (!user) notFound();

  const now = new Date();
  const todayKey = berlinDayKey(now);
  // Schedules arrive newest first, so the first one already in force is the one
  // that applies today; every older row only covers its own past period.
  const currentScheduleId = user.schedules.find((s) => s.effectiveFrom <= todayKey)?.id;
  const year = Number(todayKey.slice(0, 4));
  const account = await getVacationAccount(id, year);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/mitarbeitende" className="inline-flex items-center gap-1 text-sm text-muted hover:text-teal">
          <ArrowLeft className="h-4 w-4" /> Alle Mitarbeitenden
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-medium tracking-tight text-ink">{user.name}</h1>
          <Badge tone={user.role === "ADMIN" ? "teal" : "neutral"}>
            {user.role === "ADMIN" ? "Admin" : "Mitarbeiter:in"}
          </Badge>
          {user.active ? <Badge tone="lime">aktiv</Badge> : <Badge tone="danger">inaktiv</Badge>}
          {user.anonymizedAt && <Badge tone="neutral">anonymisiert</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted">{user.email}</p>
      </div>

      {ok && (
        <p className="flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
          <Check className="h-4 w-4" /> Aktion erfolgreich ausgeführt.
        </p>
      )}
      {fehler && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{fehler}</p>
      )}

      {/* ── Profile ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profil &amp; Status</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm
            user={{
              userId: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              bundesland: user.bundesland,
              birthDate: user.birthDate,
              employmentStart: user.employmentStart,
              employmentEnd: user.employmentEnd,
              isMinijob: user.isMinijob,
              exemptFromTimeRecording: user.exemptFromTimeRecording,
              exemptFromAutoBreak: user.exemptFromAutoBreak,
            }}
          />
        </CardContent>
      </Card>

      {/* ── Schedules ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Arbeitszeiten</CardTitle>
          <CardDescription>
            Eine neue Arbeitszeit gilt ab dem gewählten Datum; frühere Zeiträume bleiben unverändert
            (effektiv-datiert, kein Neuberechnen der Vergangenheit).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ScheduleForm userId={user.id} todayKey={todayKey} />
          {user.schedules.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-black/[0.06]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/[0.06] text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Gültig ab
                        <InfoHint>{`Datum, ab dem die Zeile gilt. 'aktuell' kennzeichnet die eine Zeile, die heute gilt: die jüngste mit 'Gültig ab' heute oder früher. Ältere Zeilen gelten für ihren damaligen Zeitraum weiter; künftig datierte greifen erst ab ihrem Datum.`}</InfoHint>
                      </span>
                    </th>
                    <th className="px-4 py-2 font-medium">Verteilung</th>
                    <th className="px-4 py-2 text-right font-medium">
                      <span className="inline-flex items-center gap-1">
                        Woche
                        <InfoHint>{`Wochensoll in Stunden – die Summe der Wochentagsstunden dieser Zeile.`}</InfoHint>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {user.schedules.map((s) => {
                    const inEffect = s.id === currentScheduleId;
                    return (
                      <tr key={s.id} className="border-b border-black/[0.04] last:border-0">
                        <td className="whitespace-nowrap px-4 py-2 font-medium text-ink">
                          {formatDayKey(s.effectiveFrom)}
                          {inEffect && <span className="ml-2 text-xs font-normal text-lime-dark">aktuell</span>}
                        </td>
                        <td className="px-4 py-2 text-muted">{scheduleSummary(s.hours)}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {String(s.weekly).replace(".", ",")} h
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

      {/* ── Vacation snapshot (entitlement is edited on the absence screen) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Urlaubskonto {year}</CardTitle>
          <CardDescription>
            Anspruch, Übertrag und Schwerbehindertenstatus werden unter{" "}
            <Link href="/admin/abwesenheiten" className="text-teal hover:underline">
              Abwesenheiten
            </Link>{" "}
            verwaltet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: "Anspruch",
                value: formatDays(account.entitlement.total),
                info: `Jahresanspruch gesamt: Vertragsurlaub bzw. höherer gesetzlicher Mindestanspruch (z. B. JArbSchG), anteilig bei Ein-/Austritt (Zwölftelung), Zusatzurlaub bei Schwerbehinderung (§208 SGB IX) und Übertrag aus dem Vorjahr.`,
              },
              {
                label: "Genommen",
                value: formatDays(account.taken),
                info: `Bereits genehmigte Urlaubstage in diesem Jahr (Arbeitstage). Noch offene Anträge sind hier nicht enthalten.`,
              },
              {
                label: "Verbleibend",
                value: formatDays(account.remaining),
                info: `Anspruch minus genommene Tage. Noch offene (nicht genehmigte) Anträge werden hier nicht abgezogen.`,
              },
              {
                label: "Krank",
                value: formatDays(account.sickDays),
                info: `Erfasste Krankheitstage in diesem Jahr (Arbeitstage). Krankheit mindert den Urlaubsanspruch nicht (§9 BUrlG).`,
              },
            ].map((c) => (
              <div key={c.label} className="rounded-xl bg-surface px-4 py-3">
                <dt className="flex items-center gap-1 text-xs text-muted">
                  {c.label}
                  <InfoHint>{c.info}</InfoHint>
                </dt>
                <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-ink">{c.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* ── Password reset ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Passwort zurücksetzen</CardTitle>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm userId={user.id} />
        </CardContent>
      </Card>

      {/* ── Data export & status ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status &amp; Datenschutz</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/api/admin/export/dsgvo?user=${user.id}`}
              className="inline-flex items-center gap-2 rounded-xl border border-teal/30 bg-white px-4 py-2 text-sm font-medium text-teal hover:bg-surface"
            >
              <FileJson className="h-4 w-4" /> Daten exportieren (Art. 15)
            </Link>
            <InfoHint>{`Lädt alle zu dieser Person gespeicherten Daten als JSON herunter (DSGVO-Auskunft, Art. 15): Profil, Zeiten, Korrekturen, Abwesenheiten und Protokoll. Ohne Passwort-Hash.`}</InfoHint>
            <Link
              href={`/admin/zeiten?user=${user.id}`}
              className="inline-flex items-center gap-2 rounded-xl border border-teal/30 bg-white px-4 py-2 text-sm font-medium text-teal hover:bg-surface"
            >
              <Download className="h-4 w-4" /> Zeiten &amp; Monatsexport
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-black/[0.06] pt-4">
            <form action={toggleActiveAction}>
              <input type="hidden" name="userId" value={user.id} />
              <input type="hidden" name="active" value={(!user.active).toString()} />
              <button
                className={`rounded-xl px-4 py-2 text-sm font-medium ${
                  user.active
                    ? "border border-danger/30 text-danger hover:bg-danger/10"
                    : "bg-lime text-white hover:bg-lime-dark"
                }`}
              >
                {user.active ? "Konto deaktivieren" : "Konto aktivieren"}
              </button>
            </form>
            <InfoHint>{`Sperrt die Anmeldung, löscht aber keine Daten. Das letzte aktive Admin-Konto kann nicht deaktiviert werden.`}</InfoHint>
            <p className="text-xs text-muted">
              Deaktivieren statt Löschen — Arbeitszeitnachweise unterliegen gesetzlichen
              Aufbewahrungsfristen.
            </p>
          </div>

          {!user.anonymizedAt && (
            <div className="flex flex-wrap items-center gap-3 border-t border-black/[0.06] pt-4">
              <span className="text-sm text-ink">
                Zwei-Faktor-Anmeldung:{" "}
                {user.twoFactorEnabled ? (
                  <Badge tone="lime">eingeschaltet</Badge>
                ) : (
                  <Badge tone="neutral">{user.role === "ADMIN" ? "noch nicht eingerichtet" : "aus"}</Badge>
                )}
              </span>
              {user.twoFactorEnabled && (
                <form action={resetTwoFactorAction}>
                  <input type="hidden" name="userId" value={user.id} />
                  <button className="rounded-xl border border-danger/30 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10">
                    Zwei-Faktor zurücksetzen
                  </button>
                </form>
              )}
              <InfoHint>{`Für verlorene Handys ohne Wiederherstellungscodes: entfernt App-Verknüpfung und Codes. Danach genügt das Passwort, bis die Person neu einrichtet — bei Konten mit Verwaltungsrechten wird das sofort nach der Anmeldung verlangt. Das eigene Konto wird unter „Mein Konto“ verwaltet. Wird protokolliert.`}</InfoHint>
            </div>
          )}

          {!user.anonymizedAt && user.active && (
            <div className="space-y-3 border-t border-black/[0.06] pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-ink">
                  Terminal-PIN:{" "}
                  {user.kioskPinSet ? <Badge tone="lime">vergeben</Badge> : <Badge tone="neutral">keine</Badge>}
                </span>
                {user.kioskPinBlockedUntil && user.kioskPinBlockedUntil > now && (
                  <Badge tone="danger">gesperrt bis {formatClock(user.kioskPinBlockedUntil)} Uhr</Badge>
                )}
                {user.kioskPinSet && (
                  <form action={removeKioskPinAction}>
                    <input type="hidden" name="userId" value={user.id} />
                    <button className="rounded-xl border border-danger/30 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10">
                      PIN entfernen
                    </button>
                  </form>
                )}
                <InfoHint>{`Für Personen ohne Smartphone: Am Stempel-Terminal Namen antippen und die sechsstellige PIN eingeben. Funktioniert nur an Terminals, an denen „Stempeln mit PIN“ eingeschaltet ist (Verwaltung → Terminals). Die PIN wird nur einmal angezeigt; eine neue ersetzt die alte. Nach ${MAX_PIN_FAILURES} falschen Versuchen ist die PIN ${PIN_BLOCK_MINUTES} Minuten gesperrt. Wird protokolliert.`}</InfoHint>
              </div>
              <KioskPinForm userId={user.id} hasPin={user.kioskPinSet} />
            </div>
          )}

          {!user.anonymizedAt && (
            <div className="rounded-xl border border-danger/20 bg-danger/[0.04] p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-danger">
                <ShieldAlert className="h-4 w-4" /> Anonymisieren (DSGVO Art. 17)
                <InfoHint>{`Unwiderruflich: überschreibt Name, E-Mail, Geburtsdatum, Bundesland und Schwerbehindertenstatus, löscht Freitext-Notizen aus Zeiten/Abwesenheiten und deaktiviert das Konto. Arbeitszeit-Fakten bleiben erhalten.`}</InfoHint>
              </div>
              <p className="mb-3 text-xs text-muted">
                Entfernt personenbezogene Daten unwiderruflich; Arbeitszeit-Fakten bleiben für die
                gesetzliche Aufbewahrung erhalten. Erst nach Ablauf der Aufbewahrungsfrist anwenden.
                Zur Bestätigung <strong>ANONYMISIEREN</strong> eingeben.
              </p>
              <form action={anonymizeUserAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="userId" value={user.id} />
                <input
                  name="confirm"
                  placeholder="ANONYMISIEREN"
                  className="h-9 w-44 rounded-xl border border-black/10 bg-white px-3 text-sm"
                />
                <button className="rounded-xl bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger-dark">
                  Endgültig anonymisieren
                </button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
