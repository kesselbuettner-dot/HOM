# Paperless-ngx in HOM: Freigabe nur für Hauskostenbelege

## Stand

HOM kann freigegebene Dokumente in **Paperless-ngx** suchen, als Beleg einer Rechnung oder eines Tarifs verknüpfen und eine PDF-Vorschau **über HOM** bereitstellen. Die Dokumente bleiben in Paperless; HOM speichert nur die numerische Dokument-ID. Es werden weder Archiv-Passwörter noch API-Tokens im Browser gespeichert oder an ihn gesendet.

**Papermerge ist bewusst nicht eingebunden.** Der dortige Bestand mit Personal- und Lohndokumenten bleibt unberührt. Eine weitere Integration benötigt eigene, nachweisbar eingeschränkte Dokumentenrechte und Sicherheitsprüfungen.

**Wichtig:** Eine neue Softwarefunktion erzeugt noch keinen Paperless-Benutzer. Den eingeschränkten Account und sein API-Token müsst Ihr in Eurer Paperless-Instanz einrichten. Ohne diese Konfiguration ist die Anbindung standardmäßig gesperrt.

## 1. Dienstkonto sicher anlegen

1. Mit dem Paperless-ngx-Administrator anmelden, **Einstellungen → Benutzer und Gruppen** öffnen.
2. Einen **normalen Nicht-Administrator-Benutzer** `hom-archiv` anlegen (kein Superuser, kein Staff).
3. Gruppe `HOM-Belege` anlegen und `hom-archiv` hinzufügen.
4. Nur die für das Lesen notwendigen **globalen Leseberechtigungen** für Dokumente und gegebenenfalls Tags erteilen. Keine Schreib-/Änderungs-/Löschberechtigungen, keine Benutzer- oder Workflow-Verwaltung.
5. Tags `HOM-Freigabe`, `Gas`, `Strom`, `Wasser`, `Abwasser` und die tatsächlich benötigten Hauskosten-Kategorien anlegen bzw. vorhandene Tags verwenden.
6. **Nur ausgewählten Hauskosten-Dokumenten** direkt **Dokumenten-Ansichtsrechte** für `HOM-Belege` zuweisen und gleichzeitig den Tag `HOM-Freigabe` und mindestens einen erlaubten Kategorie-Tag hinzufügen.
7. **Private Dokumente** dürfen keine Ansichtsrechte für `HOM-Belege` oder den Dienstbenutzer haben. Lohnabrechnungen und Personalunterlagen auch nicht versehentlich über einen gemeinsamen Ordner oder Standardworkflow freigeben.
8. Das Dienstkonto in Paperless unter **Mein Profil** mit einem eigenen API-Token ausstatten. Ausschließlich dieses Token für HOM verwenden.

**Die Tag-Berechtigung allein gibt keine Dokumentenrechte.** Paperless trennt die Berechtigung zum Anzeigen eines Tags von der Berechtigung zum Anzeigen des Dokuments. Außerdem können in Paperless Dokumente **ohne Eigentümer** für andere Benutzer sichtbar sein, wenn keine passenden Zugriffsregeln greifen. Prüft daher die tatsächlichen Dokument-Ansichtsrechte und die Eigentümer-/Workflow-Standardeinstellungen. Setzt private Dokumente auf einen zuständigen Eigentümer und gebt sie nicht für das Dienstkonto frei.

Technische Referenzen:
- https://docs.paperless-ngx.com/usage/#permissions
- https://docs.paperless-ngx.com/api/

## 2. Dokumenten- und Tag-IDs ermitteln

Die **numerische ID** des Tags `HOM-Freigabe` und die numerischen IDs der Kategorien werden für die serverseitige Filterung benötigt. Im Paperless-API-Browser unter `/api/schema/view/` oder unter `/api/tags/` lassen sich die Werte ermitteln.

Beispiel: Freigabe-Tag-ID `99`, Kategorien `3` (Gas), `4` (Strom), `5` (Wasser). **Das sind erfundene Beispiel-IDs**, keine fertigen Werte für Eure Installation.

Eine Dokument-ID für einen **ausdrücklich nicht freigegebenen** privaten Beleg benötigt Ihr zum Negativtest. Diese ID wird beim Test weder als Verknüpfung gespeichert noch im Browser als Dokument angezeigt.

## 3. UGREEN Docker konfigurieren

Vorher Volume `hom_data` sichern, keine Volumes löschen.

In der **lokalen** UGREEN-Projekt-`.env` (nicht in GitHub) ergänzen:

