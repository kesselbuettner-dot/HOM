**Neu: [Gasumrechnung, Kündigungsfristen und Daueraufträge](GAS-VERTRAEGE-ABSCHLAEGE.md)**

**Neu: [Benutzerverwaltung und Hauseinstellungen](BENUTZERVERWALTUNG.md)** · Adminrechte, Hausname und NAS-Update.

**Neu: [HOM-Anmeldung und Zertifikate](HTTPS-LOGIN.md) · [UGREEN-YAML für Version 1.1](compose-ugreen-login.yaml)**

# Hauskosten-Manager

**Lokale, deutschsprachige Web-App für ein privates Mehrgenerationenhaus.**

Version: 1.0 · Stand: November 2026 · Betrieb **ohne Cloud, ohne Datenversand (mit bcryptjs für die NAS-Anmeldung)**. Erstellt als überprüfbarer erster Projektstand – keine rechtlich geprüfte Nebenkostenabrechnungssoftware.

## DXP2800 / Docker

Für den NAS-Betrieb mit lokalem HTTPS und Passwortschutz siehe **[NAS-README.md](NAS-README.md)**. Die Anwendung ist nicht für den ungeschützten LAN-Zugriff vorgesehen.

## Schnellstart unter Windows

1. ZIP vollständig entpacken, z. B. nach `C:\Hauskosten-Manager`.
2. **Node.js 22.13 oder neuer** installieren: https://nodejs.org/ (vorzugsweise aktuelle LTS-Version).
3. Einmal im Projektordner `npm install` ausführen, dann die Datei **`start-windows.bat`** doppelklicken. Ein Terminalfenster bleibt geöffnet.
4. Im Browser **http://127.0.0.1:4317** aufrufen.
5. Zum Beenden im Terminal `Strg+C` drücken. Daten bleiben gespeichert.

Unter Windows mit PowerShell alternativ:

```powershell
cd C:\Hauskosten-Manager
node server.js
```

Die App verwendet für die NAS-Anmeldung die kleine Bibliothek `bcryptjs`. Vor dem Windows-Start einmal `npm install` ausführen. Hinweis: Node 22 meldet eventuell, dass `node:sqlite` noch experimentell ist – diese Meldung allein ist kein Fehler.

## Sofort testen

Auf der leeren Startseite **„Beispieldaten laden“** wählen. Die Daten sind erfunden und enthalten drei Haushalte, zwölf Zähler, Rechnungen und Abschläge für **2026**. Sie können nur geladen werden, wenn die Datenbank leer ist. Für echte Daten am besten den Ordner `data` bei beendetem Server löschen/umbenennen oder ein eigenes frisches Projektverzeichnis verwenden.

## Funktionen

- **Haushalte:** Wohneinheiten, Wohnfläche, Personenzahl, Aktiv/Inaktiv, Einträge bearbeiten.
- **Zähler:** beliebig viele Haupt- und Unterzähler für Strom, Gas, Wasser, Warmwasser, Heizung usw.; Ablesedaten, Zählerstände, Messfaktor.
- **Tarife:** Versorger, Preise pro Einheit, monatlicher Grundpreis, Gültigkeitsdatum als nachvollziehbare Dokumentation.
- **Rechnungen:** Beträge, Leistungszeiträume, Rechnungsnummern, Kostenart, PDF-Anhang (max. 5 MB). Doppelte Rechnungsnummern desselben Lieferanten werden abgewiesen.
- **Kostenverteilung:** nach echten Haushalts-Unterzählern, Wohnfläche, Personen, gleichen Anteilen, eigenen Gewichten oder direkter Haushaltszuordnung.
- **Gemeinschaftsverbrauch:** Differenz zwischen Haupt- und Unterzählern auf Haushalte verteilen, nach konfigurierbarem Gemeinschaftsschlüssel.
- **Abschläge/Zahlungen:** pro Haushalt, Ausweis von Nachzahlungen und Guthaben.
- **Jahresabrechnung:** Gesamtübersicht und separate PDF-Abrechnung je Haushalt; CSV- und Excel-Export.
- **Prognose:** 1, 3, 5 oder 10 Jahre mit eigener Preis- und Verbrauchsänderung und drei Szenarien.
- **Backup:** vollständige lokale JSON-Sicherung einschließlich PDF-Anhängen, Wiederherstellung mit doppelter Bestätigung.
- **Offline:** Nur `127.0.0.1`, HTML/CSS/JS und SQLite. Keine Übertragung in eine Cloud.

## Abrechnungsprinzip und wichtige Grenzen

Die folgenden Regeln werden explizit angewandt. **Bitte vor einer tatsächlichen Abrechnung kontrollieren.**

