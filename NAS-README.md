# HOM auf UGREEN DXP2800 – privates GitHub-Image (latest)

## Was wird installiert?
- GitHub Repository: https://github.com/kesselbuettner-dot/HOM (privat)
- Docker Image: `ghcr.io/kesselbuettner-dot/hom:latest`
- Zugriffsadresse im LAN: `https://villa-kunterbunt.net:8443`
- Login für alle Berechtigten: `hom`, gemeinsames selbst gewähltes Passwort
- Datenbank und PDF-Anhänge: dauerhaft in Docker-Volume `hom_data`
- Kein Internet-Portforwarding; keine Cloud-Anbindung zur Laufzeit außer für Image-Updates

**GitHub Actions** unter `.github/workflows/docker-publish.yml` testet bei jedem Push auf `main` und baut danach das Image mit den Tags `latest` und `sha-...`. Unter **GitHub → Actions** zunächst prüfen, ob der erste Build erfolgreich war und unter **Packages** ein privates Image `hom` erscheint. Vorher kann die NAS es nicht herunterladen.

## 1. Für das private GHCR-Image anmelden
Die NAS muss sich bei GHCR anmelden, weil das Image privat bleiben soll.

1. Auf https://github.com/settings/tokens einen **personal access token (classic)** mit Berechtigung **read:packages** erstellen. Keine Schreibrechte oder Repository-Scopes hinzufügen, sofern nicht ausdrücklich erforderlich.
2. Token nicht in die Compose-Datei oder in GitHub übertragen.
3. Auf der NAS per SSH als berechtigter Benutzer ausführen:
   ```sh
   sudo docker login ghcr.io -u kesselbuettner-dot
   ```
   Auf die Passwortabfrage **den Token** eingeben, nicht das GitHub-Passwort.
4. Alternativ – falls die UGREEN-Docker-App eigene Registry-Anmeldungen anbietet – das Konto dort mit dem Token eintragen. Beachten: Ein CLI-Login des Root-Nutzers wird unter Umständen nicht vom GUI-Projekt übernommen. Bei Pull-Fehlern daher die Compose-Befehle über SSH ausführen.

Das Token ist vertraulich. Bei kompromittiertem Token sofort widerrufen.

## 2. HTTPS-Passwort vorbereiten
Ein einzigartiges Passwort wählen (mindestens 16 Zeichen). Der Benutzername der Website lautet `hom`.

Auf der NAS per SSH:
```sh
sudo docker run --rm -it caddy:2-alpine caddy hash-password
```
Den ausgegebenen Hash kopieren (das Passwort selbst nirgendwo in YAML/Repository eintragen).

Projektordner auf NAS erstellen, z. B. `Docker/HOM`. Dort eine Datei `.env` anlegen:
```dotenv
HOM_PASSWORD_HASH='$2a$HIER-DEN-VOLLSTAENDIGEN-BCRYPT-HASH-EINSETZEN'
```
Der Text ist ein Platzhalter. Verwende den echten Hash in einfachen Anführungszeichen. `.env` niemals committen.

## 3. Projekt erstellen – nur YAML im UGREEN-Editor
1. UGOS Pro → **Docker → Projekt → Erstellen**.
2. Projektname `hom`, Projektordner `Docker/HOM` (mit `.env`).
3. Inhalt der Datei [compose-ugreen.yaml](compose-ugreen.yaml) in den YAML-Editor kopieren.
4. Bereitstellen. Es müssen die Container `app` und `gateway` laufen.

**Kompatibilität:** `compose-ugreen.yaml` nutzt `configs.content` zum Einbetten des Caddy-Login-Setups. Das verlangt Docker Compose >= 2.23.1. Falls die Docker-App diese Syntax nicht unterstützt, stattdessen [compose.yaml](compose.yaml) benutzen und die Datei [Caddyfile](Caddyfile) in denselben NAS-Projektordner legen. Beide beziehen die App aus `ghcr.io/kesselbuettner-dot/hom:latest`; der Quellcode muss dafür nicht auf das NAS.

Per SSH zum Prüfen (Ordnerpfad an NAS anpassen):
```sh
cd /ABSOLUTER/NAS-PFAD/Docker/HOM
sudo docker compose -f compose-ugreen.yaml config --quiet
sudo docker compose -f compose-ugreen.yaml up -d
sudo docker compose -f compose-ugreen.yaml ps
```
Falls die YAML nur im UGREEN-Projekt gespeichert ist, deren tatsächlich angelegten Compose-Dateinamen verwenden.

## 4. DNS und HTTPS
Im UniFi Gateway einen **lokalen A-Record** `villa-kunterbunt.net` auf die IP-Adresse der **UGREEN NAS** setzen. Keine öffentliche Weiterleitung von Port 8443. Browser im Heimnetz: `https://villa-kunterbunt.net:8443`. Login `hom`.

Caddy erzeugt ein **lokales Zertifikat** (`tls internal`). Damit der Browser ohne Warnung vertraut, das Caddy-Root-Zertifikat aus dem persistenten Caddy-Datenvolume sicher auf den gewählten Endgeräten installieren. Keine Zertifikatswarnung dauerhaft wegklicken.

## 5. Update aus GitHub latest
Jeder Push auf `main` baut nach erfolgreichen Tests ein neues Image und markiert es als `latest`. Ein laufender Container wird durch den Tag `latest` **nicht automatisch aktualisiert**.

**In UGOS Pro**: Docker → Container/Projekt → auf Update prüfen → **Aktualisieren** oder bei **Neu bereitstellen** die Option **Das neueste Image abrufen** aktivieren (je nach App-Version).

Alternativ im richtigen Compose-Projektordner per SSH:
```sh
sudo docker compose pull app
sudo docker compose up -d
```
`pull_policy: always` sorgt beim Compose-Bereitstellen für das Abfragen der aktuellen Image-Version. Kein Watchtower erforderlich. Das Image sollte erst nach erfolgreichen Tests und vorzugsweise nach einem Backup eingespielt werden. Automatische zeitgesteuerte Aktualisierung kann später als separater, eingeschränkter Job ergänzt werden.

## 6. Daten / SMB / Backup
- Aktive SQLite-Datenbank ausschließlich im lokalen NAS-Dateisystem / Docker-Volume `hom_data` halten – **nicht über SMB mounten**.
- Hochgeladene Rechnungs-PDFs liegen standardmäßig unter `/app/data/attachments` innerhalb dieses persistenten Volumes.
- Für SMB-Rechnungszugriff optional einen *separaten NAS-Ordner* an `/app/data/attachments` binden; vorher echten Pfad und Rechte prüfen. Nicht beim laufenden Betrieb unbedacht umstellen.
- Vor Datenbankänderungen oder Updates vollständiges JSON-Backup in der App exportieren (enthält vertrauliche PDFs!) und gesicherte Volume-Kopie erstellen.
- Bei `docker compose down` KEIN `-v` angeben, sonst könnten die Datenvolumes entfernt werden.
- Gemeinsame Zugangsdaten bieten **keine** Zuordnung, wer eine Rechnung oder einen Zählerstand verändert hat; alle Nutzer haben die gleichen Rechte.

## 7. Sicherheits- und Fachgrenzen
Nicht öffentlich im Internet freigeben. Das Gateway ist der einzige veröffentlichte Port; die App selbst ist nur im internen Docker-Netz erreichbar. Für die inhaltlichen Einschränkungen (Heizkostenverordnung, Bewohnerwechsel, Rechnungen über mehrere Jahre) siehe [README.md](README.md). Der Docker-Betrieb auf Eurer konkreten DXP2800 ist erst nach der ersten Installation verifiziert.
