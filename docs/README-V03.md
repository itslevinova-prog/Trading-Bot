# Kraken Paper Trading – lokaler Simulator

Ein deutschsprachiger **Paper-Trading-Simulator** mit öffentlichen Kraken-EUR-Marktdaten, SQLite-Persistenz, einer festen Regelstrategie, einem Buy-&-Hold-Vergleich und einem vorbereiteten KI-Konto. **Kein echtes Geld. Keine Gewinnprognose oder Gewinngarantie.** Das Projekt enthält absichtlich **keine** privaten Kraken-API-Endpunkte, keine Kontoverknüpfung und keine Live-Order-Funktion.

> **Status:** Projektversion zum lokalen Aufbau und Testen. Die Implementierung ist in dieser Umgebung nicht Ende-zu-Ende getestet worden, weil der npm-Registry-Zugriff gesperrt war. Ein produktiv verlässlicher Betrieb ist daher nicht bestätigt. Bitte erst nach erfolgreichem `pnpm install`, `pnpm typecheck` und `pnpm test` als funktionierende Simulation betrachten.

## Installation

Voraussetzung: Node.js 22, Corepack und Internetzugang für npm/Kraken.

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
pnpm build
pnpm test
pnpm dev
```

Im Entwicklungsmodus: Frontend <http://127.0.0.1:5173>, Backend <http://127.0.0.1:3000>. `pnpm start` startet Backend + gebautes Dashboard unter Port 3000. **Kein API-Key nötig.** Das Konto „KI“ ist standardmässig inaktiv, bereitet aber sämtliche Prompts vor und speichert sie.

## Docker

```bash
cp .env.example .env
# Unter Windows: Copy-Item .env.example .env
docker compose up --build -d
```

Dashboard unter <http://127.0.0.1:3000>. SQLite bleibt im benannten Volume `paper-data` erhalten. Der Port ist auf `127.0.0.1` des Hostsystems begrenzt, nicht öffentlich. Das Image wird aus dem Monorepo gebaut; `better-sqlite3` benötigt native Build-Werkzeuge.

## Konten

| Konto | Start | Funktion |
|---|---:|---|
| KI | 100 € | Inaktiv ohne Modell; erzeugt DecisionContext und Prompt. `AI_PROVIDER=mock` testet einen zufälligen Anbieter. |
| Regeln | 100 € | EMA20/50-Kreuzungen auf 15-Minuten-Kerzen, 60-Minuten-Trendfilter, RSI, Volumen und Spread. |
| Buy & Hold | 100 € | Kauft einmalig BTC über den simulierten Broker, sobald ein aktuelles Orderbuch verfügbar ist. Danach kein Handel. |

Käufer erhalten **keine Coins**: Es werden nur fiktive Konten und simulierte Buchungen in SQLite angelegt.

## Wie die simulierte Ausführung funktioniert

1. Regeln kontrollieren Konto, Positionsgrenzen, Tageslimits, Cooldown und Marktdatenalter.
2. Der Mid-Preis beim Entscheid wird für die spätere Slippage-Auswertung gespeichert.
3. Nach 300–900 ms wird das **neueste** öffentliche Level-2-Orderbuch (10 Stufen) verwendet.
4. Für Käufe wird der Ask und für Verkäufe der Bid über die Stufen aggregiert. Unzureichende Liquidität verhindert die simulierte Order.
5. Die Menge wird auf `lot_decimals` **abgerundet**, Order- und Kostenminima werden berücksichtigt.
6. Die konfigurierte Taker-Gebühr wird beim Kaufen zusätzlich und beim Verkaufen vom Erlös abgezogen.
7. Gebühren, Kurs, Slippage, Latenz, Begründung und Gewinn/Verlust werden protokolliert.

Der Buch-Client verifiziert die Kraken-v2-CRC32-Prüfsumme anhand der Preise und Mengen als Strings. Veraltete oder inkonsistente Bücher sperren Trades. Stop-Loss und Take-Profit erzeugen dieselben simulierten Verkaufsorders; Kurslücken können erhebliche Abweichungen verursachen. Kontowert basiert auf dem **Bid**, nicht auf dem letzten Handelspreis.

**Grenzen:** Ein Paper-Fill anhand von 10 aggregierten Orderbuchstufen ist nur eine Näherung. Zwischen der letzten Buchnachricht und der hypothetischen Ausführung kann sich der Markt ändern. Netzwerkjitter, Marktimpact, Teilfills, echte Queue-Position und spezifische Kontogebühren werden nicht vollständig modelliert. Es sind keine garantierten Live-Fill-Preise.

## Risikoregeln

Die Konten „KI“ und „Regeln“ haben maximal 30 % Exponierung pro Coin, höchstens vier offene Positionen, höchstens zehn Trades pro UTC-Tag und 60 Minuten Coin-Cooldown nach Verkäufen. Neue Positionen brauchen einen Stop-Loss im Bereich 2–15 %. Ein 25-%-Drawdown vom Höchststand löst eine Pause aus. Buy & Hold ist der absichtlich unbeschränkte Vergleichswert. Stop-Loss-Verkäufe bleiben auch in der Kontopause möglich und dürfen zur Risikobegrenzung das reguläre Tageslimit für Strategie-Trades überschreiten. Weitere Werte stehen in `.env.example`.

## Gedächtnis / KI

Beim Entscheidungstakt (:00, :15, :30, :45 UTC + 5 Sekunden) entstehen Feature-Vektoren, ähnliche Vergangenheitswerte und später die 1h-, 4h-, 24h-Ergebnisse. Eine ausgewählte Lektion lässt sich im Dashboard manuell hinzufügen, aktivieren oder deaktivieren. Die KI erhält später Kontexte, frühere vergleichbare Situationen, die Lektionen und harte Risikolimits.

Zum Testen **ohne KI**: `.env` auf `AI_PROVIDER=mock` setzen und Server neu starten. Im KI-Konto werden dann simulierte Entscheidungen durch denselben Broker geprüft. Der Mock ist keine künstliche Intelligenz.

Die Datei `apps/server/src/ai/ClaudeDecisionProvider.ts` ist ein absichtlich inaktiver Platzhalter. **Keine Claude-API, kein Anthropic-SDK und keine echten API-Requests** sind integriert. Die künftigen Textvorlagen liegen unter `prompts/trader-system.md` und `prompts/trader-user.md`. Die vorbereiteten, noch nicht gesendeten Prompts sind im Dashboard unter „Entscheidungen“ sichtbar. `AI_ENABLED`, `AI_MODEL` und `ANTHROPIC_API_KEY` sind für eine spätere Erweiterung reserviert und derzeit wirkungslos.

## Zurücksetzen

```bash
pnpm reset            # Konten, Trades, Positionen, Entscheidungen und Equity löschen
pnpm reset -- --full  # zusätzlich historische Kerzen, Märkte, Lektionen und Gedächtnis löschen
```

Stoppe den Server vor dem Reset. Die ursprüngliche Kontokonfiguration wird wiederhergestellt.

## Datenquellen und technische Regeln

- Kraken REST `AssetPairs` / `Ticker`: Paarliste und EUR-Volumen. Für WebSocket v2 wird die Anzeige `BTC/EUR` verwendet.
- Kraken REST `OHLC`: maximal 720 Einträge pro Abruf; die letzte laufende Kerze wird **nicht** als geschlossene Historie gewertet.
- Kraken WS v2 `ticker`, `book` (Depth 10), `ohlc` (15 und 60 Minuten): Snapshot + Aktualisierungen.
- Offizielle Dokumentation: https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/book und https://docs.kraken.com/exchange/guides/websockets/book-checksum-v2
- Kraken-Pro-Preise: https://www.kraken.com/features/fee-schedule

## Eigene Entscheidungen

- Die aktuelle publizierte Basis-Taker-Gebühr wurde am 22. Oktober 2026 als **0,80 %** geprüft. Daher wurde der anfänglich verlangte Wert `0.004` aus dem Auftrag auf `0.008` korrigiert. Änderungen jederzeit in `.env` möglich.
- Das Projekt verwendet Node 22, Fastify, Zod, React, Tailwind, Drizzle, SQLite und Vitest. Die DB wird initial per eingebautem SQL erzeugt, und das Drizzle-Schema liegt für nachfolgende `drizzle-kit`-Migrationen bei. **Migrationierung bestehender Schemas ist noch nicht automatisiert.**
- `AI_PROVIDER=mock` aktiviert das KI-Konto; `none` und `claude` bleiben ohne SDK/API inaktiv.
- Historische Kerzen und Signale werden laufend geladen; bei Verbindungsunterbruch wird die Synchronisierung erneuert.
- Für wiederholte Stop-Loss-Signale gibt es einen In-Memory-Entprellmechanismus pro Position.
- Im Frontend gibt es **keinen Button zur manuellen Order-Aufgabe**; nur Lessons und Konto-Pause/Fortsetzen sind veränderbar.
- Für exakte Euro-Cent-Abrechnungen und hohe Volumina sollten Decimal-Arithmetik, transaktionale Order-Reservierungen und belastbare Lasttests ergänzt werden. Die aktuelle Version verwendet IEEE-754-`number` und ist ein Prototyp.

## Abnahme-Checkliste (noch zu verifizieren)

- `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build` lokal erfolgreich
- Innerhalb einer Minute mindestens 15 liquide EUR-Paare im Live-Dashboard
- Initialer Buy-&-Hold-Kauf inkl. Kosten und Buch-Slippage
- Wiederholte Regeln-Entscheidungen mit Historie
- Vollständiger KI-Prompt in jedem 15-Minuten-Zyklus
- Trades mit `AI_PROVIDER=mock` und aktiven Risikoregeln
- Neustart ohne Verlust von Positionen und Entscheidungen
- Reconnect nach Netzunterbrechung und Buch-Checksumme
- 100 % öffentliches Kraken-Markt-API, kein Echtgeld-Handel

## Version 0.2 – Research Lab und Risk Center

Diese Erweiterung wurde am 26. Oktober 2026 als **Paper-Trading-only** ergänzt:

- **Strategie-Labor:** Einzelmarkt-Backtests für Trendfolge, Ausbruch und defensive Regeln. Historische Kraken-15-Minuten-Kerzen werden in 70 % Entwicklungs- und 30 % unveränderte Testperiode geteilt. Signal nur auf abgeschlossenen Kerzen, Fill frühestens am nächsten Kerzen-Open; Gebühren, Slippage, Stop-Loss, Take-Profit, Drawdown, Gewinn- und Verluststatistik, BTC-/Coin-Buy-&-Hold-Vergleich und doppelte Kosten als Stresstest. Warnung bei weniger als 20 abgeschlossenen Positionen. Kein historischer Level-2-Fill und keine statistische Gewinngarantie.
- **Risikoanalyse:** Überwachung der Datenaktualität, Orderbuchverfügbarkeit, vorbereiteten Indikatoren, abgelehnten Orders und erfassten Paper-Kontokennzahlen mit Trefferquote, Kosten, Slippage, Nettoergebnissen und Drawdown.
- **Marktfilter:** Suche nach Paar sowie Ansicht für frische Orderbücher.
- **Neue Endpunkte:** `GET /api/research?pair=BTC%2FEUR&strategy=trend&slippageBps=8`, `GET /api/analytics`, `GET /api/health`.
- **Tests:** `apps/server/test/research.test.ts` (Vitest) sowie separat offline ausführbare Unit-Tests in `apps/server/test/research-offline.mjs`.

Führe die Offline-Tests ohne Installation aus (Node 22):

```bash
node --experimental-strip-types --test apps/server/test/research-offline.mjs
```

### Grenzen der Forschung

**Backtests sind Forschung und keine Erfolgswahrscheinlichkeit.** Die 720 verfügbaren Kraken-OHLC-Einträge entsprechen auf 15-Minuten-Basis rund 7,5 Tagen, also einer viel zu kurzen Stichprobe für seriöse Robustheit. Die Testaufteilung reduziert Look-ahead, schafft aber keine unabhängigen Marktzyklen. Es gibt kein historisches Orderbuch, keine realen Teilfills, keine modellierten Liquidationskosten bei aussergewöhnlichen Ereignissen und keine automatisierte Anpassung der Live-Strategie. Die Live-Regelstrategie bleibt durch das Research-Labor **unverändert**.

- **Kill-Switch-Reset:** Beim manuellen Fortsetzen eines pausierten Paper-Kontos wird dessen Drawdown-Referenzhoch auf den aktuellen Kontostand neu gesetzt. Das verhindert sofortiges erneutes Pausieren, wird aber im Dashboard offengelegt. Die historischen Equity-Snapshots bleiben unverändert.
- **Research-Survivorship-Bias:** Die analysierten Märkte stammen aus den heute aktiven Paaren. Verschwundene/delistete Paare fehlen in den historischen Vergleichen.


## Version 0.3 – konservativer Signal-Scanner und Robustheits-Labor (26.10.2026)

**Ziel:** die Zuverlässigkeit der *Bewertung* erhöhen, statt eine hohe Erfolgsquote zu behaupten. Diese Version benötigt weiterhin **keine privaten Kraken-Zugangsdaten** und unterstützt ausschliesslich Paper-Trading.

### Neue Funktionen

1. **Signal-Scanner**: read-only `/api/signal-quality` für alle vorhandenen EUR-Feature-Snapshots. Sechs explizite Prüfungen: höherer Trend, EMA-Stärke, RSI, Volumen, ATR und Handelskosten/Spread. Der Scanner zeigt separat die Frische des Orderbuchs. **6/6 ist keine prognostizierte Gewinnwahrscheinlichkeit.**
2. **Regelkonto**: Kauf nur noch bei bestehendem EMA-Kreuzsignal **und** 6/6 Qualitätsprüfungen. Nominales Risikobudget pro Trade 0,75 % des Kontowerts **vor Gebühren, Slippage und Kurslücken**; fixe Stop-Loss-Distanz 5 %, daraus abgeleiteter Kaufbetrag normalerweise 15 % des Kontowerts (maximal 25 %). Zu kleine Orders werden ausgelassen. Verkaufsregeln und harte Broker-Risikolimits bleiben erhalten. Der Live-Regelprovider nutzt hierfür aktuelle `FeatureSnapshot`s.
3. **Viertes Backtest-Modell „Quality Select“**: eigene experimentelle Logik mit abgeschlossenen 15m-Kerzen, bestätigtem 60m-Trend, RSI- und ATR-Fenster, Momentum, 8-Kerzen-Cooldown, dynamischem Stop-Loss, Ziel mit 2,6× Stop-Abstand und einem 12-%-Notstopp für neue Einstiege. **Nicht mit den exakten Live-Regeln identisch.** Die Research-Strategie verändert das Regelkonto nicht automatisch.
4. **Walk-forward-Auswertung**: drei chronologisch aufeinanderfolgende, nicht überlappende Prüffenster über die jüngste Hälfte der vorhandenen Historie. Ohne automatische Auswahl der besten Parameter oder der besten Strategie.
5. **Statistik**: Historische Gewinnquote, Wilson-Untergrenze (95 %), Worst-Fold-Return/Drawdown, deterministischer Bootstrap mit 5-%-Quantil, doppelter Gebühren-/Slippage-Stresstest und Prüfungen auf Kerzenlücken.
6. **Strenge Kennzeichnung**: Das Label „historisch robust“ wird nur bei ≥ 1600 geschlossenen Kerzen, ≥ 30 Trades, ≤ 1 % Lücken, mindestens zwei positiven Prüffenstern und positivem Stresstest vergeben. Es ist ausdrücklich **keine Prognose**. „Datenlage unzureichend“ ist bei kurzer Historie das erwartete Ergebnis.
7. **Längere Historie**: `/api/research` verarbeitet nun bis zu 12’000 in SQLite **bereits gesammelte** 15-Minuten-Kerzen statt nur 720. Die tägliche Datenbereinigung behält maximal 90 Tage. Ein frisch installierter Bot hat weiterhin nur die von Kraken REST gelieferten maximal 720 Kerzen; weitere historische Daten wachsen während des Betriebs an.

### Untersuchungsmethodik und Grenzen

Die Strategieentwicklung auf denselben Daten wie die Bewertung kann zu Overfitting führen. Auch der Vergleich mehrerer Modelle auf dem sichtbaren Holdout verbraucht dessen Unabhängigkeit. Die zusätzlichen Prüfperioden verringern einige Fehlerquellen, ersetzen aber kein unabhängiges, langfristiges Forward-Paper-Trading. Bootstrap-Trades sind nicht unabhängig, die 60m-Resampling-Methode benötigt lückenlose zeitlich korrekt ausgerichtete 15m-Kerzen und die Ausführung ist eine vereinfachte OHLC-Simulation. Die **tatsächliche Live-Trefferquote ist unbekannt**.

**Keine Gewinnsteigerung wurde nachgewiesen.** Die neuen Regeln können die Zahl der Trades stark reduzieren und auch Chancen verpassen. Mit 100 € Kontokapital sind Gebühren ein wesentlicher Faktor. Es gibt nach wie vor keinen echten KI-Dienst.

### Tests ohne npm-Pakete

Unter Node.js 22 können die pure TypeScript Research- und Risiko-Tests laufen:

```bash
pnpm test:offline
# oder ohne pnpm:
node --experimental-strip-types --test apps/server/test/research-offline.mjs apps/server/test/robustness-offline.mjs
```

Die regulären Vitest-Tests stehen in `apps/server/test/robustness.test.ts`. Vor dem lokalen Einsatz **`pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build` ausführen**. Ein End-to-End-Build war in der Bearbeitungsumgebung wegen DNS-Sperre der npm-Registry nicht möglich. Bisher wurde keine echte Kraken-Liveverbindung für diese Version verifiziert.
