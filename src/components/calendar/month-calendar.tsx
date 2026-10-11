// Presentational month calendar. Server-rendered, no interactivity — the caller
// computes which days carry holidays/absences and passes them in as marks. Used
// for both the employee's personal calendar and the admin team calendar.

import { addDaysToKey, formatMonth, parseDayKey, weekdayOfKey } from "@/lib/time";
import { cn } from "@/lib/cn";
import { InfoHint } from "@/components/ui/info-hint";

export type MarkTone = "holiday" | "gifted" | "vacation" | "vacation-pending" | "sick";

export interface CalendarMark {
  tone: MarkTone;
  /** Shown on hover (title attribute) and in dense cells. */
  label: string;
}

const DOT: Record<MarkTone, string> = {
  holiday: "bg-teal",
  gifted: "bg-sky-500",
  vacation: "bg-lime",
  "vacation-pending": "bg-amber-400",
  sick: "bg-danger",
};

const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * @param monthAnchor any day key within the month to render ("YYYY-MM-DD").
 * @param marks       day key → marks to show on that day.
 * @param todayKey    highlight ring on this day, if in the month.
 */
export function MonthCalendar({
  monthAnchor,
  marks,
  todayKey,
}: {
  monthAnchor: string;
  marks: Map<string, CalendarMark[]>;
  todayKey?: string;
}) {
  const [year, month] = parseDayKey(monthAnchor);
  const firstKey = `${monthAnchor.slice(0, 7)}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Leading blank cells so the 1st lands under its weekday (Mon-based grid).
  const lead = ORDER.indexOf(weekdayOfKey(firstKey));

  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 0; d < daysInMonth; d++) cells.push(addDaysToKey(firstKey, d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="mb-3 grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((key, i) => {
          if (!key) return <div key={`b${i}`} className="aspect-square rounded-lg" />;
          const wd = weekdayOfKey(key);
          const isWeekend = wd === "sat" || wd === "sun";
          const dayMarks = marks.get(key) ?? [];
          const isToday = key === todayKey;
          const dayNum = Number(key.slice(8, 10));
          return (
            <div
              key={key}
              title={dayMarks.map((m) => m.label).join(" · ") || undefined}
              className={cn(
                "relative flex aspect-square flex-col rounded-lg border p-1.5 text-xs",
                isWeekend ? "border-transparent bg-surface/60 text-muted" : "border-black/[0.05] bg-white text-ink",
                isToday && "ring-2 ring-teal/40",
              )}
            >
              <span className={cn("font-medium tabular-nums", isToday && "text-teal")}>
                {dayNum}
              </span>
              {dayMarks.length > 0 && (
                <span className="mt-auto flex flex-wrap gap-0.5">
                  {dayMarks.slice(0, 4).map((m, j) => (
                    <span
                      key={j}
                      className={cn("h-1.5 w-1.5 rounded-full", DOT[m.tone])}
                      aria-hidden
                    />
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Small legend explaining the dot colours. Render under a calendar. */
export function CalendarLegend({
  items,
}: {
  items: { tone: MarkTone; label: string; hint?: string }[];
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
      {items.map((it) => (
        <span key={it.tone} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", DOT[it.tone])} aria-hidden />
          {it.label}
          {it.hint && <InfoHint>{it.hint}</InfoHint>}
        </span>
      ))}
    </div>
  );
}

export { formatMonth };
