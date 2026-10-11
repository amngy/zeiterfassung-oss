"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { changePasswordAction, type AccountState } from "./actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<AccountState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="max-w-md space-y-4">
      <Field label="Aktuelles Passwort" htmlFor="cur" required>
        <Input id="cur" name="currentPassword" type="password" required autoComplete="current-password" />
      </Field>
      <Field label="Neues Passwort" htmlFor="new" required hint="mind. 10 Zeichen, Buchstaben + Ziffern">
        <Input id="new" name="newPassword" type="password" required autoComplete="new-password" />
      </Field>
      <Field label="Neues Passwort bestätigen" htmlFor="conf" required>
        <Input id="conf" name="confirmPassword" type="password" required autoComplete="new-password" />
      </Field>
      {state.ok && (
        <p className="flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
          <Check className="h-4 w-4" /> {state.message}
        </p>
      )}
      {state.error && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{state.error}</p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Passwort ändern
        </Button>
      </div>
    </form>
  );
}
