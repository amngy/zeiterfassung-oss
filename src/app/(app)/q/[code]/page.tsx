import type { Metadata } from "next";
import Link from "next/link";
import { QrCode } from "lucide-react";
import { requireUser } from "@/lib/session";
import { activeTerminalForCode } from "@/lib/terminals";
import { getTodayView } from "@/lib/timesheet";
import { berlinDayKey, berlinDayRange } from "@/lib/time";
import { Card, CardContent } from "@/components/ui/card";
import { ClockCard } from "../../zeiten/clock-card";
import { qrClockIn, qrClockOut, qrEndBreak, qrStartBreak } from "./actions";

export const metadata: Metadata = { title: "Stempeln am Terminal" };

/** Where a scanned terminal QR code lands (after sign-in, if needed). */
export default async function QrPunchPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireUser();
  const { code } = await params;
  const terminal = await activeTerminalForCode(code);

  if (!terminal) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-5">
          <h1 className="text-lg font-medium text-ink">Code abgelaufen</h1>
          <p className="text-sm text-muted">
            Der QR-Code wechselt alle 30 Sekunden und gilt danach nur noch kurz. Bitte den Code am
            Terminal erneut scannen.
          </p>
          <Link href="/dashboard" className="text-sm font-medium text-teal hover:underline">
            Zur Übersicht
          </Link>
        </CardContent>
      </Card>
    );
  }

  const asOf = new Date();
  const today = await getTodayView(user.id, asOf);

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <QrCode className="h-5 w-5 text-teal" />
        <h1 className="text-xl font-medium tracking-tight text-ink">
          Stempeln am Terminal „{terminal.label}“
        </h1>
      </header>
      <ClockCard
        state={today.live.state}
        runningSinceISO={today.live.since ? today.live.since.toISOString() : null}
        workedMsAtRender={today.day.workedMs}
        breakMsAtRender={today.day.breakMs}
        expectedMs={today.day.expectedMs}
        absenceMs={today.day.absenceMs}
        absenceLabel={
          today.day.absence ? (today.day.absence.kind === "SICK" ? "Krank" : "Urlaub") : null
        }
        renderAtISO={asOf.toISOString()}
        dayEndsAtISO={berlinDayRange(berlinDayKey(asOf)).end.toISOString()}
        actions={{
          clockIn: qrClockIn.bind(null, code),
          clockOut: qrClockOut.bind(null, code),
          startBreak: qrStartBreak.bind(null, code),
          endBreak: qrEndBreak.bind(null, code),
        }}
      />
    </div>
  );
}
