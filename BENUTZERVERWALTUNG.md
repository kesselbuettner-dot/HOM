# HOM – Benutzerverwaltung und Hauseinstellungen

## Umstieg von HOM 1.1

- Beim ersten Start der neuen Version wird die bestehende SQLite-Datenbank **nicht ersetzt**.
- Das bisherige Login `hom` wird automatisch zum **Administrator**. Das aktuelle Passwort aus `HOM_PASSWORD_HASH` bleibt gültig.
- Bereits vorhandene, gültige HOM-Sitzungen werden dem Konto `hom` zugeordnet.
- Die Migration ist wiederholbar und lässt alle erfassten Haushalte, Rechnungen und Zählerstände unangetastet.
- Die bisherige `.env` auf der UGREEN bleibt bestehen. Das öffentliche GitHub-Repository darf **keine** Passwörter oder realen Verbrauchsdaten enthalten.

## Rechte

| Funktion | Administrator | Mitglied |
| --- | --- | --- |
| Zähler, Rechnungen, Abrechnungen, Tarife, Abschläge und Exporte | Ja | Ja |
| Benutzer anlegen, aktivieren, deaktivieren, Rolle ändern, Passwort neu vergeben | Ja | Nein |
| Haustitel unter **System → Hauseinstellungen** ändern | Ja | Nein |
| Eigenes Passwort unter **System → Mein Konto** ändern | Ja | Ja |

Die Rechte werden **am Server geprüft** (nicht nur durch das Ausblenden der Navigation).

## Benutzer anlegen

1. Als `hom` anmelden.
2. **System → Benutzerverwaltung** öffnen.
3. Benutzername (3–32 Zeichen, klein geschrieben), Anzeigename, Rolle und Startpasswort (mindestens 10 Zeichen) festlegen.
4. **Benutzer anlegen** wählen.
5. Anmeldedaten dem Familienmitglied sicher mitteilen. Es kann sein Passwort anschließend unter **Mein Konto** ändern.

Unter **Bearbeiten** könnt Ihr Konten deaktivieren, Rollen ändern und ein neues Passwort vergeben. Ein zurückgesetztes Passwort beendet die bestehenden Sitzungen dieses Kontos. Der letzte aktive Administrator kann nicht deaktiviert oder zum Mitglied herabgestuft werden.

## Hausbezeichnung ändern

Als Administrator **System → Hauseinstellungen** öffnen, neuen Titel eintragen und **Haustitel speichern** anklicken. Der Titel erscheint auf der Loginseite, in der Seitenleiste, im Browser-Titel, in der Dashboard-Überschrift und in neu erstellten PDF-Berichten. Der Wert wird dauerhaft in der bestehenden SQLite-Datenbank gespeichert.

## Sicherheit

- Passwort-Hashes: bcrypt (mindestens 10 Zeichen bei neuen Passwörtern).
- Sitzungstokens werden zufällig erzeugt und nur gehasht in SQLite gespeichert.
- Browser-Cookies: `HttpOnly`, `Secure`, `SameSite=Strict`; optional 30 Tage angemeldet bleiben.
- Nur lokal im Heimnetz, über Caddy mit HTTPS und ohne öffentlichen Router-Port.
- Die App unterstützt **keine Registrierung ohne Administrator**, keine anonyme Benutzeranlage.
- `HOM_PASSWORD_HASH` initialisiert lediglich den ersten Admin. Wird dessen Passwort später geändert, bleibt der neue Hash in SQLite erhalten. Das Entfernen des Docker-Volumes `hom_data` würde Konten **und Hausdaten** löschen.

## Installation und Update auf UGREEN DXP2800

1. Vorher Backup der Anwendung und des Volumes `hom_data` sichern.
2. GitHub Actions muss nach dem Merge auf `main` das Image `ghcr.io/kesselbuettner-dot/hom:latest` erfolgreich veröffentlichen.
3. Das **bestehende** UGREEN-Docker-Projekt `hom` aktualisieren, keine neuen Volumes erstellen und **keine Volumes löschen**.
4. Die YAML-Datei [compose-ugreen-login.yaml](compose-ugreen-login.yaml) beibehalten, die bereits den Hash an den App-Container weiterreicht.
5. Image `latest` neu abrufen und Projekt neu bereitstellen.
6. Unter `https://villa-kunterbunt.net` weiterhin mit `hom` anmelden und danach neue Benutzer einrichten.

## Backups

Der HAUSKOSTEN-Datenexport (JSON) sichert aktuell die fachlichen Hausdaten und PDF-Anhänge, **nicht die Benutzerkonten, Passwörter, Sessions oder Hauseinstellungen**. Ein konsistentes vollständiges NAS-Backup muss daher zusätzlich das persistente Docker-Volume `hom_data` enthalten.

Nur über lokale, überprüfte Sicherungen wiederherstellen. Die aktive SQLite-Datenbank nicht über SMB öffnen oder bearbeiten.
