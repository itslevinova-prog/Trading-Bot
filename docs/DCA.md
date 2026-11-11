# DCA – lokaler Entwicklungs-Benchmark (Issue #13)

Diese Implementierung ist **nur eine Offline-Simulation mit Spielgeld**. Keine API-Keys, kein Netzwerkauftrag im Testcode, keine Einzahlungen, keine Orders. Sie ist kein Nachweis, dass ein Sparplan besser als ein Bot funktioniert.

## Start

```powershell
pnpm data:import
pnpm dca:backtest --from 2020-01-01 --to 2024-01-01 --amount 100 --interval monthly --allocation 70/30
pnpm dca:backtest --from 2020-01-01 --to 2024-01-01 --multi-start true
```

Der lokale Import (#3) muss zunächst die historischen BTCUSDT-/ETHUSDT-Tageskerzen geliefert haben. **Ohne Archiv erfolgt kein Lauf und es gibt keinen erfundenen Ergebnisbericht.** Ein Report pro identischer Konfiguration wird im gitignorierten `data/backtests/dca-<hash>/report.json` einmalig erstellt. Wiederholungen an derselben Datei werden abgewiesen; dabei ist das **kein** statistisch unabhängiger Holdout.

Die vier **vorab definierten** Varianten: `classic` (fester Betrag), `trend-park` (Cash, wenn BTC unter 200-Tage-SMA), `trend-double` (bei Abwärtstrend maximal doppelte Monatsrate aus vorhandenem Cash), `value-average` (1,5× unter, 0,5× über dem SMA). Die Erkennung verwendet nur vollständig geschlossene Tageskerzen **vor** dem Kaufzeitpunkt. Fehlt der 200-Tage-Verlauf, wird bei diesen drei Trendvarianten nicht gehandelt. Kaufpreis ist der **nächste Tages-Open** nach Signal, konservativ erhöht um Gebühren-, Spread- und Slippage-Annahmen.

Die Ergebnisse umfassen Einzahlungen, Gebühren, Netto-Kontowert, zeitgewichtete Rendite (TWR), geldgewichtete Rendite (IRR), Drawdown und Trades. **Einzahlungen sind keine Performance.** Der Vergleich umfasst ausschliesslich Daten von 2020 bis Ende 2023; 2024 bleibt Validierung und ab 2025 Holdout, beides wird hier nicht gelesen. Datenlücken führen zu einem Fehler statt zu erfundenen Bars.

## Offene Teile des ursprünglichen Issue #13

- Eigenes fortlaufendes Paper-Konto und UI-Dashboard sind **noch nicht** integriert.
- Der Standard-Benchmark-Adapter für die #5-Backtest-Engine ist **noch nicht** verbunden; ein fairer Vergleich gegen aktive Strategien mit gleichen Cash-Flows fehlt.
- Ein realer lokaler Mehrjahreslauf und dessen Bericht müssen auf dem Rechner mit dem importierten Archiv stattfinden.
- Minimum-Notional wird modelliert; echte Lot- und Börsen-Rundungsdaten für Paper sind noch offen.

Der PR liefert den testbaren Offline-Baustein, **nicht** die gesamte Definition of Done. Keine Aussage zur Profitabilität ohne echte Daten und unabhängige Validierung.

## Paper-Sparplan (lokal, ohne Echtgeld)

Beim Serverstart wird ein eigenes Konto `dca` mit Startkapital **0** erstellt.
Bei jeder fälligen UTC-Kalenderwoche bzw. jedem UTC-Monat wird genau eine
**simulierte** Einzahlung als eigene SQLite-Buchung `dca_paper_deposits`
erfasst. Der Kontostand wird in derselben Datenbanktransaktion erhöht.
Ein Restart führt weder zur zweiten Einzahlung noch zur zweiten Order
für dieselbe Periode: `dca_paper_decisions` reserviert die Periode
vor dem ersten möglichen Orderversuch. Unterbrechungen können
deshalb zu einem ausgelassenen Intervall führen; es gibt **keine**
nachträgliche Erfindung eines Fills.

Konfiguration ausschliesslich für die Simulation: `DCA_AMOUNT=100`,
`DCA_INTERVAL=monthly` (alternativ `weekly`),
`DCA_ALLOCATION=70/30` (BTC/ETH),
`DCA_VARIANT=classic` (alternativ `trend-park`, `trend-double`,
`value-average`). Es werden keine Börsenzugangsdaten verwendet.
Die Käufe laufen über den Paper-Broker mit seinen echten lokalen
Orderbuch- und Mindestgrössenprüfungen; bei Datenlücken oder
abgelehnten Orders bleibt die Einzahlung als Cash erhalten.
Eine DCA-Position wird wie Buy & Hold **ohne Stop** geführt.
Der gesamte Prozess verweigert ausdrücklich `LIVE_ENABLED=true`.

Trendvarianten benötigen 200 vergangene abgeschlossene Tageskerzen
oder lückenloses stündliches Paper-Material für 200 ganze UTC-Tage;
ohne diesen Nachweis bleibt Cash geparkt und wird der Grund festgehalten.
Die Live-Buchhaltung und die Entscheidungszustände erscheinen in
`GET /api/dca` und im Dashboard. Die Kontoperformance zieht
alle fiktiven Einzahlungen von der angezeigten absoluten Gewinnzahl ab;
eine Einzahlung zählt nicht als Gewinn.

Im #5-Standardreport erscheint ein DCA-Benchmark als **TWR**,
sofern für denselben 2020–2023-Entwicklungsabschnitt durchgehend
Tagesdaten vorliegen. Ohne diese Daten steht dort ausdrücklich
`nicht verfügbar`; für einen statistisch fairen Vergleich mit
aktiven Strategien sind identische Einzahlungen erforderlich.
Die neue Anzeige allein beweist keinen Renditevorteil.

**Noch nicht erfüllt:** Der für #2 geplante Post-only-Maker-Broker
existiert bisher nicht. Das Paper-Konto nutzt deshalb weiterhin
konservative Taker-Kosten. Reale mehrjährige Replay-Ergebnisse
und ein Cashflow-gleicher Vergleich mit der aktiven Strategie
fehlen mangels importiertem lokalem Archiv. Ausgebliebene Fills
und negative Resultate dürfen nicht nachträglich wegoptimiert werden.
