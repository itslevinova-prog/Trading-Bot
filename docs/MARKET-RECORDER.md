# Market Recorder (Issue #17)

Standalone, kostenloser Binance-Spot-Recorder. Er verwendet **nur öffentliche** REST-Endpunkte von `data-api.binance.vision`, die öffentlichen WebSocket-Marktdaten auf `data-stream.binance.vision` und lokale SQLite-Dateien. Keine API-Keys, Orders, Abos, VPS, Cloud-Datenbank oder Anbindung an die Paper-Datenbank.

## Start und Stopp auf Windows (PowerShell)

Voraussetzung: Node.js und pnpm gemäss `package.json`; Repository lokal ausgecheckt und Abhängigkeiten mit `pnpm install --frozen-lockfile` installiert.

```powershell
Set-Location 'C:\Pfad\zu\Trading'
pnpm record:market
```

Zum **sauberen Stoppen Ctrl+C** in diesem Terminal drücken. Der Recorder schreibt den letzten Batch, schliesst die SQLite-Datei und entfernt `data/recordings/.lock`. Ein zweiter Start wird durch die Prozesssperre abgelehnt. Nach einem ungeplanten Absturz wird eine Sperre nur übernommen, wenn die alte Prozess-ID nachweislich nicht mehr existiert.

Der Recorder benötigt **keinen** gestarteten Paper-Server. Er macht keine privaten Binance-Abfragen und handelt nicht.

## Kostenloser Windows-Autostart (Aufgabenplanung)

Die folgenden Befehle einmal in PowerShell ausführen (Repository-Pfad anpassen). Die eingebaute Windows-Aufgabenplanung verwendet den angemeldeten Benutzer und benötigt keinen Cloud-Dienst:

```powershell
$repo = 'C:\Pfad\zu\Trading'
$pnpm = (Get-Command pnpm.cmd).Source
$action = New-ScheduledTaskAction -Execute $pnpm -Argument 'record:market' -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Trading Market Recorder' -Action $action -Trigger $trigger -Settings $settings -Description 'Public Binance market capture (local only)'
Start-ScheduledTask -TaskName 'Trading Market Recorder'
```

Status: `Get-ScheduledTask -TaskName 'Trading Market Recorder'`. Automatischen Start entfernen: `Unregister-ScheduledTask -TaskName 'Trading Market Recorder' -Confirm:$false`. **Achtung:** `Stop-ScheduledTask` beendet unter Windows gegebenenfalls ohne Ctrl+C bzw. finalen Batch; für einen sauberen Stopp lieber direkt in PowerShell starten und Ctrl+C drücken. Durch die 2-s-Batches ist ein möglicher Verlust bei abruptem Prozessende zeitlich begrenzt, aber nicht ausgeschlossen.

**Windows-Energieeinstellungen:** Automatischen Ruhezustand und gegebenenfalls Standby im Netzbetrieb ausschalten. Rechner und Internetverbindung müssen durchgehend laufen. Geplanter Rechner-Neustart oder Windows-Update erzeugt echte Messlücken.

## Konfiguration

Optional vor `pnpm record:market` in PowerShell mit `$env:VARIABLE='Wert'` setzen:

| Variable | Standard | Zweck |
|---|---|---|
| `RECORD_TOP_N` | `20` | Liquideste Basismärkte nach öffentlichem USDT-24h-Quote-Volumen |
| `RECORD_PAIRS` | leer | Manuelle kommaseparierte Paare, z. B. `BTC/USDT,BTC/USDC,BTC/EUR`; Exchange-Symbolvalidierung weiterhin erforderlich |
| `RECORD_SNAPSHOT_MS` | `5000` | Abstand gespeicherter Top-of-Book-Snapshots |
| `RECORD_STALE_MS` | `15000` | Maximales Alter einer gültigen Depth-Meldung |
| `RECORD_FLUSH_MS` | `2000` | Batch-Schreibintervall |
| `RECORD_TRADES` | `all` | `all`, `top10` (nur Trades der 10 liquidesten USDT-Basen in allen verfügbaren Quotes) oder `off` |
| `RECORD_MIN_FREE_GB` | `5` | Bei weniger freiem Plattenplatz pausieren (GiB) |
| `RECORD_SOCKET_PAIRS` | `30` | Paare pro WebSocket-Verbindung |

