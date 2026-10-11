import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getUserAbsences, getVacationAccount } from "@/lib/absences";
import { getHolidaysInRange, resolveRegion } from "@/lib/holidays";
import {
  addDaysToKey,
  berlinDayKey,
  eachDayKey,
  formatDayKey,
  formatDays,
  monthRangeOf,
} from "@/lib/time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoHint } from "@/components/ui/info-hint";
import {
  CalendarLegend,
  MonthCalendar,
  formatMonth,
  type CalendarMark,
} from "@/components/calendar/month-calendar";
import { SickRecordForm, VacationRequestForm } from "./request-forms";
import { withdrawRequestAction } from "./actions";
import { ABSENCE_LABEL, isSicknessKind } from "@/lib/time/absence-kinds";

const fmtDays = formatDays;

export const metadata: Metadata = { title: "Urlaub & Abwesenheit" };

export default async function AbsencePage({
  searchParams,
}: {
  searchParams: Promise<{ monat?: string }>;
}) {
  const user = await requireUser();
  const { monat } = await searchParams;

  const asOf = new Date();
  const todayKey = berlinDayKey(asOf);
  const year = Number(todayKey.slice(0, 4));

  const monthAnchor = /^\d{4}-\d{2}$/.test(monat ?? "") ? `${monat}-01` : `${todayKey.slice(0, 7)}-01`;
  const { from, to } = monthRangeOf(monthAnchor);

  const [account, settings, dbUser, absences] = await Promise.all([
    getVacationAccount(user.id, year),
    getAppSettings(),
    prisma.user.findUnique({ where: { id: user.id }, select: { bundesland: true } }),
    getUserAbsences(user.id),
  ]);
  const region = resolveRegion(dbUser?.bundesland, settings);
  const holidays = await getHolidaysInRange(region, from, to);

  // Build the calendar marks for the visible month.
  const marks = new Map<string, CalendarMark[]>();
  const addMark = (key: string, mark: CalendarMark) => {
    const list = marks.get(key) ?? [];
    list.push(mark);
    marks.set(key, list);
  };
  for (const h of holidays) {
    addMark(h.dayKey, {
      tone: h.type === "PUBLIC" ? "holiday" : "gifted",
      label: `${h.name}${h.fraction === "HALF" ? " (halber Tag)" : ""}`,
    });
  }
  for (const a of absences) {
    const aFrom = berlinDayKey(a.startDate, "UTC");
    const aTo = berlinDayKey(a.endDate, "UTC");
    if (aTo < from || aFrom > to) continue;
    if (a.status === "REJECTED" || a.status === "CANCELLED") continue;
    const tone: CalendarMark["tone"] = isSicknessKind(a.type)
      ? "sick"
      : a.status === "APPROVED"
        ? "vacation"
        : "vacation-pending";
    const label = `${ABSENCE_LABEL[a.type]}${a.status === "PENDING" ? " (beantragt)" : ""}`;
    for (const key of eachDayKey(aFrom < from ? from : aFrom, aTo > to ? to : aTo)) {
      addMark(key, { tone, label });
    }
  }

  const prevMonth = addDaysToKey(from, -1).slice(0, 7);
  const nextMonth = addDaysToKey(to, 1).slice(0, 7);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-ink">Urlaub &amp; Abwesenheit</h1>
        <p className="text-sm text-muted">
          Urlaubskonto, Anträge und Krankmeldungen für {year}.
        </p>
      </header>

      <VacationAccountCard account={account} />

      <div className="grid gap-4 lg:grid-cols-2">
        <VacationRequestForm todayKey={todayKey} />
        <SickRecordForm todayKey={todayKey} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(320px,420px)]">
        <AbsenceList absences={absences} />

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">{formatMonth(monthAnchor)}</CardTitle>
              <div className="flex items-center gap-1">
                <Link
                  href={`/abwesenheit?monat=${prevMonth}`}
                  className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"
                  aria-label="Vormonat"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Link>
                <Link
                  href={`/abwesenheit?monat=${nextMonth}`}
                  className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"
                  aria-label="Folgemonat"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <MonthCalendar monthAnchor={monthAnchor} marks={marks} todayKey={todayKey} />
            <CalendarLegend
              items={[
                { tone: "holiday", label: "Feiertag" },
                {
                  tone: "gifted",
                  label: "Sonderfrei",
                  hint: `Betrieblich geschenkter freier Tag (z. B. Heiligabend), zusätzlich zu gesetzlichen Feiertagen; ggf. nur halbtags. Senkt die Soll-Stunden und verbraucht keinen Urlaub.`,
                },
                { tone: "vacation", label: "Urlaub" },
                {
                  tone: "vacation-pending",
                  label: "beantragt",
                  hint: `Beantragter, aber noch nicht genehmigter Urlaub. Genehmigter Urlaub wird separat grün als „Urlaub“ angezeigt.`,
                },
                { tone: "sick", label: "Krank" },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function VacationAccountCard({
  account,
}: {
  account: Awaited<ReturnType<typeof getVacationAccount>>;
}) {
  const e = account.entitlement;
  const stats: { label: string; value: string; tone?: "lime" | "danger"; info?: string }[] = [
    {
      label: "Anspruch",
      value: fmtDays(e.annual),
      info: `In diesem Jahr erworbener Urlaubsanspruch: anteilig nach Beschäftigungsmonaten (§5 BUrlG) zzgl. evtl. Zusatzurlaub bei Schwerbehinderung. Ohne Übertrag aus dem Vorjahr.`,
    },
    {
      label: "Übertrag",
      value: fmtDays(e.carryOver),
      info: `Aus dem Vorjahr übertragene Resturlaubstage; werden von der Verwaltung gepflegt. In 'Verbleibend' sind sie bereits enthalten.`,
    },
    {
      label: "Genommen",
      value: fmtDays(account.taken),
      info: `Bereits genehmigte und damit verbrauchte Urlaubstage in diesem Jahr. Noch ausstehende Anträge zählen hier nicht mit.`,
    },
    {
      label: "Beantragt",
      value: fmtDays(account.planned),
      info: `Beantragte, aber noch nicht genehmigte Urlaubstage. Achtung: In 'Verbleibend' sind diese Tage noch nicht abgezogen.`,
    },
    {
      label: "Verbleibend",
      value: fmtDays(account.remaining),
      tone: account.remaining < 0 ? "danger" : "lime",
      info: `Anspruch + Übertrag − Genommen. Noch offene Anträge ('Beantragt') sind hier bewusst NICHT abgezogen; der sicher verplanbare Rest ist entsprechend kleiner.`,
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Urlaubskonto {account.year}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl bg-white px-4 py-3 shadow-sm">
              <dt className="flex items-center gap-1 text-xs text-muted">
                {s.label}
                {s.info && <InfoHint>{s.info}</InfoHint>}
              </dt>
              <dd
                className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
                  s.tone === "danger" ? "text-danger" : s.tone === "lime" ? "text-lime-dark" : "text-ink"
                }`}
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>

        <ul className="mt-4 space-y-1.5 text-sm text-muted">
          {e.proRated < e.contractual && (
            <li className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
              Anteilig berechnet ({e.fullMonths}/12 Monate beschäftigt, Zwölftelung nach §5 BUrlG):{" "}
              {fmtDays(e.proRated)} statt {fmtDays(e.contractual)} Tagen.
            </li>
          )}
          {e.schwerbehindertBonus > 0 && (
            <li className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
              Zusatzurlaub bei Schwerbehinderung (§208 SGB IX): +{fmtDays(e.schwerbehindertBonus)} Tage.
            </li>
          )}
          <li className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
            Krankheitstage {account.year}: <strong>{fmtDays(account.sickDays)}</strong> — sie mindern den
            Urlaubsanspruch nicht.
          </li>
          {account.childSickDays > 0 && (
            <li className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
              <span>
                „Kind krank“ {account.year}: <strong>{fmtDays(account.childSickDays)}</strong> Tage{" "}
                <InfoHint>{`Freistellung bei Erkrankung eines Kindes (§ 45 SGB V). Das Kinderkrankengeld zahlt die Krankenkasse; wie viele Tage je Kind und Jahr zustehen, legt das Gesetz fest. Die App zählt nur mit und begrenzt nichts.`}</InfoHint>
              </span>
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

const STATUS: Record<string, { label: string; tone: "warning" | "lime" | "danger" }> = {
  PENDING: { label: "ausstehend", tone: "warning" },
  APPROVED: { label: "genehmigt", tone: "lime" },
  REJECTED: { label: "abgelehnt", tone: "danger" },
  // Was in force and an administrator withdrew it after the fact — see
  // adminCancelAbsence. Kept visible so a corrected record never looks lost.
  CANCELLED: { label: "storniert", tone: "danger" },
};

function AbsenceList({
  absences,
}: {
  absences: Awaited<ReturnType<typeof getUserAbsences>>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Meine Abwesenheiten</CardTitle>
      </CardHeader>
      <CardContent>
        {absences.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Noch keine Abwesenheiten erfasst.</p>
        ) : (
          <ul className="space-y-2">
            {absences.map((a) => {
              const s = STATUS[a.status]!;
              const range = `${formatDayKey(berlinDayKey(a.startDate, "UTC"))} – ${formatDayKey(
                berlinDayKey(a.endDate, "UTC"),
              )}`;
              return (
                <li key={a.id} className="rounded-lg bg-white px-3 py-2.5 text-sm shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink">
                      {ABSENCE_LABEL[a.type]} · {range}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge tone={isSicknessKind(a.type) ? "info" : "neutral"}>
                        {fmtDays(a.workingDaysCount)} {a.type === "SICK" ? "Krankheitstage" : "Tage"}
                      </Badge>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                  </div>
                  {(a.halfDayStart || a.halfDayEnd) && (
                    <p className="mt-1 text-xs text-muted">
                      {a.halfDayStart && "Erster Tag halbtags. "}
                      {a.halfDayEnd && "Letzter Tag halbtags."}
                    </p>
                  )}
                  {a.type === "SICK" && (
                    <p className="mt-1 text-xs text-muted">
                      AU-Bescheinigung: {a.sickNoteOnFile ? "liegt vor" : "fehlt"}
                      {a.creditedBackFromVacation && (
                        <>
                          {" · Urlaub gutgeschrieben (§9 BUrlG) "}
                          <InfoHint>{`Diese Krankheit fiel in einen genehmigten Urlaub; die überschneidenden Arbeitstage wurden dem Urlaubskonto wieder gutgeschrieben (§9 BUrlG) und stehen erneut zur Verfügung.`}</InfoHint>
                        </>
                      )}
                    </p>
                  )}
                  {a.note && <p className="mt-1 text-xs text-muted">{a.note}</p>}
                  {a.type !== "SICK" && a.status === "PENDING" && (
                    <form action={withdrawRequestAction} className="mt-2 flex items-center gap-1.5">
                      <input type="hidden" name="absenceId" value={a.id} />
                      <button
                        type="submit"
                        className="text-xs font-medium text-danger hover:underline"
                      >
                        Antrag zurückziehen
                      </button>
                      <InfoHint>{`Zieht den Antrag zurück und gibt die beantragten Tage wieder frei. Nur solange der Antrag ausstehend ist; genehmigte Anträge kann nur die Verwaltung ändern.`}</InfoHint>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
