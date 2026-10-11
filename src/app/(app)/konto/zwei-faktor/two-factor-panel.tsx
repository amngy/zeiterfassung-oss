"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Download, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import {
  beginEnrolmentAction,
  cancelEnrolmentAction,
  confirmEnrolmentAction,
  disableTwoFactorAction,
  regenerateCodesAction,
  type TwoFactorState,
} from "./actions";

export interface PanelProps {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  required: boolean;
  pending: { secret: string; qrSvg: string } | null;
}

function Problem({ text }: { text?: string }) {
  if (!text) return null;
  return <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{text}</p>;
}

function CodeField({ id, label = "Code aus der App" }: { id: string; label?: string }) {
  return (
    <Field label={label} htmlFor={id} required>
      <Input
        id={id}
        name="code"
        required
        autoComplete="one-time-code"
        inputMode="numeric"
        placeholder="123456"
        className="max-w-[12rem] font-mono tracking-widest"
      />
    </Field>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
        <Check className="h-4 w-4" /> Gespeichert. Hier sind Ihre Wiederherstellungscodes.
      </p>
      <p className="text-sm text-ink">
        Jeder Code funktioniert <strong>einmal</strong> anstelle des Codes aus der App — etwa wenn das Handy
        verloren ist. Bewahren Sie sie getrennt vom Handy auf (Passwortmanager, Ausdruck).{" "}
        <strong>Sie werden nur jetzt angezeigt.</strong>
      </p>
      <ul className="grid max-w-md grid-cols-2 gap-2 rounded-xl border border-black/10 bg-black/[0.02] p-4 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true));
          }}
        >
          <Copy className="h-4 w-4" /> {copied ? "Kopiert" : "Kopieren"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([`${text}\n`], { type: "text/plain" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "wiederherstellungscodes.txt";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download className="h-4 w-4" /> Als Datei speichern
        </Button>
        <Button type="button" onClick={onDone}>
          Ich habe die Codes gesichert
        </Button>
      </div>
    </div>
  );
}

export function TwoFactorPanel(props: PanelProps) {
  const [confirmState, confirmAction, confirming] = useActionState<TwoFactorState, FormData>(confirmEnrolmentAction, {});
  const [renewState, renewAction, renewing] = useActionState<TwoFactorState, FormData>(regenerateCodesAction, {});
  const [disableState, disableAction, disabling] = useActionState<TwoFactorState, FormData>(disableTwoFactorAction, {});
  const [dismissed, setDismissed] = useState<string[] | undefined>();

  const fresh = renewState.codes ?? confirmState.codes;
  if (fresh && fresh !== dismissed) {
    return <RecoveryCodes codes={fresh} onDone={() => setDismissed(fresh)} />;
  }

  if (props.pending) {
    return (
      <div className="space-y-5">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
          <li>Eine Authenticator-App öffnen (z. B. Microsoft Authenticator, Google Authenticator, 2FAS, Aegis).</li>
          <li>Den QR-Code scannen — oder den Schlüssel von Hand eingeben.</li>
          <li>Den sechsstelligen Code, den die App anzeigt, unten eintragen.</li>
        </ol>
        <div className="flex flex-wrap items-start gap-6">
          <div
            className="h-48 w-48 shrink-0 rounded-xl border border-black/10 bg-white p-2"
            aria-label="QR-Code für die Authenticator-App"
            role="img"
            // Server-generated SVG of our own otpauth URI (qrcode library).
            dangerouslySetInnerHTML={{ __html: props.pending.qrSvg }}
          />
          <div className="space-y-1 text-sm">
            <p className="text-muted">
              Schlüssel zur Eingabe von Hand{" "}
              <InfoHint>{`Zeitbasiert (TOTP), 6 Stellen, 30 Sekunden — die Standardwerte jeder App. Den Schlüssel nicht weitergeben: Wer ihn kennt, kann Codes erzeugen.`}</InfoHint>
            </p>
            <p className="break-all font-mono text-base tracking-wider text-ink">{props.pending.secret}</p>
          </div>
        </div>
        <form action={confirmAction} className="space-y-3">
          <CodeField id="tf-confirm" />
          <Problem text={confirmState.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={confirming}>
              {confirming ? "Prüfe…" : "Bestätigen und einschalten"}
            </Button>
          </div>
        </form>
        <form action={cancelEnrolmentAction}>
          <button className="text-sm text-muted underline underline-offset-2 hover:text-ink">Abbrechen</button>
        </form>
      </div>
    );
  }

  if (props.enabled) {
    return (
      <div className="space-y-6">
        <p className="flex items-center gap-2 text-sm font-medium text-lime-dark">
          <ShieldCheck className="h-4 w-4" /> Eingeschaltet seit {props.enabledAt}
        </p>
        <p className="text-sm text-muted">
          Noch {props.recoveryCodesLeft} unbenutzte Wiederherstellungscodes.
          {props.recoveryCodesLeft <= 3 && " Bitte bald neue erzeugen."}
        </p>

        <form action={renewAction} className="space-y-3 border-t border-black/[0.06] pt-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <KeyRound className="h-4 w-4" /> Neue Wiederherstellungscodes
            <InfoHint>{`Erzeugt zehn neue Codes; die bisherigen gelten dann nicht mehr.`}</InfoHint>
          </p>
          <CodeField id="tf-renew" />
          <Problem text={renewState.error} />
          <Button type="submit" variant="outline" disabled={renewing}>
            Neue Codes erzeugen
          </Button>
        </form>

        <form action={beginEnrolmentAction} className="space-y-2 border-t border-black/[0.06] pt-4">
          <p className="text-sm font-medium text-ink">Neues Handy</p>
          <p className="text-sm text-muted">
            Richtet die App auf einem anderen Gerät ein. Bis Sie dort einen Code bestätigt haben, gilt das bisherige.
          </p>
          <Button type="submit" variant="outline">
            Auf neuem Gerät einrichten
          </Button>
        </form>

        {!props.required && (
          <form action={disableAction} className="space-y-3 border-t border-black/[0.06] pt-4">
            <p className="text-sm font-medium text-ink">Abschalten</p>
            <CodeField id="tf-disable" label="Code aus der App oder Wiederherstellungscode" />
            <Problem text={disableState.error} />
            <Button type="submit" variant="outline" disabled={disabling}>
              Zwei-Faktor-Anmeldung abschalten
            </Button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {disableState.message && (
        <p className="flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
          <Check className="h-4 w-4" /> {disableState.message}
        </p>
      )}
      <p className="text-sm text-ink">
        Bei der Anmeldung fragt die App dann zusätzlich nach einem Code aus einer Authenticator-App auf Ihrem Handy.
        Ein gestohlenes Passwort allein genügt so nicht mehr.
      </p>
      <form action={beginEnrolmentAction}>
        <Button type="submit">Einrichtung starten</Button>
      </form>
    </div>
  );
}
