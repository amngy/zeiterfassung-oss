import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getTwoFactorStatus } from "@/lib/two-factor";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChangePasswordForm } from "./account-form";

export const metadata: Metadata = { title: "Mein Konto" };

export default async function AccountPage() {
  const user = await requireUser();
  const twoFactor = await getTwoFactorStatus(user.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-ink">Mein Konto</h1>
        <p className="text-sm text-muted">{user.name} · {user.email}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Passwort ändern</CardTitle>
          <CardDescription>
            Wählen Sie ein starkes, einzigartiges Passwort. Nach der Änderung bleiben Sie angemeldet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-teal" /> Zwei-Faktor-Anmeldung
            {twoFactor.enabled ? <Badge tone="lime">eingeschaltet</Badge> : <Badge tone="neutral">aus</Badge>}
          </CardTitle>
          <CardDescription>
            {twoFactor.required
              ? "Für Konten mit Verwaltungsrechten Pflicht: Code aus einer Authenticator-App zusätzlich zum Passwort."
              : "Zusätzlich zum Passwort ein Code aus einer Authenticator-App auf dem Handy."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/konto/zwei-faktor" className="text-sm font-medium text-teal underline underline-offset-2">
            {twoFactor.enabled ? "Verwalten" : "Einrichten"}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
