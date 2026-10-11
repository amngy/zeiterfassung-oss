import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/session";
import {
  berlinDayKey,
  berlinDayRange,
  formatClock,
  formatDayKeyLong,
  formatLocalInput,
  formatMonth,
  parseDayKey,
} from "@/lib/time";
import {
  getTimesheet,
  getTodayView,
  type TimesheetView,
} from "@/lib/timesheet";
import { getUserCorrections, getOpenEntries, RESOLVE_OPEN_AFTER_MS } from "@/lib/corrections";
import { cn } from "@/lib/cn";
import { ClockCard } from "./clock-card";
import { CorrectionForm, type CorrectableEntry } from "./correction-form";
import { OpenEntryForm, type OpenEntry } from "./open-entry-form";
import {
  DayDetail,
  MyCorrections,
  OpenAnomalyBanner,
  PeriodTotals,
  TimesheetTable,
  ViolationList,
} from "./views";
import { clockIn, clockOut, endBreak, startBreak } from "./actions";
import { ABSENCE_LABEL } from "@/lib/time/absence-kinds";

export const metadata: Metadata = { title: "Meine Zeiten" };

const VIEWS: { key: TimesheetView; label: string }[] = [
  { key: "day", label: "Tag" },
  { key: "week", label: "Woche" },
  { key: "month", label: "Monat" },
];

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A well-formed AND real calendar date (rejects e.g. 2026-13-01, 2026-02-30). */
function isValidAnchor(d: string | undefined): d is string {
  if (!d || !DAY_KEY_RE.test(d)) return false;
  const [y, m, day] = parseDayKey(d);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day
  );
}

