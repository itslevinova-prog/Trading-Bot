# Marktregime v1 — vorab registrierte Spezifikation

**Status:** V1 vor dem ersten historischen Lauf festgelegt; keine Parameteroptimierung, kein Zugriff auf den Holdout für Modellwahl. Issue #19. Forschungsreferenzen: [BTC-REGIME](BTC-REGIME.md), [PAPER-MARKET-BREADTH](PAPER-MARKET-BREADTH.md). Deren 15-Minuten-Paper-Ergebnisse sind **keine** unabhängige Bestätigung einer täglichen Marktampel.

## Exakte Festlegung (V1, `variantsTested: 1`)

Alle Bewertungen gelten nur für **abgeschlossene UTC-Tageskerzen bis einschliesslich Vortag** (`candle.ts + 86_400_000 <= UTC-Tagesbeginn(asOfMs)`). Tagesdaten aus der Zukunft oder laufende 1d-Kerzen werden nicht verarbeitet. Keine rückwirkend nach heutigem Stand selektierte Coinliste: `universeAt(dayStartMs, {quote:'USDT',topN:50})` muss das Point-in-Time-Universum aus #3 liefern.

1. **Trend (0/0,5/1):** BTC-Schlusskurs über EMA(200) und EMA(50) heute höher als 20 abgeschlossene Tage zuvor: beide ja → 1; genau eines ja → 0,5; keines → 0. EMA verwendet SMA-Seed und anschliessende exponentielle Updates auf maximal 600 (EMA200) bzw. 200 (Breite-EMA50) letzten zusammenhängenden Tagen; die feste numerische Vorlaufbegrenzung verhindert vom Berichtsstart abhängige Werte.
2. **Volatilität (0/0,5/1):** 30 tägliche logarithmische BTC-Renditen, annualisierte Standardabweichung, rollierender Perzentilrang unter ausschliesslich bereits verfügbaren validen 30-Tage-Fenstern der letzten 1.095 Tage (3 × 365). Rang ≤ 1/3 → 1; > 1/3 bis ≤ 2/3 → 0,5; > 2/3 → 0. Mindestens 90 gültige historische Volatilitätswerte sind nötig.
3. **Breite (0/0,5/1):** Anteil gültiger Point-in-Time-Top-50-Coins mit gestrigem Schluss über ihrer EMA(50). < 40 % → 0; 40 % bis < 60 % → 0,5; ≥ 60 % → 1. **Jedes** Universumsmitglied muss 50 lückenlose Tage verfügbar haben; sonst `neutral` mit `Daten unvollständig`.
4. **Gesamtscore:** arithmetisches Mittel genau dieser drei Komponenten. Keine lernbaren Gewichte. Neutral → rot bei Score < 0,35 und → grün bei > 0,70. Rot → gelb erst bei Score > 0,45; Grün → gelb erst bei Score < 0,60. Direkte Rot-Grün-Übergänge sind verboten.
5. **Hysterese:** Mindestens drei **vollständige** UTC-Tage pro Zustand, bevor ein weiterer normaler Wechsel möglich ist. Bei fehlenden/ungültigen Daten unverzüglich defensiv `neutral` mit Begründung, unabhängig von der Mindestdauer. Ein unabhängiger Einzelaufruf nutzt 90 Tage Vorlauf mit anfänglichem `neutral` und daher möglicherweise abweichendem Langzeitstartzustand; Berichte nutzen einen einheitlichen, durchgehenden Replay.

Die fünf frei gewählten Parametergruppen sind: Volatilitäts-Perzentilband (1/3, 2/3), Breadth-Band (0,40, 0,60), Score-Schaltband (0,35/0,45/0,60/0,70), Mindestverweildauer (3) und historisches Replay-Warmup (90 Tage). Die Indikatorperioden 200/50/20/30/3 Jahre sowie die Gleichgewichtung stammen zwingend aus #19. **Keine** dieser Einstellungen darf anhand von Entwicklungs-, Validierungs- oder Holdout-Ergebnissen optimiert werden. Jede Änderung nach dem ersten Lauf benötigt eigene Modellversion und erhöht `variantsTested`.

## Datensplits und Analyseprotokoll

