> Checkpoint01.11local: FEATURE-HISTORY-CONTRACT.md records verified97point24hfix,1070+15checks and28EXACTold full replay results. Workingcode only, frozen/main not upgraded. Next shared causal H1direction evidence for runtime/replay; current level-above-EMA does not encode slope. No new alpha/model/profit claim; July lock and100active-hour objective remain.

> Checkpoint01.11local: BREAKOUT-ENTRIES.md documents one fixed own prior20closed-breakout gate: full28replays/14scenarios,1047+15checks,155actual buys independently checked.6/7base months improve but all7remain negative; no promotion. Next proven24hfeature-history gap fix (see feature-history-gap-observation.json), then stronger causal entry/regime discrimination. July locked;100active-hour scope incomplete.

> Latest checkpoint31.10.2026:100actual productive hours remain the active goal; older sections below describe chronological development history, not current runtime status. TRAINING-READINESS.md/proof documents1032+15passing checks,366720additional complete bars and196mature single-policy labels (below200minimum). No predictor fit; all six fixed source-policy training months negative. Further priorities are entry/regime/NO-TRADE quality, appropriately scoped local learning only when justified, honest full-cost chronological evaluation and broader selective OSS research. July outcomes locked. Frozen V3 already runs unchanged as a separate paper observation; no new deployment this checkpoint. See work-state.json for current exact next steps and actual credited time.

> Aktuelle Autoritaet: Goal dieses Chats (get_goal), mindestens100aktive Stunden, Freqtrade/Jesse/OctoBot gezielt untersuchen und kompatible Tradingintelligenz integrieren; nur Paper/gemockte KI/gratis. Fruehere nachfolgende Bestandsabschnitte sind zeitlich eingeordnet, kein neuer Echtgeldauftrag.

# Paper-Trading: Architekturprüfung und aktueller Arbeitsauftrag

Massgeblich ist die vom Nutzer aktualisierte goal-objective.md (30.10.2026): mindestens100aktive Stunden; ausschliesslich bestehendes Paper-Trading verbessern, KI nur simuliert/gemockt, keine echten KI-Provider/API-Keys/Kosten oder Echtgeldimplementierung. Frühere Live-Pläne werden nicht fortgesetzt. Vorhandene nicht angebundene Offlinebausteine bleiben erhalten.

## Bereits vorhanden und nachgelesen

- `strategy/scheduler.ts` baut Kontext aus geschlossenen Marktfeatures, Markttiefe, Historienfenstern, externen Quellen, Portfoliobewertung, Research-/Forward-Belegen und Erinnerungen. Entscheidungen/Originalkontext werden vor simulierten Orders dauerhaft gespeichert.
- `strategy/providers.ts`: unveränderte EMA-Kreuzungsbaseline mit6Qualitätsfiltern; der aktuelle MockAiProvider wählt zufällig. Der Mock besitzt keine belegte Handelsintelligenz. Seine bisherige Konfidenz0.5 erreicht Safe0.8/Risky0.6 nicht. Keine reale Modellverbindung ist aktiv.
- `strategy/quality.ts` prüft Trend, Stärke, Momentum, Volumen, ATR und Kosten. Es ist eine feste Heuristik, keine kalibrierte Wahrscheinlichkeit. Der bekannte ATR-Mindestwert0.8% blockierte die eingefrorene Untersuchung; keine nachträgliche Schwellenoptimierung auf deren bereits eingesehenen Ergebnissen.
- `broker/PaperExecutionAdapter.ts`, `broker/risk.ts` und `executionGuards.ts`: tatsächliche simulierte Book-/Fee-Fills, Limits, Exposure, Stoprisiko, Revisionsschutz, Buy-Sperren bei unbekannten Bewertungen und unabhängige Schutzverkäufe. Safe/Risky/Stoplinien bleiben bestehen.
- `context/market-context.ts`: gemeinsame geschlossene UTC-Fenster, Trend-/Volatilitätsinformationen,24hLevels, Volumenproxy, BTC-Korrelation und7/30/90Tage-Summaries. Es gibt noch keine ausreichend explizite verknüpfte Strategie-/Gegenevidenzbewertung und keine vorherige-Window-False-Breakout-Logik.
- Aktuelle eingefrorene Baseline:0%/0geschlosseneTrades. Das beweist keinen Gewinnvorteil. Walk-forward-Replays sind von unabhängiger prospektiver Evidenz zu unterscheiden; bereits eingesehene Holdouts werden nicht erneut als unabhängig bezeichnet.
- Bestehender Memory-Snapshot enthält teils nahezu zeitgleiche, identische Hold-Beobachtungen im selben15m-Zeitbucket. Beispiel im gespeicherten Fixture:5Hits liegen in3Buckets, mit gleichen Outcomes/Abständen. Diese Samples dürfen nicht als5unabhängige Trade-Erfolge oder kalibrierte Vorhersagen behandelt werden. Vor einer Änderung die Originalschema-/Feature-Zeitstempel prüfen.

