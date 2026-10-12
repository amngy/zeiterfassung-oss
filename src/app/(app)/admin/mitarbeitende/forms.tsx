"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input, Select } from "@/components/ui/input";
import type { WeekdayHours } from "@/lib/time";
import {
  createUserAction,
  updateUserAction,
  setScheduleAction,
  resetPasswordAction,
  type FormState,
} from "./actions";

function Banner({ state }: { state: FormState }) {
  if (state.ok) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-lime/15 px-3 py-2 text-sm font-medium text-lime-dark">
        <Check className="h-4 w-4" /> {state.message}
      </p>
    );
  }
  if (state.error) {
    return <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{state.error}</p>;
  }
  return null;
}

const DAYS: { key: keyof WeekdayHours; label: string }[] = [
  { key: "mon", label: "Mo" },
  { key: "tue", label: "Di" },
  { key: "wed", label: "Mi" },
  { key: "thu", label: "Do" },
  { key: "fri", label: "Fr" },
  { key: "sat", label: "Sa" },
  { key: "sun", label: "So" },
];

const WEEKDAY_HOURS_HINT = `Vertragliche Sollstunden je Wochentag (0,5-Schritte). Die Summe ergibt die Wochensollzeit und steuert Über-/Unterstunden sowie die Bewertung von Urlaubs- und Feiertagen. 0 = arbeitsfrei.`;

function WeekdayHoursHeading() {
  return (
    <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink">
      Arbeitszeiten je Wochentag (Std)
      <InfoHint>{WEEKDAY_HOURS_HINT}</InfoHint>
    </p>
  );
}

function WeekdayHoursFields({
  prefix = "sched_",
  defaults,
}: {
  prefix?: string;
  defaults?: WeekdayHours;
}) {
  const d = defaults ?? { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 };
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
      {DAYS.map((day) => (
        <Field key={day.key} label={day.label} htmlFor={`${prefix}${day.key}`}>
          <Input
            id={`${prefix}${day.key}`}
            name={`${prefix}${day.key}`}
            type="number"
            step="0.5"
            min={0}
            max={24}
            defaultValue={d[day.key]}
            className="px-2 text-center"
          />
        </Field>
      ))}
    </div>
  );
}

const BUNDESLAENDER = [
  ["", "Firmenstandard"],
  ["BW", "Baden-Württemberg"], ["BY", "Bayern"], ["BE", "Berlin"], ["BB", "Brandenburg"],
  ["HB", "Bremen"], ["HH", "Hamburg"], ["HE", "Hessen"], ["MV", "Mecklenburg-Vorpommern"],
  ["NI", "Niedersachsen"], ["NW", "Nordrhein-Westfalen"], ["RP", "Rheinland-Pfalz"],
  ["SL", "Saarland"], ["SN", "Sachsen"], ["ST", "Sachsen-Anhalt"], ["SH", "Schleswig-Holstein"],
  ["TH", "Thüringen"],
] as const;

function RegionSelect({ id, defaultValue }: { id: string; defaultValue?: string }) {
  return (
    <Select id={id} name="bundesland" defaultValue={defaultValue ?? ""}>
      {BUNDESLAENDER.map(([code, label]) => (
        <option key={code} value={code}>
          {label}
          {code ? ` (${code})` : ""}
        </option>
      ))}
    </Select>
  );
}

const AUTO_BREAK_EXEMPT_HINT = `Setzt die Pausenautomatik für diese Person aus: Es wird KEINE Pause automatisch abgezogen, wenn keine erfasst wurde. Gedacht für Verträge mit höchstens 6 Std. Tagessoll — dort würde ein gelegentliches Überschreiten der 6-Stunden-Grenze sonst 30 Minuten kosten, obwohl für die vertraglich geschuldete Zeit keine Pause vorgeschrieben ist. Eine Pause, die begonnen und nie beendet wurde, wird weiterhin angesetzt (sie hat ja stattgefunden). Der Arbeitszeit-Hinweis nach §4 ArbZG bleibt bestehen: Wer tatsächlich über 6 Std. arbeitet, braucht eine Pause — sie muss dann erfasst bzw. nachgetragen werden.`;