1. **Rechnungsjahr:** Jede Rechnung gehört zum Kalenderjahr, in dem ihr **Leistungszeitraum endet**. Eine Rechnung, die mehrere Kalenderjahre umfasst, wird noch **nicht** anteilig aufgeteilt.
2. **Verbrauch:** Die Differenz von Zählerständen zwischen Rechnungsanfang und -ende zählt. Fehlende Stände werden **nur innerhalb** zweier tatsächlicher Ablesungen linear interpoliert. Keine Extrapolation und keine Schätzung bei fehlenden Ständen.
3. **Haupt-/Unterzähler:** Wenn für eine Kostenart ein Hauptzähler vorhanden ist, wird die nicht durch Unterzähler erfasste Differenz nach dem gewählten Gemeinschaftsschlüssel verteilt. Bei einem negativen Rest wird die Rechnung als fehlerhaft gemeldet und **nicht** verteilt.
4. **Ohne Hauptzähler:** Bei verbrauchsbasierter Umlage wird nur nach den vorhandenen Unterzählern verteilt; die Summe der Unterzähler wird dann als Umlagebasis verwendet.
5. **Centgenau:** Rechnungsbeträge werden als ganze Cent gespeichert. Die Summe der verteilten Anteile entspricht exakt dem Rechnungsbetrag; Restcents gehen nach dem größten Nachkomma-Rest und anschließend nach Haushalts-ID an die Haushalte.
6. **Zahlungen:** Positive Abschläge mindern den Saldo; ein positiver Saldo bedeutet Nachzahlung, ein negativer Guthaben.
7. **Prognose:** Die tatsächlichen Jahreskosten sind der Ausgangspunkt. Jährliche angenommene Preis- und Verbrauchsänderung werden fortgeschrieben. „Optimistisch“ bedeutet -2 Prozentpunkte, „pessimistisch“ +3 Prozentpunkte bei der jährlichen Preisänderung gegenüber dem Basisszenario. **Keine Vorhersage tatsächlicher Energiepreise**.
8. **Fehler:** Rechnungen mit fehlenden bzw. widersprüchlichen Verteilungsgrundlagen werden im Bericht **ausdrücklich als unvollständig** markiert und aus der abgerechneten Gesamtsumme ausgeschlossen. Die originale Rechnung bleibt gespeichert.

### Noch nicht umgesetzt / für eine spätere Ausbaustufe

- Bewohnerwechsel und Wohnflächenänderungen als historisierte, zeitanteilige Abrechnungsgrundlagen.
- Rechtssichere Heizkostenverordnung, Warmwassertrennung, CO₂-Kostenaufteilung, gesetzliche Pflichtangaben, Prüfung von umlagefähigen Kosten sowie formelle Betriebskostenabrechnungen.
- Zählerwechsel/Überläufe, mit denen negative Verbrauchsdifferenzen zuverlässig als separater Vorgang verarbeitet werden.
- Automatische PDF-Rechnungserkennung/OCR. Rechnungsfelder werden zunächst **manuell** erfasst; Originalbeleg wird unverändert abgelegt.
- Abgeschlossenes, unveränderliches Jahresarchiv mit Versionierung und Buchungssperre.
- Separate Benutzerkonten, Haushaltsrollen und ein revisionssicheres Änderungsprotokoll. Auf dem NAS gibt es bereits einen gemeinsamen Login mit gleichen Rechten.

**Das Programm ist eine private Kosten- und Prognoserechenhilfe, nicht automatisch eine rechtsverbindliche Mieter- oder Heizkostenabrechnung.** Kein Produktivbetrieb als öffentlich erreichbarer Webserver ohne zusätzliche Zugangskontrolle und Sicherheitsprüfung.

## Backup und Datenhaltung

Die lokale Datenbank liegt unter `data/hauskosten.sqlite`, PDFs unter `data/attachments/`. Eine Sicherungsdatei enthält persönliche Haushalts- und Rechnungsinformationen; sie ist deshalb vertraulich zu behandeln. Beim Wiederherstellen werden sämtliche Einträge ersetzt. Vorher immer ein separates Backup erzeugen.

Manuelle Sicherung: Server beenden und den ganzen Ordner `data` kopieren. Bei laufendem Server besser die integrierte Backup-Funktion verwenden, statt nur eine SQLite-Datei zu kopieren.

Port ändern, beispielsweise auf 4321:

```powershell
$env:PORT=4321
node server.js
```

Datenordner abweichend festlegen:

```powershell
$env:HAUSKOSTEN_DATA="D:\Hauskosten-Daten"
node server.js
```

## Programmtests

```powershell
cd C:\Hauskosten-Manager
npm test
```

Automatisierte Tests prüfen Cent-Rundung, Zählerstände/Interpolation, Umlagen, Jahresabrechnung, Prognose sowie API, CRUD, PDF/XLSX, Backup und Wiederherstellung. Es werden dafür isolierte, temporäre Testdaten angelegt; die produktive Datenbank wird nicht verwendet.

## Technik

- Backend: Node.js eingebauter HTTP-Server und `node:sqlite` (SQLite)
- Frontend: HTML, CSS, Vanilla JavaScript, ohne externe CDNs
- PDF: lokale PDF-Erstellung; Browserdruck mit optimierten A4-Regeln
- Excel: Open XML `.xlsx` direkt aus Node.js, ohne Cloud
- Export: UTF-8 CSV mit Semikolon als Trennzeichen

**Tipp:** Der Ordner kann als Git-Repository dienen und mit OpenCode/Ollama weiterentwickelt werden. Arbeit möglichst zunächst in einem separaten Entwicklungsbranch; vor jeder Änderung ein Backup.
