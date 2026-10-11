import type { Metadata } from "next";
import Link from "next/link";
import { Check, X, ChevronLeft, ChevronRight, HeartPulse } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import {
  getAbsencesForYear,
  getAbsencesInRange,
  getPendingAbsenceRequests,
  getSickCreditCandidates,
  getStaffVacationOverview,
} from "@/lib/absences";
import { getHolidaysInRange, resolveRegion } from "@/lib/holidays";
import {
  addDaysToKey,
  berlinDayKey,
  eachDayKey,
  formatDayKey,
  formatDays,
  sickNoteDue,
  sickNoteDueKey,
  monthRangeOf,
} from "@/lib/time";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoHint } from "@/components/ui/info-hint";
import {
  CalendarLegend,
  MonthCalendar,
  formatMonth,
  type CalendarMark,
} from "@/components/calendar/month-calendar";
import {
  AdminRecordForm,
  EntitlementEditor,
  type EntitlementEmployee,
} from "./admin-forms";
import {
  AbsenceCorrectionPanel,
  type CorrectableAbsence,
} from "./correction-forms";
import {
  creditBackSickAction,
  decideAbsenceAction,
  sendReminderAction,
} from "./actions";
import { ABSENCE_LABEL, isSicknessKind } from "@/lib/time/absence-kinds";

export const metadata: Metadata = { title: "Abwesenheiten" };

function fmtKey(d: Date): string {
  return berlinDayKey(d, "UTC");
}

