# Lokale SQLite-Backups (Issue #18)

Die Sicherung verwendet **keine Cloud, keine API-Keys und keine kostenpflichtigen Dienste**. Sie funktioniert mit vorhandenen lokalen Laufwerken und Node.js-/Windows-Bordmitteln.

## Konfiguration

In der `.env` im Projektverzeichnis (optional):

```dotenv
# Unbedingt eine bereits vorhandene zweite Festplatte oder einen USB-Stick bevorzugen.
BACKUP_DIR=D:\TradingBackups
BACKUP_ENABLED=true
BACKUP_SCHEDULE=03:30
BACKUP_INCLUDE_ARCHIVE=false
BACKUP_RETENTION_DAILY=7
BACKUP_RETENTION_WEEKLY=4
BACKUP_RETENTION_MONTHLY=6
```

Ohne `BACKUP_DIR` ist das Ziel `data/backups/`. **Backups auf derselben Festplatte schützen nicht vor einem Plattenausfall.** Der Zielordner ist lokal; Cloud-Sync-Ordner sind ausdrücklich nicht vorgesehen. `BACKUP_ENABLED=false` schaltet nur den Paper-Server-Timer aus, **nicht** das verpflichtende Backup vor `pnpm reset`.

## Was gesichert wird

Alle `*.db` unter `data/` ausser erneut herunterladbaren `archive/raw/`-Rohdaten (bei `BACKUP_INCLUDE_ARCHIVE=false`), einschliesslich `data/recordings/*.db` (unersetzliche Live-Aufzeichnungen), Paper- und Live-Journale sowie Archiv-Datenbanken. Weitere reguläre Dateien wie `holdout-access.log`, `heartbeat.json`, `report.json` und `*.CHECKSUM` werden berücksichtigt. Laufende SQLite-Sidecars (`-wal`, `-shm`, `-journal`), Prozess-Locks und bereits beiseitegelegte Restore-Versionen sind keine eigenständigen Backup-Dateien. Symbolische Links unter `data/` führen aus Sicherheitsgründen zum Abbruch.

Standardmässig werden grosse, kostenlos erneut ladbare Rohdaten unter `data/archive/raw/` **ausgenommen**, mit Ausnahme von `*.CHECKSUM` und `report.json`. Mit `BACKUP_INCLUDE_ARCHIVE=true` werden auch Rohdateien gesichert. Rekorder-Datenbanken sind unabhängig von dieser Option **immer** enthalten.

SQLite-Kopien entstehen über die Online-Backup-API `better-sqlite3.backup()`, **nicht** durch Kopieren der laufenden Datenbankdatei. Jede Datenbankkopie durchläuft `PRAGMA integrity_check`. Das Manifest `manifest.json` dokumentiert relative Dateinamen, Grössen, SHA256, UTC-Zeit, Git-Commit (wenn verfügbar) und SQLite-Integrität. Zwischenstände liegen in `.pending-*` und werden erst nach Fertigstellung umbenannt; bei Platzmangel erfolgt ein Abbruch mit Fehlermeldung. Vor Beginn muss mindestens etwa die doppelte Quellgrösse plus 64 MiB frei sein.

## Befehle

Vom Projektverzeichnis aus:

```powershell
pnpm backup:run
pnpm backup:list
pnpm backup:verify
pnpm backup:verify --id 2026-11-05_0330
```

Backups liegen in `BACKUP_DIR/YYYY-MM-DD_HHMM/`. Innerhalb derselben Minute wird eine bereits vorhandene ID niemals überschrieben; ein zweiter Durchlauf bricht ab. `list` zeigt den Manifest-Status und die Gesamtgrösse; **`verify`** prüft zusätzlich erneut alle SHA256 und SQLite-Integritätschecks. Fehler liefern einen fehlgeschlagenen Exit-Code.

Erfolgreiche Backups lösen die Aufbewahrung aus: **7 tägliche, 4 wöchentliche, 6 monatliche** (konfigurierbar). Die Zeiträume werden nach unterschiedlichen Tagen/ISO-Wochen/Monaten gruppiert. Entfernt werden ausschliesslich **erkannte, überprüfte Backup-Kopien** im Backup-Ziel, niemals aktive Daten aus `data/`. Das neueste erfolgreich überprüfte Backup bleibt auch bei Aufbewahrung 0 erhalten. Defekte oder nicht zuordenbare Backup-Verzeichnisse werden nicht automatisch gelöscht.

