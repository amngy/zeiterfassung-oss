"use client";

import * as React from "react";
import { useActionState } from "react";
import { PencilLine, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input, Select, Textarea } from "@/components/ui/input";
import { submitCorrection, type CorrectionFormState } from "./correction-actions";

export interface CorrectableEntry {
  id: string;
  type: "WORK" | "BREAK";
  startLocal: string; // "YYYY-MM-DDTHH:mm" Berlin wall-clock
  endLocal: string;
  label: string;
}

export function CorrectionForm({
  dayKey,
  entries,
  breakDeclarationRequired,
}: {
  dayKey: string;
  entries: CorrectableEntry[];
  /** Employees must state whether a break was taken; admins may leave it open. */
  breakDeclarationRequired: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, action, pending] = useActionState<CorrectionFormState, FormData>(
    submitCorrection,
    {},
  );

  // Controlled fields so selecting an existing entry can prefill them.
  const [target, setTarget] = React.useState("");
  const [type, setType] = React.useState<"WORK" | "BREAK">("WORK");
  const [start, setStart] = React.useState(`${dayKey}T09:00`);
  const [end, setEnd] = React.useState(`${dayKey}T17:00`);
  // Intentionally starts unanswered — the point is that somebody says so.
  const [hasBreak, setHasBreak] = React.useState<"" | "yes" | "no">("");
  const [breakStart, setBreakStart] = React.useState(`${dayKey}T12:30`);
  const [breakEnd, setBreakEnd] = React.useState(`${dayKey}T13:00`);

  function onPickTarget(id: string) {
    setTarget(id);
    const e = entries.find((x) => x.id === id);
    if (e) {
      setType(e.type);
      setStart(e.startLocal);
      setEnd(e.endLocal);
    }
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
          aria-expanded={open}
        >
          <span className="flex items-center gap-2 text-base font-medium text-teal">
            <PencilLine className="h-4 w-4" />
            Zeit korrigieren oder nachtragen
          </span>
          <span className="text-sm text-muted">{open ? "schließen" : "öffnen"}</span>
        </button>

        {state.ok && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
            <Check className="h-4 w-4" />
            {state.applied
              ? "Zeit geändert. Der bisherige Wert bleibt als ersetzte Version im Protokoll."
              : "Korrekturantrag eingereicht. Er wird von der Verwaltung geprüft — bis dahin ändert sich an der erfassten Zeit nichts."}
          </p>
        )}

        {open && (
          <form action={action} className="mt-4 space-y-4">
            <Field label="Eintrag" htmlFor="timeEntryId" hint="optional" info={`Leer lassen (Neuer Eintrag), um eine vergessene Zeit nachzutragen; oder einen vorhandenen Eintrag zur Korrektur wählen. Der alte Wert wird nie gelöscht, sondern revisionssicher durch eine neue Version ersetzt.`}>
              <Select
                id="timeEntryId"
                name="timeEntryId"
                value={target}
                onChange={(e) => onPickTarget(e.target.value)}
              >
                <option value="">Neuer Eintrag (nachtragen)</option>
                {entries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label} korrigieren
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Art" htmlFor="type" info={`Arbeit zählt als Arbeitszeit, Pause als Pausenzeit. Pausen werden nicht als Arbeit gewertet, sondern auf die gesetzlich vorgeschriebene Ruhepause angerechnet (§4 ArbZG).`}>
                <Select
                  id="type"
                  name="type"
                  value={type}
                  onChange={(e) => setType(e.target.value as "WORK" | "BREAK")}
                >
                  <option value="WORK">Arbeit</option>
                  <option value="BREAK">Pause</option>
                </Select>
              </Field>
              <Field label="Beginn" htmlFor="start" required info={`Datum und Uhrzeit in deutscher Ortszeit (Europe/Berlin). Zeiten, die es wegen der Sommer-/Winterzeit-Umstellung nicht gibt oder die doppelt vorkommen, werden abgelehnt.`}>
                <Input
                  id="start"
                  name="start"
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </Field>
              <Field label="Ende" htmlFor="end" required info={`Deutsche Ortszeit; muss nach dem Beginn liegen. Eine Korrektur schließt den Eintrag immer ab – offene (laufende) Zeiten lassen sich hier nicht anlegen.`}>
                <Input
                  id="end"
                  name="end"
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </Field>
            </div>

            {type === "WORK" && (
              <fieldset className="space-y-3 rounded-xl bg-surface p-4">
                <legend className="sr-only">Pause</legend>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-ink">
                    Wurde in dieser Zeit eine Pause gemacht?
                    {breakDeclarationRequired && <span className="text-danger">*</span>}
                    <InfoHint>{`Pflichtangabe: Eine korrigierte Arbeitszeit ohne Aussage zur Pause ist kein vollständiger Nachweis — die Pausenprüfung nach §4 ArbZG würde das Schweigen sonst als „keine Pause" werten, ohne dass das jemand erklärt hätte. Die Angabe ersetzt die für diese Schicht erfassten Pausen.`}</InfoHint>
                  </span>
                  <div className="flex items-center gap-4">
                    <label className="inline-flex items-center gap-1.5 text-sm text-ink">
                      <input
                        type="radio"
                        name="hasBreak"
                        value="yes"
                        checked={hasBreak === "yes"}
                        onChange={() => setHasBreak("yes")}
                        required={breakDeclarationRequired}
                        className="h-4 w-4 border-black/20 text-teal"
                      />
                      Ja
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-sm text-ink">
                      <input
                        type="radio"
                        name="hasBreak"
                        value="no"
                        checked={hasBreak === "no"}
                        onChange={() => setHasBreak("no")}
                        required={breakDeclarationRequired}
                        className="h-4 w-4 border-black/20 text-teal"
                      />
                      Nein
                    </label>
                  </div>
                </div>

                {hasBreak === "yes" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Pause von" htmlFor="breakStart" required>
                      <Input
                        id="breakStart"
                        name="breakStart"
                        type="datetime-local"
                        value={breakStart}
                        onChange={(e) => setBreakStart(e.target.value)}
                        required
                      />
                    </Field>
                    <Field
                      label="Pause bis"
                      htmlFor="breakEnd"
                      required
                      info={`Die Pause muss innerhalb der oben angegebenen Arbeitszeit liegen.`}
                    >
                      <Input
                        id="breakEnd"
                        name="breakEnd"
                        type="datetime-local"
                        value={breakEnd}
                        onChange={(e) => setBreakEnd(e.target.value)}
                        required
                      />
                    </Field>
                  </div>
                )}

                {hasBreak === "no" && (
                  <p className="text-xs text-muted">
                    Für diese Schicht wird keine Pause erfasst. Bereits erfasste Pausen
                    innerhalb dieser Zeit werden mit der Korrektur als ersetzt markiert.
                  </p>
                )}
              </fieldset>
            )}

            <Field label="Grund (Änderungsgrund)" htmlFor="reason" required info={`Pflichtangabe (3–500 Zeichen). Der Grund wird dauerhaft und unveränderbar im Änderungsprotokoll gespeichert, damit Zeitkorrekturen revisionssicher nachvollziehbar bleiben.`}>
              <Textarea
                id="reason"
                name="reason"
                required
                placeholder="z. B. Ausstempeln vergessen, tatsächliches Ende war 17:00"
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
                  Korrektur beantragen
                </Button>
                <InfoHint>{`Sendet einen Antrag an die Verwaltung. Er bleibt offen (PENDING), bis er geprüft und genehmigt ist – bis dahin ändert sich an der erfassten Zeit nichts.`}</InfoHint>
              </span>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