## Nächste Umsetzung in Prioritätsfolge

1. Zufalls-Mock durch deterministische, versionierte Paper-Entscheidungsheuristik ersetzen. Gleiche Eingaben müssen gleiche Entscheidungen erzeugen. Schlüssige positive Szenarien müssen erlaubt sein; schwache, widersprüchliche, stale oder kostennegative Szenarien ergeben NO TRADE. Die eingefrorene Regelbaseline unverändert als Vergleich behalten.
2. Strukturierte Opportunity-Belege: Beobachtung, geeignete Strategie/Regime, Unterstützung, Gegenevidenz, Invalidierung, Kosten und Netto-Payoff. Gebühren/Spread/Slippage mit den tatsächlichen unterschiedlichen Stop-/Target-Basisregeln des Paperbrokers abgleichen. Break-even-Wahrscheinlichkeit als erforderliche Schwelle, niemals als geschätzte Erfolgswahrscheinlichkeit ausgeben. Keine unbelegte Erwartungswertzahl.
3. Portfolio-/Korrelations- und Volatilitätsrisiko mit aktuellen Limits verbinden; bestehende Hardlimits nicht lockern. BTC-Korrelation ist keine vollständige Coin-Coin-Kovarianz und instabile Korrelation kein garantierter Hedge.
4. Historische Lernbelege auf zeitliche Abhängigkeiten, doppelte Samples, fehlende Outcomes und Leakage prüfen. Neue Heuristiken vor zukünftiger Auswertung registrieren; Training/Validierung/Test zeitlich trennen. Null-Trades ergeben unbekannte Trade-/Kalibrationsmetriken, keine Erfolgsbehauptung.
5. Bestehende Backtests um faire versionierte Vergleiche über mehrere Zeiträume/Regime ergänzen: Nettoertrag, Drawdown, risikoadjustierte Rendite, Frequenz, Profitfaktor/Erwartungswert nur bei ausreichenden Daten, Kalibration nur bei belastbarer Prognosestichprobe. Rückblickende Exploration explizit kennzeichnen.
6. Relevante Thesen, Ablehnungsgründe und Datenfrische in bestehendem Dashboard sichtbar machen. Keine kosmetische Neuerstellung, keine zusätzlichen Provider- oder Echtgeldanbindungen.

## Laufender Kontextabschluss

Begonnene validierte Exit-/Gebührenzusammenfassungen werden ausschliesslich mit lokalen Fixtures abgeschlossen. Native Produktion nicht zusätzlich angebunden. Pflichtdaten, ursprüngliche Dezimalstrings und gewählte Paper-Policy bleiben erhalten. Wiederholte Labels/Werte werden verlustfrei geteilt; das feste115000-Zeichen-/131072-Fenster wird nicht bloss erhöht. Maximalpaket enthält alle20Marktübersichten,20belegte Offline-Exit-Summaries und die ausgewählten Erinnerungen. Ein zu grosses oder widersprüchliches Paket verweigert vor Modellinferenz. Das ist technische Kontextvalidierung und kein Nachweis gesteigerter Handelsrendite.


## Kostenbaustein begonnen nach natürlicher Nutzungserneuerung

