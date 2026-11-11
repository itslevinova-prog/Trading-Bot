# Technische Prüfung V0.3 (26.10.2026)

## Erreichte Änderungen
- Neue konservative Live-Regelprüfung: 6/6 Qualitätsmerkmale, getrenntes nominelles Risikobudget pro Position.
- Live-Signal-Scanner mit eigener schreibgeschützter JSON-Route.
- Eigenes historisches Qualitäts-Strategiemodell mit dynamischen Stops und Ruhephasen.
- Walk-forward-ähnliche Validierung auf drei nicht überlappenden Zeitfenstern; keine Anpassung von Parametern auf diesen Fenstern.
- Historische Gewinnquote mit Wilson-Untergrenze, deterministischer Bootstrap, Kosten-Stresstest, Lückenanalyse und ehrlichem Status bei zu wenig Daten.
- Historische Backtests akzeptieren bis zu 12’000 gespeicherte 15m-Kerzen; die reguläre Aufbewahrung beträgt 90 Tage.
- 15 eigenständig ausführbare Node.js-Offline-Tests bestanden.
- 40 TS/TSX-Dateien mit TypeScript `transpileModule` syntaktisch geprüft; keine Syntaxfehler.
- `tsc --noEmit` auf den eigenständigen Backtest-/Robustheitsmodulen erfolgreich.

## Wichtige Einschränkungen
- Der komplette React/Fastify-Build konnte mangels DNS-Zugriff auf registry.npmjs.org **nicht** durchgeführt werden.
- Kein Ende-zu-Ende-Test einer Kraken-WebSocket-Verbindung oder realer Markt-/Orderbuchdaten in dieser Umgebung.
- 15 Offline-Tests ersetzen weder die komplette Vitest-Suite noch Langzeit- oder Reconnect-Tests.
- Historische Performance, eine Quality-6/6-Bewertung und ein positiver Walk-forward-Test ergeben **keine garantierte oder bezifferbare künftige Erfolgsrate**.
- Historische OHLC-Daten ersetzen kein echtes Orderbuch zum damaligen Zeitpunkt. Gebühren/Slippage können abweichen.
- Die Quality-Research-Strategie und die Live-Regelstrategie sind unterschiedlich; kein automatischer Strategiewechsel aus Backtest-Ergebnissen.
- Mit den ersten 720 Kraken-15-Minuten-Kerzen wird die strenge Datenanforderung von ≥ 1600 Kerzen noch nicht erreicht.
- `ClaudeDecisionProvider` bleibt ein Platzhalter; es gibt keine echte KI-Anbindung.

## Sicherheitsgrenze
Der Adapter `KrakenLiveExecutionAdapter` führt keine Orders aus. Kein privater Kraken-API-Zugriff, keine Einzahlung, keine Auszahlungen, kein Hebel und kein Echtgeld-Handel. Nur Simulation.

## Test-Kommandos
```
node --experimental-strip-types --test apps/server/test/research-offline.mjs apps/server/test/robustness-offline.mjs
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

## Nächste technische Schritte zur belastbaren Bewertung
1. Langfristig **nur virtuelle Trades** sammeln und historische Datensätze verschiedener Marktphasen einbeziehen.
2. Ausführung auf einem separaten, vorab fixierten längeren Zeitraum prüfen.
3. Keine Parametersuche anhand der sichtbaren Holdout-Renditen durchführen.
4. Entwicklung und Auswertung getrennt dokumentieren; erfolgreiche Ergebnisse nie als Wahrscheinlichkeit künftiger Gewinne ausgeben.
