"use client";

import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Textarea } from "@/components/ui/input";
import { decideCorrectionAction, type DecisionState } from "./actions";

/** Approve/reject controls for one pending correction request. */
export function CorrectionDecision({ correctionId }: { correctionId: string }) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(
    decideCorrectionAction,
    {},
  );

  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="correctionId" value={correctionId} />
      <div className="flex items-center gap-1.5">
        <label htmlFor={`decisionNote-${correctionId}`} className="text-sm font-medium text-ink">
          Anmerkung zur Entscheidung
        </label>
        <InfoHint>{`Optionale Anmerkung zur Entscheidung. Sie wird dauerhaft im Protokoll gespeichert und der betroffenen Person bei ihrem Antrag angezeigt — bei Genehmigung wie bei Ablehnung. Kann leer bleiben.`}</InfoHint>
      </div>
      <Textarea
        id={`decisionNote-${correctionId}`}
        name="decisionNote"
        placeholder="Anmerkung zur Entscheidung (optional)"
        className="min-h-[56px]"
      />
      {state.error && (
        <p className="rounded-lg bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <span className="inline-flex items-center gap-1.5">
          <Button type="submit" name="decision" value="approve" disabled={pending}>
            <Check className="h-4 w-4" /> Genehmigen
          </Button>
          <InfoHint>{`Übernimmt den Antrag sofort: Der bisherige Eintrag wird ersetzt (als überschrieben markiert, nicht gelöscht) bzw. bei einem Nachtrag neu angelegt. Alles wird protokolliert; die Entscheidung ist endgültig.`}</InfoHint>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Button
            type="submit"
            name="decision"
            value="reject"
            variant="outline"
            disabled={pending}
          >
            <X className="h-4 w-4" /> Ablehnen
          </Button>
          <InfoHint>{`Lehnt den Antrag ab; die erfassten Zeiten bleiben unverändert. Die Ablehnung wird protokolliert und ist endgültig — der Antrag kann danach nicht erneut entschieden werden.`}</InfoHint>
        </span>
      </div>
    </form>
  );
}
