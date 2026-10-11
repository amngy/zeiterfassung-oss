import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import { getAppSettings } from "@/lib/settings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import {
  GeneralForm,
  RoundingForm,
  RuleProfileForm,
  BreakPolicyForm,
  CorrectionPolicyForm,
  PunchPolicyForm,
} from "./settings-forms";

export const metadata: Metadata = { title: "Einstellungen" };

export default async function AdminSettingsPage() {
  await requireAdmin();
  const s = await getAppSettings();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-ink">Einstellungen</h1>
        <p className="text-sm text-muted">
          Parameter und Governance — bewusst konfigurierbar gehalten, damit die erwartete
          ArbZG-Reform 2026 ohne Code-Änderung abgebildet werden kann.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Allgemein</CardTitle>
          <CardDescription>Firmenname, Standard-Bundesland, Urlaub, Verfallfrist und Aufbewahrung.</CardDescription>
        </CardHeader>
        <CardContent>
          <GeneralForm s={s} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Arbeitszeit-Regelprofil (ArbZG)</CardTitle>
          <CardDescription>
            Schwellen für Tagesmaximum, Pausen und Ruhezeit. Im Wochenmodus greift die wöchentliche
            Obergrenze statt der täglichen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RuleProfileForm p={s.ruleProfile} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-base">
            Regelprofil für Minderjährige (JArbSchG)
            <InfoHint>{`Strengeres Profil für unter 18-Jährige (JArbSchG). Es wird automatisch statt des Standardprofils angewendet, sobald ein hinterlegtes Geburtsdatum am Stichtag eine Minderjährigkeit ergibt.`}</InfoHint>
          </CardTitle>
          <CardDescription>
            Strengeres Profil für unter 18-Jährige — wird automatisch angewandt, wenn ein Geburtsdatum
            eine Minderjährigkeit ergibt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RuleProfileForm p={s.minorRuleProfile} minor />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-base">
            Pausenautomatik
            <InfoHint>{`Setzt eine Pause an, wenn keine brauchbare erfasst wurde: bei einer begonnenen, nie beendeten Pause und an Tagen ganz ohne Pausenbuchung. Die Stempelzeiten bleiben unverändert — der Abzug entsteht bei der Berechnung, wird getrennt ausgewiesen und als Hinweis am Tag angezeigt.`}</InfoHint>
          </CardTitle>
          <CardDescription>
            Was angesetzt wird, wenn eine Pause nie beendet oder gar nicht erst erfasst wurde.
            Ohne sie wird nicht gearbeitete Zeit als Arbeitszeit gewertet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BreakPolicyForm s={s} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Governance — Korrekturen &amp; Sperren</CardTitle>
          <CardDescription>
            Wer darf eigene Zeiten anlegen/korrigieren, müssen Korrekturen freigegeben werden, und wann
            wird ein Monat gesperrt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CorrectionPolicyForm s={s} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stempeln — Erfassungsweg</CardTitle>
          <CardDescription>
            Was zu jeder Stempelung über das verwendete Gerät gespeichert wird.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PunchPolicyForm s={s} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rundung</CardTitle>
          <CardDescription>Optionales Runden erfasster Zeiten auf ein Intervall.</CardDescription>
        </CardHeader>
        <CardContent>
          <RoundingForm s={s} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted">
        Alle Schwellen sind technische Voreinstellungen. Sie ersetzen keine Rechtsberatung und sind vom
        Betrieb (ggf. mit Steuerberater:in / Fachanwält:in) zu prüfen.
      </p>
    </div>
  );
}
