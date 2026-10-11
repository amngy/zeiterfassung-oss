"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  adminRecordAbsenceAction,
  updateEntitlementAction,
  type AdminAbsenceState,
} from "./actions";

export interface EmployeeOption {
  id: string;
  name: string;
}

export interface EntitlementEmployee extends EmployeeOption {
  vacationDaysPerYear: number;
  statutoryVacationDays: number | null;
  additionalVacationDays: number | null;
  vacationCarryOverDays: number;
  isSchwerbehindert: boolean;
  schwerbehindertFrom: string; // "YYYY-MM-DD" or ""
  schwerbehindertTo: string;
}

function Banner({ state }: { state: AdminAbsenceState }) {
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
      <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{state.error}</p>
    );
  }
  return null;
}

export function AdminRecordForm({
  employees,
  todayKey,
}: {
  employees: EmployeeOption[];
  todayKey: string;
}) {
  const [state, action, pending] = useActionState<AdminAbsenceState, FormData>(
    adminRecordAbsenceAction,
    {},
  );
  const [type, setType] = React.useState<"VACATION" | "SICK">("VACATION");

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mitarbeiter:in" htmlFor="r-user" required>
          <Select id="r-user" name="userId" required defaultValue="">
            <option value="" disabled>
              Bitte wählen
            </option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Art"
          htmlFor="r-type"
          info={`Urlaub wird vom Jahresanspruch abgezogen und sofort als genehmigt gebucht. Krankheit wird nur erfasst und verringert den Urlaubsanspruch nie.`}
        >
          <Select
            id="r-type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as "VACATION" | "SICK")}
          >
            <option value="VACATION">Urlaub</option>
            <option value="SICK">Krankheit</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Von"
          htmlFor="r-start"
          required
          info={`Beginn des Zeitraums. Gezählt werden nur vertragliche Arbeitstage; Wochenenden und Feiertage werden automatisch ausgeschlossen.`}
        >
          <Input id="r-start" name="startDate" type="date" defaultValue={todayKey} required />
        </Field>
        <Field label="Bis" htmlFor="r-end" required>
          <Input id="r-end" name="endDate" type="date" defaultValue={todayKey} required />
        </Field>
      </div>

      {type === "VACATION" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" name="halfDayStart" className="h-4 w-4 rounded border-black/20 accent-lime" />
              <span className="text-ink">Erster Tag halbtags</span>
            </label>
            <InfoHint>{`Zählt den ersten Tag nur als halben Urlaubstag (0,5). Bei eintägigem Zeitraum ergeben sich insgesamt 0,5 Tage.`}</InfoHint>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" name="halfDayEnd" className="h-4 w-4 rounded border-black/20 accent-lime" />
              <span className="text-ink">Letzter Tag halbtags</span>
            </label>
            <InfoHint>{`Zählt den letzten Tag nur als halben Urlaubstag (0,5). Bei eintägigem Zeitraum ergeben sich insgesamt 0,5 Tage.`}</InfoHint>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" name="sickNoteOnFile" className="h-4 w-4 rounded border-black/20 accent-lime" />
            <span className="text-ink">AU-Bescheinigung liegt vor</span>
          </label>
          <InfoHint>{`Bestätigt eine vorliegende Arbeitsunfähigkeitsbescheinigung. Nur damit können Krankheitstage, die in einen genehmigten Urlaub fallen, dem Urlaubskonto gutgeschrieben werden (§9 BUrlG).`}</InfoHint>
        </div>
      )}

      <Field label="Anmerkung" htmlFor="r-note" hint="optional">
        <Textarea id="r-note" name="note" />
      </Field>
      <Banner state={state} />
      <p className="text-xs text-muted">
        Ein Verwaltungseintrag gilt als Entscheidung und wird direkt verbucht (und protokolliert).
      </p>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Eintragen
        </Button>
      </div>
    </form>
  );
}

