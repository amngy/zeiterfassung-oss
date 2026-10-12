import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { OvertimeBookings } from "@/components/overtime-bookings";
import { formatDayKey, formatSigned } from "@/lib/time";
import type { OvertimeAccount } from "@/lib/overtime";

/** The person's own Arbeitszeitkonto (#22), read-only. */
export function OvertimeCard({ account }: { account: OvertimeAccount }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          Arbeitszeitkonto
          <InfoHint>{`Ihr Saldo seit Beginn des Kontos (Ist + Abwesenheit − Soll, wie in der Übersicht unten), plus Buchungen der Verwaltung: Anfangssaldo, Auszahlung, Verfall / Kappung, Korrekturen. Freizeitausgleich beantragen Sie als Abwesenheit; er mindert das Konto von selbst.`}</InfoHint>
        </CardTitle>
        <CardDescription>Geführt seit {formatDayKey(account.fromKey)}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-xs text-muted">Stand heute</p>
            <p className={`font-mono text-2xl font-semibold tabular-nums ${account.balanceMs < 0 ? "text-danger" : "text-ink"}`}>
              {formatSigned(account.balanceMs)}
            </p>
          </div>
          <p className="text-sm text-muted">
            Arbeitszeit {formatSigned(account.workMs)} · Buchungen {formatSigned(account.bookedMs)}
          </p>
        </div>
        {account.bookings.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-teal">
              Buchungen ({account.bookings.length})
            </summary>
            <div className="mt-3">
              <OvertimeBookings bookings={account.bookings} />
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
