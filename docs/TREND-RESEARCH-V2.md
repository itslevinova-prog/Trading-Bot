# H-025 v2: Entwicklungs-Backtest mit Mengenregel-Annahmen

## Getrennte Variante, getrennte Belege

Der manuelle Research-Workflow bietet zusätzlich `run_trend_v2=false` an. Für den vollständigen Lauf setzen: `run_trend_v2=true`, `symbols` leer, `from=2020-01`, `to=2023-12`, `intervals=1d,1h`. `run_trend` und `run_spike` können unabhängig ausgeschaltet werden. Abweichende v2-Eingaben werden vor dem Download abgewiesen. Der Workflow lädt das vollständige historische USDT-Archiv, einschließlich früherer Coins; er schneidet es nicht auf heute gelistete Märkte oder Top-N ab.

Der Modus verwendet `trend-vol-target-v1-binance-lots-v2` aus `engine-v2.ts` und die gemeinsame exakte Dezimalrundung aus `lots.ts`. Es ist dieselbe bereits registrierte zweite H-025-Variante, kein neuer Parametervergleich: `variantsTested` bleibt **2**. Die alte Ganzcoin-Variante, ihre Registrierung, CLI und Ergebnisse werden nicht verändert.

Lokal nach vorhandenem vollständigem Entwicklungsarchiv:

```bash
LIVE_ENABLED=false AI_ALLOW_REMOTE=false pnpm --filter @paper/shared build
LIVE_ENABLED=false AI_ALLOW_REMOTE=false pnpm --filter @paper/server exec tsx src/backtest/trend-research-v2-cli.ts
```

Ergebnisse liegen ausschließlich unter `data/trend-research-v2/`: `report.json` mit Ledger, Kennzahlen, Rejections, Universum, Konfiguration, Code- und Daten-Fingerprints, aktuellem Exchange-Snapshot und dessen Zeitpunkt/Hash sowie `summary.md`. Der bisherige Ordner `data/trend-research/` bleibt unangetastet. Der Workflow sichert eigene v2-Artefakte und postet nach erfolgreichem Lauf den datenschutzgeprüften v2-Bericht in Issue #3. In dieser Implementierungssession wird kein Actions-Forschungslauf ausgelöst und kein Forward-Test gestartet.

## Mengenregeln sind rückwirkende Annahmen

Nur der öffentliche, kostenlose Endpunkt `https://data-api.binance.vision/api/v3/exchangeInfo` wird für aktuelle Metadaten abgefragt; kein Account, kein Schlüssel. `LOT_SIZE.stepSize`, `LOT_SIZE.minQty` und das strengere `MIN_NOTIONAL`/`NOTIONAL` werden als heutige, **nicht historische** Regeln gespeichert. Beliebige unterstützte Dezimalschritte werden am tatsächlichen Fill abgerundet. Der v1-Brokerpfad ohne `stepSize` behält seine bisherige Dezimalrundung. Das neue Mindestnotional stammt aus den jeweiligen angenommenen Börsenfiltern statt aus einer zusätzlichen pauschalen 10-USDT-Grenze.

Historische Mengenregeln und damalige Handelbarkeit sind damit nicht rekonstruiert. Insbesondere delistete Coins ohne aktuell verwendbare Regeln bleiben im historischen Universum und in der Abdeckungsstatistik, dürfen jedoch keine Einstiege erzeugen. Fehlende Regeln werden im Bericht aufgelistet. Keine erfundenen Ersatz-Lots und keine fingierten Liquidationen bei Datenende. Diese konservative Zugangssperre kann die Ergebniswahl dennoch verzerren; das Ergebnis ist kein survivorship-freier Ausführungsnachweis und kein Beleg für Profitabilität.

## Daten- und Ausführungsgrenzen

Alle Kerzenabfragen gehen durch einen Entwicklungsadapter: frühestens 2020-01-01, exklusives Ende 2024-01-01. Auch Indikator- und Risikovorlauf wird auf diese Grenze beschränkt; 2024 und der Holdout werden nie geladen. Rückgaben außerhalb des erlaubten Fensters werden abgewiesen. Die ersten Monate dienen dem Aufbau der unveränderten Alters-/Indikatorhistorie; es werden keine Daten vor 2020 erfunden.

