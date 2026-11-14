# Gastarife, Vertragsfristen und monatliche Daueraufträge

## 1. Erdgas richtig abrechnen

**Zählerstände:** Erdgaszähler werden weiterhin in **m³** abgelesen. Bei der Zähleranlage \`Gas\` und \`m³\` wählen. Es gibt keine Eingabe von Brennwert oder Zustandszahl bei jeder Ablesung.

**Tarif:** Unter **Tarife & Verträge → Tarif erfassen** als Kostenart **Gas** wählen und die **tatsächlichen Werte aus der Gasrechnung** hinterlegen:
- Brennwert (kWh/m³), beispielsweise 11,2 – **kein pauschaler Standardwert** wird vorgegeben.
- Zustandszahl, beispielsweise 0,95 – ebenfalls aus der Rechnung.
- Arbeitspreis in €/kWh und Grundpreis in €/Monat. Diese Werte dienen bislang der Dokumentation, die Rechnungsverteilung verwendet den tatsächlichen Rechnungsgesamtbetrag.

**Gasrechnung:** Unter **Rechnungen** Kostenart **Gas** wählen und im Feld **Gastarif für Brennwert und Zustandszahl** den passenden Eintrag auswählen. Die zwei Faktoren werden beim Speichern der Rechnung **als historische Momentaufnahme** übernommen. Eine spätere Änderung des Tarifs ändert bestehende Rechnungen nicht; bei der bewussten Auswahl eines anderen Gastarifs können sich die Faktoren ändern.

Rechenweg:
\`\`\`
Gasenergie [kWh] = Verbrauch [m³] × Brennwert [kWh/m³] × Zustandszahl
100,000 m³ × 11,200 kWh/m³ × 0,950 = 1.064,000 kWh
\`\`\`

Im Jahresbericht und Export erscheinen zu den Gasrechnungen die verbrauchten m³ und errechneten kWh. Die nach Zählerwerten aufgeteilten **Euro-Beträge** basieren weiterhin auf der tatsächlich hinterlegten Lieferantenrechnung und werden nicht ein zweites Mal aus Arbeitspreis und Energiemenge berechnet.

**Bestandsdaten:** Bereits vorhandene Gasrechnungen ohne hinterlegte Faktoren werden aus Rückwärtskompatibilität weiter nach erfassten Zählerwerten aufgeteilt und als noch **nicht in kWh umgerechnet** gekennzeichnet. Falls alte Gaszähler fälschlich als kWh angelegt waren, korrigiert bitte zuerst die Messwerteinheit und prüft, ob die Daten wirklich m³ darstellen; nie kWh-Werte einfach zu m³ umbenennen. Gasrechnungen mit erfassten Faktoren benötigen Gaszähler in m³.

## 2. Vertragslaufzeit und Kündigungsfrist

Der Tarif besitzt zusätzlich:
- Vertragsbeginn
- Vertragsende
- **Spätester Kündigungstermin** (bitte aus dem Vertrag übernehmen)
- Erinnerungsvorlauf in Tagen (standardmäßig 42)
- Kündigung „Offen“ / „Erledigt“

Das Dashboard zeigt Verträge, deren Kündigungstermin innerhalb des gewählten Vorlaufs liegt, und überfällige offene Termine. **Die Erinnerung erscheint nur beim Aufruf der App:** keine Hintergrundüberwachung, Push-Nachricht, E-Mail oder automatische Kündigung. Eine Frist wird nicht aus der Vertragslaufzeit geschätzt; bitte das tatsächliche Kündigungsdatum hinterlegen.

Unter **Tarife & Verträge** gibt es einen Link zum offiziellen [CHECK24 Strom- und Gasvergleich](https://www.check24.de/strom-gas/). Eine direkte CHECK24-API für aktuelle Angebote oder Vertragswechsel ist **nicht** eingebunden. Eine automatisierte Integration erfordert einen genehmigten technischen Zugang bzw. zulässige Partnerschnittstelle.

## 3. Monatliche Daueraufträge für Abschläge

Unter **Abschläge & Daueraufträge** auf **Dauerauftrag / Erhöhung** klicken. Eintragen:
- Haushalt
- Monatlicher Betrag in Euro
- Abbuchungstag 1–31 (in kürzeren Monaten wird der letzte Kalendertag verwendet)
- **Gültig ab**: erster Tag des Monats
- Optional **Gültig bis** sowie eine Bemerkung

Beispiel: Ab Januar 100 €/Monat, Erhöhung ab Juli auf 130 €/Monat.
1. Regel „100 €, ab 01.01.“ anlegen.
2. Zweite Regel „130 €, ab 01.07.“ anlegen.
3. HOM beendet die vorherige Regel automatisch am 30.06. Die Januar–Juni-Abschläge bleiben je 100 €, ab Juli werden 130 € angesetzt.

In Berichten werden nur die **bis zum aktuellen Datum planmäßig fälligen Abschläge** berücksichtigt. Für abgeschlossene Vorjahre sind alle damaligen Termine fällig. **Wichtig:** Ein Dauerauftrag wird ohne Kontoanbindung nur **als planmäßig bezahlt angenommen**, nicht bankseitig bestätigt. Prüft diese Beträge bei einer endgültigen Abrechnung anhand Eurer Kontoauszüge.

Wenn für denselben Haushalt im selben Monat eine manuelle Einzelzahlung erfasst ist, **ersetzt diese** den fiktiven Dauerauftrag für diesen Monat, damit nichts doppelt gezählt wird. Das gilt auch bei Teilzahlungen: Bitte dann alle tatsächlich geleisteten Zahlungen dieses Monats korrekt manuell erfassen.

Daueraufträge können gelöscht werden; dadurch kann sich die historische Abrechnung ändern. Bei bloßen Preiserhöhungen oder Änderungen neue Regel ab einem späteren Monat anlegen und die Historie erhalten.

## 4. Update und Datensicherheit

- Die Migration ergänzt bestehende SQLite-Tabellen und legt eine neue Tabelle für Daueraufträge an. Alte Hauskosten-Daten, bestehende Nutzer und Anmeldungen werden nicht gelöscht.
- **Vor dem Docker-Update ein Backup des persistenten Volumes \`hom_data\`** erstellen.
- Es bleibt bei derselben UGREEN-Compose-Konfiguration und \`ghcr.io/kesselbuettner-dot/hom:latest\`. Kein neues NAS-Projekt anlegen und keine Volumes löschen.
- Der JSON-Export enthält nun auch die hinterlegten Dauerauftragsregeln und historisierten Gasfaktoren. Alte JSON-Backups ohne Daueraufträge bleiben lesbar.
- Benutzerkonten, Passwörter, Sessions und Hauseinstellungen sind weiterhin **nicht Bestandteil des JSON-Exports**. Für eine komplette Wiederherstellung benötigt Ihr zusätzlich das persistente Docker-Volume.
