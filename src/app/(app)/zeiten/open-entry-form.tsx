"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  resolveOpenEntryAction,
  type CorrectionFormState,
} from "./correction-actions";

export interface OpenEntry {
  id: string;
  type: "WORK" | "BREAK";
  /** Berlin wall-clock "YYYY-MM-DDTHH:mm" the entry started. */
  startLocal: string;
  /** Human label, e.g. "Arbeit seit Mo, 27.07.2026 08:12". */
  label: string;
  /** Suggested end: the same day's contractual end, or the start + expected hours. */
  suggestedEndLocal: string;
}

/**
 * Self-service resolution for a forgotten clock-out.
 *
 * An entry with no end blocks every future clock-in (one open ACTIVE entry per
 * type is enforced by a partial unique index), so this form has to stay reachable
 * from every view — not just the day view — and it must accept the RUNNING entry
 * as its target. Both were the reason employees ended up permanently locked out.
 */
export function OpenEntryForm({ entries }: { entries: OpenEntry[] }) {
  const [state, action, pending] = useActionState<CorrectionFormState, FormData>(
    resolveOpenEntryAction,
    {},
  );

  const [entryId, setEntryId] = React.useState(entries[0]?.id ?? "");
  const current = entries.find((e) => e.id === entryId) ?? entries[0];
  const [end, setEnd] = React.useState(current?.suggestedEndLocal ?? "");

  // Re-seed the suggested end when the selected entry changes — by selection, or
  // because a resolved entry dropped out of `entries`. Adjusted during render
  // (React's pattern for state derived from props) rather than in an effect.
  const [seededFor, setSeededFor] = React.useState(current?.id);
  if (current && current.id !== seededFor) {
    setSeededFor(current.id);
    setEnd(current.suggestedEndLocal);
  }

  if (entries.length === 0) return null;

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Offener Eintrag.</strong> Eine Zeiterfassung wurde nicht beendet
            (vermutlich vergessenes Ausstempeln). Solange sie offen ist, können Sie
            sich nicht neu einstempeln. Bitte tragen Sie das tatsächliche Ende nach —
            das schließt den Eintrag sofort ab.
          </span>
        </div>

        {state.ok && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
            <Check className="h-4 w-4" />
            Eintrag abgeschlossen. Sie können sich wieder normal einstempeln.
          </p>
        )}

        <form action={action} className="mt-4 space-y-4">
          {entries.length > 1 ? (
            <Field label="Offener Eintrag" htmlFor="entryId">
              <Select
                id="entryId"
                name="entryId"
                value={entryId}
                onChange={(e) => setEntryId(e.target.value)}
              >
                {entries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <>
              <input type="hidden" name="entryId" value={entryId} />
              <p className="text-sm text-muted">{current?.label}</p>
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Tatsächliches Ende"
              htmlFor="open-end"
              required
              info={`Deutsche Ortszeit. Muss nach dem Beginn und darf nicht in der Zukunft liegen. Der ursprüngliche Eintrag wird nicht gelöscht, sondern revisionssicher durch eine neue, abgeschlossene Version ersetzt.`}
            >
              <Input
                id="open-end"
                name="end"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </Field>
          </div>

          <Field
            label="Grund"
            htmlFor="open-reason"
            required
            info={`Pflichtangabe (3–500 Zeichen). Wird dauerhaft im Änderungsprotokoll gespeichert, damit die Nachtragung revisionssicher nachvollziehbar bleibt.`}
          >
            <Textarea
              id="open-reason"
              name="reason"
              required
              placeholder="z. B. Ausstempeln vergessen, Feierabend war um 17:00"
            />
          </Field>

          {state.error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
              {state.error}
            </p>
          )}

          <div className="flex justify-end">
            <span className="inline-flex items-center gap-1.5">
              <Button type="submit" disabled={pending}>
                Eintrag abschließen
              </Button>
              <InfoHint>{`Schließt den offenen Eintrag sofort ab, damit Sie wieder stempeln können. Die Nachtragung wird protokolliert und ist für die Verwaltung im Protokoll sichtbar.`}</InfoHint>
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
