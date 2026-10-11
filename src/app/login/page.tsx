import type { Metadata } from "next";
import { ShieldCheck, Clock3, CalendarDays } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { BRAND } from "@/config/brand";
import { safeInternalPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Anmelden" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  // Back to the page that sent them here (e.g. a scanned terminal code).
  const next = safeInternalPath((await searchParams).callbackUrl);
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel — hidden on small screens */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-teal p-12 text-white lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-lime/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-teal-dark/60 blur-3xl"
        />
        <Logo variant="dark" size="lg" />

        <div className="relative max-w-md">
          <h1 className="text-3xl font-light leading-tight tracking-tight">
            Arbeitszeit erfassen — einfach, fair und{" "}
            <span className="font-semibold text-lime">rechtssicher</span>.
          </h1>
          <p className="mt-4 text-white/75">
            Kommen und Gehen, Pausen, Urlaub und Krankheit an einem Ort.
            Transparent für das Team, revisionssicher für die Verwaltung.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-white/85">
            <li className="flex items-center gap-3">
              <Clock3 className="h-5 w-5 shrink-0 text-lime" />
              Ein Klick zum Ein- und Ausstempeln
            </li>
            <li className="flex items-center gap-3">
              <CalendarDays className="h-5 w-5 shrink-0 text-lime" />
              Urlaub &amp; Feiertage automatisch berücksichtigt
            </li>
            <li className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 shrink-0 text-lime" />
              Manipulationssicher &amp; DSGVO-konform
            </li>
          </ul>
        </div>

        {BRAND.copyrightHolder ? (
          <p className="relative text-xs text-white/50">
            © {new Date().getFullYear()} {BRAND.copyrightHolder}
          </p>
        ) : (
          <span />
        )}
      </aside>

      {/* Form panel */}
      <section className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo size="lg" />
          </div>

          <h2 className="text-2xl font-medium tracking-tight text-ink">
            Anmelden
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            Melden Sie sich mit Ihrer geschäftlichen E-Mail-Adresse an.
          </p>

          <LoginForm next={next} />

          <p className="mt-6 text-center text-xs text-muted">
            Probleme bei der Anmeldung? Bitte wenden Sie sich an Ihre
            Administration.
          </p>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-muted/80">
            Diese Anwendung verwendet ausschließlich ein technisch notwendiges
            Cookie, um Ihre Anmeldung zu speichern. Es findet kein Tracking und
            keine Weitergabe an Dritte statt — daher ist keine Einwilligung
            erforderlich (§ 25 Abs. 2 TDDDG).
          </p>
        </div>
      </section>
    </main>
  );
}