`strategy/paper-payoff.ts` bildet die tatsächlichen unterschiedlichen Paper-Definitionen ab: Stop vom gebührenhaltigen Einstand, Take-Profit vom Fillpreis. Ein-/Ausstiegsgebühren und angenommene Slippage bestimmen bedingten Nettogewinn/-verlust, Netto-Chance/Risiko und die erforderliche Break-even-Gewinnrate. Sofortiger markierter Ausstieg berücksichtigt Bid/Ask. Geschätzte Erfolgswahrscheinlichkeit und Erwartungswert bleiben null; ohne Prognosekalibration wären sie erfunden. Kostennegative Targets liefern keine erreichbare Break-even-Rate. Preislücken können das Stopszenario überschreiten.

Der Baustein ist noch nicht an den Mock-Entscheider angeschlossen. Als Nächstes daraus transparente Trade-/NO-TRADE-Prüfungen machen, mit geeigneten positiven Szenarien und ausdrücklicher Gegenevidenz; kein automatisches Übernehmen einer Heuristik als profitabel validierte Strategie. Die ursprüngliche Regelbaseline bleibt unverändert.


## Fortschritt30.10.: Mock/Payoff und zeitliches Gedaechtnis

Punkte1/2 sind als erste Paper-Forschungsheuristik implementiert, aber kein abgeschlossener Strategie-/Profitnachweis. Siehe strategy/paper-intelligence.ts, upstream-research/REVIEW.md und paper-intelligence-proof.json.18Szenarien und4Kausalitaetspruefungen vorhanden; Mock nicht aktiviert. BTC-Korrelation ist weiterhin nur ein begrenzter Risikobaustein.

Punkt4 hat jetzt eine konkrete zeitliche Grundlage: MEMORY-TIME.md, additive Beobachtungs-/Outcome-Belege, explizites asOf, reife Skalierungsdaten, exakte Horizonte, Duplikat-/Ueberlappungskennzeichnung und konservativ unbekannte Altwerte/PnL. Noch keine Lernstrategie oder Kalibration. Neues20Markt-/20Exit-/Memory-v2-Kontextpaket rekonstruiert Pflichtfakten bei114084Zeichen exakt.

Naechste groessere Arbeiten: FreqAI-Feature-/Label-/Modellalterpfad, Jesse-Strategie-/Simulationsarchitektur und OctoBot-Evaluatoraggregation weiter nachvollziehen; anschliessend konkrete sinnvolle Regime-/Strategie-/adaptive Verfahren mit registrierter Kosten-/Walk-forward-/OOS-Auswertung integrieren. Bisherige14ausgewaehlte Upstreamdateien sind keine vollstaendige Untersuchung. Ueberwachte Paper-Lern-Outcomes und reale Historie sind von synthetischen Fixtures strikt zu unterscheiden. Originalbaseline nicht auf bekannte historische Resultate zurechtoptimieren.


## Lokaler Lernversuch v1: erste negative Evidenz

LOCAL-LEARNING.md und learning-protocol-v1.json: eigenstaendige lokale Ridge-/Null-/Mittelwert-Referenzen mit zeitlich reifen Labels, Train-only-Skalierung, chronologisch bereinigten14/4/4-Tage-Folds und fester Validierungswahl implementiert.2140Beobachtungen/107Zeiten/20Maerkte, zwei abhaengige Testfenster. Ridge MAE schlaegt Null nicht, Kapitaldiagnose einmal-0,13646%mit2hypothetischen Positionen und einmal0bei0Positionen. Validierungsgewaehlte Varianten traden beide nicht. Kein Modell/Tradingpfad aktiviert, keine Test-Nachoptimierung.

Kuenftige sinnvolle Arbeit: untersuchte Zeitfenster im learning-evaluation-register erhalten, weitere konkrete Upstream-Strategie-/Regimeideen bewerten. Groesseren/facettenreicheren bereits erhobenen90Tage-Datenbestand und Quellen-/Ankunftsqualitaet pruefen; neue unveraenderliche Forschungsdatensaetze nur zusaetzlich anlegen, niemals den eingefrorenen Referenz-/Defaultdatensatz austauschen. Neue Verfahren/Stressannahmen vor Bewertung festlegen und bekannte Historie weiter retrospektiv benennen. Mehr Modellausgabe ist kein Qualitaetsbeweis.