Universum und Qualitätsannahmen verwenden ausschließlich frühere Archivkerzen. Strategieparameter kommen explizit aus der v2-Konfiguration. Gebühren 0,1 %, Spread 10 bps und Slippage 5 bps sowie Startkapital 10 000 USDT bleiben gleich. Der vorhandene Backtest-Broker, seine Schutzregeln und die Portfolio-RiskEngine werden weiterverwendet. Damit wird keine vollständige Ausführungsparität mit dem Forward-Adapter behauptet. Fehlende Risikohistorie kann Einstiege blockieren; Null-Trades und negative Ergebnisse bleiben sichtbar.

Die unveränderten BTC-/DCA-Referenzen des bisherigen Forschungslaufs werden zusätzlich mit gleichen Kosten ausgegeben. Ihre synthetische Rundung ist ausdrücklich keine Simulation der v2-Börsenlots. DCA verwendet zusätzliche Einzahlungen und eine cashflow-neutrale Rendite; Endvermögen ist nicht direkt vergleichbar.

Keine Änderung an Pipeline-Gates oder v1-Datensplits, keine Paper-Freigabe, keine Gewinnprognose, keine Holdout-Auswertung. Ein tatsächlicher vollständiger Forschungslauf und seine Ergebnisse müssen nach Ausführung separat beurteilt werden.

## Entscheidungen

- Vorhandene v2-Registrierung weiterführen statt dieselbe Strategie doppelt zu zählen.
- Historisches Universum erhalten; fehlende aktuelle Regeln sperren Eintritte statt unbekannte Lots zu erfinden.
- Gemeinsamen Backtest-Broker optional um exakte Schrittweiten erweitern, den v1-Pfad unverändert lassen.
- Provenance und Daten-/Kostenannahmen sichtbar berichten; keine rückwirkende Umdeutung alter Ergebnisse.

## Vergleich der drei Risikoprofile (Issue #7)

Zusätzlich kann der manuelle Workflow mit `run_profiles=true` gestartet werden. Die Eingaben
müssen **exakt** `symbols` leer, `from=2020-01`, `to=2023-12`, `intervals=1d,1h`
sein. `run_spike`, `run_trend` und `run_trend_v2` für einen ausschliesslichen Profilvergleich
ausschalten. Das Entwicklungsarchiv wird einmal importiert; die Profile `vorsichtig`,
`normal`, `aggressiv` werden danach in der fest vorregistrierten Reihenfolge mit demselben
aktuellen Mengenregel-Snapshot ausgeführt. Kein Zugriff auf 2024 oder den Holdout.

Lokal (bereits importiertes Archiv vorausgesetzt):

```bash
LIVE_ENABLED=false AI_ALLOW_REMOTE=false pnpm --filter @paper/server exec tsx src/backtest/trend-research-v2-cli.ts --profiles
```

Die JSON-Belege (`data/trend-research-v2/profiles-report.json`) und die gemeinsame Markdown-
Tabelle (`data/trend-research-v2/profiles-summary.md`) werden separat gespeichert und im
Workflow als Artefakt hochgeladen. Nach erfolgreicher Datenschutzprüfung wird der
Markdown-Inhalt über die **Ereignis-Datei** (`GITHUB_EVENT_PATH`), niemals als
Text-Umgebungsvariable, geprüft und in Issue #7 gepostet.

Die Risikoprofile werden mit `resolvePaperRiskProfile()` ohne Überschreibungen aufgelöst.
Die bereits geltenden absoluten Caps dürfen Profile nur **verschärfen**. `engineLimits`
gehen an die Portfolio-RiskEngine, die gekappten `maxOpenPositions` und `maxPositionPct`
zusätzlich an den Broker. Im Trend-Planer gelten die gekappten `targetAnnualVol`,
`maxOpenPositions` als `topK`, `maxPositionPct` und `maxInvestedPct` als Zielgrenzen.
`cappedFields` sowie angeforderte und wirksame Profile erscheinen in jedem JSON-Ergebnis;
die Kappungen stehen zusätzlich im Markdown.

