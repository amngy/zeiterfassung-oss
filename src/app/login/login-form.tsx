"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { authenticate, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<
    LoginState | undefined,
    FormData
  >(authenticate, undefined);
  const [showPassword, setShowPassword] = useState(false);
  // What was typed in step 1, kept for the code step (#14) — React resets the
  // form after each action. Without JavaScript the step simply asks again.
  const [typed, setTyped] = useState<{ email: string; password: string; remember: boolean } | null>(null);
  const codeStep = state?.step === "code";
  const carried = codeStep && typed ? typed : null;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const fd = new FormData(e.currentTarget);
        setTyped({
          email: String(fd.get("email") ?? ""),
          password: String(fd.get("password") ?? ""),
          remember: fd.get("remember") != null,
        });
      }}
      className="mt-8 space-y-5"
      aria-label="Anmeldung"
    >
      {state?.error && (
        <div
          role="alert"
          className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm font-medium text-danger"
        >
          {state.error}
        </div>
      )}

      {carried ? (
        <>
          <input type="hidden" name="email" value={carried.email} />
          <input type="hidden" name="password" value={carried.password} />
          {carried.remember && <input type="hidden" name="remember" value="on" />}
          <p className="text-sm text-muted">
            Angemeldet als <strong className="text-ink">{carried.email}</strong> ·{" "}
            <a href="/login" className="text-teal underline underline-offset-2">
              anderes Konto
            </a>
          </p>
        </>
      ) : (
        <>
      <Field label="E-Mail-Adresse" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="name@firma.de"
          inputMode="email"
          defaultValue={state?.email}
          required
        />
      </Field>

      <Field label="Passwort" htmlFor="password" required>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            required
            className="pr-11"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-ink focus-visible:outline-none focus-visible:text-teal"
            aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
            aria-pressed={showPassword}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>

      <div className="flex items-center gap-1.5">
        <label className="flex items-center gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            name="remember"
            className="h-4 w-4 rounded border-black/20 text-lime focus-visible:ring-2 focus-visible:ring-lime/40"
          />
          Angemeldet bleiben
        </label>
        <InfoHint>{`Aktiviert: Sie bleiben rund 30 Tage angemeldet. Deaktiviert: Die Anmeldung endet, sobald Sie den Browser schließen. Auf gemeinsam genutzten Geräten besser deaktiviert lassen.`}</InfoHint>
      </div>
        </>
      )}

      {codeStep && (
        <Field
          label="Code aus der Authenticator-App"
          htmlFor="code"
          required
          info={`Der sechsstellige Code aus der App, die Sie bei der Einrichtung der Zwei-Faktor-Anmeldung verbunden haben. Ohne Handy: einen Ihrer Wiederherstellungscodes eingeben (jeder gilt einmal). Sind beide verloren, kann die Verwaltung die Zwei-Faktor-Anmeldung zurücksetzen.`}
        >
          <Input
            id="code"
            name="code"
            autoComplete="one-time-code"
            placeholder="123456"
            autoFocus
            required
            className="font-mono tracking-widest"
          />
        </Field>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {codeStep && <ShieldCheck className="h-4 w-4" />}
        {pending ? "Anmeldung läuft…" : codeStep ? "Code bestätigen" : "Anmelden"}
      </Button>
    </form>
  );
}