## Täglich um 03:30 Uhr

Ein laufender Paper-Server startet mit `startBackupScheduler()` einen Timer zur **Ortszeit des Computers**. Ohne laufenden Server ist die Windows-Aufgabenplanung die kostenlose Alternative:

1. `where.exe pnpm` in PowerShell ausführen und den vollständigen Pfad zur `pnpm.cmd` ermitteln.
2. **Aufgabenplanung** öffnen → **Aufgabe erstellen** → Trigger **Täglich 03:30** (optional „Aufgabe so schnell wie möglich nach einem verpassten Start ausführen“).
3. **Aktion:** „Programm starten“; *Programm/Skript*: vollständiger Pfad zu `pnpm.cmd`; *Argumente*: `backup:run`; *Starten in*: vollständiger Pfad zum Trading-Projekt.
4. Konto mit Zugriff auf das lokale Ziellaufwerk wählen. Aufgabe manuell testen, danach `pnpm backup:list` und `pnpm backup:verify` ausführen. Keine Cloud-Freigabe oder Online-Dienste aktivieren.

**Nur einen** täglichen Auslöser verwenden: Paper-Server-Timer oder Aufgabenplanung. Bei bereits belegter Minuten-ID schlägt der zweite Lauf sicher fehl und überschreibt nichts. Der Rechner und das Backup-Laufwerk müssen zur Ausführungszeit verfügbar sein.

## Sichere Wiederherstellung

1. **Paper-Server, Recorder und Live-Runner vollständig stoppen.** Der Restore prüft `*.lock` unter `data/` und bricht bei aktivem oder nicht interpretierbarem Lock ab. Er kann nicht garantieren, dass ein Prozess ohne Lock-Datei beendet wurde: diesen Schritt zwingend manuell prüfen.
2. Alle vorhandenen `*.db-wal`, `*.db-shm` und `*.db-journal` der betroffenen Datenbanken prüfen. Ein Restore wird abgebrochen, solange eine solche Sidecar-Datei vorhanden ist; keine Sidecars im laufenden Betrieb löschen.
3. Sicherung verifizieren und entweder komplett oder gezielt wiederherstellen:

```powershell
pnpm backup:verify --id 2026-11-05_0330
pnpm backup:restore --id 2026-11-05_0330 --file paper.db
# Ohne --file: alle Dateien des Snapshots wiederherstellen.
pnpm backup:restore --id 2026-11-05_0330
# Nur bei bewusst gewollter Live-Journal-Rücksetzung:
pnpm backup:restore --id 2026-11-05_0330 --file live-usdt-abcdef.db --i-understand-live-journal
```

`--file` akzeptiert einen Datenbankpfad relativ zu `data/` (z. B. `recordings/market-2026-11.db`). Bei Live-/Testnet-Journalen ist `--i-understand-live-journal` zusätzlich verpflichtend. **Alte Live-Orderzustände können falsch sein**: vor einer Wiederaufnahme Börsen-/Orderstatus manuell abgleichen und keine ungeprüfte Orderwiederholung auslösen.

Die vorhandene Zieldatei wird vor dem Einsetzen des geprüften Backups in `*.before-restore-<zeit>-<uuid>` **umbenannt und behalten**; die gesicherte Version bleibt verfügbar. Bei einer Fehlermeldung während eines Mehrdatei-Restores sind bereits wiederhergestellte Dateien und die Beiseitekopien einzeln zu prüfen. Nichts wird stillschweigend überschrieben.

## Reset

`pnpm reset` und `pnpm reset -- --full` verlangen **vor** der ersten Löschtransaktion einen erfolgreichen, überprüften Snapshot. Ein fehlgeschlagenes Backup stoppt den Reset; die Datenbank wird dann nicht per Reset verändert.

## Prüfung

Die Backup-Tests `apps/server/test/backup-*.test.ts` arbeiten ausschliesslich in eindeutig gekennzeichneten temporären Verzeichnissen des Betriebssystems. Sie rufen weder Binance noch eine andere API auf. Für die vollständige Projektprüfung: `pnpm verify`.
