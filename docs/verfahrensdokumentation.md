# Verfahrensdokumentation — Zeiterfassung (GoBD)

> **ENTWURF – rechtlich prüfen lassen.** Beschreibt, wie das System Arbeitszeiten
> erfasst, korrigiert, schützt und für die Lohnabrechnung exportiert. Dient als
> Grundlage einer GoBD-Verfahrensdokumentation und ist an den Betrieb anzupassen.

## 1. Zweck und Geltungsbereich

Das System erfasst die Arbeitszeiten der Beschäftigten **tagesaktuell** und
verwaltet Abwesenheiten. Es erfüllt die Pflicht zur Aufzeichnung der Arbeitszeit
(EuGH C-55/18; BAG 1 ABR 22/21) und ist auf **Revisions- und
Manipulationssicherheit** ausgelegt.

## 2. Rollen und Berechtigungen

- **Mitarbeiter:in:** erfasst eigene Zeiten (Stempeln/Pausen), sieht
  ausschließlich eigene Daten, stellt Korrekturanträge, sieht die
  Änderungshistorie der eigenen Einträge.
- **Administrator:in:** verwaltet Konten und Arbeitszeitmodelle, sieht alle
  Daten, genehmigt/lehnt Korrektur- und Urlaubsanträge, nimmt (versionierte und
  protokollierte) Korrekturen vor, verwaltet Parameter und Exporte.

Zugriff ist serverseitig rollenbasiert abgesichert; bei jedem schreibenden
Vorgang wird das Konto erneut gegen die Datenbank geprüft.

## 3. Erfassung (Vollständigkeit, Tagesaktualität)

Zeiten werden als **Arbeits-** und **Pausenintervalle** mit absoluten Zeitstempeln
erfasst (Zeitzone Europe/Berlin für Tagesgrenzen). Das System erkennt **Lücken
aktiv**: offene Einträge (eingestempelt, nie ausgestempelt), Arbeitstage ganz ohne
Eintrag und unplausibel lange offene Schichten werden gekennzeichnet und müssen
über den regulären Korrekturweg aufgelöst werden — es wird **niemals automatisch
ein Ende geraten oder still geschlossen**.

Gestempelt wird im Browser oder per **QR-Code an einem Terminal** (z. B. Tablet
am Eingang): Das Terminal zeigt einen Code, der alle 30 Sekunden wechselt und
serverseitig signiert ist; er wird höchstens 90 Sekunden lang angenommen. Die
Mitarbeitenden scannen ihn mit dem eigenen, angemeldeten Handy. Der Zeitpunkt
stammt in jedem Fall von der Serveruhr. Terminals werden von der Administration
gekoppelt und deaktiviert (protokolliert).

### 3.1 Pausenautomatik

Für Pausen gilt eine Ausnahme von der Regel „nichts ergänzen", weil das Unterlassen
hier zur *Über*erfassung führt: eine begonnene und nie beendete Pause ließ sich nicht
messen und blieb deshalb ganz unberücksichtigt, und ein Tag ganz ohne Pausenbuchung
wurde in voller Länge als Arbeitszeit gewertet. In beiden Fällen wurde nicht
gearbeitete Zeit vergütet.

Ist die **Pausenautomatik** aktiviert (Einstellungen → Pausenautomatik), setzt das
System deshalb eine Pause an:

- **Nie beendete Pause:** Sie wird mit der konfigurierten festen Länge gewertet —
  aber erst, wenn die zugehörige Arbeitssitzung beendet ist oder als vergessenes
  Ausstempeln gilt. Solange die Sitzung läuft, bleibt die Pause unangetastet.
- **Keine Pause erfasst:** Überschreitet die Arbeitszeit die Pausenschwelle des
  Regelprofils (§4 ArbZG), wird die fehlende Pausenzeit abgezogen. Der Abzug
  unterschreitet nie das gesetzliche Minimum und wird je **Schicht** ermittelt,
  damit auch eine über Mitternacht laufende Schicht erfasst wird.

