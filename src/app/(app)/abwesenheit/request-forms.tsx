"use client";

import * as React from "react";
import { useActionState } from "react";
import { CalendarPlus, Thermometer, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  ABSENCE_EFFECT_TEXT,
  ABSENCE_LABEL,
  ABSENCE_TREATMENT,
  REQUESTABLE_KINDS,
} from "@/lib/time/absence-kinds";
import type { AbsenceKind } from "@/lib/time/types";
import {
  recordSickDay,
  submitVacationRequest,
  type AbsenceFormState,
} from "./actions";

function Checkbox({
  name,
  label,
  hint,
  info,
}: {
  name: string;
  label: string;
  hint?: string;
  info?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm">
      <label className="flex flex-1 items-start gap-2.5">
        <input
          type="checkbox"
          name={name}
          className="mt-0.5 h-4 w-4 rounded border-black/20 text-lime accent-lime"
        />
        <span>
          <span className="font-medium text-ink">{label}</span>
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
      </label>
      {info && <InfoHint>{info}</InfoHint>}
    </div>
  );
}

function Banner({ state }: { state: AbsenceFormState }) {
  if (state.ok) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
        <Check className="mt-0.5 h-4 w-4 shrink-0" />
        {state.message}
      </p>
    );
  }
  if (state.error) {
    return (
      <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
        {state.error}
      </p>
    );
  }
  return null;
}

export function VacationRequestForm({ todayKey }: { todayKey: string }) {
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState<AbsenceKind>("VACATION");
  const [state, action, pending] = useActionState<AbsenceFormState, FormData>(
    submitVacationRequest,
    {},
  );

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
            <CalendarPlus className="h-4 w-4" />
            Urlaub &amp; Abwesenheit beantragen
          </span>
          <span className="text-sm text-muted">{open ? "schließen" : "öffnen"}</span>
        </button>

        {state.ok && <div className="mt-3"><Banner state={state} /></div>}

        {open && (
          <form action={action} className="mt-4 space-y-4">
            <Field
              label="Art"
              htmlFor="v-type"
              hint={ABSENCE_EFFECT_TEXT[ABSENCE_TREATMENT[type]]}
              info={`Urlaub wird vom Urlaubskonto abgezogen. Sonderurlaub, Fortbildung und Dienstreise werden wie Arbeitszeit gutgeschrieben; Freizeitausgleich wird aus dem Überstundensaldo genommen; bei unbezahltem Urlaub, Elternzeit, Mutterschutz und „Kind krank“ entfällt die Sollzeit. Alle Arten werden von der Verwaltung genehmigt. Krankheit bitte rechts unter „Krankmeldung“ erfassen.`}
            >
              <Select
                id="v-type"
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value as AbsenceKind)}
              >
                {REQUESTABLE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ABSENCE_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Von"
                htmlFor="v-start"
                required
                info={`Erster Urlaubstag. Wochenenden und Feiertage im Zeitraum werden automatisch nicht als Urlaub gezählt.`}
              >
                <Input id="v-start" name="startDate" type="date" defaultValue={todayKey} required />
              </Field>
              <Field
                label="Bis"
                htmlFor="v-end"
                required
                info={`Letzter Urlaubstag (inklusive). Das Ende darf nicht vor dem Beginn liegen; der Zeitraum darf höchstens ein Jahr umfassen.`}
              >
                <Input id="v-end" name="endDate" type="date" defaultValue={todayKey} required />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Checkbox
                name="halfDayStart"
                label="Erster Tag halbtags"
                hint="z. B. nachmittags frei"
                info={`Zählt den ersten Tag nur als halben Urlaubstag (0,5) – z. B. wenn Sie erst mittags in den Urlaub starten.`}
              />
              <Checkbox
                name="halfDayEnd"
                label="Letzter Tag halbtags"
                info={`Zählt den letzten Tag nur als halben Urlaubstag (0,5). Bei einem eintägigen Zeitraum ergibt eine halbe Markierung insgesamt 0,5 Tage.`}
              />
            </div>
            <Field label="Anmerkung" htmlFor="v-note" hint="optional">
              <Textarea id="v-note" name="note" placeholder="z. B. Familienurlaub" />
            </Field>
            {!state.ok && <Banner state={state} />}
            <div className="flex items-center justify-end gap-1.5">
              <Button type="submit" disabled={pending}>
                Antrag einreichen
              </Button>
              <InfoHint>{`Reicht den Antrag ein. Er bleibt offen, bis die Verwaltung ihn genehmigt; erst dann wird Urlaub vom Guthaben abgezogen bzw. die Abwesenheit in den Zeiten berücksichtigt.`}</InfoHint>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function SickRecordForm({ todayKey }: { todayKey: string }) {
  const [open, setOpen] = React.useState(false);
  const [state, action, pending] = useActionState<AbsenceFormState, FormData>(
    recordSickDay,
    {},
  );

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
            <Thermometer className="h-4 w-4" />
            Krankheit melden
          </span>
          <span className="text-sm text-muted">{open ? "schließen" : "öffnen"}</span>
        </button>

        {state.ok && <div className="mt-3"><Banner state={state} /></div>}

        {open && (
          <form action={action} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Von" htmlFor="s-start" required>
                <Input id="s-start" name="startDate" type="date" defaultValue={todayKey} required />
              </Field>
              <Field
                label="Bis"
                htmlFor="s-end"
                required
                info={`Letzter Krankheitstag (inklusive). Das Ende darf nicht vor dem Beginn liegen; der Zeitraum darf höchstens ein Jahr umfassen.`}
              >
                <Input id="s-end" name="endDate" type="date" defaultValue={todayKey} required />
              </Field>
            </div>
            <Checkbox
              name="sickNoteOnFile"
              label="Arbeitsunfähigkeitsbescheinigung liegt vor"
              hint="AU/eAU — Pflicht i. d. R. ab dem 4. Krankheitstag"
              info={`Bestätigt, dass eine AU-/eAU-Bescheinigung vorliegt. Nur dann kann Krankheit während eines genehmigten Urlaubs später als Urlaub gutgeschrieben werden (§9 BUrlG).`}
            />
            <Field label="Anmerkung" htmlFor="s-note" hint="optional">
              <Textarea id="s-note" name="note" />
            </Field>
            {!state.ok && <Banner state={state} />}
            <p className="text-xs text-muted">
              Krankheitstage werden separat erfasst und mindern den Urlaubsanspruch nicht.
            </p>
            <div className="flex items-center justify-end gap-1.5">
              <Button type="submit" variant="secondary" disabled={pending}>
                Krankheit erfassen
              </Button>
              <InfoHint>{`Erfasst die Krankheit sofort als bestätigt – ohne Genehmigung und ohne Abzug vom Urlaub. Überschneidet sie einen genehmigten Urlaub, kann eine Gutschrift nach §9 BUrlG geprüft werden.`}</InfoHint>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
