# Datenschutzerklärung — Zeiterfassung

> **ENTWURF – rechtlich prüfen lassen.** Dieses Dokument ist eine technische
> Vorlage und ersetzt keine Rechtsberatung. Bitte vor Verwendung durch eine
> fachkundige Stelle (Datenschutzbeauftragte:r, Fachanwält:in) prüfen und an die
> tatsächlichen Verhältnisse des Betriebs anpassen. Platzhalter in `[eckigen
> Klammern]` ausfüllen.

## 1. Verantwortlicher

[Firmenname], [Anschrift], [E-Mail], [Telefon].
[Ggf. Datenschutzbeauftragte:r: Name, Kontakt.]

## 2. Zweck der Verarbeitung

Diese Anwendung dient der **Erfassung und Verwaltung der Arbeitszeiten** der
Beschäftigten sowie der Verwaltung von **Urlaub und Abwesenheiten**. Erfasst und
verarbeitet werden insbesondere:

- Stammdaten: Name, dienstliche E-Mail-Adresse, Rolle, Eintritts-/Austrittsdatum,
  Bundesland (für Feiertage), Beschäftigungsmerkmale (z. B. Minijob, leitende
  Funktion), ggf. Geburtsdatum (zur Anwendung des Jugendarbeitsschutzes) und
  Status der Schwerbehinderung (für den gesetzlichen Zusatzurlaub).
- Arbeitszeitdaten: Beginn, Ende und Dauer von Arbeits- und Pausenzeiten,
  Korrekturen und deren Begründungen; je Stempelung der Erfassungsweg
  (z. B. Browser oder QR-Code am Terminal, dann mit der Bezeichnung des
  Terminals, z. B. „Eingang“). [Nur falls aktiviert:] zusätzlich der grob erkannte
  Gerätetyp (z. B. „iPhone · Safari“) — ohne eindeutige Gerätekennung und ohne
  Standort.
- Abwesenheiten: Urlaub und Krankheitszeiten (inkl. Vorliegen einer AU-
  Bescheinigung als Ja/Nein-Kennzeichen — **keine Diagnosedaten**) sowie
  Sonderurlaub, Fortbildung, Dienstreise, Freizeitausgleich, unbezahlter Urlaub,
  Elternzeit, Mutterschutz und „Kind krank“ (§ 45 SGB V), jeweils nur Art und
  Zeitraum.
- Protokolldaten zu Änderungen (Wer, Wann, Was, Alt→Neu, Grund).

Es findet **keine** biometrische Erfassung, **keine** Standortverfolgung und
**keine** Leistungsbewertung statt. [Nur falls aktiviert:] Der Gerätetyp dient
ausschließlich der Plausibilitätsprüfung einzelner Stempelungen — etwa ob ein
Arbeitsende am Arbeitsplatz oder auf einem Mobilgerät erfasst wurde — und wird
nicht zu Profilen ausgewertet. [Bei Betriebsrat: Grundlage ist die
Betriebsvereinbarung vom …]

## 3. Rechtsgrundlagen

- **§ 26 Abs. 1 BDSG** i. V. m. **Art. 6 Abs. 1 lit. b/f DSGVO** — Verarbeitung
  zur Durchführung des Beschäftigungsverhältnisses bzw. berechtigtes Interesse an
  einer ordnungsgemäßen Arbeitszeiterfassung.
- **Art. 6 Abs. 1 lit. c DSGVO** — Erfüllung rechtlicher Pflichten
  (Arbeitszeitaufzeichnungspflicht; ArbZG, MiLoG § 17, Nachweis- und
  Aufbewahrungspflichten).
- Die Verarbeitung beruht **nicht auf Einwilligung**, da diese im
  Beschäftigungsverhältnis regelmäßig nicht freiwillig ist.

## 4. Empfänger