Maßgeblich für die Revisionssicherheit: **Die erfassten Stempelzeiten werden dadurch
nicht verändert.** Es wird kein Datensatz angelegt, geändert oder geschlossen; der
Abzug entsteht ausschließlich bei der Berechnung, wird in Zeitnachweis und Export
getrennt ausgewiesen und erzeugt am betroffenen Tag einen Hinweis („Pause automatisch
angesetzt" bzw. „Pause nie beendet") mit der Aufforderung zur Korrektur. Die
Pausenautomatik ist damit eine Absicherung gegen zu hohe Zeitgutschriften, **kein
Ersatz für die nach §16(2) ArbZG geforderte Aufzeichnung der tatsächlichen Zeiten**.
Sie ist abschaltbar; ohne sie wird ausschließlich erfasste Pausenzeit abgezogen.

Einzelne Konten können zusätzlich **vom automatischen Abzug ausgenommen** werden
(Profil → „Kein automatischer Pausenabzug"). Vorgesehen ist das für Verträge mit
höchstens sechs Stunden Tagessoll: Für die geschuldete Arbeitszeit ist dort keine
Pause vorgeschrieben, ein gelegentliches Überschreiten der Schwelle würde aber den
vollen Abzug auslösen. Die Ausnahme betrifft ausschließlich den Abzug bei **fehlender**
Pausenbuchung. Eine begonnene und nie beendete Pause wird weiterhin angesetzt (sie
hat tatsächlich stattgefunden), und der §4-Hinweis bleibt bestehen: Wer tatsächlich
über sechs Stunden arbeitet, benötigt eine Pause und muss sie nachtragen. Das Setzen
und Entfernen der Ausnahme wird protokolliert.

## 4. Unveränderbarkeit und Korrekturen (Revisionssicherheit)

- Ein erfasster Zeitwert wird **nie überschrieben** — weder von Beschäftigten noch
  von der Administration.
- Eine Korrektur erzeugt eine **neue Version**, die auf das Original verweist; das
  Original wird als „ersetzt" markiert, aber nicht gelöscht.
- Korrekturen laufen über ein **Antrags-/Genehmigungsverfahren**. Ob
  Eigenkorrekturen erlaubt sind und ob sie genehmigt werden müssen, ist
  konfigurierbar (Voreinstellung: Genehmigung erforderlich).
- Beantragen Beschäftigte die Korrektur einer **Arbeitszeit**, müssen sie
  zwingend angeben, **ob in dieser Zeit eine Pause gemacht wurde** — und wenn
  ja, wann. Eine korrigierte Schicht ohne Aussage zur Pause wäre kein
  vollständiger Nachweis: die Prüfung nach §4 ArbZG würde das Fehlen sonst als
  „keine Pause" auslegen, ohne dass das jemand erklärt hat. Die Angabe wird am
  Antrag gespeichert, der genehmigenden Stelle angezeigt und mit der Genehmigung
  in die erfassten Pausen übernommen; zuvor erfasste Pausen innerhalb der
  korrigierten Schicht werden dabei als ersetzt markiert (nicht gelöscht).
- Die **Administration kann einen Zeitwert zusätzlich unmittelbar richtigstellen**
  („Alle Zeiten" → „Einzelne Zeiten korrigieren"), also ohne Antrag der betroffenen
  Person und unabhängig von der Rückwirkungssperre, die für Beschäftigte gilt. Das
  ist der Weg für Werte, die nachweislich falsch erfasst wurden und die sonst
  niemand mehr berichtigen könnte (z. B. ein durch vergessenes Ausstempeln über
  Mitternacht laufender Eintrag oder ein fehlerhafter Sammel-Nachtrag). Die
  Unveränderbarkeit bleibt dabei vollständig gewahrt: auch dieser Eingriff
  überschreibt nichts, sondern erzeugt eine neue Version, verlangt zwingend eine
  Begründung und wird protokolliert.
- Die Administration kann einen Eintrag zusätzlich **aus der Wertung nehmen**
  („Entfernen"). Das ist kein Löschen: die Zeile wird wie bei einer Korrektur als
  *ersetzt* markiert, zählt nicht mehr in Nachweisen und Auswertungen, bleibt aber
  im Rohdaten-Export und im Protokoll dauerhaft sichtbar. Der Weg ist notwendig für
  **Doppelerfassungen** — dieselbe Schicht mehrfach angelegt —, denn solange
  mehrere Einträge dieselbe Zeit abdecken, lässt sich keiner von ihnen korrigieren,
  ohne dass die Zeit doppelt gewertet würde. Auch hier gilt Begründungspflicht.
- Jede Erstellung/Korrektur/Entscheidung wird mit **Akteur, Zeitpunkt, Alt-Wert,
  Neu-Wert und Pflicht-Begründung** in einem **append-only-Protokoll** festgehalten.
  Das Protokoll kennt keine Änderungs- oder Löschfunktion.

## 5. Regelprüfungen (ArbZG)

Geprüft werden die konfigurierbaren Schwellen: werktägliche Höchstarbeitszeit
(§3), Mindestpausen einschließlich der Mindestdauer anrechenbarer Abschnitte von
15 Minuten (§4 Abs. 1 S. 2), Mindestruhezeit von 11 Stunden zwischen zwei
Schichten (§5), Sonn- und Feiertagsarbeit (§9) sowie das strengere Profil für
Minderjährige (JArbSchG), das je **Tag** anhand des an diesem Tag geltenden
Alters gewählt wird.

Bezugsgröße von §3 und §4 ist die **Schicht**, nicht der Kalendertag: eine
durchgehende Arbeitszeit von 18:00 bis 06:00 Uhr wird als eine Schicht von zwölf
Stunden bewertet und dem Tag ihres Beginns zugerechnet. §5 wird zwischen
aufeinanderfolgenden Schichten gemessen, also auch innerhalb eines Kalendertages.

Die Schwellen liegen im **Regelprofil** (Daten, nicht Code), damit die erwartete
ArbZG-Reform 2026 ohne Code-Änderung abgebildet werden kann.

**Wirkung der Prüfungen.** Die Prüfungen sind dokumentierend, nicht
verhindernd: Sie kennzeichnen Sachverhalte als „Hinweis" bzw. — je nach
Regelprofil — als „Verstoß" und weisen sie in der Anwendung und in den Exporten
aus. Eine Erfassung wird dadurch **nicht** blockiert. Das ist bewusst so
gestaltet: Nach §16 Abs. 2 ArbZG ist die tatsächlich geleistete Arbeitszeit
aufzuzeichnen. Eine Software, die das Speichern regelwidriger Zeiten verweigert,
erzeugt eine Unter­erfassung und damit einen weiteren Verstoß. Die Einhaltung der
Höchstarbeitszeiten ist eine organisatorische Aufgabe des Arbeitgebers; die
Anwendung macht Abweichungen sichtbar und nachweisbar.

**Nicht automatisiert überwacht** wird der Ausgleichszeitraum nach §3 S. 2 ArbZG
über den vollen Zeitraum von sechs Kalendermonaten bzw. 24 Wochen hinweg: Die
Anwendung berechnet den Durchschnitt über den jeweils ausgewerteten Zeitraum
(`checkAveraging`), eine durchgehende Überwachung des gesetzlichen
Ausgleichszeitraums erfolgt organisatorisch. Ebenso wenig überwacht wird die
Aufzeichnungsfrist von sieben Tagen nach §17 MiLoG.

## 6. Urlaub und Abwesenheiten

Urlaubsanträge durchlaufen eine Genehmigung; die Anzahl verbrauchter Arbeitstage
wird mit derselben Logik wie die Sollzeit berechnet (Feiertage/Teilzeit/halbe
Tage einheitlich). Krankheit wird getrennt geführt und mindert den Urlaub nicht;
§ 9 BUrlG (Krankheit im Urlaub) wird über eine geprüfte Gutschrift abgebildet.

### 6.1 Bewertung im Zeitkonto

Ein **Feiertag senkt** die Sollzeit — an ihm ist keine Arbeit geschuldet.
Genehmigter Urlaub und erfasste Krankheit werden dagegen **gutgeschrieben**: Die
Sollzeit des Tages bleibt bestehen und wird bis zu ihrer Höhe als Abwesenheitszeit
ausgeglichen (Entgeltfortzahlung, §11 BUrlG / §3 EFZG). Damit weist der Monat
weiterhin die vertragliche Sollzeit aus, die Gutschrift erscheint als eigene Größe
in Zeitnachweis und Export, und es gilt durchgängig

> **Saldo = Ist + Abwesenheit − Soll**

Ein halber Urlaubstag schreibt das halbe Tagessoll gut — also genau den Anteil, der
auch dem Urlaubskonto belastet wurde. Wurde an einem Abwesenheitstag gearbeitet,
wird nur die Differenz bis zum Soll ergänzt; darüber hinausgehende Arbeitszeit
bleibt Mehrarbeit. Nur **genehmigte** Abwesenheiten werden gutgeschrieben; ein
beantragter, noch nicht genehmigter Urlaub wirkt sich nicht aus.

### 6.2 Nachträgliche Korrektur durch die Administration

Eine Abwesenheit ist — anders als ein Stempelzeitpunkt — keine Messung, sondern
eine **Entscheidung**. Ändern sich die zugrunde liegenden Tatsachen (ein Urlaub
wird durch eine Erkrankung verkürzt, ein Zeitraum wurde unter der falschen Art
erfasst), ist die Entscheidung selbst zu ändern. Die Administration kann daher
Zeitraum, Art (Urlaub ↔ Krankheit), halbe Tage, AU-Vermerk und Notiz einer bereits
erfassten Abwesenheit korrigieren oder den Eintrag **stornieren**.

Verfahrenssichernd gilt dabei:

- Stornierte Einträge werden **nicht gelöscht**, sondern als „storniert"
  gekennzeichnet; sie zählen nicht mehr, bleiben aber nachvollziehbar.
- Die verbrauchten Arbeitstage werden aus dem korrigierten Zeitraum **neu
  berechnet**, einschließlich aller noch wirksamen §9-Gutschriften. Diese werden
  aus den Zeiträumen abgeleitet und nicht fortgeschrieben, damit das Urlaubskonto
  unabhängig von der Reihenfolge der Korrekturen korrekt bleibt.
- Eine **Begründung ist Pflicht**. Sie wird am Eintrag vermerkt und zusammen mit
  Zeitpunkt, handelnder Person sowie Vorher-/Nachher-Stand in das unveränderbare
  Protokoll geschrieben.
- Zeiterfassungsdaten (Stempelzeiten) sind davon nicht berührt; sie bleiben
  ausschließlich über den Korrekturweg aus Abschnitt 4 änderbar.

## 7. Export zur Lohnabrechnung

Pro Mitarbeiter:in und Monat stehen ein **PDF** (zahlungsbereiter Nachweis) und
eine **CSV** (deutsches Format: Semikolon, Dezimalkomma, UTF-8) zur Verfügung,
zusätzlich eine **Rohdaten-CSV** der einzelnen Erfassungen (auch
Zoll-/MiLoG-tauglich, in deutscher Sprache). Die Exporte werden über
zugriffsgeschützte Endpunkte ausschließlich von Administrator:innen erzeugt.

## 8. Aufbewahrung, Datenschutz, Sicherung

Aufbewahrung gemäß gesetzlicher Fristen (siehe Datenschutzerklärung /
Verarbeitungsverzeichnis). Datensparsamkeit (keine Biometrie, kein Standort,
keine Gerätekennung), HTTPS, argon2id-Hashing, Login-Sperre, Sicherheits-Header.

Jede Stempelung wird zusätzlich als Stempelereignis mit Zeitpunkt und
Erfassungsweg (z. B. Browser) gespeichert. Ist in den Einstellungen „Gerätetyp
beim Stempeln erfassen“ aktiviert (Voreinstellung: aus), kommt der grob
erkannte Gerätetyp hinzu (z. B. „iPhone · Safari“). Er dient der
Plausibilitätsprüfung und ist nur in der Administrationsansicht „Alle Zeiten“
sichtbar, nicht in den Exporten zur Lohnabrechnung. Vor der Aktivierung ist
der Betriebsrat zu beteiligen (§ 87 Abs. 1 Nr. 6 BetrVG). Sicherung
über die verwaltete Datenbank zzgl. regelmäßiger `pg_dump`-Kopien (siehe README).

## 9. Änderungen an dieser Dokumentation

Diese Verfahrensdokumentation ist bei wesentlichen Änderungen des Systems
(Erfassung, Korrekturwege, Exporte, Aufbewahrung) fortzuschreiben.

---
*Stand: [Datum]. Verantwortlich: [Name/Funktion].*