export default async function AdminAbsencesPage({
  searchParams,
}: {
  searchParams: Promise<{ monat?: string }>;
}) {
  await requireAdmin();
  const { monat } = await searchParams;

  const todayKey = berlinDayKey(new Date());
  const year = Number(todayKey.slice(0, 4));
  const monthAnchor = /^\d{4}-\d{2}$/.test(monat ?? "") ? `${monat}-01` : `${todayKey.slice(0, 7)}-01`;
  const { from, to } = monthRangeOf(monthAnchor);

  const [pending, overview, candidates, settings, teamAbsences, employeeRows] = await Promise.all([
    getPendingAbsenceRequests(),
    getStaffVacationOverview(year),
    getSickCreditCandidates(year),
    getAppSettings(),
    getAbsencesInRange(from, to),
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        vacationDaysPerYear: true,
        statutoryVacationDays: true,
        additionalVacationDays: true,
        vacationCarryOverDays: true,
        isSchwerbehindert: true,
        schwerbehindertFrom: true,
        schwerbehindertTo: true,
      },
    }),
  ]);
  const region = resolveRegion(null, settings); // company default for the team view
  const holidays = await getHolidaysInRange(region, from, to);

  // Every absence on file this year, so an admin can correct one after the fact
  // (a holiday cut short by illness, a spell recorded under the wrong type).
  const correctableRows = (
    await Promise.all(employeeRows.map((u) => getAbsencesForYear(u.id, year)))
  ).flat();
  const dueSickNotes = correctableRows.filter(
    (a) =>
      a.type === "SICK" &&
      (a.status === "APPROVED" || a.status === "PENDING") &&
      sickNoteDue(
        { fromKey: fmtKey(a.startDate), toKey: fmtKey(a.endDate), sickNoteOnFile: a.sickNoteOnFile },
        settings.auRequiredFromDay,
        todayKey,
      ),
  );
  const dueIds = new Set(dueSickNotes.map((a) => a.id));
  const nameOf = new Map(employeeRows.map((u) => [u.id, u.name]));

  const correctable: CorrectableAbsence[] = correctableRows.map((a) => ({
    id: a.id,
    userId: a.userId,
    type: a.type,
    startDate: fmtKey(a.startDate),
    endDate: fmtKey(a.endDate),
    halfDayStart: a.halfDayStart,
    halfDayEnd: a.halfDayEnd,
    sickNoteOnFile: a.sickNoteOnFile,
    sickNoteDue: dueIds.has(a.id),
    creditedBackFromVacation: a.creditedBackFromVacation,
    workingDaysCount: a.workingDaysCount,
    status: a.status,
    note: a.note,
    correctionReason: a.correctionReason,
  }));

  const employees: EntitlementEmployee[] = employeeRows.map((u) => ({
    id: u.id,
    name: u.name,
    vacationDaysPerYear: u.vacationDaysPerYear,
    statutoryVacationDays: u.statutoryVacationDays,
    additionalVacationDays: u.additionalVacationDays,
    vacationCarryOverDays: u.vacationCarryOverDays,
    isSchwerbehindert: u.isSchwerbehindert,
    schwerbehindertFrom: u.schwerbehindertFrom ? fmtKey(u.schwerbehindertFrom) : "",
    schwerbehindertTo: u.schwerbehindertTo ? fmtKey(u.schwerbehindertTo) : "",
  }));

  // Team-calendar marks: holidays + every employee's absence days in the month.
  const marks = new Map<string, CalendarMark[]>();
  const addMark = (key: string, mark: CalendarMark) => {
    const list = marks.get(key) ?? [];
    list.push(mark);
    marks.set(key, list);
  };
  for (const h of holidays) {
    addMark(h.dayKey, {
      tone: h.type === "PUBLIC" ? "holiday" : "gifted",
      label: h.name,
    });
  }
  for (const a of teamAbsences) {
    const aFrom = fmtKey(a.startDate);
    const aTo = fmtKey(a.endDate);
    const tone: CalendarMark["tone"] = isSicknessKind(a.type)
      ? "sick"
      : a.status === "APPROVED"
        ? "vacation"
        : "vacation-pending";
    const verb = `${ABSENCE_LABEL[a.type]}${a.status === "PENDING" ? " (offen)" : ""}`;
    for (const key of eachDayKey(aFrom < from ? from : aFrom, aTo > to ? to : aTo)) {
      addMark(key, { tone, label: `${a.user.name}: ${verb}` });
    }
  }

  const prevMonth = addDaysToKey(from, -1).slice(0, 7);
  const nextMonth = addDaysToKey(to, 1).slice(0, 7);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-ink">Abwesenheiten</h1>
        <p className="text-sm text-muted">
          Urlaubsanträge genehmigen, Krankheit erfassen, Ansprüche verwalten und das Team im Blick behalten.
        </p>
      </header>

      {/* ── Pending requests (leave and the other requestable kinds) ──────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-1.5 text-base">
            Offene Anträge {pending.length > 0 && <Badge tone="warning">{pending.length}</Badge>}
            <InfoHint>{`Genehmigt den Antrag und bucht die Abwesenheit (Urlaub wird vom Anspruch abgezogen). Die Arbeitstage werden dabei neu berechnet – seit dem Antrag geänderte Arbeitszeiten oder Feiertage fließen in die genehmigte Zahl ein.`}</InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Keine offenen Anträge.</p>
          ) : (
            <ul className="space-y-2">
              {pending.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-3 py-2.5 text-sm shadow-sm"
                >
                  <div>
                    <p className="font-medium text-ink">
                      {r.user.name} · {ABSENCE_LABEL[r.type]}
                    </p>
                    <p className="text-muted">
                      {formatDayKey(fmtKey(r.startDate))} – {formatDayKey(fmtKey(r.endDate))} ·{" "}
                      <strong>{formatDays(r.workingDaysCount)}</strong> Tage
                      {(r.halfDayStart || r.halfDayEnd) && " · mit Halbtag"}
                    </p>
                    {r.note && <p className="text-xs text-muted">{r.note}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <form action={decideAbsenceAction}>
                      <input type="hidden" name="absenceId" value={r.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <button className="inline-flex items-center gap-1 rounded-lg bg-lime px-3 py-1.5 text-xs font-semibold text-white hover:bg-lime-dark">
                        <Check className="h-3.5 w-3.5" /> Genehmigen
                      </button>
                    </form>
                    <form action={decideAbsenceAction}>
                      <input type="hidden" name="absenceId" value={r.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <button className="inline-flex items-center gap-1 rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10">
                        <X className="h-3.5 w-3.5" /> Ablehnen
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Sick notes due (EFZG §5, setting "AU-Pflicht ab Tag") ─────────── */}
      {dueSickNotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-1.5 text-base">
              AU-Bescheinigung fällig <Badge tone="warning">{dueSickNotes.length}</Badge>
              <InfoHint>{`Krankmeldungen, die den ${settings.auRequiredFromDay}. Krankheitstag erreicht haben und für die noch keine AU/eAU vermerkt ist (Einstellung „AU-Pflicht ab Tag“, EFZG §5). Bei gesetzlich Versicherten die eAU bei der Krankenkasse abrufen; danach unter „Abwesenheit nachträglich korrigieren“ „AU-Bescheinigung liegt vor“ setzen.`}</InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {dueSickNotes.map((a) => {
                const fromKey = fmtKey(a.startDate);
                const toKey = fmtKey(a.endDate);
                const dueKey = sickNoteDueKey({ fromKey, toKey, sickNoteOnFile: false }, settings.auRequiredFromDay);
                return (
                  <li key={a.id} className="rounded-lg bg-white px-3 py-2.5 text-sm shadow-sm">
                    <p className="font-medium text-ink">{nameOf.get(a.userId) ?? "—"}</p>
                    <p className="text-muted">
                      Krank {formatDayKey(fromKey)} – {formatDayKey(toKey)}
                      {dueKey && ` · fällig seit ${formatDayKey(dueKey)}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── §9 sick-during-vacation review queue ──────────────────────────── */}
      {candidates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-1.5 text-base">
              Krankheit während des Urlaubs (§9 BUrlG)
              <InfoHint>{`Schreibt zertifizierte Krankheitstage, die in einen genehmigten Urlaub fallen, dem Urlaubskonto zurück (§9 BUrlG). Setzt eine vorliegende AU-Bescheinigung voraus und ist je Krankmeldung nur einmal möglich.`}</InfoHint>
            </CardTitle>
            <CardDescription>
              Zertifizierte Krankheitstage, die in einen genehmigten Urlaub fallen, können dem
              Urlaubskonto gutgeschrieben werden.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {candidates.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-3 py-2.5 text-sm shadow-sm"
                >
                  <span>
                    <span className="font-medium text-ink">{s.user.name}</span> · krank{" "}
                    {formatDayKey(fmtKey(s.startDate))} – {formatDayKey(fmtKey(s.endDate))}
                  </span>
                  <form action={creditBackSickAction}>
                    <input type="hidden" name="sickId" value={s.id} />
                    <button className="inline-flex items-center gap-1 rounded-lg bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-dark">
                      <HeartPulse className="h-3.5 w-3.5" /> Urlaub gutschreiben
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Staff overview ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Urlaubsübersicht {year}</CardTitle>
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
                      <InfoHint>{`Gesamtanspruch dieses Jahres: Jahresanspruch (inkl. gesetzlicher Mindest- und Schwerbehinderten-Aufstockung sowie Zwölftelung bei Teiljahr) plus Übertrag aus dem Vorjahr.`}</InfoHint>
                    </span>
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Genommen
                      <InfoHint>{`Bereits genehmigte und verbuchte Urlaubstage in diesem Jahr. Krankheitstage sind hier nicht enthalten.`}</InfoHint>
                    </span>
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Offen
                      <InfoHint>{`Beantragte, aber noch nicht genehmigte Urlaubstage. Sie mindern „Verbleibend“ noch nicht, reduzieren aber den sicher noch buchbaren Rest.`}</InfoHint>
                    </span>
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Verbleibend
                      <InfoHint>{`Anspruch minus genommener Urlaub. Noch offene (beantragte) Tage sind hier NICHT abgezogen; ein negativer Wert bedeutet Überbuchung.`}</InfoHint>
                    </span>
                  </th>
                  <th className="px-5 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Krank
                      <InfoHint>{`Genehmigte Krankheitstage (Arbeitstage) in diesem Jahr. Reine Information – Krankheit mindert den Urlaubsanspruch nie.`}</InfoHint>
                    </span>
                  </th>
                  <th className="px-5 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Hinweis
                      <InfoHint>{`Vermerkt nur, dass die Aufforderung zum Urlaubsverbrauch erteilt wurde – Voraussetzung für den möglichen Verfall von Resturlaub (EuGH/BAG). Es wird keine E-Mail oder Nachricht versendet.`}</InfoHint>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.map(({ user, account }) => (
                  <tr key={user.id} className="border-b border-black/[0.04] last:border-0">
                    <td className="px-5 py-2.5 font-medium text-ink">{user.name}</td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums">
                      {formatDays(account.entitlement.total)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums">{formatDays(account.taken)}</td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums text-muted">
                      {formatDays(account.planned)}
                    </td>
                    <td
                      className={`px-5 py-2.5 text-right font-mono tabular-nums ${
                        account.remaining < 0 ? "text-danger" : "text-lime-dark"
                      }`}
                    >
                      {formatDays(account.remaining)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums">{formatDays(account.sickDays)}</td>
                    <td className="px-5 py-2.5">
                      <form action={sendReminderAction}>
                        <input type="hidden" name="userId" value={user.id} />
                        {account.carryOverReminderSentAt ? (
                          <span className="text-xs text-muted">
                            gesendet {formatDayKey(berlinDayKey(account.carryOverReminderSentAt))}
                          </span>
                        ) : (
                          <button className="text-xs font-medium text-teal hover:underline">
                            Hinweis senden
                          </button>
                        )}
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 pt-3 text-xs text-muted">
            „Hinweis senden“ vermerkt, dass die Aufforderung zum Urlaubsverbrauch erteilt wurde —
            Voraussetzung dafür, dass Resturlaub verfallen kann (EuGH/BAG).
          </p>
        </CardContent>
      </Card>

      {/* ── Admin entry + entitlement editor ──────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Abwesenheit für Mitarbeiter:in eintragen</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminRecordForm employees={employees} todayKey={todayKey} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-1.5 text-base">
              Abwesenheit nachträglich korrigieren
              <InfoHint>{`Ändert eine bereits erfasste Abwesenheit: Zeitraum, Art (Urlaub ↔ Krankheit), halbe Tage und AU-Vermerk. Die verbrauchten Urlaubstage werden aus dem korrigierten Zeitraum neu berechnet, bereits erteilte §9-Gutschriften bleiben erhalten. Alternativ lässt sich ein Eintrag stornieren — er bleibt dann im Protokoll erhalten, zählt aber nicht mehr. Jede Korrektur verlangt eine Begründung und wird protokolliert.`}</InfoHint>
            </CardTitle>
            <CardDescription>
              Z. B. einen genehmigten Urlaub verkürzen, weil die Person erkrankt ist — und
              die Krankheit anschließend separat erfassen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AbsenceCorrectionPanel
              employees={employees}
              absences={correctable}
              year={year}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Urlaubsanspruch &amp; Übertrag</CardTitle>
            <CardDescription>
              Jahresanspruch, Übertrag und Schwerbehindertenstatus je Mitarbeiter:in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EntitlementEditor employees={employees} />
          </CardContent>
        </Card>
      </div>

      {/* ── Team calendar ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Teamkalender — {formatMonth(monthAnchor)}</CardTitle>
            <div className="flex items-center gap-1">
              <Link href={`/admin/abwesenheiten?monat=${prevMonth}`} className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label="Vormonat">
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <Link href={`/admin/abwesenheiten?monat=${nextMonth}`} className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label="Folgemonat">
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
                hint: `Betrieblich geschenkter freier (Halb-)Tag, z. B. Heiligabend. Solche Tage verbrauchen keinen bzw. nur halben Urlaub.`,
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
  );
}
