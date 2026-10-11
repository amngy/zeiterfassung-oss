import type { Metadata } from "next";
import { terminalForPairCode } from "@/lib/terminals";
import { PairForm } from "./pair-form";

export const metadata: Metadata = { title: "Terminal einrichten" };

export default async function PairTerminalPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const code = (await searchParams).code ?? "";
  const terminal = await terminalForPairCode(code);
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-medium text-ink">Terminal einrichten</h1>
        {terminal ? (
          <>
            <p className="text-sm text-muted">
              Dieses Gerät wird als Stempel-Terminal{" "}
              <strong className="text-ink">„{terminal.label}“</strong> eingerichtet und zeigt danach
              dauerhaft einen wechselnden QR-Code an. Ein bisher für dieses Terminal gekoppeltes
              Gerät wird dabei abgemeldet.
            </p>
            <PairForm code={code} />
          </>
        ) : (
          <p className="text-sm text-muted">
            Dieser Kopplungslink ist abgelaufen oder wurde bereits verwendet. Unter Verwaltung →
            Terminals lässt sich ein neuer erzeugen (gültig 15 Minuten).
          </p>
        )}
      </div>
    </main>
  );
}
