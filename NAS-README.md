# Hauskosten-Manager (HOM) auf UGREEN DXP2800

**Aktueller Stand:** Version 1.1 mit **eigener Loginseite**, „30 Tage angemeldet bleiben“, Abmeldung und unverändertem gemeinsamen Nutzer `hom`. Familienmitglieder haben nach dem Login **alle dieselben Rechte**. Vor einem Update immer Backup machen.

## Auf der UGREEN installieren oder aktualisieren

1. Sicherung der HOM-Daten (in der App: Backup-Export; zusätzlich Docker-Volume `hom_data`) anlegen.
2. Das bestehende Projekt **hom** unter UGREEN Docker bearbeiten. **Kein zweites Projekt** anlegen und **keine Volumes löschen**.
3. Die komplette YAML aus [compose-ugreen-login.yaml](compose-ugreen-login.yaml) einsetzen. Sie bezieht `ghcr.io/kesselbuettner-dot/hom:latest` und startet Caddy nur noch als HTTPS-Proxy.
4. Die bestehende lokale `.env` mit `HOM_PASSWORD_HASH` **nicht ändern**. Es wird derselbe Hash jetzt im App-Container verwendet. Die Datei muss im Compose-Projektordner liegen.
5. Das Projekt neu bereitstellen und das Image aktualisieren (nach einem erfolgreichen GitHub-Actions-Build).
6. Unter `https://villa-kunterbunt.net` soll nun **eine grafische Anmeldeseite** erscheinen. Nutzer `hom`, bisheriges Passwort. Bei einem Browserdialog ist der alte Caddy-Basic-Auth-Code noch aktiv.

Status per SSH:
```bash
sudo docker ps --filter name=hom
curl -k -i --noproxy '*' --resolve villa-kunterbunt.net:443:127.0.0.1 https://villa-kunterbunt.net/
```
Ohne Anmeldung muss die Antwort `303 See Other` mit `Location: /login` sein.

## HTTPS-Zertifikat ohne Browserwarnung

Bislang verwendet Caddy `tls internal`. Die Verbindung ist damit verschlüsselt, aber Browser vertrauen der lokalen Aussteller-CA nicht automatisch. Der sichere Export des CA-Zertifikats und die Einrichtung unter Windows sind in **[HTTPS-LOGIN.md](HTTPS-LOGIN.md)** beschrieben. Dieses GitHub-Update allein kann die Zertifikatswarnung **nicht** beseitigen. Für eine allgemein vertrauenswürdige Lösung ohne CA-Installation ist später ein öffentliches ACME-Zertifikat über DNS-01 nötig (falls Ihr die Domain kontrolliert). Keine Router-Portfreigabe.

## Dauerhafte Daten und Dateien

- Datenbank und Rechnungen bleiben im persistenten Volume `hom_data`, **nicht in GitHub**.
- Die aktive SQLite-Datenbank nicht über SMB einbinden. Nur Rechnungskopien/Exporte/Backups dürfen über SMB zugänglich sein.
- **Keine** `docker compose down -v`, keine „Volumes entfernen“-Option.
- Der öffentliche Quellcode und das öffentliche Docker-Image enthalten keinerlei reale Hausdaten oder Passwörter, sofern diese nicht manuell hineinkopiert werden.
- Die App ist **nur für das Heimnetz** vorgesehen und ist keine rechtlich geprüfte Nebenkosten-/Heizkostenabrechnungssoftware.

Für Änderungen an der Berechnungslogik und weitere Einschränkungen siehe [README.md](README.md).