Aktuelle Datenpruefung: der eingefrorene Datensatz enthaelt bereits8640bis8729Bars je Markt (rund90Tage); der erste Lernlauf nutzte absichtlich nur das bisherige gemeinsame Oktober-Auswertungsfenster. Fuer eine breitere retrospektive Untersuchung denselben unveraenderten Archivdatensatz mit neu festgelegtem gemeinsamen Warm-up-/Auswertungsfenster nutzen, statt unnoetig Daten zu duplizieren oder Defaultpointer zu tauschen.

Zusaetzlich eine saubere, isolierte prospektive Paper-Vergleichskohorte fuer den deterministischen Mock planen: eigene simulierte Konten/Datenbank, gleiche Startzeit/Kapital/Kosten/Universum und Regel-/Hold-Vergleiche, stabile Versions-/Frischebelege. Hauptkonten und eingefrorene Referenz nicht umschreiben. Kein echter KI-Provider und keine Echtgeld-/Privatboersenaufrufe; Ridge bleibt mangels Vorteil unaktiviert. Hintergrundbeobachtung zaehlt nicht als Entwicklungszeit und Ergebnisse erst bei tatsaechlich beobachteter vergleichbarer Evidenz bewerten.


## Erweiterter90-Tage-Vergleich abgeschlossen; naechste Integrationsluecke

LOCAL-LEARNING-EXPANDED.md:17chronologische Testfenster auf unveraendertem Archiv, identische Modelle/Parameter, Basis-/adaptive2x-/gepaarte2x-Kosten vorab festgelegt. Ridge insgesamt-3,548%bei64hypothetischen Positionen und schlechtere MAE alsNull; Validierungswahl+0,512%bei13Positionen, aber bei2xKosten negativ. Keine Aktivierung/Profitbehauptung oder Nachoptimierung. Separate v2-Testfensterregistrierung, Original-v1-Belege erhalten.

PAPER-EXPERIMENT-DESIGN.md enthaelt jetzt den konkret nachgelesenen Integrationsvertrag: vorhandene Vergleichslogik ist absichtlich rules/hold-only, AI-Policy besitzt legitime eigene evaluationVersion. Vor isoliertem Mock-Paperstart explizite gemeinsame Experimentregistrierung plus individuelle Leg-Versionen/Baseline-/Kosten-/Universum-/Fill-/Gappruefungen implementieren. Alte Komparatorguards/Referenzpointer nicht umgehen. Noch kein neuer Versuch gestartet; das ist konkrete offene Implementierung, keine externe Blockade.


## Registrierungsgrundlage31.10.

paper-experiment.ts verbindet32isolierte Testfaelle mit echter bestehender Policy-/Provenanceberechnung; separate Leg-Versionen werden nicht gefaelscht. PAPER-EXPERIMENT-REGISTRATION.md zeigt Details und noch offene Bootstrap-/synchronisierte Beobachtungs-/Mehrleg-Auswertung. Hauptprofil weiter AInone; kein neuer Versuch/kein Ridgeeinsatz. Nach dieser notwendigen Vergleichsverdrahtung weitere konkrete Strategie-/Regimeintelligenz priorisieren, statt Infrastruktur als Zielersatz auszubauen.


## Gemeinsame Paper-Beobachtung und Auswertung31.10.

Jetzt eigene atomare3Leg-Startpunkte, echte Zeit-/Run-/Fill-/Feerate-/Cash-Ledgerpruefung und Snapshot-Vergleich mit erhaltenenLuecken implementiert und getestet;685+15Suite. PAPER-EXPERIMENT-OBSERVATIONS.md. Noch nicht automatisch gestartet/verdrahtet. Naechster enger Integrationspunkt: sichererBootstrap vor Scheduler/Hold, realer Bewertungsbatch ohne Legacy-Doppelbeobachtung, eigenerRead-onlyReport, dann isoliertesFreeze/Launch. Danach wieder direkteRegime-/Strategieintelligenz und konkreteUpstreammodule priorisieren.


## Echte Ablaufanbindung31.10.

