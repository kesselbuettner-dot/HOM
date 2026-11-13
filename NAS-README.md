# Hauskosten-Manager auf UGREEN DXP2800 (UGOS Pro)

## Sicherheit und Betriebszustand

Diese Fassung ergänzt die Windows-Web-App um ein Dockerfile und ein Caddy-Gateway mit **HTTPS + Passwortschutz**. Die App selbst ist NICHT direkt als NAS-Port veröffentlicht. Standardmäßig sind Datenbank und PDFs in einem persistenten Docker-Volume `hom_data` gespeichert, **nicht im GitHub-Repository**. Das gemeinsame Login `hom` ist noch keine Haushalts-Rollenverwaltung.

**Nicht ins Internet freigeben.** Vor echten Abrechnungen die fachlichen Grenzen in README.md lesen. Der Container wurde in dieser Entwicklungsumgebung nicht auf einer echten DXP2800 gestartet; die vorhandenen Node-Tests wurden ausgeführt.

## 1. GitHub-Quellcode

Private GitHub-Repository-Adresse: https://github.com/kesselbuettner-dot/HOM

ZIP entpacken. Alle Projektdateien in das Repository übernehmen, *außer* `.env`, SQLite-Datenbanken, Backups, PDF-Rechnungen und Zertifikate. `.gitignore` verhindert einige versehentliche Uploads, ersetzt jedoch keine Prüfung vor `git add`.

## 2. NAS-Docker-Projekt

1. UGOS Pro → App Center → Docker installieren.
2. Im NAS-Dateimanager einen Ordner für das Compose-Projekt anlegen, z. B. `Docker/HOM`; Projektdateien dorthin kopieren.
3. Ein starkes, einzigartiges Passwort für den Benutzer `hom` wählen.
4. In einem Terminal mit Docker **interaktiv** einen bcrypt-Hash erzeugen (das Passwort wird nicht als Kommandozeilenargument übergeben):

   ```sh
   docker run --rm -it caddy:2-alpine caddy hash-password
   ```

   Das Passwort am Prompt eingeben, den ausgegebenen Hash kopieren.
5. `.env.example` in `.env` kopieren und in der Zeile `HOM_PASSWORD_HASH=` den kompletten Hash einsetzen. Falls der Hash Dollarzeichen enthält, den Hashwert in **einfache Anführungszeichen** setzen; z. B. `HOM_PASSWORD_HASH='$2a$...'`. `.env` niemals zu GitHub hochladen.
6. UGOS Docker → **Projekt → Erstellen**; Compose-Projektdateien im gewählten Ordner verwenden, Build starten. Alternativ bei installiertem Docker Compose aus dem Projektordner:

   ```sh
   docker compose up -d --build
   docker compose ps
   ```

7. NAS-IP ermitteln. Im UniFi Cloud Gateway Fiber einen **lokalen A-Record** `villa-kunterbunt.net` auf die **NAS-IP** setzen. Anfragende Geräte müssen den UniFi-DNS verwenden.
8. Dann im lokalen Netz `https://villa-kunterbunt.net:8443` öffnen und mit Benutzer `hom` und dem gewählten Passwort anmelden.

## 3. HTTPS-Zertifikat

Caddy erstellt mit `tls internal` ein **lokales Zertifikat**. Browser vertrauen dessen interner CA anfänglich nicht. Das CA-Root-Zertifikat liegt im Caddy-Datenvolume unter `/data/caddy/pki/authorities/local/root.crt`. Dieses Zertifikat ausschließlich auf Euren vertrauenswürdigen Endgeräten importieren. Die Zertifikatswarnung nicht dauerhaft ignorieren. Der eigene Domainname muss im Heimnetz auf die NAS-IP auflösen.

`8443` ist absichtlich gewählt, um Konflikte mit dem NAS auf 80/443 zu vermeiden. Eine Adresse ohne Port erfordert anschließend einen entsprechend konfigurierten HTTPS-Reverse-Proxy auf 443. Darauf achten, dass kein ungeschützter Zugriff auf den App-Container möglich wird.

## 4. Datenablage und SMB

In der Standardkonfiguration liegen Datenbank und PDFs im Docker-Volume `hom_data` (`/app/data`). Hiermit startet der Container ohne problematische SMB-Dateisperren. Die **aktive SQLite-Datei niemals auf ein Netzlaufwerk/SMB-Mount legen**.

Für direkten SMB-Zugriff auf Rechnungs-PDFs können die `compose.yaml`-Zeilen für die Bind-Mount-Option nach Anpassung des **tatsächlichen NAS-Pfads** aktiviert werden:

```yaml
- /NAS-ABSOLUTER-PFAD/Hauskosten/Rechnungen:/app/data/attachments
```

Den absoluten Pfad unter UGOS Pro → Dateien → **Speicherpfad kopieren** ermitteln. Vor dem Start sicherstellen, dass der Containerbenutzer `node` (UID 1000) auf dem Zielordner lesen und schreiben darf. Hostseitiges SMB nicht schreibend für andere Benutzer freigeben, wenn Originalrechnungen unverändert bleiben sollen. Die App bietet derzeit keine direkte Dateiexport-Automatik in beliebige SMB-Verzeichnisse; PDF-Abrechnungen werden im Browser als Download erzeugt.

## 5. Backups und Aktualisierung

- In der App den JSON-Backup-Export verwenden; enthält alle Rechnungen inkl. Belege und ist **vertraulich**.
- Zusätzlich das Docker-Volume `hom_data` als konsistente Sicherung kopieren, nachdem die App gestoppt wurde (WAL-Dateien beachten). Nicht nur die laufende SQLite-Hauptdatei allein kopieren.
- Vor Docker-Updates und Datenbankmigrationen Sicherung erstellen.
- Änderungen nur über private Git-Branches/PRs entwickeln, Tests ausführen, danach NAS-App aktualisieren.

## 6. Sicherheitshinweise

- Kein Port-Forwarding am Router, keine Cloudflare-Tunnel-Konfiguration.
- Ein einzelnes Gateway-Passwort schützt die gesamte Anwendung; **es gibt noch keine getrennten Zugriffsrechte pro Haushalt**. Daher vorerst nur für berechtigte Administratoren freigeben.
- Die gewählte Domain gehört im LAN in Euren lokalen DNS. Öffentliche DNS-Einträge sind nicht nötig.
- `HOM_ALLOWED_ORIGINS` in `compose.yaml` muss zur exakten externen URL passen (derzeit `https://villa-kunterbunt.net:8443`).
- Die ursprüngliche App prüft weiterhin den internen Hostnamen `localhost`; Caddy setzt genau diesen Host-Header für das Backend.
