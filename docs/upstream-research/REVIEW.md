> Current03.11 pass29: direct inventory56distinct retained source files including6licences; older54/55incremental counts were overcounts. SOURCE-INVENTORY-2026-11-03.json is authoritative. Three pinnedJessecandlepipeline files reviewed; own synchronized20marketstress adapter/test/proof completed, no vendorcodeport/profitclaim. Whole-project review remains partial.

> Latest pass15:47selected archived files incl5licences. Targeted Freqtrade informative-timeframe availability examined; own97point24hfeature correction and exact historical compatibility verified. New analytical H1direction gap documented, not yet implemented/tested economically. Whole-project investigation remains incomplete.

> Current targeted pass14:46selected archived files incl5licences. Two new JesseMIT channel/bootstrap files with hashes; prior-signal exclusion, filter lifecycle and cross-asset/volume bootstrap limits examined. Own breakout hypothesis tested but all7base months negative, unpromoted. Whole-project review remains incomplete.

> Latest targeted follow-up: REVIEW-PASS13.md covers expiry/source clocks and resampling dependence.44selected archived files including5licences; thorough whole-project review remains incomplete. Own freshness guard and causal source-policy corpus implemented, no profitable learner established.

> Aktuelle ErgÃ¤nzung31.10.:44 ausgewÃ¤hlte Archivdateien inkl5Lizenzen; REVIEW-PASS11.md dokumentiert Spread-Einheiten und den gemeinsamen eigenen Broker-Guard. GesamtprÃ¼fung weiterhin unvollstÃ¤ndig.

> Fortsetzungsstand31.10.2026: Der untenstehende Text beschreibt den ersten Durchgang. Inzwischen sind43 ausgewÃ¤hlte Archivdateien einschlieÃŸlich5Lizenzdateien vorhanden; die GesamtprÃ¼fung bleibt unvollstÃ¤ndig. Gezielte FolgeprÃ¼fungen und tatsÃ¤chliche Integrationen sind in REVIEW-PASS2.md bis REVIEW-PASS10.md sowie REVIEW-REGIME-APPLICATION.md dokumentiert. Aktuell: kausale Einstiegszuordnung und ursprÃ¼nglicher Support-Exit; kein bestÃ¤tigter Gewinnvorteil.

# Gezielte Upstream-Untersuchung: erste Implementierungsrunde

Stand30.10.2026. Drei Ã¶ffentliche Repositories sind auf konkrete Commits gepinnt, ihre DateibÃ¤ume sowie14ausgewÃ¤hlte Quell-/Dokument-/Lizenzdateien mit SHA256 archiviert. Das ist der erste gezielte Durchgang und keine abgeschlossene VollprÃ¼fung sÃ¤mtlicher Architekturen, Strategien oder ML-Systeme. Es wurden keine Upstream-Programme installiert oder ausgefÃ¼hrt, keine Zugangsdaten/Accounts verwendet und keine Quelltexte in die Anwendung kopiert.

| Projekt | Gepinnter Commit | Lizenz der untersuchten Bereiche |
|---|---|---|
| Freqtrade | 7fea5ea24b3c3193cfdd4143b243f7baab66d661 | Hauptlizenz GPLv3; einzelne Komponenten separat prÃ¼fen |
| Jesse | aded4b9d51d432d411a8f7fbf45e47572dff6629 | MIT, Copyright-/Lizenzhinweise bei tatsÃ¤chlicher Ãœbernahme erforderlich |
| OctoBot | c45fdc2c95c5bd3d649251fa90c327e2e8f86b00 | Hauptprojekt GPLv3; untersuchtes Evaluators-Paket LGPLv3 |

## Freqtrade / FreqAI

[Lookahead-PrÃ¼fung](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/optimize/analysis/lookahead.py) vergleicht Indikatorwerte am gemeinsamen Zeitindex aus vollem und verkÃ¼rztem Datenlauf. Das ist ein wertvolles Testprinzip fÃ¼r unsere eigenen Indikatoren und Entscheidungen; es wird nicht durch eine schÃ¶ne Equitykurve ersetzt.

[DataKitchen](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/freqai/data_kitchen.py) verwaltet u.a. Trainings-/Testaufteilung und rollende Trainings-/Backtestzeitspannen. Fehlende Shuffle-Konfiguration wird aufFalse gesetzt; explizite Optionen kÃ¶nnen das Ã¤ndern. NaN-Eingaben wirken auf do_predict. Unsere Ableitung: chronologische, nachprÃ¼fbare Splits und gesonderte Ablehnung ungeeigneter Inputs, keine Vorhersage aus fehlenden Daten. [FreqAI-Interface](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/freqai/freqai_interface.py) und Modellverzeichnisse sind weiter zu prÃ¼fen, insbesondere Modellalter, Retraining, Outlier-/Featurepipeline und Trainingslabel-Grenzen. Kein ML-Paket wurde installiert, kein Modell trainiert.