PAPER_EXPERIMENT_MODEmock und PAPER-EXPERIMENT-INTEGRATION.md: neue eigeneDB/profilstrikt, echterProducer/Markt-vor-Baseline-vor-Scheduler-Bootstrap, realeBrokerEntryguards vor/nachLatenz, Schutzverkaeufeunabhaengig, Source-Runregistrierung vor Resume-Ticks, echtergemeinsamerBewertungsbatch und bedingteRead-onlyAPI sourceintegriert.16neueTests,701+15gesamt, Hauptprofiloff/AInone/Route404realgeprueft. Noch kein separater eingefrorenerForwardprozess gestartet. Naechstesprepare/start/verifyeigeneRoot/Seed/114Abhaengigkeiten/Loopbackport, keineAlt-/Referenzkonten ueberschreiben. Danach Strategie-/Regimeintelligenz und weitereUpstreammodule priorisieren.


##01.11 — shared closed-hour direction foundation complete

HOURLY-TREND-CONTEXT.md:1098+15/typecheck/build, shared source/recurrence/freshness proof, lossless budget/repack, four full old economics exact. Descriptive only, no activation/profit. Next preregister ONE fixed rising-hourly entry gate atop existing breakout, gate all qualified candidates before selection, preserve exits/risk and compare complete consumed-history portfolios at both fee rates. July locked. No fit on196dependent mature labels or automatic promotion of smaller losses.


##01.11 — fixed hourly rule tested; still no profitable policy

HOURLY-ENTRIES.md:28fullreplays,14frozenbaselineexact,141raworiginchecks;5/7relativebetter but7/7basefeenegative,153->139trades, no promotion/July. RIDGE-MODEL-VALIDATION.md: concrete invalidmodel/sparsevector gap fixed after study,6red->23green/120validforecasts exact/full1132+15. Next reuse existing failure diagnostics for scoped entry/cost/regime mechanisms; verify actual frozen forward runtime after shutdown without inventing continuous observations. UpstreamPASS16/17deepened3sourcefiles each, no newforeigncode. Full100hscope incomplete.


##01.11 — failure mechanisms and recovered actual runtime integration

HOURLY-ENTRY-FAILURES:296scope rows/2censored checked; fee-onlyremoval notenough,52positiveinteriorlossmarks notexitproof, actualholding405minmedian vs4htarget mismatch. MainandV3shutdownrecovery preservesoldaccounts/epochs and12.905hgap. FULL-REGIME-BUDGET: real20marketstressfailed despiteunitgreens; fixedlosslessly atsame115kcap, full1140+15/actual13loopbackdummytransmission green, deployedmainc2f35b...only. FrozenV3cc123oldpolicyintact. Next preregisterproper target/entry/regime hypothesis/causaldata adequacy, notposthoc trailingthresholds orpooling labels. All7base monthsnegative,Julylocked,100hscopeincomplete.


##01.11 — explicit local learning target and negative six-month study

FIXED-TARGET-LEARNING.md:8h/12hcontracts separatefromlegacy4h/policyPnL,7280rawtargets/featuresverified,41train-onlymodels/6560testpredictions/591costpositionschecked. Ridgeandselectorlose;cashzero wins. Full1163+15/build, no provideractivation/July. Mainall113loadedfilesunchanged, only2offline researchmodulesadded. Nextpinned-source-informedcontext/features/marketregimehypothesis underfixedsame-horizonbaseline/protocol, notloweringthresholdsorclaimingtrainingreadyfromnewtargetlabels.


##01.11 — cross-market relative intelligence tested, no profit promotion

RELATIVE-ENTRIES.md: same-quoteBTC/assetclosed4hsource checks, researchonlyentryfilter retainsabsolute/risk/exitguards;1199+15/28fullreplays/14oldexact/128rawBUYchecks.4better/2worse/1same,all7base negative;notactivated,Julylocked. PASS18/19deeperpair-feature/perpairmodel/evaluatorcycleconcepts, no codeport. Nextaudit genuine intrabar ambiguity/execution rejections withoriginalprotection+rawdata beforeanysimulator orstrategychange; do notoptimizebydeletinglosses. Main/V3unchanged.


##01.11 — no simultaneous-barrier artifact found

INTRABAR-ASSUMPTIONS.md:269scopedroundtrips fullychecked,0both-touch/0entrybarintrabar; defaultadversarial13tests pass. No newengineoption/optimisticlossdeletion. Residual5stiming andgap/liquidity unknown; observed19gapstops/11clocks notfuturebound. Nextsourcepayoff/stop/target/volatility diagnosis andjustifiedpreregistered hypothesis, notposthocparameter rescue.
