import type { Metadata } from "next";
import Link from "next/link";
import { Clock3, CalendarDays, ArrowRight, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getMonthViolationCount, getTodayView } from "@/lib/timesheet";
import { getVacationAccount } from "@/lib/absences";
import { berlinDayKey, berlinDayRange, formatDays, formatSigned } from "@/lib/time";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClockCard } from "../zeiten/clock-card";
import { clockIn, clockOut, endBreak, startBreak } from "../zeiten/actions";
import { ABSENCE_LABEL } from "@/lib/time/absence-kinds";

export const metadata: Metadata = { title: "Übersicht" };

export default async function DashboardPage() {
  const user = await requireUser();
  const firstName = user.name.split(" ")[0] || user.name;

  const asOf = new Date();
  const year = Number(berlinDayKey(asOf).slice(0, 4));
  const [today, monthViolations, vacation] = await Promise.all([
    getTodayView(user.id, asOf),
    getMonthViolationCount(user.id, asOf),
    getVacationAccount(user.id, year),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Willkommen zurück</p>
          <h1 className="text-2xl font-medium tracking-tight text-ink">
            Guten Tag, {firstName}
          </h1>
        </div>
        <Badge tone={user.role === "ADMIN" ? "teal" : "lime"}>
          {user.role === "ADMIN" ? "Administrator:in" : "Mitarbeiter:in"}
        </Badge>
      </header>

      {monthViolations > 0 && (
        <Link href="/zeiten?view=month" className="block">
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition-colors hover:bg-amber-100">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              <strong>{monthViolations}</strong>{" "}
              {monthViolations === 1 ? "Arbeitszeit-Hinweis" : "Arbeitszeit-Hinweise"} in
              diesem Monat — zur Übersicht.
            </span>
          </div>
        </Link>
      )}

      <ClockCard
        state={today.live.state}
        runningSinceISO={today.live.since ? today.live.since.toISOString() : null}
        workedMsAtRender={today.day.workedMs}
        breakMsAtRender={today.day.breakMs}
        expectedMs={today.day.expectedMs}
        absenceMs={today.day.absenceMs}
        absenceLabel={
          today.day.absence ? ABSENCE_LABEL[today.day.absence.kind] : null
        }
        renderAtISO={asOf.toISOString()}
        dayEndsAtISO={berlinDayRange(berlinDayKey(asOf)).end.toISOString()}
        actions={{ clockIn, clockOut, startBreak, endBreak }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <QuickLink
          href="/zeiten"
          icon={<Clock3 className="h-5 w-5" />}
          title="Meine Zeiten"
          desc="Tages-, Wochen- und Monatsübersicht mit Saldo."
          stat={`Saldo heute: ${formatSigned(today.day.balanceMs)}`}
        />
        <QuickLink
          href="/abwesenheit"
          icon={<CalendarDays className="h-5 w-5" />}
          title="Urlaub & Abwesenheit"
          desc="Urlaubskonto, Urlaubsanträge und Krankmeldungen."
          stat={`Resturlaub ${year}: ${formatDays(vacation.remaining)} Tage`}
        />
      </div>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  title,
  desc,
  stat,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  stat: string;
}) {
  return (
    <Link href={href} className="group">
      <Card className="transition-shadow hover:shadow-card-hover">
        <CardContent className="flex items-start gap-4 pt-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal/10 text-teal">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-ink">
              <span className="font-medium">{title}</span>
              <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
            </div>
            <p className="mt-0.5 text-sm text-muted">{desc}</p>
            <p className="mt-2 font-mono text-sm tabular-nums text-teal">{stat}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
