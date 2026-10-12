import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDayKey, formatSigned, OVERTIME_KIND_LABEL } from "@/lib/time";
import type { OvertimeBookingRow } from "@/lib/overtime";

/** The bookings of an Arbeitszeitkonto (#22), newest first. */
export function OvertimeBookings({
  bookings,
  action,
}: {
  bookings: OvertimeBookingRow[];
  /** Per-row control, e.g. the admin's reversal form. */
  action?: (b: OvertimeBookingRow) => ReactNode;
}) {
  if (bookings.length === 0) return <p className="text-sm text-muted">Noch keine Buchungen.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/[0.06] text-left text-xs text-muted">
            <th className="py-2 pr-3 font-medium">Datum</th>
            <th className="py-2 pr-3 font-medium">Art</th>
            <th className="py-2 pr-3 text-right font-medium">Stunden</th>
            <th className="py-2 pr-3 font-medium">Begründung</th>
            {action && <th className="py-2 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id} className="border-b border-black/[0.04] align-top last:border-0">
              <td className="py-2 pr-3 whitespace-nowrap">{formatDayKey(b.dayKey)}</td>
              <td className="py-2 pr-3">
                {b.reversesId ? `Storno: ${OVERTIME_KIND_LABEL[b.kind]}` : OVERTIME_KIND_LABEL[b.kind]}
                {b.reversed && (
                  <>
                    {" "}
                    <Badge tone="neutral">storniert</Badge>
                  </>
                )}
              </td>
              <td className="py-2 pr-3 text-right font-mono whitespace-nowrap">{formatSigned(b.minutes * 60_000)}</td>
              <td className="py-2 pr-3 text-muted">
                {b.note ?? "—"}
                {b.createdByName && <span className="block text-xs">von {b.createdByName}</span>}
              </td>
              {action && <td className="py-2">{!b.reversed && !b.reversesId && b.kind !== "CARRY_FORWARD" && action(b)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
