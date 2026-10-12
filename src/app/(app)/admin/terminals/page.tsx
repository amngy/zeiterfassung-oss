import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import { listTerminals } from "@/lib/terminals";
import { berlinDayKey, formatClock, formatDayKey } from "@/lib/time";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { CreateTerminalForm, PairLinkButton } from "./terminal-forms";
import { setTerminalActiveAction, setTerminalPinAction } from "./actions";

export const metadata: Metadata = { title: "Terminals" };

function when(d: Date | null): string {
  return d ? `${formatDayKey(berlinDayKey(d))}, ${formatClock(d)}` : "—";
}

export default async function AdminTerminalsPage() {
  await requireAdmin();
  const terminals = await listTerminals();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-ink">Terminals</h1>
        <p className="text-sm text-muted">
          Ein Tablet am Eingang zeigt einen QR-Code, der alle 30 Sekunden wechselt. Mitarbeitende
          scannen ihn mit dem eigenen Handy und stempeln damit ein oder aus — die Stempelung wird
          mit Erfassungsweg „QR-Code“ und dem Namen des Terminals gespeichert.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-base">
            Terminal anlegen
            <InfoHint>{`So geht's: 1. Terminal anlegen. 2. Den angezeigten Kopplungslink auf dem Tablet öffnen (z. B. den QR-Code mit der Tablet-Kamera scannen) und dort bestätigen. 3. Das Tablet zeigt ab dann dauerhaft den wechselnden Code; am besten im Vollbild- bzw. Kiosk-Modus des Geräts. Ein Code gilt höchstens 90 Sekunden — ein Foto davon ist danach wertlos. Wer den Code laufend abfotografiert und weiterleitet, kann aber von außerhalb stempeln: eine QR-Stempelung ist ein Hinweis auf Anwesenheit, kein Beweis. Das Terminal muss die Anwendung über HTTPS aufrufen (wie auf Railway üblich), sonst speichert der Browser die Kopplung nicht.`}</InfoHint>
          </CardTitle>
          <CardDescription>
            Danach den Kopplungslink auf dem Terminal-Gerät öffnen. Der Link gilt 15 Minuten und
            nur einmal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateTerminalForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vorhandene Terminals</CardTitle>
          <CardDescription>
            Deaktivieren meldet das Gerät sofort ab und macht seine Codes ungültig. Zum
            Wiederverwenden danach aktivieren und neu koppeln.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {terminals.length === 0 ? (
            <p className="text-sm text-muted">Noch keine Terminals angelegt.</p>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {terminals.map((t) => (
                <li key={t.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{t.label}</span>
                        {!t.active ? (
                          <Badge tone="neutral">deaktiviert</Badge>
                        ) : t.paired ? (
                          <Badge tone="lime">gekoppelt</Badge>
                        ) : (
                          <Badge tone="warning">nicht gekoppelt</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted">
                        Gekoppelt: {t.paired ? when(t.pairedAt) : "—"} · Zuletzt aktiv:{" "}
                        {when(t.lastSeenAt)} ·{" "}
                        {t.punchCount} Stempelungen
                      </p>
                    </div>
                    <form action={setTerminalActiveAction}>
                      <input type="hidden" name="terminalId" value={t.id} />
                      <input type="hidden" name="active" value={t.active ? "false" : "true"} />
                      <Button type="submit" variant={t.active ? "ghost" : "outline"} size="sm">
                        {t.active ? "Deaktivieren" : "Aktivieren"}
                      </Button>
                    </form>
                  </div>
                  {t.active && <PairLinkButton terminalId={t.id} label={t.label} />}
                  {t.active && (
                    <form action={setTerminalPinAction} className="flex flex-wrap items-center gap-2 text-sm">
                      <input type="hidden" name="terminalId" value={t.id} />
                      <input type="hidden" name="allowPin" value={t.allowPin ? "false" : "true"} />
                      <span className="text-ink">
                        Stempeln mit PIN:{" "}
                        {t.allowPin ? <Badge tone="lime">an</Badge> : <Badge tone="neutral">aus</Badge>}
                        {t.pinBlockedUntil && t.pinBlockedUntil > new Date() && (
                          <> <Badge tone="danger">gesperrt bis {formatClock(t.pinBlockedUntil)}</Badge></>
                        )}
                      </span>
                      <Button type="submit" variant="outline" size="sm">
                        {t.allowPin ? "Ausschalten" : "Einschalten"}
                      </Button>
                      <InfoHint>{`Für Beschäftigte ohne Smartphone: Am Terminal den eigenen Namen wählen und die sechsstellige Terminal-PIN eingeben (vergeben unter Mitarbeitende → Person). Gespeichert wird die Stempelung mit Erfassungsweg „Terminal“ und dem Namen des Terminals. Die Namensliste zeigt nur Personen mit PIN. Nach fünf falschen PINs ist das Stempeln mit PIN für die Person 15 Minuten gesperrt, nach zwanzig falschen PINs innerhalb von 15 Minuten für das ganze Terminal. Eine PIN beweist weniger als ein eigenes Gerät: Wer sie kennt, kann für die Person stempeln.`}</InfoHint>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
