import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { listUsersWithDetails } from "@/lib/users";
import { getAppSettings } from "@/lib/settings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateUserForm } from "./forms";

export const metadata: Metadata = { title: "Mitarbeitende" };

export default async function AdminEmployeesPage() {
  await requireAdmin();
  const [users, settings] = await Promise.all([listUsersWithDetails(), getAppSettings()]);
  const activeCount = users.filter((u) => u.active).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-ink">Mitarbeitende</h1>
        <p className="text-sm text-muted">
          {activeCount} aktiv · {users.length} {users.length === 1 ? "Konto" : "Konten"} gesamt
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Alle Konten</CardTitle>
          <CardDescription>
            Auf eine Zeile klicken, um Profil, Arbeitszeiten, Passwort und Status zu verwalten.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-black/[0.06] text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2 font-medium">Name</th>
                  <th className="px-5 py-2 font-medium">E-Mail</th>
                  <th className="px-5 py-2 font-medium">Rolle</th>
                  <th className="px-5 py-2 text-right font-medium">Wochenstunden</th>
                  <th className="px-5 py-2 text-right font-medium">Urlaub</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="group border-b border-black/[0.04] last:border-0 hover:bg-surface/60">
                    <td className="px-5 py-2.5 font-medium text-ink">
                      <Link href={`/admin/mitarbeitende/${u.id}`} className="hover:text-teal">
                        {u.name}
                      </Link>
                      <span className="ml-2 inline-flex gap-1 align-middle">
                        {u.isMinijob && <Badge tone="info">Minijob</Badge>}
                        {u.exemptFromTimeRecording && <Badge tone="neutral">befreit</Badge>}
                        {u.exemptFromAutoBreak && (
                          <Badge tone="neutral" title="Kein automatischer Pausenabzug">
                            ohne Pausenautomatik
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-muted">{u.email}</td>
                    <td className="px-5 py-2.5">
                      <Badge tone={u.role === "ADMIN" ? "teal" : "neutral"}>
                        {u.role === "ADMIN" ? "Admin" : "Mitarbeiter:in"}
                      </Badge>
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums">
                      {u.weeklyHours > 0 ? u.weeklyHours.toString().replace(".", ",") : "—"}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums text-muted">
                      {u.vacationDaysPerYear.toString().replace(".", ",")}
                    </td>
                    <td className="px-5 py-2.5">
                      {u.active ? <Badge tone="lime">aktiv</Badge> : <Badge tone="danger">inaktiv</Badge>}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Link
                        href={`/admin/mitarbeitende/${u.id}`}
                        className="inline-flex text-muted group-hover:text-teal"
                        aria-label={`${u.name} verwalten`}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Neue:n Mitarbeiter:in anlegen</CardTitle>
          <CardDescription>
            Legt das Konto samt erster Arbeitszeit an. Das Passwort kann später von der Person selbst
            geändert werden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateUserForm defaultVacationDays={settings.defaultVacationDays} />
        </CardContent>
      </Card>
    </div>
  );
}