function StatusFlags({
  isMinijob,
  exempt,
  exemptAutoBreak,
}: {
  isMinijob?: boolean;
  exempt?: boolean;
  exemptAutoBreak?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="flex items-center gap-1.5">
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" name="isMinijob" defaultChecked={isMinijob} className="h-4 w-4 rounded border-black/20 accent-lime" />
          <span className="text-ink">Minijob (MiLoG §17 — 7-Tage-Frist)</span>
        </label>
        <InfoHint>{`Kennzeichnet das Konto als Minijob; der Vermerk erscheint auf den Monatsberichten (PDF/CSV). Für Minijob-Konten wird die Aufzeichnungsfrist nach MiLoG §17 überwacht (Beginn, Ende und Dauer bis zum Ablauf des siebten Folgetags): Einträge, deren Ende fehlt oder die erst nach Ablauf der Frist vollständig erfasst wurden, erscheinen unter „Korrekturen“, in „Alle Zeiten“ und im Monatsbericht.`}</InfoHint>
      </div>
      <div className="flex items-center gap-1.5">
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" name="exemptFromTimeRecording" defaultChecked={exempt} className="h-4 w-4 rounded border-black/20 accent-lime" />
          <span className="text-ink">Von Zeiterfassung befreit (leitend §5(3) BetrVG)</span>
        </label>
        <InfoHint>{`Nimmt die Person aus Zeit-Auswertung und ArbZG-Überwachung heraus (z. B. leitende Angestellte); ihre Zeiten erscheinen nicht in Statistik und Verstoß-Prüfung.`}</InfoHint>
      </div>
      <div className="flex items-center gap-1.5">
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            name="exemptFromAutoBreak"
            defaultChecked={exemptAutoBreak}
            className="h-4 w-4 rounded border-black/20 accent-lime"
          />
          <span className="text-ink">Kein automatischer Pausenabzug (Tagessoll ≤ 6 Std.)</span>
        </label>
        <InfoHint>{AUTO_BREAK_EXEMPT_HINT}</InfoHint>
      </div>
    </div>
  );
}

export function CreateUserForm({ defaultVacationDays }: { defaultVacationDays: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createUserAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="c-name" required>
          <Input id="c-name" name="name" required autoComplete="off" />
        </Field>
        <Field
          label="E-Mail"
          htmlFor="c-email"
          required
          info={`Dient zugleich als Login-Name – eine Änderung ändert die Anmeldung. Muss eindeutig sein und wird klein geschrieben gespeichert.`}
        >
          <Input id="c-email" name="email" type="email" required autoComplete="off" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Rolle"
          htmlFor="c-role"
          info={`Administrator:in hat vollen Zugriff auf Konten, Auswertungen und Einstellungen. Das letzte aktive Admin-Konto kann nicht herabgestuft oder deaktiviert werden.`}
        >
          <Select id="c-role" name="role" defaultValue="EMPLOYEE">
            <option value="EMPLOYEE">Mitarbeiter:in</option>
            <option value="ADMIN">Administrator:in</option>
          </Select>
        </Field>
        <Field
          label="Bundesland (Feiertage)"
          htmlFor="c-region"
          hint="optional"
          info={`Legt fest, welche gesetzlichen Feiertage gelten. Feiertage senken an Arbeitstagen die Sollstunden und kosten keinen Urlaub. „Firmenstandard“ nutzt das im Betrieb hinterlegte Bundesland.`}
        >
          <RegionSelect id="c-region" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Eintritt"
          htmlFor="c-start"
          hint="optional"
          info={`Beschäftigungsbeginn. Bei unterjährigem Eintritt wird der Jahresurlaub anteilig gezwölftelt (BUrlG §5). Beim Anlegen zugleich Startdatum der ersten Arbeitszeit-Regel.`}
        >
          <Input id="c-start" name="employmentStart" type="date" />
        </Field>
        <Field
          label="Geburtsdatum"
          htmlFor="c-birth"
          hint="für JArbSchG"
          info={`Bestimmt den Minderjährigen-Status: dann gelten strengere Arbeitszeit-Regeln (JArbSchG) und ein höherer Mindesturlaub (JArbSchG §19).`}
        >
          <Input id="c-birth" name="birthDate" type="date" />
        </Field>
        <Field
          label="Jahresurlaub (Tage)"
          htmlFor="c-vac"
          info={`Vertraglicher Jahresurlaub, bereits auf die Arbeitswoche umgerechnet (z. B. 4-Tage-Woche ≈ 22 Tage). Vorbelegt mit dem Standard-Jahresurlaub aus den Einstellungen. Der Mindesturlaub nach BUrlG §3 greift automatisch, falls höher. Halbe Tage möglich.`}
        >
          <Input id="c-vac" name="vacationDaysPerYear" type="number" step="0.5" min={0} max={365} defaultValue={defaultVacationDays} />
        </Field>
      </div>
      <StatusFlags />
      <div>
        <WeekdayHoursHeading />
        <WeekdayHoursFields />
      </div>
      <Field label="Initiales Passwort" htmlFor="c-pw" required hint="mind. 10 Zeichen, Buchstaben + Ziffern">
        <Input id="c-pw" name="password" type="text" required autoComplete="new-password" />
      </Field>
      <Banner state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Konto anlegen
        </Button>
      </div>
    </form>
  );
}

