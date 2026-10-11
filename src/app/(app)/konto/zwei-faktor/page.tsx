import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getPendingEnrolment, getTwoFactorStatus } from "@/lib/two-factor";
import { groupSecret } from "@/lib/totp";
import { berlinDayKey, formatDayKey } from "@/lib/time";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TwoFactorPanel } from "./two-factor-panel";

export const metadata: Metadata = { title: "Zwei-Faktor-Anmeldung" };

export default async function TwoFactorPage() {
  const user = await requireUser();
  const [status, pending] = await Promise.all([getTwoFactorStatus(user.id), getPendingEnrolment(user.id)]);

  return (
    <div className="space-y-6">
      <header>
        <Link href="/konto" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Mein Konto
        </Link>
        <h1 className="text-2xl font-medium tracking-tight text-ink">Zwei-Faktor-Anmeldung</h1>
        <p className="text-sm text-muted">
          {status.required
            ? "Für Konten mit Verwaltungsrechten ist sie Pflicht."
            : "Freiwillig — schützt Ihr Konto, falls jemand Ihr Passwort kennt."}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Authenticator-App</CardTitle>
          <CardDescription>Ein sechsstelliger Code, der sich alle 30 Sekunden ändert.</CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorPanel
            enabled={status.enabled}
            enabledAt={status.enabledAt ? formatDayKey(berlinDayKey(status.enabledAt)).slice(4) : null}
            recoveryCodesLeft={status.recoveryCodesLeft}
            required={status.required}
            pending={pending && { secret: groupSecret(pending.secret), qrSvg: pending.qrSvg }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