```dotenv
HOM_PAPERLESS_URL=http://<PAPERLESS-IP-IM-LAN>:<PORT>
HOM_PAPERLESS_TOKEN=<TOKEN-VON-hom-archiv>
HOM_PAPERLESS_RELEASE_TAG_ID=<ID-HOM-FREIGABE>
HOM_PAPERLESS_CATEGORY_TAG_IDS=<ID-GAS>,<ID-STROM>,<ID-WASSER>
```

Die Beispiel-Platzhalter müssen mit Euren echten lokalen Daten ersetzt werden. Alternativ eine per HTTPS erreichbare Paperless-Adresse verwenden. Ohne HTTPS ist nur eine interne LAN-/Docker-Adresse erlaubt. HOM sendet das Token niemals an fremde Dokumenten-URLs.

In der **bestehenden** UGREEN-Docker-Projekt-YAML die vier optionalen Umgebungsvariablen im Service `app` ergänzen – oder die aktualisierte [compose-ugreen-login.yaml](compose-ugreen-login.yaml) übernehmen. Alle existierenden Werte, insbesondere `HOM_PASSWORD_HASH`, Domains und Volumes, beibehalten. Image `ghcr.io/kesselbuettner-dot/hom:latest` aktualisieren und vorhandenes Projekt neu bereitstellen.

## 4. Zugriffsrechte verpflichtend prüfen

1. Als HOM-Administrator unter **System → Hauseinstellungen → Dokumentenarchiv** auf **Verbindung prüfen** klicken.
2. Die bekannte **Dokument-ID eines privaten, nicht für HOM freigegebenen Dokuments** im Feld für den Negativtest eingeben.
3. Auf **Privatzugriff testen** klicken.
4. **Nur** wenn der Test mit `Erfolgreich: HOM-Archivbenutzer kann dieses private Dokument nicht abrufen` endet, schaltet HOM die Archivsuche frei. **Bis dahin sind Suche, Vorschau und Verknüpfungen serverseitig gesperrt.** Ein `UNSICHER` bedeutet: Der Paperless-Dienstbenutzer kann das private Dokument lesen! Seine Rechte sofort korrigieren; HOM sperrt dann auch zuvor freigegebene Archivzugriffe.

Der Negativtest fragt die Dokumentberechtigung direkt bei Paperless ab und gibt nur `denied` aus, nie den Dokumenteninhalt. Die erfolgreiche Freigabe wird in HOM für die aktuelle Kombination aus Paperless-Adresse, Dienst-Token und Tags gespeichert. **Bei einer Änderung dieser Werte ist der Negativtest erneut verpflichtend.** Verwendet eine nachweislich existierende private Dokument-ID; eine erfundene ID beweist keine ausreichende Berechtigungstrennung.

## 5. Dokument in HOM auswählen

Unter **Rechnungen** oder **Tarife & Verträge** einen Eintrag anlegen oder bearbeiten. Über **Dokument aus Paperless wählen** nach einem freigegebenen Beleg suchen. HOM liefert nur Dokumente zurück, die **beide** Prüfungen bestehen:

- Tag `HOM-Freigabe`
- mindestens einer der freigegebenen Hauskosten-Tags

Zusätzlich muss das technische Paperless-Konto das Dokument über die **Paperless-Dokumentberechtigungen** sehen dürfen. HOM prüft diese Bedingungen sowohl bei der Auswahl als auch **vor jedem Vorschauabruf** erneut. Werden Rechte oder Tags später entzogen, ist die Vorschau in HOM gesperrt.

Das ausgewählte Dokument wird nur über seine ID verknüpft. Bestehende lokale PDF-Anhänge bleiben unabhängig davon erhalten. Über **Verknüpfung entfernen** wird nur der HOM-Verweis gelöscht, nicht das Original im Archiv.

## Grenzen der aktuellen Version

- Keine Anmeldung mit dem persönlichen Paperless-Admin-Token.
- Keine Papermerge-Verbindung, keine automatische Synchronisation, kein automatischer Upload.
- Keine OCR-Inhaltsübernahme oder automatische Buchung: Eingaben in HOM werden weiterhin von Euch bestätigt.
- Keine Exposition von Token, OCR-Inhalt oder Original-Archiv-URL im Browser.
- Die JSON-Backups von HOM enthalten Dokument-IDs, aber **nicht die Dokumentdateien**; Paperless muss separat gesichert werden.
- Andere HOM-Benutzer mit Zugriff auf Hauskosten können freigegebene Hauskosten-Dokumente über HOM ansehen. Das technische Paperless-Konto bleibt auf diese Freigaben beschränkt.
- Ein tagbasierter Filter ist **kein Ersatz** für die objektbezogenen Paperless-Leserechte.
