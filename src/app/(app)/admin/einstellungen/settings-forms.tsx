"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input, Select } from "@/components/ui/input";
import type { AppSettings, RuleProfile } from "@/lib/settings";
import {
  saveGeneralAction,
  saveRuleProfileAction,
  saveMinorRuleProfileAction,
  saveBreakPolicyAction,
  saveCorrectionPolicyAction,
  savePunchPolicyAction,
  saveOvertimeLimitsAction,
  type SettingsState,
} from "./actions";

function Banner({ state }: { state: SettingsState }) {
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

function Check2({
  name,
  label,
  defaultChecked,
  info,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  info?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="flex items-center gap-2.5 text-sm">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4 rounded border-black/20 accent-lime" />
        <span className="text-ink">{label}</span>
      </label>
      {info && <InfoHint>{info}</InfoHint>}
    </div>
  );
}

const BUNDESLAENDER = [
  "BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV", "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH",
];

export function GeneralForm({ s }: { s: AppSettings }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveGeneralAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Firmen-/App-Name" htmlFor="g-name" required>
          <Input id="g-name" name="companyName" defaultValue={s.companyName} required />
        </Field>
        <Field
          label="Standard-Bundesland (Feiertage)"
          htmlFor="g-region"
          required
          info={`Bundesland für gesetzliche Feiertage. Dient als Rückfallwert, wenn bei einer Person kein eigenes Bundesland hinterlegt ist. Feiertage beeinflussen Sollstunden und Urlaubsberechnung.`}
        >
          <Select id="g-region" name="defaultBundesland" defaultValue={s.defaultBundesland}>
            {BUNDESLAENDER.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Standard-Jahresurlaub (Tage)"
          htmlFor="g-vac"
          required
          info={`Vollzeit-Jahresanspruch bei 5-Tage-Woche. Gesetzliches Minimum 20 Tage (BUrlG §3). Wird beim Anlegen einer Person vorgeschlagen; der Anspruch selbst wird je Person im Profil gepflegt (bei Teilzeit dort umrechnen).`}
        >
          <Input id="g-vac" name="defaultVacationDays" type="number" step="0.5" min={0} max={365} defaultValue={s.defaultVacationDays} />
        </Field>
        <Field
          label="Verfall Resturlaub — Monat"
          htmlFor="g-com"
          required
          hint="z. B. 3 = März"
          info={`Gedachter Stichtag-Monat für den Verfall von Resturlaub (üblich 3 = März). Die App lässt Resturlaub derzeit nicht automatisch verfallen; ein Verfall setzt zudem eine rechtzeitige Aufforderung voraus (EuGH/BAG).`}
        >
          <Input id="g-com" name="carryOverCutoffMonth" type="number" min={1} max={12} defaultValue={s.carryOverCutoffMonth} />
        </Field>
        <Field
          label="Verfall Resturlaub — Tag"
          htmlFor="g-cod"
          required
          info={`Gedachter Stichtag-Tag im gewählten Monat (üblich 31). Die App lässt Resturlaub derzeit nicht automatisch verfallen; ein Verfall setzt eine rechtzeitige Aufforderung an die Beschäftigten voraus (EuGH/BAG).`}
        >
          <Input id="g-cod" name="carryOverCutoffDay" type="number" min={1} max={31} defaultValue={s.carryOverCutoffDay} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Aufbewahrungsfrist (Jahre)"
          htmlFor="g-ret"
          required
          hint="ArbZG/MiLoG ≥ 2, Sozialvers. ≈ 4"
          info={`Wie lange Zeiten, Abwesenheiten, Anträge und Protokoll aufbewahrt werden, gerechnet ab Ende des Kalenderjahres. Gelöscht wird nicht automatisch, sondern unter Verwaltung → Aufbewahrung nach Bestätigung. Richtwerte: ArbZG/MiLoG ≥ 2 Jahre, Sozialversicherung ≈ 4, Lohnunterlagen bis ~10 – mit Berater:in abstimmen.`}
        >
          <Input id="g-ret" name="retentionYears" type="number" min={2} max={30} defaultValue={s.retentionYears} />
        </Field>
        <Field
          label="AU-Pflicht ab Tag"
          htmlFor="g-au"
          required
          hint="EFZG §5: Standard 4"
          info={`Ab welchem Krankheitstag (Kalendertage) eine AU/eAU verlangt wird. EFZG §5: gesetzlich spätestens ab Tag 4, früher zulässig. Krankmeldungen, die diesen Tag erreichen und für die noch keine AU vermerkt ist, erscheinen unter Abwesenheiten als „AU fällig“.`}
        >
          <Input id="g-au" name="auRequiredFromDay" type="number" min={1} max={14} defaultValue={s.auRequiredFromDay} />
        </Field>
      </div>
      <Banner state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

// Rendered twice on one page (standard and JArbSchG profile), so every id is
// prefixed per form — otherwise a label in the second form focuses the first.
function RuleProfileFields({ p, idPrefix }: { p: RuleProfile; idPrefix: string }) {
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Begrenzungsmodus"
          htmlFor={id("cap")}
          info={`Tagesmodus prüft die tägliche Höchstarbeitszeit (ArbZG aktuell). Wochenmodus prüft stattdessen die Wochenobergrenze je Kalenderwoche – vorbereitet für die erwartete ArbZG-Reform 2026.`}
        >
          <Select id={id("cap")} name="capMode" defaultValue={p.capMode}>
            <option value="DAILY">Täglich (ArbZG aktuell)</option>
            <option value="WEEKLY">Wöchentlich (Reform 2026)</option>
          </Select>
        </Field>
        <Field
          label="Max. Stunden / Woche"
          htmlFor={id("mw")}
          hint="für Wochenmodus"
          info={`Wöchentliche Höchstarbeitszeit – wirkt nur im Wochenmodus. Orientierung ArbZG: rund 48 Std./Woche im 6-Monats-Durchschnitt.`}
        >
          <Input id={id("mw")} name="maxHoursPerWeek" type="number" step="0.5" min={1} max={80} defaultValue={p.maxHoursPerWeek} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Max. Stunden / Tag"
          htmlFor={id("md")}
          info={`Tägliche Höchstarbeitszeit – wirkt im Tagesmodus. ArbZG §3: grundsätzlich 8 Std., ausnahmsweise bis 10 Std. bei Ausgleich im Durchschnitt.`}
        >
          <Input id={id("md")} name="maxHoursPerDay" type="number" step="0.5" min={1} max={24} defaultValue={p.maxHoursPerDay} />
        </Field>
        <Field
          label="Standardstunden / Tag"
          htmlFor={id("sd")}
          hint="Mittelungsziel"
          info={`Als Mittelungs-/Sollwert gedacht, fließt aber nicht in die Berechnungen ein (nur Plausibilitätsprüfung: darf das Tagesmaximum nicht überschreiten). Der Soll je Person ergibt sich aus dem Arbeitszeitplan.`}
        >
          <Input id={id("sd")} name="standardHoursPerDay" type="number" step="0.5" min={1} max={24} defaultValue={p.standardHoursPerDay} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field
          label="Pause 1 ab (Std)"
          htmlFor={id("b1a")}
          info={`Arbeitsdauer, ab der die erste Pausenpflicht greift. ArbZG §4: bei mehr als 6 Std. mind. 30 Min. Pause.`}
        >
          <Input id={id("b1a")} name="break1AfterHours" type="number" step="0.5" min={0} max={24} defaultValue={p.break1AfterHours} />
        </Field>
        <Field
          label="… Minuten"
          htmlFor={id("b1m")}
          info={`Mindestpause in Minuten oberhalb der ersten Schwelle. ArbZG §4 fordert hier mind. 30 Min.`}
        >
          <Input id={id("b1m")} name="break1Minutes" type="number" min={0} max={240} defaultValue={p.break1Minutes} />
        </Field>
        <Field
          label="Pause 2 ab (Std)"
          htmlFor={id("b2a")}
          info={`Arbeitsdauer, ab der die höhere Pausenstufe gilt. ArbZG §4: bei mehr als 9 Std. mind. 45 Min. Pause. Muss über der ersten Schwelle liegen.`}
        >
          <Input id={id("b2a")} name="break2AfterHours" type="number" step="0.5" min={0} max={24} defaultValue={p.break2AfterHours} />
        </Field>
        <Field
          label="… Minuten"
          htmlFor={id("b2m")}
          info={`Mindestpause in Minuten oberhalb der zweiten Schwelle. ArbZG §4 fordert hier mind. 45 Min.`}
        >
          <Input id={id("b2m")} name="break2Minutes" type="number" min={0} max={240} defaultValue={p.break2Minutes} />
        </Field>
      </div>
      <Field
        label="Mindestruhezeit (Std)"
        htmlFor={id("rest")}
        className="max-w-xs"
        info={`Mindestruhe zwischen Arbeitsende und dem Beginn des nächsten Arbeitstags. ArbZG §5: grundsätzlich mind. 11 Std. ununterbrochen.`}
      >
        <Input id={id("rest")} name="minRestHours" type="number" step="0.5" min={0} max={24} defaultValue={p.minRestHours} />
      </Field>
      <Check2
        name="blockOnViolation"
        label={`Verstöße als „Verstoß“ statt als „Hinweis“ kennzeichnen`}
        defaultChecked={p.blockOnViolation}
        info={`Steuert ausschließlich die Einstufung in der Anzeige und in den Exporten: aus = „Hinweis“ (WARN), ein = „Verstoß“ (BLOCK). Es wird dadurch NICHTS blockiert. Das ist Absicht: nach §16(2) ArbZG ist die tatsächlich geleistete Arbeitszeit aufzuzeichnen — eine Erfassung zu verweigern würde zu einer Unter­erfassung führen und wäre selbst ein Verstoß.`}
      />
    </>
  );
}

export function RuleProfileForm({ p, minor }: { p: RuleProfile; minor?: boolean }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    minor ? saveMinorRuleProfileAction : saveRuleProfileAction,
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <RuleProfileFields p={p} idPrefix={minor ? "rp-minor" : "rp"} />
      <Banner state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

export function BreakPolicyForm({ s }: { s: AppSettings }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveBreakPolicyAction, {});
  const b = s.breakPolicy;
  return (
    <form action={action} className="space-y-4">
      <Check2
        name="enabled"
        label="Pausenautomatik aktivieren"
        defaultChecked={b.enabled}
        info={`Ist die Option aktiv, setzt das System eine Pause an, wenn im Datensatz keine brauchbare steht — entweder weil eine Pause begonnen und nie beendet wurde, oder weil an einem Tag mit Pausenpflicht gar keine erfasst wurde. Die erfassten Stempelzeiten werden dabei NICHT verändert: der Abzug entsteht erst bei der Berechnung, wird getrennt ausgewiesen und erzeugt einen Hinweis mit der Bitte um Korrektur. Ist die Option aus, wird ausschließlich erfasste Pausenzeit abgezogen — eine nie beendete Pause bleibt dann ganz unberücksichtigt und die Arbeitszeit fällt zu hoch aus.`}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Feste Pause (Minuten)"
          htmlFor="bp-fix"
          hint="0 = gesetzliches Minimum"
          info={`Pausenlänge, die bei fehlender Erfassung angesetzt wird. Sie wird nie UNTER das gesetzliche Minimum angewendet: liegt die Arbeitszeit über der zweiten Schwelle des Regelprofils (ArbZG §4: mehr als 9 Std.), werden mindestens 45 Min. abgezogen, auch wenn hier 30 steht. 0 bedeutet „genau das gesetzliche Minimum“. Ein höherer Wert bildet eine längere betriebsübliche Mittagspause ab. Unterhalb der ersten Pausenschwelle (§4: bis 6 Std.) wird nie etwas abgezogen.`}
        >
          <Input id="bp-fix" name="fixedMinutes" type="number" min={0} max={240} defaultValue={b.fixedMinutes} />
        </Field>
        <Field
          label="Nie beendete Pause (Minuten)"
          htmlFor="bp-unf"
          hint="0 = nicht ansetzen"
          info={`Länge, mit der eine begonnene, aber nie beendete Pause gewertet wird. Solange die zugehörige Arbeitssitzung noch läuft, bleibt die Pause unangetastet und läuft weiter — die Person kann ja noch zurückkommen. Erst wenn die Sitzung beendet ist oder als vergessenes Ausstempeln gilt, wird die Pause mit diesem Wert angesetzt. 0 = wie bisher gar nicht werten.`}
        >
          <Input id="bp-unf" name="unfinishedBreakMinutes" type="number" min={0} max={240} defaultValue={b.unfinishedBreakMinutes} />
        </Field>
      </div>
      <p className="text-xs text-muted">
        Hinweis: §16(2) ArbZG verlangt die Aufzeichnung der tatsächlichen Zeiten. Die
        Pausenautomatik verhindert, dass nicht gearbeitete Zeit als Arbeitszeit vergütet wird —
        sie ersetzt aber keine Korrektur. Jeder automatische Abzug erscheint deshalb als
        Arbeitszeit-Hinweis beim betroffenen Tag.
      </p>
      <Banner state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

export function CorrectionPolicyForm({ s }: { s: AppSettings }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveCorrectionPolicyAction, {});
  const c = s.correctionPolicy;
  return (
    <form action={action} className="space-y-4">
      <Check2
        name="allowSelfCreate"
        label="Mitarbeitende dürfen eigene Einträge anlegen/korrigieren"
        defaultChecked={c.allowSelfCreate}
        info={`Legt fest, ob Beschäftigte selbst Zeiteinträge anlegen bzw. zur Korrektur einreichen dürfen. Ist die Option aus, sind Eigenkorrekturen gesperrt und nur die Verwaltung kann Einträge anlegen.`}
      />
      <Check2
        name="selfCorrectionRequiresApproval"
        label="Eigenkorrekturen benötigen Freigabe (empfohlen)"
        defaultChecked={c.selfCorrectionRequiresApproval}
        info={`Ist die Option aktiv, werden Korrekturen an den eigenen Zeiten erst nach Freigabe durch die Verwaltung wirksam. Abgewählt wirken sie sofort — weiterhin versioniert, mit Pflicht-Begründung und vollständig protokolliert, aber ohne Vier-Augen-Prinzip. Korrekturen an den Zeiten ANDERER Personen durchlaufen immer die Freigabe, unabhängig von dieser Option.`}
      />
      <Check2
        name="autoLockOnMonthExport"
        label="Monat nach Export/Freigabe sperren"
        defaultChecked={c.autoLockOnMonthExport}
        info={`Soll einen Monat nach Export/Freigabe gegen weitere Änderungen sperren. Hinweis: Diese Sperre ist derzeit nicht umgesetzt und ohne Wirkung.`}
      />
      <Field
        label="Sperrfrist nach Eintrag (Tage)"
        htmlFor="cp-lock"
        hint="0 = aus"
        className="max-w-xs"
        info={`Soll Einträge N Tage nach ihrem Datum gegen Korrekturen sperren (0 = aus). Hinweis: Diese Sperre ist derzeit nicht umgesetzt und ohne Wirkung.`}
      >
        <Input id="cp-lock" name="lockAfterDays" type="number" min={0} max={3650} defaultValue={c.lockAfterDays} />
      </Field>
      <Banner state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

export function PunchPolicyForm({ s }: { s: AppSettings }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(savePunchPolicyAction, {});
  return (
    <form action={action} className="space-y-4">
      <Check2
        name="recordDeviceType"
        label="Gerätetyp beim Stempeln erfassen"
        defaultChecked={s.punchPolicy.recordDeviceType}
        info={`Speichert zu jeder Stempelung den grob erkannten Gerätetyp, z. B. „iPhone · Safari“ oder „Windows · Edge“ — ohne Version, ohne Gerätekennung, ohne Standort. So wird sichtbar, ob z. B. ein spätes Ausstempeln vom Handy statt vom Büro-PC kam. Der Wert stammt aus der Browserkennung und ist ein Hinweis, kein Beweis. Weil die Angabe geeignet ist, Verhalten zu überwachen, besteht ein Mitbestimmungsrecht des Betriebsrats (§87 Abs. 1 Nr. 6 BetrVG); die Beschäftigten sind vorab zu informieren (Art. 13 DSGVO). Ausgeschaltet wird nur der Erfassungsweg (z. B. „Browser“) gespeichert. Gilt ab dem Speichern für neue Stempelungen.`}
      />
      <Field
        label="Prüfhinweis bei Mehrarbeit über den Webzugang (Minuten)"
        htmlFor="pp-review"
        hint="0 = aus"
        info={`Endet ein Arbeitstag mit einem Ausstempeln über den Webzugang (also von überall möglich, nicht am Terminal) und liegt der Tag mehr als diese Minuten über dem Soll, erscheint er unter Verwaltung → Korrekturen zur Prüfung. Es wird nichts gesperrt oder geändert; die Verwaltung markiert den Tag als „geprüft“ (protokolliert), die Person sieht in ihren Zeiten „in Prüfung“ bzw. „geprüft“. Ausgewertet werden nur ohnehin gespeicherte Zeiten. Als Verhaltenskontrolle mitbestimmungspflichtig (§87 Abs. 1 Nr. 6 BetrVG); die Beschäftigten sind zu informieren (Art. 13 DSGVO).`}
      >
        <Input id="pp-review" name="reviewRemoteOvertimeMinutes" type="number" min={0} max={600} step={1} defaultValue={s.punchPolicy.reviewRemoteOvertimeMinutes} className="max-w-xs" />
      </Field>
      <Field
        label="Gerätetyp löschen nach (Monaten)"
        htmlFor="pp-device-months"
        hint="1–24, Voreinstellung 3"
        info={`Für den Gerätetyp einer Stempelung gibt es keine Aufbewahrungspflicht; er dient nur der Prüfung einzelner Stempelungen. Ältere Angaben werden unter Verwaltung → Aufbewahrung gelöscht (nach Bestätigung, nicht automatisch). Zeitpunkt und Erfassungsweg der Stempelung bleiben.`}
      >
        <Input id="pp-device-months" name="deviceLabelMonths" type="number" min={1} max={24} step={1} defaultValue={s.punchPolicy.deviceLabelMonths} className="max-w-xs" />
      </Field>
      <Banner state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

export function OvertimeLimitsForm({ s }: { s: AppSettings }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveOvertimeLimitsAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Obergrenze (Plusstunden)"
          htmlFor="ot-cap"
          hint="0 = keine"
          info={`Liegt ein Arbeitszeitkonto darüber, wird das bei der Person und in der Auswertung markiert. Es wird nichts automatisch gekappt: Ob Stunden über der Grenze ausgezahlt werden oder verfallen, regeln Arbeitsvertrag, Tarifvertrag oder Betriebsvereinbarung — die Verwaltung bucht das bei der Person als „Auszahlung“ oder „Verfall / Kappung“.`}
        >
          <Input id="ot-cap" name="capHours" type="number" min={0} max={2000} step={1} defaultValue={s.overtimeLimits.capHours} />
        </Field>
        <Field
          label="Untergrenze (Minusstunden)"
          htmlFor="ot-floor"
          hint="0 = keine"
          info={`Als positive Zahl eingeben: 20 bedeutet höchstens 20 Minusstunden. Ein Konto darunter wird markiert, sonst passiert nichts.`}
        >
          <Input id="ot-floor" name="floorHours" type="number" min={0} max={2000} step={1} defaultValue={s.overtimeLimits.floorHours} />
        </Field>
      </div>
      <Banner state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}
