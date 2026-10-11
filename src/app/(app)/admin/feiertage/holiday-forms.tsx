"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, Sparkles, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input, Select } from "@/components/ui/input";
import {
  addGiftedHolidayAction,
  seedHolidaysAction,
  type HolidayFormState,
} from "./actions";

function Banner({ state }: { state: HolidayFormState }) {
  if (state.ok) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
        <Check className="h-4 w-4" />
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

export function SeedHolidaysForm({
  defaultBundesland,
  defaultYear,
}: {
  defaultBundesland: string;
  defaultYear: number;
}) {
  const [state, action, pending] = useActionState<HolidayFormState, FormData>(seedHolidaysAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Bundesland"
          htmlFor="bundesland"
          hint="ISO-Kürzel, z. B. NW"
          info={`Für welches Bundesland die Feiertage erzeugt werden (2-stelliges Kürzel, z. B. NW, BY). Sie gelten nur für Mitarbeiter, deren Bundesland – oder der Firmen-Standard, falls keins gesetzt ist – diesem Kürzel entspricht.`}
        >
          <Input id="bundesland" name="bundesland" defaultValue={defaultBundesland} maxLength={2} required />
        </Field>
        <Field
          label="Jahr"
          htmlFor="year"
          required
          info={`Feiertage werden pro Jahr berechnet – bewegliche Feste wie Ostern fallen jedes Jahr auf ein anderes Datum. Für jedes benötigte Jahr einzeln anlegen.`}
        >
          <Input id="year" name="year" type="number" min={2000} max={2100} defaultValue={defaultYear} required />
        </Field>
      </div>
      <Banner state={state} />
      <div className="flex items-center justify-end gap-1.5">
        <Button type="submit" variant="secondary" disabled={pending}>
          <Sparkles className="h-4 w-4" />
          Gesetzliche Feiertage anlegen
        </Button>
        <InfoHint>{`Legt die gesetzlichen Feiertage dieses Bundeslands/Jahres an. Mehrfaches Ausführen ist gefahrlos: bereits vorhandene Tage werden übersprungen, manuell ergänzte Feiertage bleiben unverändert.`}</InfoHint>
      </div>
    </form>
  );
}

export function AddGiftedForm({ defaultYear }: { defaultYear: number }) {
  const [state, action, pending] = useActionState<HolidayFormState, FormData>(addGiftedHolidayAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Datum" htmlFor="g-date" required>
          <Input id="g-date" name="date" type="date" defaultValue={`${defaultYear}-12-24`} required />
        </Field>
        <Field
          label="Umfang"
          htmlFor="g-fraction"
          info={`Ganzer Tag: Soll-Arbeitszeit wird auf 0 gesetzt, Halber Tag halbiert sie. Liegt der Tag in einem Urlaub, verbraucht er keinen bzw. nur einen halben Urlaubstag – nur an vertraglichen Arbeitstagen.`}
        >
          <Select id="g-fraction" name="fraction" defaultValue="FULL">
            <option value="FULL">Ganzer Tag</option>
            <option value="HALF">Halber Tag</option>
          </Select>
        </Field>
      </div>
      <Field label="Bezeichnung" htmlFor="g-name" required>
        <Input id="g-name" name="name" placeholder="z. B. Heiligabend, Rosenmontag" required />
      </Field>
      <div className="flex items-center gap-1.5">
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" name="recurringAnnually" className="h-4 w-4 rounded border-black/20 accent-lime" />
          <span className="text-ink">Jährlich wiederkehrend (gleicher Tag/Monat in jedem Jahr)</span>
        </label>
        <InfoHint>{`Der Tag wiederholt sich in jedem Jahr am gleichen Tag und Monat (z. B. Heiligabend). Ein am 29.02. angelegter Tag entfällt in Jahren ohne Schalttag.`}</InfoHint>
      </div>
      <Banner state={state} />
      <div className="flex items-center justify-end gap-1.5">
        <Button type="submit" disabled={pending}>
          <CalendarPlus className="h-4 w-4" />
          Sonderfrei hinzufügen
        </Button>
        <InfoHint>{`Fügt einen firmenweiten Sonderfrei-Tag hinzu – er gilt für alle Mitarbeiter unabhängig vom Bundesland und reduziert Soll-Zeit und Urlaubsverbrauch wie ein Feiertag.`}</InfoHint>
      </div>
    </form>
  );
}