Zugriff haben ausschließlich berechtigte Personen: Beschäftigte auf **ihre
eigenen** Daten, Administrator:innen (z. B. Personalverwaltung) auf alle Daten im
erforderlichen Umfang. Eine Übermittlung an Dritte erfolgt nur, soweit gesetzlich
vorgeschrieben (z. B. an Finanzbehörden, Zoll, Sozialversicherungsträger) oder
zur Lohnabrechnung erforderlich. **Es werden keine Drittdienste für Analyse,
Tracking oder externe Schriftarten/CDNs eingebunden.**

## 5. Speicherdauer

Arbeitszeit- und abwesenheitsbezogene Daten werden für die Dauer der
gesetzlichen Aufbewahrungsfristen gespeichert. Mehrere Fristen überlagern sich:

- Arbeitszeitnachweise: **≥ 2 Jahre** (ArbZG § 16 Abs. 2), MiLoG-Aufzeichnungen
  ebenfalls ≥ 2 Jahre;
- sozialversicherungsrelevante Unterlagen: **≈ 4 Jahre**;
- lohn-/steuerrelevante Daten: ggf. bis zu **~10 Jahre**.

Die in der Anwendung hinterlegte Aufbewahrungsfrist ist konfigurierbar
(Voreinstellung: 4 Jahre, mindestens 2) und läuft ab dem Ende des
Kalenderjahres, in dem ein Datensatz entstanden ist. Nach Ablauf werden Zeiten,
Abwesenheiten, Anträge, Urlaubsjahre und Protokolleinträge **gelöscht**; Konten
ausgeschiedener Beschäftigter werden **anonymisiert**. Die Löschung stößt die
Verwaltung an (Verwaltung → Aufbewahrung), sie läuft nicht automatisch.

Für den Gerätetyp einer Stempelung besteht keine Aufbewahrungspflicht. Er wird
derzeit mit dem Zeiteintrag gespeichert und mit ihm bzw. bei der
Anonymisierung entfernt.
[Kürzere Frist festlegen, z. B. … Monate.]

## 6. Rechte der betroffenen Personen

Betroffene haben das Recht auf **Auskunft** (Art. 15), **Berichtigung** (Art. 16),
**Löschung** (Art. 17, im Rahmen der Aufbewahrungspflichten),
**Einschränkung** (Art. 18), **Datenübertragbarkeit** (Art. 20) und **Widerspruch**
(Art. 21). Die Anwendung stellt hierfür Funktionen bereit (Datenexport pro Person,
Anonymisierung). Beschäftigte können die Änderungshistorie ihrer eigenen Einträge
jederzeit einsehen.

Zudem besteht ein **Beschwerderecht** bei einer Aufsichtsbehörde
([zuständige Landesdatenschutzbehörde eintragen]).

## 7. Datensicherheit

Übertragung ausschließlich verschlüsselt (HTTPS). Passwörter werden mit einem
modernen Verfahren (argon2id) gehasht. Konten mit Verwaltungsrechten melden
sich zusätzlich mit einem Code aus einer Authenticator-App an
(Zwei-Faktor-Anmeldung); für alle anderen ist sie freiwillig. Gespeichert werden
dafür der geheime Schlüssel der App-Verknüpfung und Prüfwerte (Hashes) der
Wiederherstellungscodes. Zugriffe sind rollenbasiert beschränkt;
administrative und korrigierende Vorgänge werden manipulationssicher
protokolliert (revisionssichere, fortlaufende Protokollierung). Es gelten
geeignete technische und organisatorische Maßnahmen nach Art. 32 DSGVO.

## 8. Mitbestimmung

Sofern ein **Betriebsrat** besteht, unterliegt die Einführung und Anwendung
dieses Systems der Mitbestimmung nach § 87 Abs. 1 Nr. 6 BetrVG.

---
*Stand: [Datum]. Diese Erklärung ist anzupassen, sobald sich Zwecke, Empfänger
oder Fristen ändern.*