- Entwicklung **2020-01-01 bis 2023-12-31** (sofern echte historische Kerzen und PIT-Universen vorhanden). Perioden ohne genügend Warmup zählen als unvollständig, nicht als risk-on.
- Validierung **2024-01-01 bis 2024-12-31 einmalig**, Ergebnis unverändert protokollieren; nicht zum Tunen.
- Holdout **ab 2025-01-01** wird **nicht** zur Optimierung oder Backtest-Auswahl verwendet; aktuelle Live-Anzeige ist operationelle Überwachung, keine statistische Validierung.
- Berichte: Tage/Zustand, Verweildauer, Wechsel/Jahr (<6 Richtwert), BTC- und gleichgewichtete PIT-Top-10-Folgerendite über 30 Tage mit fix-seeded Bootstrap-CI; mit der produktiven #5-Engine BTC Buy & Hold gegen mit Exposure gewichtet: vorsichtig 1/0,5/0, normal 1/0,7/0,2, aggressiv 1/0,85/0,4. Vergleiche Nettorendite, maximalen Drawdown und Sharpe, getrennt nach Split. Keine erfundenen Renditen.

## Befund / Blocker (noch keine Validierung)

Am 05.11.2026 sind #3 (mehrjähriges Archiv mit `ArchiveCandleSource`/`universeAt`), #5 (einheitliche Backtest-Engine) und #6 (Hypothesenregister) nicht auf `main` gemergt. Die bisherige Paper-DB hat keine mehrjährigen 1d-PIT-Daten. **Zustandsanteile, Wechselhäufigkeit, Forward-Returns und Backtest-Kennzahlen sind daher nicht verfügbar.** V1 wird für diese Lücke nicht mit aktuellen Coin-Listen, heuristischen Kursen oder künstlichen Renditen „validiert“.

## Anbindung nach Merge von #4/#7

Die Strategie bzw. RiskEngine erhält ausschliesslich `RegimeProvider` und `exposureMultiplier(regime,profile)` als injizierte Abhängigkeit, z. B. `const state = await regimeProvider.getRegime(decisionTimeMs); const cap = exposureMultiplier(state.regime, profile);`. Nur das bereits von der Strategie vorgeschlagene Exposure auf `cap` begrenzen; kein Strategie-Signal, keine Broker-Regel, keine RiskEngine-Logik kopieren. Ist `state.reasons` wegen unvollständiger Daten defensiv, gilt der neutrale Multiplikator, nicht risk-on. Nach Merge von #3/#5 zuerst die Datenverfügbarkeit prüfen, Entwicklungslauf protokollieren, 2024 **einmalig** prüfen, Holdout unberührt lassen.

## Bedienung des Reports (keine Cloud, nur lokaler Output)

`pnpm regime:report` schreibt eine **neue** JSON-Datei unter `data/regime/` (keine bestehenden Dateien überschreiben) und zeigt Tageszustand, Gründe sowie 365-Tage-Verlauf. Solange die #3-Schnittstelle fehlt, kann der Aufruf ohne Archiv-Adapter **nur** `neutral` + `Daten unvollständig` liefern; das ist ausdrücklich **keine** gemessene aktuelle Ampel. Keine Ersatzuniversen aus heutigen Volumen-Rankings benutzen.

Für echte Daten einen lokalen TypeScript-/JavaScript-Adapter mit den benannten Exporten `source: CandleSource` und `universeAt: UniverseAt` bereitstellen. Danach `pnpm regime:report -- --adapter=./lokaler-adapter.ts` (operationelle Anzeige) beziehungsweise `pnpm regime:report -- --development --adapter=./lokaler-adapter.ts` (Entwicklungssplit 2020–2023, 30-Tage-Folgerenditen mit fixem 30-Tage-Block-Bootstrap). Der Adapter muss die von #3 implementierte unveränderte `CandleSource` sowie `universeAt` verwenden. Die 2024-Einmalvalidierung und die BTC-Buy-and-Hold-/Exposure-Backtests werden erst mit #3/#5 durchgeführt; diese Module erfinden keine simulierten Broker-Fills. Die #5-Engine bleibt allein für Kosten und Backtest-Kennzahlen zuständig. Falls der lokale Adapter den Holdout schützt, ist dessen Sperre zu respektieren. **Keinen** `allowHoldout`-Bypass für die Forschung setzen.
