# Internetvertrag und monatliche Anbieter-Abschläge in HOM

## 1. Verträge und Kosten

Unter **Tarife & Verträge → Tarif oder Vertrag erfassen** kann die neue Kostenart **Internet & Telefon** gewählt werden. Die Vertragslaufzeit, Kündigungsfrist und monatliche Grund-/Vertragspauschale werden wie bei anderen Tarifen verwaltet.

- **Abrechnungsintervall:** Monatlich / Jährlich / Sonstige.
- **Monatspreis als Hauskosten ansetzen:** Bei Internet standardmäßig **Ja**, bei Strom standardmäßig **Nein**.
- **Verteilung:** Wohnfläche, Personenzahl oder gleiche Anteile.
- Internet-Flatrate: `unit_price_eur=0`, Monatsgebühr z. B. `39,95 EUR`.
- Bei einem Festpreiswechsel einen neuen Tarif ab dem **ersten Tag des Änderungsmonats** anlegen, damit die bisherigen Monate unverändert bleiben. Bei gleichen Anbieter- und Kostenartnamen gilt für jeden Monat der neueste Tarif.
- Feste Monatskosten werden für **volle Vertragsmonate** als verteilte Kosten der Jahresabrechnung angesetzt. Für angebrochene Anfangs-/Endmonate bitte die tatsächlich abgerechneten Beträge als Rechnung erfassen; HOM erfindet keine taggenauen Preise.

### Beispiel Internet

Telekom: Januar–Juni 39,95 €, ab Juli 49,95 € monatlich.

- Januar–Juni: 6 × 39,95 € = 239,70 €
- Juli–Dezember: 6 × 49,95 € = 299,70 €
- Jährlicher vertraglicher Kostenansatz: **539,40 €**.

Diese Monatspauschalen werden in Jahresabrechnung, PDF und Excel ausdrücklich als **aus dem Vertrag erzeugt** gekennzeichnet. Sie sind keine geprüften Bankbuchungen.

Bei einer **zusätzlich erfassten Rechnung desselben Anbieters und derselben Kostenart**, die sich mit einem Vertragsmonat überschneidet, wird die automatische Monatspauschale **für diesen Monat ausgelassen**. So wird sie nicht doppelt berechnet. Eine Jahresabrechnung des Versorgers kann mehrere Monate ersetzen. Prüft vor dem Erfassen von Korrektur- und Nachzahlungsrechnungen, ob diese den Gesamtbetrag oder nur eine Differenz enthalten: HOM kann das nicht selbst entscheiden.

## 2. Monatliche Zahlungen an Anbieter

Unter **Abschläge → Abschläge an Anbieter → Anbieter-Abschlag / Erhöhung** legt Ihr einen monatlichen Zahlungsplan pro Vertrag an:

- Vertrag: z. B. „Telekom Festnetz“, „Stromanbieter A“
- Monatlicher Betrag
- Abbuchungstag (1–31; in kurzen Monaten letzter Kalendertag)
- Beginn ab **Monatserstem**, optional Enddatum
- Bei Änderung: Neuer Eintrag mit künftigem Startmonat. HOM schließt die alte Version automatisch am Ende des Vormonats.

Die Jahresvorschau zeigt zwölf Monate, einschließlich zukünftiger Fälligkeiten. Die Beträge gelten als **geplant, nicht bankbestätigt**.

**Entscheidender Unterschied:**

| Buchung | Wirkung |
|---|---|
| Internet-Monatspauschale mit automatischer Kostenbuchung | Wird als Hauskosten verteilt |
| Monatlicher Anbieter-Abschlag (Internet/Strom/Gas) | Nur Zahlungsplanung; nicht zusätzlich als Kosten |
| Tatsächliche Strom-Jahresrechnung | Tatsächliche Kosten; ein Anbieter-Abschlag ist keine zusätzliche Stromrechnung |
| Monatliche Stromrechnung | Einzelrechnung mit Monatszeitraum erfassen; zählt als Kosten |
| Zahlungen der Haushalte an die Hauskostenkasse | Weiterhin getrennt unter Haushalts-Daueraufträge/Einzelzahlungen |

So wird ein Stromvertrag mit zwölf Abschlägen à 100 € nicht fälschlich als zusätzliche 1.200 € Stromkosten neben der Jahresrechnung abgerechnet.

## 3. Datenerhalt

Das Update ist additiv; vorhandene Tarife, Rechnungen, Haushalts-Zahlungen und Benutzerkonten bleiben erhalten. Die neuen Einträge werden in HOM-JSON-Backups mitgesichert, und ältere Backups ohne Anbieter-Abschläge lassen sich weiterhin einlesen.

Vor NAS-Update eine Sicherung von `hom_data` anlegen. Das bestehende Docker-Projekt mit `ghcr.io/kesselbuettner-dot/hom:latest` aktualisieren; **keine Volumes löschen**.

## 4. Grenzen

- Anbieter-Abschläge werden **nicht mit echten Bankumsätzen abgeglichen**.
- Monatliche Abschlagspläne allein erzeugen keine Rechnung. Für Internet gibt es dafür die separat aktivierbare automatische **Vertragspauschale**.
- Bei Preisanpassungen alter Monate empfiehlt sich ein eigener Vertragssatz mit neuem Gültigkeitsbeginn; das direkte Überschreiben des alten Tarifpreises kann historische Ableitungen verändern.
- Die alte Funktion „Daueraufträge der Haushalte“ bleibt unberührt.
