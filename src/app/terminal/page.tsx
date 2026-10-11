import type { Metadata } from "next";
import { cookies } from "next/headers";
import { terminalForCookie, TERMINAL_COOKIE } from "@/lib/terminals";
import { KioskDisplay } from "./kiosk-display";

export const metadata: Metadata = { title: "Terminal" };

/** Full-screen kiosk view for a paired on-site device; no user session. */
export default async function TerminalPage() {
  const terminal = await terminalForCookie((await cookies()).get(TERMINAL_COOKIE)?.value);
  if (!terminal) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface p-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="text-xl font-medium text-ink">Kein Terminal eingerichtet</h1>
          <p className="text-sm text-muted">
            Dieses Gerät ist nicht (mehr) als Stempel-Terminal gekoppelt. Unter Verwaltung →
            Terminals lässt sich ein Kopplungslink erzeugen, der hier geöffnet wird.
          </p>
        </div>
      </main>
    );
  }
  // Someone signed in on the shared device after pairing (pairing signs out).
  const signedIn = (await cookies()).getAll().some((c) => c.name.includes("authjs.session-token"));
  return <KioskDisplay label={terminal.label} signedInWarning={signedIn} />;
}