**Universum:** Die 20 liquidesten USDT-Basis-Coins werden gewählt, anschliessend soweit verfügbar zu USDT, USDC und EUR erweitert (max. 60 Paare). Das sind **dieselben Basen** in allen Quotes, nicht drei getrennte Top-20-Listen. Neue Listings und Rankings werden bei einem Neustart neu ermittelt; bereits gespeicherte Daten werden nicht nachträglich verändert. `market/pinned-universe.ts` übernimmt die bestehende öffentliche USDT-Ranking-Logik; `market/binance-data.ts` liefert öffentlichen REST-Zugriff und den validierenden Partial-Book-Parser. Der Paper-Server selbst bleibt unverändert.

## Daten und Qualität

Dateien: `data/recordings/market-YYYY-MM.db` (UTC, SQLite WAL) plus SQLite-WAL/SHM-Nebendateien. In `.gitignore` ist `data/*` bereits ausgeschlossen. Tabellen:

- `book_snapshots`: `ts` (Unix-ms), `symbol` als `BTC/USDT`, `bid`, `bid_qty`, `ask`, `ask_qty`, `spread_bps`, `depth_bid_10bps`, `depth_ask_10bps`, `depth_bid_25bps`, `depth_ask_25bps`. Die Spalten entsprechen den Feldern `bidQty`, `askQty`, `spreadBps`, `depthBid10bps` usw. des TypeScript-Readers.
- `agg_trades`: `ts`, `symbol`, `agg_id`, `price`, `qty`, `is_buyer_maker`; doppelte `symbol + agg_id` werden ignoriert.
- `events`: Zeitpunkt, Paar, `connect`, `disconnect`, `reconnect`, `gap_start`, `gap_end`, `stale_book`, `sequence_error`, `storage_paused`, `storage_resumed` oder `queue_overflow`.
- `meta`: `format`, `started_at`, `universe`, `snapshot_ms`.

Die Tiefe wird als **Preis × Basismenge in Quote-Währung** über die sichtbaren Level bis 10 bzw. 25 Basispunkte vom besten Bid/Ask berechnet. `spreadBps=(ask-bid)/((ask+bid)/2)*10000`. Leere, gekreuzte, ungültige oder zu alte Bücher werden **nicht** als gültige Snapshots ausgegeben.

**Grenze der Aussagekraft:** Binance `@depth20@100ms` liefert ganze Top-20-Ansichten mit `lastUpdateId`, keine lückenlose Diff-Depth-Folge. Deshalb kann der Recorder Regressionsfehler, Unterbrechungen, Staleness und Lücken erkennen, aber **nicht jeden übersprungenen Buch-Update beweisen**. Tiefe ausserhalb der sichtbaren 20 Level wird nicht geschätzt; die 10/25bps-Tiefe ist nur die sichtbare und kann zu klein sein. Nach Verbindungsabbruch wird **nie** das alte Buch weiterverwendet. Jede Verbindung wird vor dem 24-Stunden-Limit (nach 23h50m) neu geöffnet, mit Backoff (max. 60s) und Watchdog.

Bei zu wenig Speicher schreibt der Recorder keine Marktdaten, verwirft seinen noch nicht gespeicherten Batch, protokolliert die Pause/Lücke und versucht periodisch die Wiederaufnahme. Wenn auch das Heartbeat nicht geschrieben werden kann, erscheint eine Warnung im Prozesslog. Bei einem vollen RAM-Batch-Limit werden zusätzliche Trades/Snapshots verworfen und eine Warnung ausgegeben, niemals unendlich in den Speicher gepuffert.

## Betrieb prüfen und Bericht

```powershell
Get-Content .\data\recordings\heartbeat.json
pnpm record:report
pnpm record:report --month 2026-11
```

