"use client";

import * as React from "react";
import { useActionState } from "react";
import { Copy, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  createTerminalAction,
  pairCodeAction,
  type PairLink,
  type TerminalFormState,
} from "./actions";

function PairLinkPanel({ pair }: { pair: PairLink }) {
  const [copied, setCopied] = React.useState(false);
  const until = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(pair.expiresAtISO));
  return (
    <div className="space-y-3 rounded-xl border border-teal/20 bg-teal/5 p-4">
      <p className="text-sm text-ink">
        Kopplungslink für <strong>„{pair.label}“</strong> — einmal verwendbar, gültig bis {until} Uhr.
        Auf dem Terminal-Gerät öffnen (z. B. diesen Code mit dessen Kamera scannen) und dort
        bestätigen.
      </p>
      <div className="flex flex-wrap items-start gap-4">
        <div
          className="h-40 w-40 shrink-0 rounded-lg bg-white p-1 [&>svg]:h-full [&>svg]:w-full"
          // Server-generated SVG of our own pairing URL (qrcode library).
          dangerouslySetInnerHTML={{ __html: pair.svg }}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <code className="block break-all rounded-lg bg-white px-3 py-2 text-xs text-ink">{pair.url}</code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(pair.url).then(() => setCopied(true));
            }}
          >
            <Copy className="h-4 w-4" />
            {copied ? "Kopiert" : "Link kopieren"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorLine({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{error}</p>;
}

export function CreateTerminalForm() {
  const [state, action, pending] = useActionState<TerminalFormState, FormData>(createTerminalAction, {});
  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <Field label="Bezeichnung" htmlFor="terminal-label" className="min-w-[14rem] flex-1">
          <Input id="terminal-label" name="label" placeholder="z. B. Eingang Büro" maxLength={60} required />
        </Field>
        <Button type="submit" disabled={pending}>
          <Plus className="h-4 w-4" />
          Terminal anlegen
        </Button>
      </form>
      <ErrorLine error={state.error} />
      {state.pair && <PairLinkPanel pair={state.pair} />}
    </div>
  );
}

export function PairLinkButton({ terminalId, label }: { terminalId: string; label: string }) {
  const [state, action, pending] = useActionState<TerminalFormState, FormData>(pairCodeAction, {});
  return (
    <div className="space-y-3">
      <form action={action}>
        <input type="hidden" name="terminalId" value={terminalId} />
        <input type="hidden" name="label" value={label} />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          <Link2 className="h-4 w-4" />
          Kopplungslink
        </Button>
      </form>
      <ErrorLine error={state.error} />
      {state.pair && <PairLinkPanel pair={state.pair} />}
    </div>
  );
}
