# Gepinnte Quellpruefung, Pass 3 — 31.10.2026

Acht weitere Dateien, insgesamt28ausgewaehlte Dateien; keine vollstaendige Untersuchung der drei Projekte. Eigene manifest-pass3.json je Projekt mit URL/Commit/SHA256/Bytes, alle acht Archive nach dem Lesen nachgeprueft. Keine Installation oder Ausfuehrung fremden Codes, keine Quellcodekopie in der Anwendung. Vorherige Manifeste/Berichte unveraendert.

## Freqtrade

[StoplossGuard](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/plugins/protections/stoploss_guard.py) betrachtet geschlossene Trades innerhalb eines Rueckblicks, konkrete Stop-/Liquidationsgruende und Gewinnschwelle; Paar-/Richtungsumfang sind Optionen. [LowProfitPairs](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/plugins/protections/low_profit_pairs.py) verlangt eine Mindestanzahl geschlossener Trades und summiert deren Renditekennzahlen vor einer befristeten Einstiegsperre. Solche beobachteten Cluster sind keine unabhaengigen Prognosestichproben. Schutzverkaeufe muessen weiterhin moeglich bleiben; keine Schwellen aus wenigen frischen Verlusten ableiten.

[MaxDrawdown](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/plugins/protections/max_drawdown_protection.py) unterscheidet realisierte absolute Gewinne mit angepasstem Anfangskapital und eine alte Renditesummenrechnung. Diese sind bei ungleichen Positionsgroessen nicht austauschbar. Unser aktueller bewerteter Portfoliodrawdown darf nicht durch eine reine Summe geschlossener Prozentrenditen ersetzt werden. Offene Positionen, unbekannte Bewertungen und Ausfuehrungsluecken bleiben eigene Risiken.

[SampleStrategy](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/templates/sample_strategy.py) kombiniert unter anderem RSI-Kreuzungen mit weiterem Trend-/Band-/Volumenfilter. Beispielcode ist kein nachgewiesener profitabler Parametersatz. Zukuenftige Regime-/Reversalhypothesen brauchen eigene unveraenderte Kosten- und Zeitvertraege, nicht nachtraegliche Auswahl guter Beispielschwellen. Freqtrade-Hauptlizenz GPLv3, fuer direkte Codeintegration konkrete Kompatibilitaet pruefen; keine pauschale Relizenzierung unseres Bots.

## Jesse

[Trade Monte Carlo](https://github.com/jesse-ai/jesse/blob/aded4b9d51d432d411a8f7fbf45e47572dff6629/jesse/research/monte_carlo/monte_carlo_trades.py) kopiert und mischt vorhandene Trades mit gesetzten Szenarioseeds. Die Rekonstruktion verteilt vorhandene absolute PNL-Werte auf urspruengliche Zeitpunkte; sie spielt keine neuen Marktfills oder Entry-/Exit-Zeitverlaeufe durch. Sinnvoll als Reihenfolge-/Drawdown-Stressdiagnose, kein Nachweis neuer unabhaengiger Ertragschancen oder kalibrierter Gewinnwahrscheinlichkeit. Bei null Trades wird explizit abgebrochen. Vor Uebernahme Gebuehrenbedeutung der exportierten PNL-Felder gesondert verfolgen.

[Candle Monte Carlo](https://github.com/jesse-ai/jesse/blob/aded4b9d51d432d411a8f7fbf45e47572dff6629/jesse/research/monte_carlo/monte_carlo_candles.py) fuehrt Backtests mit optionaler Kerzenpipeline aus; pro Szenario wird eine eigene Kopie der Parameter mit versetztem Seed verwendet. Originalpfad ist nicht einer der angeforderten synthetischen Pfade. Die konkrete Pipeline und Erhaltung von Zeit-/Mehrmarkt-Abhaengigkeiten sind dadurch noch nicht geprueft. Unsere existierenden gepaarten Kostentests behalten dieselben Trades; adaptive Freigabetests werden getrennt ausgewiesen. Weitere MIT-kompatible Wiederverwendung erst bei echter Fragestellung; kein Ray-Stack nur fuer mehr Simulationen installieren.

## OctoBot

[Mixed strategies](https://github.com/Drakkar-Software/OctoBot/blob/c45fdc2c95c5bd3d649251fa90c327e2e8f86b00/packages/tentacles/Evaluator/Strategies/mixed_strategies_evaluator/mixed_strategies.py) sammelt TA-Auswertungen je Zeitrahmen, prueft Wert/Typ und berechnet in TechnicalAnalysisStrategyEvaluator einen gewichteten Mittelwert nur bei positiver Gesamtgewichtung. Ein Echtzeit-Update kann zunaechst TA-Neuauswertung ausloesen und sofort zurueckkehren. Fehlende Matrixauswertungen besitzen einen Fehlerpfad. Ein Durchschnitt von Evaluatornoten ist keine kalibrierte Wahrscheinlichkeit; widersprechende oder veraltete Belege duerfen nicht als neutrale Stimmen eingehen.

Die ebenfalls archivierte [Tentacles-Lizenz](https://github.com/Drakkar-Software/OctoBot/blob/c45fdc2c95c5bd3d649251fa90c327e2e8f86b00/packages/tentacles/LICENSE) ist LGPLv3. Hauptprojekt und Einzelpakete nicht pauschal gleich lizenzieren. Keine direkte Uebernahme in diesen Aenderungen.

## Konkrete naechste fachliche Schritte

1. Tatsachlich beobachteten gemeinsamen Kontextzeitfehler beheben und getrennt versionieren; keine Lockerung der Future-/Stale-Gates. Der erste eingefrorene Mockversuch liefert damit keinen Strategiequalitaetsnachweis.
2. Kausale Regime-/Strukturhypothese fuer Trend vs Range mit geschlossenen Kerzen und echten Quellzeiten vorab definieren. Bestehenden Regelvergleich und Mock-v1-Quellen erhalten, keine Schwellenanpassung an wenige prospektive Minuten.
3. Spaetere Verlustcluster-/Strategieauswahl nur mit Nettoergebnissen, Kosten-/Markt-/Versionsbindung und ausreichend zeitlich zulaessiger Historie; exits niemals sperren. Hypothesen gegen konstantes Cash, Regelbaseline und BTC mit fairen Risiken vergleichen.
4. Weiter offen: wesentlich breitere Strategie-/Lern-/Backtest- und Testcodepruefung aller Projekte.28Dateien ersetzen weder gruendliche Gesamtpruefung noch100produktive Stunden.