Das Heartbeat enthält den letzten Update- und erfolgreichen Schreibzeitpunkt (Unix-ms), Status (`recording`, `reconnecting`, `paused_disk`, …), Paaranzahl, Queue-Grösse und letzten WS-Empfang. `record:report` ist **offline**. Für jeden Markt zeigt er gültige 5s-Snapshot-Abdeckung seit Beginn der Monatsaufzeichnung, Lückenereignisse, Trade-Anzahl, Median und P90-Spread. Die Abdeckung bewertet **erwartete Sampling-Slots**, nicht die ununterbrochene Gültigkeit zwischen zwei Aufnahmen; Start-/Endgrenzen sind UTC. Quote-Zusammenfassungen sind die exakten, nach Snapshot-Anzahl gewichteten (gepoolten) Median- und P90-Werte aller Märkte der Quote-Währung. Für grosse Monatsdateien kann diese Sortierung etwas dauern. Er meldet auch SQLite-Dateigrösse inklusive WAL/SHM.

Bibliothek für Issue #2: `apps/server/src/recorder/reader.ts` exportiert `getBookSnapshots(symbol,from,to,dir?,limit?)`, `getSpreadStats(symbol,from,to,dir?)` und `getMonthReport(month,dir?,now?)`. Abfragen verwenden Unix-Millisekunden, `from` inklusiv, `to` exklusiv, ohne Netzwerk oder Paper-DB.

## Grobe Speicherabschätzung

Bei 60 Paaren und je einem Snapshot alle 5s entstehen `60 × 17'280 = 1'036'800` Snapshot-Zeilen/Tag, ca. `31'104'000` bei 30 Tagen. Mit grob **150–300 Byte pro Zeile inkl. SQLite-Indizes** sind das etwa **0.16–0.31 GB/Tag** bzw. **4.7–9.3 GB/Monat**, vor WAL und Trades. Die tatsächliche Zeilengrösse und Komprimierung schwanken.

Trades skalieren viel stärker und sind praktisch nicht seriös pauschal schätzbar: bereits 100 aggregierte Trades/s ergeben 8.64 Mio. Zeilen/Tag. Bei grob 70–140 Byte/Zeile sind das weitere **0.6–1.2 GB/Tag je 100 Trades/s**, in aktiven Märkten möglicherweise erheblich mehr. Mit `RECORD_TRADES=top10` die Anzahl der Trade-Märkte reduzieren, oder `off` wählen, wenn die Platte nicht ausreicht (dann keine Maker-Fill-Tradedaten mehr!). Es fallen keine Datenanbieter-Kosten an; Strom-, Internet- und lokale Datenträgerbelastung bleiben.

## Tests und Grenzen

`apps/server/test/recorder-*.test.ts` nutzt Fixture-Depth/Trade-WebSockets und lokale temporäre SQLite-Dateien; kein Netz erforderlich. `pnpm verify` deckt diese Tests mit ab. Ein echter 10-min-Live-Test ist nur auf einem Rechner mit funktionsfähiger öffentlicher Binance-Verbindung möglich; ohne diese Verbindung muss dies im PR klar angegeben werden.

## Reproduzierbarer Monatswechsel-/Neustart-Replay (#76)

`replayRecorderTrades(symbol, fromMs, toMs, recordingDir)` liest vorhandene Monatsdatenbanken **ausschliesslich read-only**, niemals die Paper-Datenbank. Die Abfrage ist auf 62 Tage begrenzt und sortiert deterministisch nach Exchange-Zeit, lokal dokumentierter Empfangszeit und Aggregate-Trade-ID. Pro `aggId` wird ein bestätigtes Ereignis nur einmal ausgewiesen; Widersprüche über Monatsdateien sowie unmögliche ID-/Zeitabfolgen werden als `conflict` gemeldet.

Neue Trade-Reihen erhalten beim Enqueue die lokale Empfangszeit (`received_at`). Alte bestätigte Zeilen bleiben beim rein additiven Upgrade der Recorder-SQLite-Tabelle unverändert; ohne gespeicherten Empfangszeitpunkt ist die Reihenfolge der Ankunft **unbekannt**, nicht rekonstruiert. Bekannte `gap_start`-/Overflow-Marker, fehlende 5-Sekunden-Snapshot-Slots und nicht vorhandene Monatsdateien ergeben `incomplete`. Es werden weder fehlende Trades synthetisiert noch offene Recorder-Batches als sicher persistiert betrachtet. Der Report enthält einen deterministischen SHA-256-Fingerprint, aber keinen Profitabilitäts- oder Vollständigkeitsnachweis ausserhalb der tatsächlich beobachteten Zeitfenster.