export interface ProfileDefaults {
  userId: string;
  name: string;
  email: string;
  role: "EMPLOYEE" | "ADMIN";
  bundesland: string;
  birthDate: string;
  employmentStart: string;
  employmentEnd: string;
  isMinijob: boolean;
  exemptFromTimeRecording: boolean;
  exemptFromAutoBreak: boolean;
}

export function ProfileForm({ user }: { user: ProfileDefaults }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateUserAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="userId" value={user.userId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="p-name" required>
          <Input id="p-name" name="name" defaultValue={user.name} required />
        </Field>
        <Field
          label="E-Mail"
          htmlFor="p-email"
          required
          info={`Dient zugleich als Login-Name; eine Änderung ändert die Anmeldeadresse. Wird automatisch klein geschrieben und muss eindeutig sein.`}
        >
          <Input id="p-email" name="email" type="email" defaultValue={user.email} required />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Rolle"
          htmlFor="p-role"
          info={`Administrator:in erhält vollen Verwaltungszugriff. Das letzte aktive Admin-Konto kann nicht auf Mitarbeiter:in herabgestuft werden.`}
        >
          <Select id="p-role" name="role" defaultValue={user.role}>
            <option value="EMPLOYEE">Mitarbeiter:in</option>
            <option value="ADMIN">Administrator:in</option>
          </Select>
        </Field>
        <Field
          label="Bundesland (Feiertage)"
          htmlFor="p-region"
          info={`Legt fest, welche gesetzlichen Feiertage für diese Person gelten (wirkt auf Soll-Zeiten und Urlaubstag-Zählung). Firmenstandard = Vorgabe aus den Einstellungen.`}
        >
          <RegionSelect id="p-region" defaultValue={user.bundesland} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Eintritt"
          htmlFor="p-start"
          hint="optional"
          info={`Beschäftigungsbeginn. Der Jahresurlaub wird für das Eintrittsjahr anteilig (Zwölftelung) berechnet; darf nicht nach dem Austritt liegen.`}
        >
          <Input id="p-start" name="employmentStart" type="date" defaultValue={user.employmentStart} />
        </Field>
        <Field
          label="Austritt"
          htmlFor="p-end"
          hint="optional"
          info={`Beschäftigungsende. Der Jahresurlaub wird für das Austrittsjahr anteilig (Zwölftelung) berechnet; darf nicht vor dem Eintritt liegen.`}
        >
          <Input id="p-end" name="employmentEnd" type="date" defaultValue={user.employmentEnd} />
        </Field>
        <Field
          label="Geburtsdatum"
          htmlFor="p-birth"
          hint="für JArbSchG"
          info={`Für unter 18-Jährige gelten strengere Arbeitszeitregeln (JArbSchG) und ein höherer Urlaubs-Mindestanspruch (§19 JArbSchG). Ohne Angabe werden diese Regeln nicht angewandt.`}
        >
          <Input id="p-birth" name="birthDate" type="date" defaultValue={user.birthDate} />
        </Field>
      </div>
      <StatusFlags
        isMinijob={user.isMinijob}
        exempt={user.exemptFromTimeRecording}
        exemptAutoBreak={user.exemptFromAutoBreak}
      />
      <Banner state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Profil speichern
        </Button>
      </div>
    </form>
  );
}

export function ScheduleForm({ userId, todayKey }: { userId: string; todayKey: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setScheduleAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <Field
        label="Gültig ab"
        htmlFor="s-from"
        required
        hint="frühere Zeiträume bleiben unverändert"
        info={`Ab diesem Tag gilt die neue Arbeitszeit; frühere Zeiträume behalten ihre bisherige Regel. Dasselbe Datum wie eine bestehende Regel überschreibt diese.`}
      >
        <Input id="s-from" name="effectiveFrom" type="date" defaultValue={todayKey} required className="max-w-xs" />
      </Field>
      <div>
        <WeekdayHoursHeading />
        <WeekdayHoursFields />
      </div>
      <Banner state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Arbeitszeit übernehmen
        </Button>
      </div>
    </form>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resetPasswordAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="userId" value={userId} />
      <Field
        label="Neues Passwort"
        htmlFor="r-pw"
        required
        hint="mind. 10 Zeichen, Buchstaben + Ziffern"
        info={`Setzt ein neues Passwort und hebt eine etwaige Konto-Sperre auf (fehlgeschlagene Anmeldungen werden zurückgesetzt). Mindestens 10 Zeichen, Buchstaben und Ziffern.`}
      >
        <Input id="r-pw" name="password" type="text" required autoComplete="new-password" className="max-w-sm" />
      </Field>
      <Banner state={state} />
      <div className="flex justify-end">
        <Button type="submit" variant="outline" disabled={pending}>
          Passwort zurücksetzen
        </Button>
      </div>
    </form>
  );
}
