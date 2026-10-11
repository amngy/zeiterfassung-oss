import { redirect } from "next/navigation";
import { auth } from "@/auth";
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
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { name, role } = session.user;

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
      {children}
    </AppShell>
  );
}
