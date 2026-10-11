"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertTriangle, Check, CalendarPlus, Undo2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  previewBatchAction,
  applyBatchAction,
  type BatchState,
} from "./actions";
import type { SkipReason } from "@/lib/batch-entry";

export interface EmployeeOption {
  id: string;
  name: string;
  active: boolean;
}

const SKIP_LABEL: Record<SkipReason, string> = {
  NOT_A_WORKING_DAY: "kein Arbeitstag",
  HOLIDAY: "Feiertag",
  ABSENCE: "Abwesenheit",
  ALREADY_RECORDED: "bereits erfasst",
  IN_THE_FUTURE: "in der Zukunft",
  BEFORE_EMPLOYMENT: "vor Eintritt",
  AFTER_EMPLOYMENT: "nach Austritt",
};

function fmt(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

function dmy(dayKey: string): string {
  const [y, m, d] = dayKey.split("-");
  return `${d}.${m}.${y}`;
}

export function BatchForm({
  employees,
  defaultFrom,
  defaultTo,
}: {
  employees: EmployeeOption[];
  defaultFrom: string;
  defaultTo: string;
}) {
  const [state, action, pending] = useActionState<BatchState, FormData>(
    previewBatchAction,
    {},
  );
  const [applyState, applyAction, applying] = useActionState<BatchState, FormData>(
    applyBatchAction,
    {},
  );

  // Unchecked → no BREAK entry is written for any of the days. The time fields
  // stay visible but disabled, so unchecking is reversible without retyping.
  const [withBreak, setWithBreak] = React.useState(true);

  const preview = state.preview;
  const input = state.input;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <span className="inline-flex items-center gap-2">
              <CalendarPlus className="h-4 w-4 text-teal" />
              Zeiten für einen Zeitraum nachtragen
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Mitarbeiter:in"
                htmlFor="b-user"
                required
                info={`Die Person, für die nachgetragen wird. Der Nachtrag wird mit Ihrer Kennung als erfassende Person protokolliert.`}
              >
                <Select id="b-user" name="userId" required>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.active ? "" : " (inaktiv)"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Von" htmlFor="b-from" required>
                <Input id="b-from" name="fromKey" type="date" defaultValue={defaultFrom} required />
              </Field>
              <Field
                label="Bis"
                htmlFor="b-to"
                required
                info={`Einschließlich. Tage ab heute werden nie nachgetragen — der Nachtrag ist ausschließlich rückwirkend.`}
              >
                <Input id="b-to" name="toKey" type="date" defaultValue={defaultTo} required />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Beginn" htmlFor="b-start" required>
                <Input id="b-start" name="startTime" type="time" defaultValue="09:00" required />
              </Field>
              <Field label="Ende" htmlFor="b-end" required>
                <Input id="b-end" name="endTime" type="time" defaultValue="17:00" required />
              </Field>
            </div>

            <fieldset className="space-y-3 rounded-xl bg-surface p-4">
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="withBreak"
                  checked={withBreak}
                  onChange={(e) => setWithBreak(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-black/20 text-teal"
                />
                <span className="inline-flex items-center gap-1">
                  Pause eintragen
                  <InfoHint>{`Abwählen, um ohne Pausenzeit nachzutragen — dann wird kein Pausen-Eintrag erzeugt und die volle Zeit zwischen Beginn und Ende zählt als Arbeitszeit. Die Vorschau weist weiterhin darauf hin, wenn nach §4 ArbZG eine Ruhepause vorgeschrieben wäre.`}</InfoHint>
                </span>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Pause von"
                  htmlFor="b-bstart"
                  required={withBreak}
                  info={`Wird als eigener Pausen-Eintrag erfasst und von der Arbeitszeit abgezogen.`}
                >
                  <Input
                    id="b-bstart"
                    name="breakStartTime"
                    type="time"
                    defaultValue="12:30"
                    required={withBreak}
                    disabled={!withBreak}
                  />
                </Field>
                <Field label="Pause bis" htmlFor="b-bend" required={withBreak}>
                  <Input
                    id="b-bend"
                    name="breakEndTime"
                    type="time"
                    defaultValue="13:00"
                    required={withBreak}
                    disabled={!withBreak}
                  />
                </Field>
              </div>

              {!withBreak && (
                <p className="text-xs text-muted">
                  Es wird kein Pausen-Eintrag erzeugt — die Tage werden ohne Pause nachgetragen.
                </p>
              )}
            </fieldset>

            <fieldset className="grid gap-2 rounded-xl bg-surface p-4 sm:grid-cols-3">
              <Toggle
                name="onlyContractedDays"
                label="Nur vertragliche Arbeitstage"
                defaultChecked
                info="Überspringt Tage, an denen laut Arbeitszeitmodell keine Sollzeit besteht (z. B. Wochenenden, Teilzeit-freie Tage)."
              />
              <Toggle
                name="skipHolidays"
                label="Feiertage überspringen"
                defaultChecked
                info="Ganze gesetzliche und firmenfreie Feiertage werden nicht nachgetragen."
              />
              <Toggle
                name="skipAbsences"
                label="Abwesenheiten überspringen"
                defaultChecked
                info="Tage mit genehmigtem Urlaub oder erfasster Krankheit werden nicht nachgetragen."
              />
            </fieldset>

            {state.error && (
              <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                {state.error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <span className="text-sm text-muted">
                Es wird zunächst nur eine Vorschau berechnet — noch nichts gespeichert.
              </span>
              <Button type="submit" disabled={pending}>
                Vorschau berechnen
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {preview && input && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">
                Vorschau — {preview.userName}, {dmy(preview.fromKey)} bis {dmy(preview.toKey)}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge tone={preview.days.length > 0 ? "lime" : "neutral"}>
                  {preview.days.length} Tag(e) werden erfasst
                </Badge>
                <Badge tone="neutral">{preview.skipped.length} übersprungen</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.warnings.map((w, i) => (
              <p
                key={i}
                className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{w}</span>
              </p>
            ))}

            {preview.days.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-black/10 text-left text-xs text-muted">
                      <th className="py-2 pr-3 font-medium">Tag</th>
                      <th className="py-2 pr-3 font-medium">Arbeit</th>
                      <th className="py-2 pr-3 font-medium">Pause</th>
                      <th className="py-2 pr-3 text-right font-medium">Netto</th>
                      <th className="py-2 text-right font-medium">Soll</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.days.map((d) => (
                      <tr key={d.dayKey} className="border-b border-black/5">
                        <td className="py-1.5 pr-3">{dmy(d.dayKey)}</td>
                        <td className="py-1.5 pr-3 font-mono tabular-nums">
                          {input.startTime}–{input.endTime}
                        </td>
                        <td className="py-1.5 pr-3 font-mono tabular-nums text-muted">
                          {d.breakStart ? `${input.breakStartTime}–${input.breakEndTime}` : "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                          {fmt(d.netHours)}
                        </td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-muted">
                          {fmt(d.expectedHours)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-medium">
                      <td className="py-2 pr-3">Summe</td>
                      <td className="py-2 pr-3" colSpan={2} />
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        {fmt(preview.totals.netHours)}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-muted">
                        {fmt(preview.totals.expectedHours)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {preview.skipped.length > 0 && (
              <details className="rounded-xl bg-surface px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-ink">
                  {preview.skipped.length} übersprungene Tage anzeigen
                </summary>
                <ul className="mt-2 grid gap-1 text-sm text-muted sm:grid-cols-2">
                  {preview.skipped.map((s) => (
                    <li key={s.dayKey}>
                      <span className="font-mono tabular-nums">{dmy(s.dayKey)}</span>{" "}
                      — {SKIP_LABEL[s.reason]}
                      {s.detail ? ` (${s.detail})` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {preview.days.length > 0 && (
              <form action={applyAction} className="space-y-4 border-t border-black/10 pt-4">
                {/* Re-submit the exact parameters; the server re-computes the
                    preview itself and refuses if the day count moved. */}
                <input type="hidden" name="userId" value={input.userId} />
                <input type="hidden" name="fromKey" value={input.fromKey} />
                <input type="hidden" name="toKey" value={input.toKey} />
                <input type="hidden" name="startTime" value={input.startTime} />
                <input type="hidden" name="endTime" value={input.endTime} />
                {input.breakStartTime && input.breakEndTime && (
                  <>
                    <input type="hidden" name="withBreak" value="on" />
                    <input type="hidden" name="breakStartTime" value={input.breakStartTime} />
                    <input type="hidden" name="breakEndTime" value={input.breakEndTime} />
                  </>
                )}
                {input.onlyContractedDays && (
                  <input type="hidden" name="onlyContractedDays" value="on" />
                )}
                {input.skipHolidays && <input type="hidden" name="skipHolidays" value="on" />}
                {input.skipAbsences && <input type="hidden" name="skipAbsences" value="on" />}
                <input type="hidden" name="expectedDayCount" value={preview.days.length} />

                <Field
                  label="Grund des Nachtrags"
                  htmlFor="b-reason"
                  required
                  info={`Pflichtangabe. Wird an jedem erzeugten Eintrag und im Änderungsprotokoll dauerhaft gespeichert — die Nachtragung bleibt so revisionssicher nachvollziehbar (GoBD/ArbZG).`}
                >
                  <Textarea
                    id="b-reason"
                    name="reason"
                    required
                    placeholder="z. B. Stempeluhr defekt 06.–17.07., Zeiten laut handschriftlichem Nachweis"
                  />
                </Field>

                {applyState.error && (
                  <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                    {applyState.error}
                  </p>
                )}
                {applyState.ok && applyState.message && (
                  <p className="flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
                    <Check className="h-4 w-4" />
                    {applyState.message}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Button type="submit" disabled={applying}>
                      {preview.days.length} Tag(e) verbindlich nachtragen
                    </Button>
                    <InfoHint>{`Erzeugt je Tag einen manuellen Arbeitszeit-Eintrag (und ggf. einen Pausen-Eintrag). Vorhandene Zeiten werden nie überschrieben. Der gesamte Nachtrag erhält eine Sammel-Kennung und kann darüber wieder zurückgenommen werden.`}</InfoHint>
                  </span>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Toggle({
  name,
  label,
  info,
  defaultChecked,
}: {
  name: string;
  label: string;
  info: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-ink">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 rounded border-black/20 text-teal"
      />
      <span className="inline-flex items-center gap-1">
        {label}
        <InfoHint>{info}</InfoHint>
      </span>
    </label>
  );
}

export { Undo2 };
