"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { OVERTIME_KIND_LABEL, MANUAL_OVERTIME_KINDS } from "@/lib/time/overtime";
import { bookOvertimeAction, reverseOvertimeAction, startOvertimeAction, type FormState } from "./actions";

// Arbeitszeitkonto (#22): start an account, book on it, reverse a booking.

function Result({ state }: { state: FormState }) {
  if (state.ok) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark" role="status">
        <Check className="h-4 w-4" /> {state.message}
      </p>
    );
  }
  if (state.error) {
    return <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{state.error}</p>;
  }
  return null;
}

export function StartOvertimeForm({ userId, defaultMonth }: { userId: string; defaultMonth: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(startOvertimeAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Konto ab Monat"
          htmlFor="ot-from"
          info={`Ab dem 1. dieses Monats wird der tägliche Saldo aufsummiert. Liegen davor keine oder unvollständige Zeiten in der App, einen späteren Monat wählen und den bisherigen Stand als Anfangssaldo eintragen. Der Beginn lässt sich danach nicht mehr ändern.`}
        >
          <Input id="ot-from" name="fromMonth" type="month" defaultValue={defaultMonth} max={defaultMonth} required />
        </Field>
        <Field label="Anfangssaldo (Stunden)" htmlFor="ot-opening" hint="z. B. 12:30 oder -4,5; leer = 0">
          <Input id="ot-opening" name="opening" placeholder="0:00" />
        </Field>
        <Field label="Begründung" htmlFor="ot-start-note" hint="nötig bei Anfangssaldo">
          <Input id="ot-start-note" name="note" maxLength={500} placeholder="z. B. Übertrag aus Stundenzettel" />
        </Field>
      </div>
      <Result state={state} />
      <Button type="submit" disabled={pending}>
        Arbeitszeitkonto einrichten
      </Button>
    </form>
  );
}

export function BookOvertimeForm({ userId, todayKey, fromKey }: { userId: string; todayKey: string; fromKey: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(bookOvertimeAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Art" htmlFor="ot-kind">
          <Select id="ot-kind" name="kind" defaultValue="PAYOUT">
            {MANUAL_OVERTIME_KINDS.map((k) => (
              <option key={k} value={k}>
                {OVERTIME_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Datum" htmlFor="ot-day">
          <Input id="ot-day" name="day" type="date" defaultValue={todayKey} min={fromKey} max={todayKey} required />
        </Field>
        <Field
          label="Stunden"
          htmlFor="ot-hours"
          hint="z. B. 8:00 oder 7,5"
          info={`Auszahlung und Verfall werden immer abgezogen, egal mit welchem Vorzeichen eingegeben. Eine Korrektur behält ihr Vorzeichen: -2:00 zieht ab, 2:00 schreibt gut.`}
        >
          <Input id="ot-hours" name="hours" required />
        </Field>
        <Field label="Begründung" htmlFor="ot-note">
          <Input id="ot-note" name="note" maxLength={500} required placeholder="z. B. Auszahlung mit Abrechnung 10/2026" />
        </Field>
      </div>
      <Result state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        Buchen
      </Button>
    </form>
  );
}

export function ReverseBookingForm({ userId, bookingId }: { userId: string; bookingId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reverseOvertimeAction, {});
  if (state.ok) return <Result state={state} />;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-danger">Stornieren</summary>
      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="bookingId" value={bookingId} />
        <label htmlFor={`storno-${bookingId}`} className="sr-only">
          Grund für das Storno
        </label>
        <Input id={`storno-${bookingId}`} name="note" maxLength={500} required placeholder="Grund" className="max-w-[14rem]" />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          Storno buchen
        </Button>
        <Result state={state} />
      </form>
    </details>
  );
}
