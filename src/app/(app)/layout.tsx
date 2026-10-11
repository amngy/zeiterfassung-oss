import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/layout/app-shell";
import { getPendingCorrectionCount } from "@/lib/corrections";
import { getPendingAbsenceCount } from "@/lib/absences";
import { signOutAction } from "./actions";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrator:in",
  EMPLOYEE: "Mitarbeiter:in",
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The current DB role, not the token's: an admin without a second factor
  // sees the employee navigation until they have set one up (#14).
  const user = await requireUser();
  const { name, role } = user;

  // Show admins how many correction requests and vacation requests await them.
  const badges =
    role === "ADMIN"
      ? {
          "/admin/korrekturen": await getPendingCorrectionCount(),
          "/admin/abwesenheiten": await getPendingAbsenceCount(),
        }
      : undefined;

  return (
    <AppShell
      user={{ name: name ?? "—", role: ROLE_LABEL[role] ?? role }}
      roleKey={role}
      badges={badges}
      signOutAction={signOutAction}
    >
      {user.twoFactorSetupRequired && (
        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
          <span className="flex-1">
            Ihr Konto hat Verwaltungsrechte. Die Verwaltung ist erst nutzbar, wenn Sie die
            Zwei-Faktor-Anmeldung eingerichtet haben.
          </span>
          <Link href="/konto/zwei-faktor" className="font-medium text-teal underline underline-offset-2">
            Jetzt einrichten
          </Link>
        </div>
      )}
      {children}
    </AppShell>
  );
}