export function EntitlementEditor({ employees }: { employees: EntitlementEmployee[] }) {
  const [state, action, pending] = useActionState<AdminAbsenceState, FormData>(
    updateEntitlementAction,
    {},
  );
  const [selectedId, setSelectedId] = React.useState(employees[0]?.id ?? "");
  const selected = employees.find((e) => e.id === selectedId) ?? employees[0];

  if (!selected) return <p className="text-sm text-muted">Keine Mitarbeitenden vorhanden.</p>;

  return (
    <div className="space-y-4">
      <Field label="Mitarbeiter:in" htmlFor="e-user">
        <Select id="e-user" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
      </Field>

      {/* key forces the controlled defaults to reset when the employee changes. */}
      <form key={selected.id} action={action} className="space-y-4">
        <input type="hidden" name="userId" value={selected.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="davon gesetzlich (Tage)"
            htmlFor="e-stat"
            info={`Gesetzlicher Mindesturlaub nach BUrlG §3, bezogen auf die Arbeitswoche der Person (20 Tage bei 5-Tage-Woche, 24 bei 6-Tage-Woche). Dieser Teil wird bei unterjährigem Eintritt NICHT anteilig gekürzt, sobald die sechsmonatige Wartezeit im selben Kalenderjahr erfüllt wird (§5 BUrlG) — eine Kürzung darunter wäre nach §13 unwirksam. Leer lassen, wenn nur ein Gesamtwert im Vertrag steht.`}
          >
            <Input
              id="e-stat"
              name="statutoryVacationDays"
              type="number"
              step="0.5"
              min={0}
              max={365}
              defaultValue={selected.statutoryVacationDays ?? ""}
              placeholder="z. B. 20"
            />
          </Field>
          <Field
            label="davon zusätzlich (Tage)"
            htmlFor="e-add"
            info={`Vertraglich zugesagte Tage ÜBER dem gesetzlichen Minimum. Nur dieser Teil darf bei unterjährigem Eintritt/Austritt anteilig gekürzt und (z. B. zum 31.03.) verfallen — sofern der Vertrag das vorsieht.`}
          >
            <Input
              id="e-add"
              name="additionalVacationDays"
              type="number"
              step="0.5"
              min={0}
              max={365}
              defaultValue={selected.additionalVacationDays ?? ""}
              placeholder="z. B. 8"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Jahresanspruch gesamt (Tage)"
            htmlFor="e-days"
            required
            info={`Gesamter vertraglicher Volljahresanspruch. Sind die beiden Felder oben gefüllt, wird dieser Wert automatisch als deren Summe geführt. Er bleibt maßgeblich, solange die Aufteilung nicht hinterlegt ist.`}
          >
            <Input
              id="e-days"
              name="vacationDaysPerYear"
              type="number"
              step="0.5"
              min={0}
              max={365}
              defaultValue={selected.vacationDaysPerYear}
              required
            />
          </Field>
          <Field
            label="Übertrag aus Vorjahr (Tage)"
            htmlFor="e-carry"
            required
            info={`Aus dem Vorjahr übertragene Resttage; werden unverändert zum diesjährigen Gesamtanspruch addiert. Ein Verfall wird nicht automatisch berechnet – die Resttage bleiben bestehen, bis sie hier manuell angepasst werden.`}
          >
            <Input
              id="e-carry"
              name="vacationCarryOverDays"
              type="number"
              step="0.5"
              min={0}
              max={365}
              defaultValue={selected.vacationCarryOverDays}
              required
            />
          </Field>
        </div>

        <div className="flex items-center gap-1.5">
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              name="isSchwerbehindert"
              defaultChecked={selected.isSchwerbehindert}
              className="h-4 w-4 rounded border-black/20 accent-lime"
            />
            <span className="text-ink">Schwerbehinderung (GdB ≥ 50) — Zusatzurlaub §208 SGB IX</span>
          </label>
          <InfoHint>{`Gewährt den Zusatzurlaub nach §208 SGB IX: +5 Tage bei 5-Tage-Woche, auf die Arbeitswoche skaliert und nach vollen Monaten mit gültigem Status anteilig berechnet (aufgerundet auf volle Tage).`}</InfoHint>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Status gültig ab"
            htmlFor="e-sb-from"
            hint="optional"
            info={`Ab wann die Schwerbehinderung gilt. Der Zusatzurlaub wird nur für die vollen Monate ab diesem Datum gewährt. Leer = ab Beschäftigungsbeginn.`}
          >
            <Input id="e-sb-from" name="schwerbehindertFrom" type="date" defaultValue={selected.schwerbehindertFrom} />
          </Field>
          <Field
            label="Status gültig bis"
            htmlFor="e-sb-to"
            hint="optional"
            info={`Bis wann die Schwerbehinderung gilt. Der Zusatzurlaub wird nur für volle Monate bis zu diesem Datum berechnet. Leer = unbefristet gültig.`}
          >
            <Input id="e-sb-to" name="schwerbehindertTo" type="date" defaultValue={selected.schwerbehindertTo} />
          </Field>
        </div>

        <Banner state={state} />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            Speichern
          </Button>
        </div>
      </form>
    </div>
  );
}
