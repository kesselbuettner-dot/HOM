# HOM – sichere Anmeldung und HTTPS auf der DXP2800

## Neue Loginseite (Version 1.1)
Die Anwendung bietet jetzt eine eigene Startseite unter `https://villa-kunterbunt.net/login`. Alle angemeldeten Familienmitglieder haben dieselben Rechte; getrennte Konten oder ein Änderungsprotokoll gibt es weiterhin nicht.

- Benutzer: `hom`.
- Das Passwort bleibt **genau das bisherige**: `HOM_PASSWORD_HASH` in der lokalen `.env` auf der NAS. Es wird nicht ins GitHub-Repository übertragen.
- Der neue Login nutzt denselben bcrypt-Hash wie Caddy zuvor.
- `Angemeldet bleiben` erzeugt ein zufälliges, nicht lesbares Sitzungstoken für **30 Tage**. Ohne Häkchen endet die serverseitige Sitzung spätestens nach 12 Stunden und das Cookie ist ein Browser-Sitzungscookie.
- Im Browser kann man „Passwort speichern“ wählen; das entscheidet der jeweilige Browser-Passwortmanager. Die Web-App selbst speichert kein Klartextpasswort.
- Die Sitzung ist als SHA-256-Hash in der bestehenden SQLite-Datenbank hinterlegt, Cookie `Secure`, `HttpOnly` und `SameSite=Strict`; Abmelden macht sie sofort ungültig.
- Es gibt ein einfaches Login-Versuchslimit; 10 Fehlversuche innerhalb kurzer Zeit sperren die gemeinsame Gateway-Adresse für ca. 5 Minuten.
- Der Backend-Container ist weiterhin nur im internen Docker-Netz erreichbar.

### Upgrade von der alten Caddy-Basic-Auth-Konfiguration

**Zuerst ein vollständiges Backup der HOM-Daten erstellen.** In der UGREEN Docker-App das **bereits vorhandene** Projekt `hom` bearbeiten. NICHT ein zweites Projekt anlegen. Keine Volumes löschen.

Den Inhalt von **[compose-ugreen-login.yaml](compose-ugreen-login.yaml)** als kompletten YAML-Code einsetzen. Dies ist erforderlich, damit:
1. `app` den bestehenden `HOM_PASSWORD_HASH` erhält und die neue Loginseite aktiviert;
2. `gateway` HTTPS bereitstellt, die Browser-Basic-Auth aber **nicht mehr** erzwingt.

Die bestehenden Volumes `hom_data`, `hom_caddy_data` und `hom_caddy_config` behalten. Den YAML-Code mit dem identischen Compose-Projektnamen `hom` erneut bereitstellen. Sicherstellen, dass der neue Container aus `ghcr.io/kesselbuettner-dot/hom:latest` geladen wurde und beide Container gesund laufen. Es ist möglich, dass bei einem unvollständigen Update sonst die alte Browser-Passwortabfrage **zusätzlich** zur neuen Loginseite erscheint.

Testen:
```bash
sudo docker ps --filter name=hom
curl -k -i --noproxy '*' --resolve villa-kunterbunt.net:443:127.0.0.1 https://villa-kunterbunt.net/
```
Erwartet: **HTTP 303** mit `Location: /login`. Danach im Browser `https://villa-kunterbunt.net` öffnen.

## Warum der Browser „Nicht sicher“ meldet

Caddy erzeugt mit `tls internal` ein **lokales Zertifikat**. Die Verbindung ist verschlüsselt, der Browser kennt die ausstellende lokale Zertifizierungsstelle (CA) aber noch nicht. **Das kann kein GitHub-Update auf fremden Browsern automatisch beheben.**

### Lokale CA auf vertrauenswürdigen Geräten installieren

1. Auf der NAS das **öffentliche Root-Zertifikat** exportieren (nur `root.crt`, niemals `root.key`):
   ```bash
   sudo docker cp hom-gateway-1:/data/caddy/pki/authorities/local/root.crt ./hom-root.crt
   ```
2. Die Datei `hom-root.crt` über einen geschützten Weg auf Euren Windows-PC übertragen, zunächst den Zertifikats-Fingerabdruck auf der NAS und dem PC vergleichen:
   ```bash
   openssl x509 -in hom-root.crt -noout -fingerprint -sha256
   ```
3. Unter Windows auf Eurem **eigenen vertrauenswürdigen PC** das Zertifikat als vertrauenswürdige Stammzertifizierungsstelle für den aktuellen Benutzer importieren. PowerShell im Verzeichnis mit der kopierten Datei:
   ```powershell
   certutil -user -addstore Root .\hom-root.crt
   ```
   Dabei können Sicherheitsabfragen erscheinen. Nur durchführen, wenn das Zertifikat tatsächlich von **Eurem eigenen Caddy-Container** stammt und der Fingerabdruck geprüft wurde.
4. Browser neu starten. Firefox nutzt unter Umständen eine eigene Zertifikatsverwaltung; ggf. zusätzlich dort vertrauen. Android/iOS benötigen eine eigene, plattformspezifische CA-Vertrauensstellung.
5. **Vorsicht:** Eine vertrauenswürdige Root-CA darf grundsätzlich TLS-Zertifikate für beliebige Namen ausstellen. Installiert sie nur auf Euren eigenen vertrauenswürdigen Endgeräten und sichert `root.key` im Caddy-Datenvolume besonders gut.

### Dauerhaft ohne lokale CA-Installation auf jedem Gerät

Falls Ihr die Domain `villa-kunterbunt.net` tatsächlich besitzt, ist ein **öffentlich vertrauenswürdiges Let's-Encrypt-Zertifikat über DNS-01-Challenge** die komfortablere Lösung. Dafür benötigen wir den DNS-Anbieter und eine sichere DNS-API-Konfiguration; der Webdienst muss dabei nicht aus dem Internet erreichbar werden. Der aktuelle Docker-Container `caddy:2-alpine` enthält dafür nicht automatisch jedes DNS-Provider-Plugin. Dies ist eine **separate Konfiguration**, noch nicht im Repository aktiv.

Der öffentliche DNS-Eintrag darf nicht zum versehentlichen Öffnen der privaten Hauskosten-App führen. Keine Router-Portfreigabe.

## Prüfen, ob tatsächlich HOM antwortet
```bash
curl -k -i --noproxy '*' --resolve villa-kunterbunt.net:443:127.0.0.1 https://villa-kunterbunt.net/
```
`HTTP 303` zur `/login`-Seite = neue Anmeldung aktiv. `HTTP 401` mit `WWW-Authenticate: Basic` = alter Caddy-Login ist noch aktiv. `HTTP 200` ohne Anmeldung = vor der Familienfreigabe unbedingt die Authentifizierung prüfen.

**Hinweis:** Ob die Browseranzeige „Sicher“ ist, hängt nach dem GitHub-Update weiterhin von der Zertifikats-Vertrauenskette und von der DNS-Auflösung auf dem jeweiligen Gerät ab.