**Unvollständiges Profil:** Der separat langfristig gehaltene BTC/ETH-`corePct`-Kern
ist in diesem Backtest **nicht implementiert**. Die Ergebnisse sind daher nur ein
Vergleich des aktiven Trend-Satelliten mit unterschiedlichen Limits, **kein vollwertiger
Test** der Profilkonzepte. `universeTopN`, `riskPerTradePct` und
`minimumEdgeMultiple` werden im v2-Planer nicht als eigene Profilregeln umgesetzt.
`maxInvestedPct` ist ein Zielgewicht und kein jederzeit garantierter Mark-to-Market-Deckel.
Exposure in der Tabelle ist der Zeitanteil mit offenen Positionen, nicht der gemittelte
investierte Kapitalanteil. Die passiven BTC-/DCA-Vergleiche bleiben synthetische Referenzen. Der Kostenanteil
ist nur bei positivem Brutto-PnL definiert; für passive Benchmarks wird kein
vergleichbarer Kostenanteil erfunden. DCA ist cashflow-neutral, nicht direkt mit
einer einmaligen Anfangsanlage gleichzusetzen.

Die drei Vergleichsprofile zählen als drei zusätzliche registrierte/geprüfte Varianten
von H-025, **nicht** als nachgewiesene rentable Strategien. Die Eintragung in
`hypotheses.json` ist kein Nachweis, dass ein Lauf auf realem Archiv bereits beendet
wurde. Erst ein erfolgreicher Workflow liefert empirische Kennzahlen; kein Paper-/Live-
Freigabeschritt wird daraus abgeleitet.

## Ursachendiagnose des bestehenden H-025-v2-Laufs

Die nachträgliche Auswertung des **Originalartefakts** aus Run
[43380362062](https://github.com/itslevinova-prog/Trading-Bot/actions/runs/43380362062)
hat die Exit-only-/Cash-Sperre **bestätigt**: 2'090 von 2'106 abgelehnten
Käufen wurden wegen der 10-%-Drawdown-Grenze verweigert. Die Schwelle
wurde am **06.09.2020** erreicht (Drawdown 10,0527 %). Nach dem 05.09.2020
erfolgte kein weiterer Trade; 1'456 von 1'461 Tagen blieb das Konto
vollständig in Cash, obwohl an 706 Tagen mindestens ein Kaufsignal
des Planers vorlag. Die 188 fehlenden Mengenregeln sind eine zusätzliche
unbekannte Zugangsbeschränkung, aber nicht der dominante dokumentierte
Ausführungsengpass.

**Der vollständige, überprüfbare Quellenbericht** mit Datenfingerprint,
Ablehnungsstatistik, Tagesstatus, Exposure-Rekonstruktion und Equity
2020–2023 liegt unter
[`docs/research/H-025-v2-run-43380362062-diagnosis.md`](research/H-025-v2-run-43380362062-diagnosis.md).
Dieser Bericht wurde **ohne neuen Forschungslauf** aus dem vorhandenen
Actions-JSON erstellt.

Der v2- und der Dreiprofil-Backtest erhalten zusätzlich **passive**
Diagnosefelder, damit künftige `summary.md`/`profiles-summary.md` die
Entscheidungsquellen und den Statuswechsel unmittelbar ausweisen:
Top-15-Gründe pro Quelle mit unterschiedlichen Zähleinheiten,
Planer-Signaltage gegenüber tatsächlichen Fill-Tagen, in Cash verbrachte
Tage, investierter Kapitalanteil, jährliche Equity und Drawdowns.
Dabei werden Schwellenstatus (alle Tage) und Hard-Stop-Latch (nur nach
tatsächlicher Evaluierung) unterschieden. Der erste Schwellenwechsel
wird am UTC-Zeitpunkt der darauffolgenden Auswertungs-/Entscheidungsuhr
datiert; jährliche Werte beziehen sich auf die abgeschlossenen
Tageskerzen. **Strategie, Planer, Risikogrenzen und Broker-Ausführung
bleiben unverändert.** Es wird nicht auf 2024/Holdout zugegriffen, und
die neue Instrumentierung ist weder eine weitere Strategievariante
noch ein Anlass zur Änderung der Risikosperre.
