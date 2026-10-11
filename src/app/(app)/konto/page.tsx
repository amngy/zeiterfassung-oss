import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
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
    </div>
  );
}
