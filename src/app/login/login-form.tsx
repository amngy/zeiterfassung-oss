"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { authenticate, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";

export function LoginForm({ next }: { next: string | null }) {
  const [state, formAction, pending] = useActionState<
    LoginState | undefined,
    FormData
  >(authenticate, undefined);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="mt-8 space-y-5" aria-label="Anmeldung">
      {next && <input type="hidden" name="next" value={next} />}
      {state?.error && (
        <div
          role="alert"
          className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm font-medium text-danger"
        >
          {state.error}
        </div>
      )}

      <Field label="E-Mail-Adresse" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="name@firma.de"
          inputMode="email"
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

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Anmeldung läuft…" : "Anmelden"}
      </Button>
    </form>
  );
}