## Jesse

[Strategy](https://github.com/jesse-ai/jesse/blob/aded4b9d51d432d411a8f7fbf45e47572dff6629/jesse/strategies/Strategy.py) trennt should_long/should_short, zusÃ¤tzliche Filter, Positions-/Orderbehandlung und KonfliktprÃ¼fung. [Utils](https://github.com/jesse-ai/jesse/blob/aded4b9d51d432d411a8f7fbf45e47572dff6629/jesse/utils.py) enthÃ¤lt risikobezogene Mengen-/Budgethilfen mit GebÃ¼hrenberÃ¼cksichtigung. [Backtest-Modus](https://github.com/jesse-ai/jesse/blob/aded4b9d51d432d411a8f7fbf45e47572dff6629/jesse/modes/backtest_mode.py) besitzt explizite Warm-up-/Candledatenpfade. Unsere Ableitung: Gelegenheit und AusfÃ¼hrungsfreigabe getrennt halten; Nominalbudget allein ist keine nach Kosten begrenzte RisikogrÃ¶sse. Die GebÃ¼hrenformel wurde nicht kopiert, weil unsere Stop-/Targetbasis spezifisch ist. Jesse-ML/AI-Model-Dateinamen sind noch kein Beleg fÃ¼r einen lokal trainierten HandelsprÃ¤diktor; deren konkrete ZustÃ¤ndigkeiten sind weiter zu untersuchen.

## OctoBot

[Evaluators-Dokumentation](https://github.com/Drakkar-Software/OctoBot/blob/c45fdc2c95c5bd3d649251fa90c327e2e8f86b00/docs/content/developers/packages/evaluators.md) beschreibt unterschiedliche Signalerzeuger und deren Strategieaggregation mit Zeit-/AktualitÃ¤tsbezug. [Matrix-Implementierung](https://github.com/Drakkar-Software/OctoBot/blob/c45fdc2c95c5bd3d649251fa90c327e2e8f86b00/packages/evaluators/octobot_evaluators/matrix/matrix.py) verwaltet Werte, Typen, Pfade und Evaluationszeitstempel. [Trading-Dokumentation](https://github.com/Drakkar-Software/OctoBot/blob/c45fdc2c95c5bd3d649251fa90c327e2e8f86b00/docs/content/developers/packages/trading.md) trennt Produzenten/Verbraucher. Unsere Ableitung: zusammengehÃ¶rige Evidenz muss zeitlich konsistent sein und getrennt von Execution ausgewertet werden. Unkalibrierte Signalnoten werden nicht zu Gewinnwahrscheinlichkeiten gemittelt. Externe LLM-/Account-/Cloud-Anbindungen werden nicht Ã¼bernommen. Backtesting-, Strategie- und Lernmodule bleiben fÃ¼r weitere DurchgÃ¤nge offen.

## Konkret umgesetzt

Eigene TypeScript-Implementierung `strategy/paper-intelligence.ts` ersetzt die Zufallsauswahl des MockAiProvider durch eine versionierte Paper-Forschungsheuristik. Sie verknÃ¼pft geschlossene frische Features, passende Marktzeitstempel, Trend/4h-Momentum, RSI/Volumen, aktuelle Tiefe/Spread, ausgewÃ¤hlte Stopdistanz, bedingte Netto-Payoffs und Portfoliobudget. BTC-Korrelation kann neue Allokation halbieren; das ersetzt keine vollstÃ¤ndige Kovarianzmatrix. Historischer Widerstand vor dem Target, ungeklÃ¤rte Daten oder Kostenlage bedeuten NO TRADE. VolatilitÃ¤tsabhÃ¤ngige Stops bleiben innerhalb bestehender Mindest-/Maximalgrenzen. Der reale Paperbroker behÃ¤lt sÃ¤mtliche unabhÃ¤ngigen Limits.

Maximal ein neuer Kauf pro Snapshot vermeidet mehrfach verplantes Cash/Slots; bestehende bearish-Trendpositionen kÃ¶nnen separat einen simulierten Schliessvorschlag bekommen. SchutzverkÃ¤ufe laufen weiterhin unabhÃ¤ngig. Strukturierte Beobachtung/UnterstÃ¼tzung/Gegenevidenz/Invalidierung und Payoffannahmen werden Ã¼ber getEvidence im bestehenden Entscheidungsprotokoll gespeichert. Der konstante Protokollscore0.8 ist ausdrÃ¼cklich unkalibriert; Prognosewahrscheinlichkeit/Erwartungswert bleiben null.

18SzenariofÃ¤lle prÃ¼fen deterministische Auswahl, erlaubten Positivfall, stale/future/mixed Daten, Marktkontext ausserhalbPaper, fehlende Grenzen, Kosten, Tiefe, Widerstand, Price-Dislocation, BTC-Korrelation, Konto-/Bewertungssperren und unverÃ¤nderte Regelbaseline. Das belegt ausgewÃ¤hlte EntscheidungsvertrÃ¤ge, keine profitable Strategie. Noch erforderlich: breiter historischer Regimevergleich, unabhÃ¤ngige Forward-Beobachtung, robuste Quellen-/NewsbezÃ¼ge, echte False-Breakout-/Range-Strategien, Lern-/Kalibrationspipeline und deren Out-of-sample-Nachweise.

## Selektive Wiederverwendung / Lizenzgrenze

Bisher werden allgemeine Architektur-/Testprinzipien wiederverwendet, keine Upstream-Codefragmente. Die lokal archivierten Originaldateien behalten ihre Lizenz-/Copyrighttexte und dienen dem Audit. Vor tatsÃ¤chlicher QuellcodeÃ¼bernahme mÃ¼ssen Datei-Lizenz, kompatible Einbindung und erforderliche Hinweise konkret geprÃ¼ft werden; insbesondere wird GPL-/LGPL-Code nicht kommentarlos in die Anwendung transplantiert. UnnÃ¶tige Dashboards, BÃ¶rsen-/Walletanbindungen und zusÃ¤tzliche Frameworkprozesse bleiben ausserhalb des Umfangs.


## Eigene Kausalitaetsprobe und noch offene GedÃ¤chtnispruefung

Vier Schnitte bei225/400/701/1400synthetischen15m-Bars vergleichen vollstÃ¤ndige Historie mit identisch begonnenen, auf den Entscheidungszeitpunkt abgeschnittenen Daten. Unfertige/zukÃ¼nftige15m- und Stundenkerzen werden zusÃ¤tzlich durch extreme, aber gÃ¼ltige OHLCV-Werte ersetzt. Features, kompletter Markt-/Regimekontext und Mockentscheidung samt Evidenz mÃ¼ssen exakt gleich bleiben. Alle vier PrÃ¼fungen bestanden. Das prÃ¼ft zeitliche KausalitÃ¤t dieser Pfade, keinen Profit, keine UnabhÃ¤ngigkeit von Samples und keine vollstÃ¤ndige Backtest-/Lernpipeline. Gleicher Warm-up-Beginn ist absichtlich erhalten; Indikatorrekursion kann bei anderem Beginn abweichen.

Quellcodeaudit von `apps/server/src/memory/index.ts` zeigt vor einer Lernintegration offene Risiken:
- `recall` verwendet die aktuelle Systemzeit statt eines expliziten historischen asOf; die vierstÃ¼ndige Altersgrenze allein schÃ¼tzt keinen historischen Replay.
- `globalStats` standardisiert anhand sÃ¤mtlicher gespeicherter Featurevektoren und cached nach aktuellem Kalendertag; zukÃ¼nftige Beobachtungen kÃ¶nnten einen historischen Nachbarschaftsabstand verÃ¤ndern.
- Outcome-RÃ¼ckfÃ¼llung sucht den letzten geschlossenen Kurs innerhalb einer Toleranz, statt fehlende exakte Horizontanker grundsÃ¤tzlich unbekannt zu lassen. UrsprÃ¼ngliche Entscheidungszeit und Feature-/Preiszeit sind zu unterscheiden.
- Gleiche/Ã¼berlappende Beobachtungen sind keine unabhÃ¤ngigen Versuche; der bisherige Kurztext kann trotz korrekter roher Trefferzahl zu viel Sicherheit vermitteln.

Diese Stellen wurden in dieser Runde nur untersucht, nicht korrigiert. Der neue Mock verwendet weder `recall` noch dessen Summarystatistik als Kauf-/Verkaufsignal. NÃ¤chste Umsetzung: explizite historische Zeit-/Outcome-Grenzen, nur vor asOf verfÃ¼gbare Skalierung, sichtbare AbhÃ¤ngigkeit/Duplikate und exakte fehlende Kursanker; dazu unabhÃ¤ngige Offline-Fixtures vor Lern-/Performancebehauptungen. Bestehende Daten nicht rÃ¼ckwirkend umschreiben.


##01.11 latest passes16/17

REVIEW-PASS16.md: verified existing OctoBot aggregation/MA semantics and Jesse entry lifecycle; own fixed hourly rule subsequently fully tested, all7basefeemonths negative, no promotion. REVIEW-PASS17.md: verified existing FreqAI train/test transform/abstention contracts, no blanket pipeline guarantee; independently reproduced OWN malformed-model gap subsequently fixed, full1132+15/120validforecastidentity.47selected archived sources incl5licences still partial. Historical/forward profitability not established; July locked.


##01.11 passes18/19 â€” cross-market sources and evaluator cycles

REVIEW-PASS18.md and REVIEW-PASS19.md record additional targetedsections of existing pinnedFreqtrade/Jesse/OctoBot sources.47selectedincl5licences remainspartial. Ownrelativehelper/filter nowfull28replays/128rawBUYverified: all7base monthsnegative, no promotion/July/codeport. Source-driven capability/explainability doesnotestablishprofit.

##01.11 pass20 â€” target semantics and protective-value validation

REVIEW-PASS20.md verifies two existing pinned source hashes: FreqAI future-window-average labels are not first-barrier outcomes or delayed-open trade PnL; Jesse checks finite exit values before cancellation of old protection. Own separate offline first-barrier contract retains ambiguous paths, complete-horizon maturity and cost/scope binding. No code copied/model fitted/active provider changed.47selected sources remain partial; economics with these new labels not yet evaluated.

##01.11 pass21 â€” intrabar/gap assumptions

REVIEW-PASS21.md verifies pinned Jesse backtest-mode gap execution and red/green intrabar ordering sections. Own same-OHLC/two-opposite-first-hit counterexample confirms unresolved path; no upstream heuristic or favorable gap-price improvement copied into original broker.47selected files remain partial, not full framework equivalence.

##02.11 pass22 â€” fixed local nonlinear model interface

REVIEW-PASS22.md adds one pinned Freqtrade LightGBM adapter source (manifest-pass22, GPL archive only), taking selected archive count to48incl5licences. Reuses the train-only/interface concept through an isolated free BSD sklearn numerical research bridge; no GPL implementation or external AI provider. Synthetic only:12TypeScript/6Python tests,46native/portable predictions match; no historical fit or profit claim yet.

##02.11 pass23 â€” time weighting versus row order

REVIEW-PASS23.md verifies pinned data-kitchen recency/split options. Own same-clock pooled-asset example shows why per-pair ordinal recency weights cannot be blindly imported into our20asset rows. No weighting/model/threshold changed;48selected files remain partial.

##02.11 pass24 â€” conditional shared seeds and unsampled volume

REVIEW-PASS24.md closes part of PASS14's base/caller lifecycle gap with one pinned MIT base-candles file (49selectedincl5licences). Equal explicit seeds/calls can synchronize price-block indices; this does not guarantee general route alignment or preserve price-volume relation when volume is unshuffled. Own numerical illustration, no synthetic-trade/independent-profit claims or model change.

##02.11 pass25 â€” strength versus direction and volume proxies

REVIEW-PASS25.md verifies existing pinned OctoBot ADX/Klinger sections. Own closed193bar DMI/ADX descriptor has16causality/domain tests plus60digit independent math proof; no vendor-code port, new trade rule or calibrated probability.49selected source files remain partial; active8Dinputs/packet unchanged.

## 02.11 â€” implementation follow-through after pass25

Research-only DMI enrichment now has exact full-history/replay-tail parity on all7280 original fixed clocks. Independent closed-form verification checks43680 descriptor values; original8D inputs/costed labels remain unchanged. One separately preregistered10D linear ablation appends ADX/100 and movement balance; its MAE.0147896 is worse than oldridge.0146762 andmean.0143508. All old control metrics exact; no promotion, threshold search, trading-profit inference orJuly. See DIRECTIONAL-CLOCK-LEARNING.md and DIRECTIONAL-RIDGE-WALKFORWARD.md.49selected upstream sources remain partial; this is own mathematical implementation, not additional upstream review or vendor code port.

##02.11 pass26 â€” volume reference/finality and actual retained fields

Existing pinned OctoBot optionalVWMA/callback and FreqAI relative-volume sections reviewed;49selected filesincl5licences stillpartial. Current-including rolling averages differ from our prior20reference. Own closed21bar volume-activity helper has18tests, explicit unknownzero-reference versus measuredzero, stable extreme normalization. All7280original clocks independentlyrawverified;7276ratios and4undefinedreferences verified with60digitDecimal, old8Dcolumn valuesexact. Two undefinedreferences have positivecurrent after20zeros; original vectors/reports preserved. No liquidity/signedflow from OHLCV, model/search/rule/packet change orJuly. Official publickline schema reviewed: quote/taker fields discarded by oldCandle cannot be reconstructed; see REVIEW-PASS26.md and VOLUME-ACTIVITY.md.

##02.11 â€” retained public-field implementation after pass26

Own research parser now retains actual public quote/taker/trade fields with strict96closedbar/capture clocks;34parser/aggregate/availability tests pass. One preregistered2pair/2request capture has192bars, immutable rawpayloads and exact legacyOHLCVparity. Independent60digitDecimal checks384shares and42fields across6descriptive windows. Capture time cannot be backdated to historicalclose+5s; stale windows denied. No vendorcodeport/newupstreamreview, activepacket/model/rule/account/reference change or profit evidence. See PUBLIC-EXECUTED-ACTIVITY.md;49selected upstream sources remain partial.

##02.11 â€” guarded research-context integration

Own executed-activity research bridge now binds public URL/symbol/closed-window/capture provenance, sealedrawpayload and96OHLCVcausal equality.29adapter+42related tests pass (71targetedtotal); actualcapture8scenarios andsyntheticrealbroker3callback fullcontext/fill/equity parity verified. No new upstream review/sourcecount, networkrequest, provider/strategy activation orprofitclaim. Original20market packet114758/115000 cannot fit even20newunknown rows; explicitblockade retained, research-only120000comparison117038 preservesfields. Activebudgetunchanged. See EXECUTED-ACTIVITY-REPLAY.md.49selected upstream filesincl5licences remainpartial.

##02.11 â€” lossless research transport verification

Own optional run representation preserves exact executed-activity states; full repeated sourcehashes are retained once with named references.53targeted tests and independent Python completeJSON reconstruction (2cases/20markets/106hashrefs each) pass. Original ordinary packet114758 unchanged;20unknown111439 andmixed2retained+18unknown114719 fit115000 withoutlimitincrease. Mixedcase transport-only, sourceclockavailabilitynotasserted; uniqueoversize stillblocks. No active serializer/provider/model/network change, no new upstream review orprofitclaim. See EXECUTED-ACTIVITY-ENCODING.md;49selected upstream files remainpartial.

##02.11 â€” original raw-source discovery and fixed aggressor ablation

Correction: normalizedCandle objects omit extra publicfields, but original immutablehistorical RAWpages alreadyretainall12. Probe8pages/124clocks thenpreregisteredfull480pages/7280clocks reusesoriginalbytes, zeroAPIrequests; allnormalizedOHLCV/fullfieldoverlaps exact, independent60digitDecimal7272known+8unknownfeatures verified. Explicit modeled-historical-close domain isnotactualfirstreceipt andcannotbypasscaptureguards. One fixed9Dlinear comparison has tinyMAEchange vsfaircommon8D(.01467358vs.01468139), stillworsemean.01435082; oldcontrols exact, no modelpromotion/profitclaim/July. See ARCHIVED-AGGRESSOR-SOURCES.md and AGGRESSOR-RIDGE-WALKFORWARD.md.49selected upstreamsourcefiles remainpartial; thisisownmath/sourceintegration, notadditionalvendorreview.

##02.11 pass27 â€” dependency mask boundary and support distance

PinnedFreqtrade requirements now retained (datasieve0.1.9), plus MITDataSieve v0.1.9commit93669d... licence/pipeline/wrapper/DI sources.54selectedfilesincl6licences, stillpartial. Stockinspectedpath initializesnewoutlierones anddoesnotpass earlierNaNmask beforedo_predictoverwrite; staticcall-path observation, notexecutedwhole-stackbug. Local32missingqueries/8missingtestrows remainnull. DInearest/meantrainingdistance describesinputsupport, notprobability; no blindthresholdport. See REVIEW-PASS27.md andsourcehashmanifest; no install/vendorcodeexecution.

Samefixed0.005ranking audit ofaggressor9D verified independently:56rankedopportunities stillnegative meanlabelâˆ’.0048001; original/extendedselectors exactlysame11keys across328clocks.45,920forecastrows/2,296choices checked, no newfit/selector/profit/brokerreturnclaim. AGGRESSOR-RANKING-AUDIT.md documentswhy no modelpromotion isjustified.

##02.11 â€” own clock-excluded support diagnostic follow-through

Own train-only geometry excludesALLsame-clocktrainingassets forreference distances;12tests/typechecks/build pass. Outcome-blind frozenbb7c60d... independentlyverified82snapshots/45870trainrefs/13120queries(16missing), no labels/forecasts inmetric. Onlythenpreregistered12group opportunityaudit a2de62e...:9Dwinner medianratio1.7037vseligible.7783,8D1.75vs.7346. Independentgroup checks all13120rows/106winnerrecords; descriptivecoverage-risk evidence, notcausalprofitproof/cutoff. No filter/model/forecast/ranking/provider changes. See FEATURE-SUPPORT-DIAGNOSTIC.md.54selectedsourcesincl6licences remainpartial; no additionalvendorcodeexecution orsourcecountclaim.

##03.11 â€” fixed empirical support-entry research

After support geometry wasfrozen andgroupaudit verified, ONEtraining-only95thnearest-rank cutoff wasregisteredbeforeevaluation.26targetedtests pass; independent82cutoffs/13120scores/656clockchoices verifiesbefore-rankingmasking and4common/6aggressor supportedalternatives, no null-reactivation ornewopportunityclocks. Rankedopportunities50â†’36 and56â†’42, butmeanlabels remainnegative(âˆ’.0047291/âˆ’.0034430). No promotion/thresholdsweep/predictivefit/profitclaim. SUPPORT-ENTRY-STUDY.md. No additionalupstreamreview;54selectedsourcesincl6licences partial.


##03.11 pass28 â€” performance denominators and clock-level validation evidence

PinnedJesse metrics.py/MIT retained with exactmanifest;55selectedfilesincl6licences remainpartial. Distinguish observed Sharpe/autocorrelation correction, win-rate denominator excludingbreakeven, arithmetic100tradeextrapolation andFreqAItrain-targetmean/std from calibratedconfidence. No vendor execution/port. Ownvalidationhelper19targetedtests/typechecks/build pass; independent6,560rows/32,800forecasts/328clockremovals reproducesoriginalselectors.160rows/fold only8clocks;320clocks reusedacrossvalidation/testroles, legitimatechronologybutnotindependentcorroboration.44modechanges translateinto9changedcandidatecases/15uniqueclocksonly. No activation/profitclaim. REVIEW-PASS28.md and VALIDATION-EVIDENCE.md.


##03.11 â€” own per-field market receipt evidence

Actualpublicfeed/contextaudit found sharedreceipt conflation. Ownfield-specificclocks now preservebid/ask/last/volume/change24h ages throughpartialupdates; initialRESTreceiptcapturedbeforeunrelatedmetadatawait. Reusedexistinglosslesscolumncodec retainsallticker/qualityevidence inoriginal115000budget; legacy114758packetexact.110targetedtests/server+test+webtypechecks/buildpass; independentPython120marketrecords/threeinitial+repackedcases exact. No newsources/vendorport/profitclaim;55selectedupstreamfilesincl6licences remainpartial. TICKER-SOURCE-CLOCKS.md. FrozenV3buildverifiedunchanged; workingbuildnotrestartedintoexistingservices.


##03.11 â€” target/loss alignment and actual mock consumer verification

Ownfrozen-forecastvalidationMSEcomparator testsconditionalmeanratherthanmedian; no vendorport/newsources oractivation.51targetedtests/typechecks/buildpass; independent41choices/6560validationrows/26240testforecasts/328ranks. Sixopportunitiesmeanlabelstillnegativeâˆ’.0072252, MSEselectorworsethantrainingmeanbaseline. Previouslyexaminedhistoryisnotnewholdout; noparameter/thresholdsearch/July/profitinference. Throwing-gettertest confirmsactualmockdoesnotreadunqualifiedtickerstats/aggregateage, no unusedsignalreaderadded. VALIDATION-LOSS-OBJECTIVE.md.55selectedfilesincl6licences remainpartial.


##03.11 â€” own learned common-market ablation

PASS18/19alreadycoveredrelativehardentryrules; thisdistinctONEBTC4hclosedsourceinputto8Dnetridge usesexactsame-clockcontracthashes/missingBTCabstention.12TS+3Python tests/typechecks/buildpass; independent7280bindings/41folds/697normal-equationcoefficients/26240rawqueries/65600forecasts/1968choices. BTC9DworsensMAE/MSEandrankedmeanlabels; extendedMSEselectornegativeandworsethanfairparentlibrarywithoutnewfeature. Noactivation/featuresearch/July/profitclaim. COMMON-MARKET-RIDGE.md. No new upstreamsource/vendorport;55selectedfilesincl6licencesstillpartial. NextunresolvedJessecandlepipelinecrossassetdependence reviewfromPASS3/13, notanotherloser-drivenfeaturesearch.


##03.11 pass29 — joint candle-block dependence and risk stress

PinnedMITJessebase/MBB/Gaussiansources retained and existingperroutefactoryreviewed. MultivariateOHLCtuplesarenotautomaticallyjointassetplans; same-seed/equalstreamscansynchronizeindicesconditionally, copiedvolumeisnotresampledwithprice. No universalupstreamdefectclaim. Ownexplicitjointplan/relativeOHLC+basevolumeadapter17tests+18covariance=35pass/typechecks/build. Archived20marketJan7700sourcebars,2deterministicscenarios7720bars/800coventries/2riskbudgets independentlyverified withDecimal; no orders/profit/independenceclaim. REVIEW-PASS29.md andSYNCHRONIZED-STRESS.md. Inventoryrecount56distinctfilesincl6licencescorrectsolderovercounts; no source deleted.


##03.11 — actual multi-position adverse-gap integration and quote-trigger correction

Own4Safe/RiskymultiassetfixturesexerciseactualScheduler/Paperbroker/SQLitefailureledger: paused/daily-cap protection, adversegapVWAP, staleotherbook/unknownvaluation, durablemanagerrestart/recoveryintent, repeatedtickdedup. Independent16fills/fees/lotrounding/basis/cash/PNL verified to1.30e-13; syntheticoperationalstressonly. ActualKrakenhandleroldbid-on-statisticsupdate defectreproducedredthenfixedwithpayloadbid+exactreceipt guard; final44targetedtests/typechecks/buildpass. No upstreamsourceaddition/vendorport; authoritativeinventory56incl6licencespartial. COMMON-SHOCK-PAPER.md.


##03.11 — native public activity first-receipt building block

Following modeledhistoricalaggressorlimitations, officialBinanceWSschema snapshotted separately(protocoldocs,notframeworkcatalog). OwnnativeWSparser/exactdecimalfacts/append-onlydedicatedjournal andoptionalfeederobserver39tests/typechecks/buildpass. IndependentrealSQLitefixtureclose/read-onlyreopen5observations/9as-ofqueries/hash/conflict/receiptgates verified; SYNTHETICfixtureonly,0actualmessagescaptured. Observernotwiredinrunningmain, no strategyactivation/defaultDB/source/frozenchanges ornewmarketrequests. WS-ACTIVITY-JOURNAL.md. Namedframeworkinventory56distinctincl6licencesremainsunchanged/partial; noprofitclaim.


##03.11 — qualified first-receipt provenance and current native windows

Ownmain-onlyfree-runtimecapture-sessionfactory preservesnone/mockcompatibility/excludesfrozenexperiment; append-onlyatomiclinks preventreclassifyingunbound/fixturedata. Qualifiedscopeearliestreceiptscannotborrowoldunboundtimestamps; fixtureconflictsdo notsupplyreal-sourceview. Strict4/16/96currentclosedOHLCVmatchedread-onlysnapshots.64targetedtests/typechecks/buildpass; independent193rows/4mockheaders/10queries/5completepolicy-testwindows/hash/aggregatesverified. ALLSYNTHETIC,0actualmessages; metadatahashesnotcryptoexchangeauth. WS-ACTIVITY-WINDOWS.md. No newsources/vendorport/model/provider/defaultDB/frozenchange;56namedupstreamsinc6licencespartial.


##03.11 — actual prospective public source capture

Ownmain-onlyopt-incapturelifecycle85targetedtests/typechecks/buildpass; guardedPaperrolloutpreserved3accounts/oldtrade/51epochsandfrozenreference. IndependentSQLite/rawnativeJSON/Decimal/session/deploymentchecksverifiedfirst20actualmessagesbutONEshared15mclose;4/16/96windowsunknown. No model/ruleactivation/profitclaim. WS-ACTIVITY-CAPTURE.md. No frameworksourceaddition/vendorport;56selectedfilesincl6licencesunchangedpartial.


##03.11 pass30 — explicit numeric/state validity at entry boundary

PinnedretainedFreqtradecustomstopfiniteguard/Jesseordernormalization/OctoBotmatrixvalidityconceptsrevisitedand3sourcehashesverifiedagainstinventory. Ownsharedriskmalformedstatebugred14casesfixed;19new/1622fullservertests+types/build+5000validdifferentialcasespass. Protectiveexitsremainentryguardindependent; no profitclaim/vendorport/newsource/deployment. REVIEW-PASS30.md/RISK-INPUT-CONTRACT.md.56retainedfilesinc6licencesunchanged,whole-projectreviewpartial.


##03.11 — drawdown at execution boundary

RevisitedretainedFreqtradeMaxDrawdownclosed-tradevsfreshmarkedopenportfolio distinction(REVIEW-PASS3/14); no newsource/vendorport. Own3brokerdefectsredthenfixed/6newtests/full1628pass+types/build. Existingconfiguredlimit/persistedpeakcheckedpre/postlatencyandknownpostfillcosts; replayaligned/sellprotectionpreserved. DRAWDOWN-EXECUTION.md/proof. No profitclaim/thresholdsearch/deployment;56sourcesincl6licencesunchangedpartial.


##03.11 pass31 — calendar recency versus row weighting and continual reuse

Three retained pinnedFreqAIweights/LightGBMsampleweights/initmodel paths rechecked+sourcehashverified. Own optional shared-clock/calendar-maturity weights +weighted8Dridge/metadataimplemented;52tests/types/build and80digit8479weights/normal-equations pass. Old8479rowplainmodel EXACTunchanged. No vendorport/newsource/install, no Mayretuning/performanceclaim/activechange. REVIEW-PASS31.md/CALENDAR-CLOCK-WEIGHTING.md;56sourcesincl6licencesunchangedpartial.

## 04.11 pass32 — coverage of a shared market clock

Rechecked pinned OctoBot-Tentacles LGPL-3.0-or-later source at commit c45fdc2c95c5bd3d649251fa90c327e2e8f86b00. The mixed strategy requests configured TA timeframes, then combines available valid notes. Its social branch passes observation time and expiry to the validator. The technical strategy applies the timeframe weight once per available evaluator, so the effective timeframe weight depends on the number of valid evaluators. This is a configuration property of the examined implementation.

Our Paper market breadth now identifies the shared closed clock and gives each metric its own coverage count. It counts each unambiguous pair once and derives 24-hour returns from complete aligned candle windows with a preceding close. This uses an original implementation and keeps the breadth descriptive. The archived source inventory remains at 56 files including six licences.

Reviewed source SHA256 6ad600f312614b6509ef239488d66cddb45a487a6d66c37e8d1feeb0881b78c8. [Pinned mixed strategy source](https://github.com/Drakkar-Software/OctoBot/blob/c45fdc2c95c5bd3d649251fa90c327e2e8f86b00/packages/tentacles/Evaluator/Strategies/mixed_strategies_evaluator/mixed_strategies.py)

## 04.11 pass33 — trend direction and concentration

Rechecked Jesse er.py at aded4b9d51d432d411a8f7fbf45e47572dff6629 (MIT, SHA256 223debf7ca989984e4e184799dca39a775b77d8fc7c825484f3e68186bd824fb) and OctoBot trend.py at c45fdc2c95c5bd3d649251fa90c327e2e8f86b00 (Tentacles LGPL-3.0-or-later, SHA256 b97cd8c4f9805ff93e7187e8b8f05b6376b3a0432a6b23753270c8c697d23f3c). Jesse's retained ER source uses a higher-order difference and a scalar window sum. Our existing endpoint/path definition already differs. OctoBot's EMA divergence evaluator compares the latest price to one EMA. With the retained defaults its two ordered comparisons cover the finite domain, so that branch is unsuitable as a neutral regime classifier for this project. This is a source-level observation about the pinned file.

The original four-hour move-concentration descriptor distinguishes a single jump from a distributed directional path even when endpoints and efficiency are identical. It records the largest absolute log move's share of the path and positive/negative move counts. In consumed May and June data, the losing month actually showed lower mean concentration at the selected entries. The descriptor remains research-only. No upstream source was copied or installed. The archive inventory remains at 56 files including six licences.

## 04.11 pass34 — drawdown sampling

Verified the existing MIT Jesse metrics.py from commit aded4b9d51d432d411a8f7fbf45e47572dff6629, SHA256 00561472a7e1a669ab14410c8e4c0cbe1d05b0153626b71f26d55dc85f48e06d. The examined function builds observed balance returns with pct_change and computes peak-to-trough decline over their cumulative curve. It can attach balance timestamps when supplied. The calculation does not create additional observations between balances.

On the consumed June rule portfolio, Decimal recomputation from the stored curve yielded 2.475242% at UTC daily endpoints and 3.188361% at 15-minute closes. The replay with open and close marks also reported 3.188361%. On ungated momentum the respective values were 8.668456%, 8.673662% and 8.818541%. This is an internal cadence comparison using the same simulated fills and starting equity. It is not claimed to reproduce Jesse's data, seed treatment or execution. Compare drawdown figures only with their observation and execution scopes. No source port, new archive file or external execution.
