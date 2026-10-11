# Verzeichnis von Verarbeitungstätigkeiten — Arbeitszeiterfassung (Art. 30 DSGVO)

> **ENTWURF – rechtlich prüfen lassen.** Vorlage für den Eintrag „Arbeitszeit-
> erfassung" im Verarbeitungsverzeichnis des Verantwortlichen. Platzhalter `[…]`
> ausfüllen.

| Feld | Angabe |
|---|---|
| **Bezeichnung der Verarbeitung** | Arbeitszeiterfassung und Abwesenheitsverwaltung |
| **Verantwortlicher** | [Firmenname], [Anschrift], [Kontakt] |
| **Datenschutzbeauftragte:r** | [Name/Kontakt, falls bestellt] |
| **Zwecke** | Erfassung/Abrechnung der Arbeitszeit, Überstunden-/Gleitzeitkonto, Urlaubs- und Krankheitsverwaltung, Einhaltung von ArbZG/MiLoG, Lohnvorbereitung; [falls aktiviert:] Plausibilitätsprüfung einzelner Stempelungen anhand des Gerätetyps |
| **Rechtsgrundlagen** | § 26 Abs. 1 BDSG; Art. 6 Abs. 1 lit. b, c, f DSGVO |
| **Kategorien betroffener Personen** | Beschäftigte (inkl. Minijobber:innen, ggf. Minderjährige); Administrator:innen |
| **Kategorien personenbezogener Daten** | Stammdaten (Name, dienstl. E-Mail, Rolle, Beschäftigungszeitraum, Arbeitszeitmodell, Bundesland); Arbeits-/Pausenzeiten; je Stempelung Erfassungsweg, [falls aktiviert:] grob erkannter Gerätetyp (ohne Gerätekennung, ohne Standort); Korrekturen mit Begründung; Urlaubs- und Krankheitszeiten (AU als Ja/Nein); Protokolldaten |
| **Besondere Kategorien (Art. 9)** | Grundsätzlich **keine**. Hinweis auf Schwerbehinderung wird ausschließlich als Status für den gesetzlichen Zusatzurlaub geführt; Krankheit ohne Diagnosedaten. Keine biometrischen Daten. |
| **Kategorien von Empfängern** | Interne Personalverwaltung; bei gesetzlicher Pflicht: Finanzbehörden, Zoll (MiLoG), Sozialversicherungsträger; Lohnabrechnung [intern/extern: …] |
| **Drittlandübermittlung** | **Keine.** Daten verbleiben auf der selbst gehosteten Instanz (Hosting: [Railway / EU-Region / eigener Server — präzisieren]). |
| **Löschfristen** | Nach Ablauf der Aufbewahrungsfristen (ArbZG/MiLoG ≥ 2 J.; Sozialversicherung ≈ 4 J.; lohn-/steuerrelevant bis ~10 J.); danach Löschung (Zeiten, Abwesenheiten, Anträge, Urlaubsjahre, Protokoll) bzw. Anonymisierung der Konten Ausgeschiedener, ausgelöst durch die Verwaltung (Verwaltung → Aufbewahrung). Frist in der Anwendung konfigurierbar (Voreinstellung 4 J., mindestens 2), gerechnet ab Ende des Kalenderjahres. Gerätetyp der Stempelungen: keine Aufbewahrungspflicht, entfällt spätestens bei der Anonymisierung [kürzere Frist: …]. |
| **Technische und organisatorische Maßnahmen (Art. 32)** | HTTPS-Transportverschlüsselung; argon2id-Passwort-Hashing; rollenbasierte Zugriffskontrolle (Mandant:innen sehen nur eigene Daten); Login-Sperre nach Fehlversuchen; manipulationssichere, fortlaufende Protokollierung (revisionssicher); Versionierung statt Überschreiben; Sicherheits-Header (CSP/HSTS); Datensparsamkeit (keine Standort-/Biometriedaten, keine Gerätekennung; Gerätetyp nur nach Aktivierung und ohne Version); regelmäßige Backups. |

---
*Stand: [Datum]. Bei Änderungen von Zwecken, Empfängern, Fristen oder TOM ist der
Eintrag fortzuschreiben.*