Die Prüfung des Neustarts, eines simuliert unterbrochenen Flushs und doppelter `aggId`-Lieferungen erfolgt mit temporären SQLite-Dateien in `recorder-restart-replay.test.ts` – ohne Netzwerk, Echtgeld, neue externe Dienste oder Löschung vorhandener Daten.

## Mindestabdeckung für Kosten-Evidenz (#69)

Die beobachteten Median-/P90-Werte sind **deskriptive Verteilungen**, keine belastbare Freigabe von Ausführungskosten. Ein Monatsbericht hat `coverageStatus=sufficient` nur, wenn **mindestens 20 Märkte in mindestens zwei Quote-Währungen** erfasst sind und **jeder** aufgeführte Markt die festgeschriebenen Anforderungen `recorder-cost-coverage-v1` erfüllt:

- Mindestens 7 verschiedene UTC-Beobachtungstage mit qualifizierten Zeitblöcken.
- Alle vier 6-Stunden-UTC-Blöcke des Tages müssen beobachtet sein.
- Mindestens 14 unabhängige qualifizierte (UTC-Tag, 6-Stunden-Block)-Kombinationen.
- Mindestens 14 Kalendertage zwischen dem ersten und dem letzten Beobachtungstag (inklusive).
- Ein Zeitblock zählt nur, wenn dort mindestens 3 verschiedene UTC-Minuten echte Snapshots enthalten. Tausende Snapshots aus derselben Minute erfüllen diesen Nachweis nicht.

Die tatsächlich beobachtete UTC-Spanne, pro Markt relevante Zähler und nicht erfüllte Kriterien stehen im maschinenlesbaren `cost:report` und in der Monatsübersicht `record:report`. Bei Mängeln lautet der Status `insufficient` und die Kostenfreigabe bleibt gesperrt. Auch **ausreichende Verteilung** impliziert **keine** quantifizierte Slippage für 10/50/100 Quote-Einheiten, keinen verifizierten Maker-Fill und keinen belegten Netto-Edge: `executableCostEvidenceComplete` bleibt `false`, bis tatsächlich unabhängige Ausführungsdaten vorliegen. Echte Recorder-Daten wurden durch diesen Code-PR nicht gesammelt oder bewertet.

## Zeitpunktgenauer Empfangszeit-Cutoff für Kosten-Replay (#68)

Die reine Offline-Diagnose `receivedCostReplay(symbol,fromMs,toMs,cutoffMs,dir)` verwendet die bestehende lesende `replayRecorderTrades`-Schnittstelle und vergleicht für jeden historischen Aggregate-Trade **Exchange-Zeit, lokal aufgezeichnete Empfangszeit und Entscheidungszeitpunkt**. Nur Trades mit `exchangeTs <= cutoffMs`, `receivedAt >= exchangeTs` und `receivedAt <= cutoffMs` gehören zur zulässigen Entscheidungsansicht. Ein verspätet zugestellter Print wird **niemals** rückwirkend zu einem vorher bekannten Trade; Ereignisse mit späterer Exchange-Zeit werden nicht einmal geladen.

Der versionierte Diagnosebericht `recorder-cost-replay-receipt-v1` nennt vor dem Cutoff kausal bekannte IDs, verspätete/fehlende Empfangszeiten, negative Clock-Skews, ID-Duplikate, widersprüchliche Exchange-/Empfangsreihenfolgen, bekannte Receipt-Latenzen (Median/P90/Maximum) und eine SHA-256-Prüfsumme. Ein `invalid`-Status kennzeichnet Clock-/ID-Widersprüche, `insufficient` ungeklärte Daten. Ein erneutes Replay von später hinzugefügten **zukünftigen Exchange-Events** darf frühere zulässige Entscheidungs-Events nicht verändern. Bei unbekannten alten `received_at`-Feldern wird nichts aus dem Exchange-Timestamp rekonstruiert.

Diese API bewertet **nur die Beobachtungsqualität**; weder aus Quote-/Depth-Bändern noch aus öffentlichen Prints lässt sich eine tatsächliche Maker-Queue-Position oder grössenspezifische Slippage beweisen: `executableCostEvidenceComplete=false`. Es werden keine Orders ausgelöst und keine lokalen Recorder-/Paper-Dateien verändert. Die Tests laufen vollständig mit temporären SQLite-Fixtures, ohne Netz oder Holdout-Daten.