export default async function ZeitenPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; d?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const asOf = new Date();
  const todayKey = berlinDayKey(asOf);
  const view: TimesheetView =
    sp.view === "day" || sp.view === "month" ? sp.view : "week";
  const anchor = isValidAnchor(sp.d) ? sp.d : todayKey;

  const [today, sheet, corrections, openEntries] = await Promise.all([
    getTodayView(user.id, asOf),
    getTimesheet(user.id, view, anchor, asOf),
    getUserCorrections(user.id),
    // Every still-running entry, regardless of age. One of these blocking a
    // clock-in is the whole lockout bug, so it is loaded on every view.
    getOpenEntries(user.id),
  ]);

  // Only entries old enough to be implausible need the resolution form; a
  // normally-running shift is ended with the ordinary "Ausstempeln" button.
  const stale: OpenEntry[] = openEntries
    .filter((e) => asOf.getTime() - e.start.getTime() > RESOLVE_OPEN_AFTER_MS)
    .map((e) => ({
      id: e.id,
      type: e.type,
      startLocal: formatLocalInput(e.start),
      label: `${e.type === "BREAK" ? "Pause" : "Arbeit"} seit ${formatDayKeyLong(
        berlinDayKey(e.start),
      )} ${formatClock(e.start)}`,
      // Suggest the end of the started day rather than "now", so a forgotten
      // clock-out does not silently book days of phantom working time.
      suggestedEndLocal: suggestEnd(e.start),
    }));

  const href = (v: TimesheetView, d: string) => `/zeiten?view=${v}&d=${d}`;

  // Entries on the viewed day that the employee can target for a correction.
  // Use the FULL (un-clipped) entry bounds so a cross-midnight shift prefills
  // its true span — correcting a day-clipped slice would silently shrink it.
  const dayForForm = view === "day" ? sheet.period.days[0] : undefined;
  const correctableById = new Map<string, CorrectableEntry>();
  for (const s of dayForForm?.segments ?? []) {
    // A running entry has no end to prefill; it is added from `openEntries`
    // below, which knows the true start even when the day produced no segment.
    if (s.running || !s.entryId || correctableById.has(s.entryId)) continue;
    correctableById.set(s.entryId, {
      id: s.entryId,
      type: s.type,
      startLocal: formatLocalInput(s.entryStart),
      endLocal: formatLocalInput(s.entryEnd),
      label: `${s.type === "BREAK" ? "Pause" : "Arbeit"} ${formatClock(s.entryStart)}–${formatClock(s.entryEnd)}`,
    });
  }
  // Entries that were never clocked out belong in this list too. They produce
  // NO day segment once they pass the plausibility cap (summarizeDay drops them
  // as anomalies) and are skipped while merely running — so the dropdown used to
  // offer nothing but "Neuer Eintrag (nachtragen)". Choosing that added a SECOND
  // entry beside the broken one: the day then showed the right times while the
  // original stayed ACTIVE, kept its "offen" flag and kept blocking clock-in.
  // Correcting one is explicitly allowed at any age (see corrections.ts), it was
  // only unreachable from here.
  if (view === "day") {
    for (const e of openEntries) {
      if (berlinDayKey(e.start) !== anchor || correctableById.has(e.id)) continue;
      correctableById.set(e.id, {
        id: e.id,
        type: e.type,
        startLocal: formatLocalInput(e.start),
        // No real end exists — offer the same conservative suggestion the
        // resolve form uses rather than "now".
        endLocal: suggestEnd(e.start),
        label: `${e.type === "BREAK" ? "Pause" : "Arbeit"} ab ${formatClock(e.start)} (nie ausgestempelt)`,
      });
    }
  }
  const correctable: CorrectableEntry[] = [...correctableById.values()];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-ink">Meine Zeiten</h1>
        <p className="text-sm text-muted">
          Kommen &amp; Gehen, Pausen und Ihre Stundenübersicht.
        </p>
      </header>

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
        dayEndsAtISO={berlinDayRange(todayKey).end.toISOString()}
        actions={{ clockIn, clockOut, startBreak, endBreak }}
      />

      <section className="space-y-4">
        {/* View switcher + period navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-surface p-1">
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={href(v.key, anchor)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  view === v.key
                    ? "bg-white text-teal shadow-sm"
                    : "text-muted hover:text-ink",
                )}
              >
                {v.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <Link
              href={href(view, sheet.prevAnchor)}
              aria-label="Vorheriger Zeitraum"
              className="rounded-lg border border-black/10 bg-white p-2 text-ink hover:bg-surface"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <span className="min-w-[10rem] text-center text-sm font-medium text-ink">
              {periodLabel(view, sheet.range, anchor)}
            </span>
            <Link
              href={href(view, sheet.nextAnchor)}
              aria-label="Nächster Zeitraum"
              className="rounded-lg border border-black/10 bg-white p-2 text-ink hover:bg-surface"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
            <Link
              href={href(view, todayKey)}
              className="ml-1 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium text-teal hover:bg-surface"
            >
              Heute
            </Link>
          </div>
        </div>

        {/* Rendered on EVERY view: a stale open entry blocks clocking in, so the
            way out of it must not be hidden behind switching to the day view. */}
        <OpenEntryForm entries={stale} />

        {stale.length === 0 && sheet.period.hasOpenAnomaly && <OpenAnomalyBanner />}

        {view === "day" && sheet.period.days[0] ? (
          <>
            <DayDetail day={sheet.period.days[0]} violations={sheet.violations} />
            <CorrectionForm
              dayKey={anchor}
              entries={correctable}
              breakDeclarationRequired={user.role !== "ADMIN"}
            />
          </>
        ) : (
          <>
            <PeriodTotals period={sheet.period} />
            <TimesheetTable period={sheet.period} violations={sheet.violations} />
            <ViolationList violations={sheet.violations} />
            <p className="text-sm text-muted">
              Zum Nachtragen oder Korrigieren einer Zeit in die{" "}
              <Link href={href("day", anchor)} className="font-medium text-teal underline">
                Tagesansicht
              </Link>{" "}
              wechseln.
            </p>
          </>
        )}

        <MyCorrections rows={corrections} />
      </section>
    </div>
  );
}

/**
 * A plausible end for a forgotten clock-out: 17:00 on the day the entry started,
 * or start + 1 min if the entry began later than that. Never "now" — a punch left
 * open over a weekend would otherwise suggest booking 60+ hours of work.
 */
function suggestEnd(start: Date): string {
  const dayKey = berlinDayKey(start);
  const startLocal = formatLocalInput(start);
  const candidate = `${dayKey}T17:00`;
  return candidate > startLocal ? candidate : startLocal;
}

function periodLabel(
  view: TimesheetView,
  range: { from: string; to: string },
  anchor: string,
): string {
  if (view === "day") return formatDayKeyLong(anchor);
  if (view === "month") return formatMonth(anchor);
  // week: "15.06. – 21.06.2026"
  const [, fm, fd] = range.from.split("-");
  const [ty, tm, td] = range.to.split("-");
  return `${fd}.${fm}. – ${td}.${tm}.${ty}`;
}
