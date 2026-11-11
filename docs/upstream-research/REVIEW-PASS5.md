# Zielsemantik und zustandsbehaftete Signale, Pass5 — 31.10.2026

Fuenf weitere gezielt gelesene Dateien, insgesamt36ausgewaehlte Dateien; keine vollstaendige Untersuchung der drei Projekte. Separate manifest-pass5.json jeProjekt mit gepinntemCommit/URL/Bytes/SHA, alleHashes nachgelesen. Keine Fremdausfuehrung/Installation/Keys, kein Quellcode in die Anwendung kopiert. Eigene kleine Umsetzung von Ziel-/Verfuegbarkeitsprinzipien, keine Relizenzierung des Bots.

## Freqtrade / FreqAI

[FreqaiExampleStrategy](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/templates/FreqaiExampleStrategy.py) trennt benannte Feature-/Zielspalten und das do_predict-Gueltigkeitssignal. Das Beispielziel ist ein kuenftiger rollender Durchschnitt relativ zum jetzigen Close; es ist kein Nettoergebnis einer gefuelltenPosition mit Gebuehren/Stop/Trendexit. Beispielentrys nutzen Zielschwellen und Gueltigkeit. Daraus folgt keine gepruefte gewinnbringende Konfiguration und kein Grund, die Beispielschaellen in unseren Bot zu kopieren.

[SKLearnRandomForestClassifier](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/freqai/prediction_models/SKLearnRandomForestClassifier.py) instanziert/fittet einen RandomForest mit Trainingsgewichten, kann Testscore ausgeben und warnt, dass continual_learning nicht unterstuetzt wird. Die score-Methode misst Klassifikationsgenauigkeit laut [offizieller scikit-learn-Dokumentation](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.RandomForestClassifier.html#sklearn.ensemble.RandomForestClassifier.score). Diese Metrik umfasst keine Handelskosten, Rendite oder Kalibrierungspruefung. Das vorher gepruefte Basismodell besitzt eigene Feature-/Label-/Gueltigkeitspipeline; kein Beleg fuer automatische kalibrierte Gewinnwahrscheinlichkeit.

Die [Classifier-Teststrategie](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/tests/strategy/strats/freqai_test_classifier.py) setzt mit einem Vergleich zu100Kerzen spaeter die Klassen up/down. Ein nicht vorhandener Futurewert kann bei naivem Vergleich den False-Zweig down erhalten. Diese konkrete Testfixture ist kein Beweis fuer Verhalten jeder produktiven FreqAI-Trainingspipeline; Tail-/Verfuegbarkeitsfilter muessen gesondert nachvollzogen werden. Fuer unseren Code ist die Anforderung klar: unbekannt bleibt unbekannt, nicht automatisch Verlust oder negatives Preissignal.

GPLv3-Hauptlizenz und Originalhinweise erhalten. Kein RandomForest-/Pandas-/ML-Paket installiert, keine externeKI/Trainingsserver angebunden.

## OctoBot-Tentacles

[Trendmodule](https://github.com/Drakkar-Software/OctoBot/blob/c45fdc2c95c5bd3d649251fa90c327e2e8f86b00/packages/tentacles/Evaluator/TA/trend_evaluator/trend.py): SuperTrend berechnet ATR-Baender und speichert vorherigeBaender/Trend jeSymbol/Zeitframe, unterscheidet Umschlag/Fortsetzung und einen reversal-only-Modus. Eine isolierte ATR-Zahl ersetzt diesen Zustand nicht. Bei Wiederverwendung muessen Warm-up/Reset/gleicherKerzenzeitpunkt/Replaypraefix geprueft werden. DoubleMovingAverageTrend nutzt normalisierte Abstaende/Kreuzungen und ein heuristisches Bewegungsstadium; solche Scores sind keine kalibrierte Erfolgswahrscheinlichkeit.

[Momentummodule](https://github.com/Drakkar-Software/OctoBot/blob/c45fdc2c95c5bd3d649251fa90c327e2e8f86b00/packages/tentacles/Evaluator/TA/momentum_evaluator/momentum.py): RSIMomentum hat Trendwechsel- und Schwellenpfade. Die Callbackdatenabfrage reicht include_in_construction weiter; nicht pauschal jede Upstreamauswertung als geschlosseneKerze behandeln. Unsere historischeSimulation erlaubt ausschliesslich nachweislich geschlosseneVergangenheit. Die geprueften Abschnitte enthalten keine empirische Netto-Erfolgskalibrierung. Nicht alle weiteren Klassen dieses44983Byte-Moduls vollstaendig auditiert. Header LGPLv3+, Paketlizenz schon archiviert; keine direkte Codeuebernahme.

## Konkrete Umsetzung und offene Arbeit

Eigene policy-labels-v1 leitet statt einer pauschalen4hPreisrichtung das tatsaechliche Nettoergebnis derselben simuliertenPositionspolicy ab. Dataset/Replaybuild/Decisioncode/Kosten-Szenario strikt gebunden. Outcome erst nachExitkerzenschluss plus deklarierten5s nutzbar; dies ist eine historischeSimulationsannahme und NICHT der beobachtete erste Empfang. Tatsaechliche Artefakterstellung wird getrennt gespeichert, Nutzung braucht expliziten historical-simulation-Modus. Keine Eintraege in verifizierteLive-Memory.

Offene/illiquideRestpositionen und reineTestendliquidation sind zensiert; keine trainierbare Klasse daraus. Teilverkaeufe/Scale-in/unpassendeLedgers werden abgewiesen statt erfunden. DoppelteEpisoden zaehlen einmal jeScope; unterschiedlichePolicy/Kosten werden nicht als unabhaengige Daten vermischt. Keine automatische dauerhafte Regel aus wenigen Gewinnern. Dies schafft bessere Voraussetzungen fuer ein spaeteres lokales Lernexperiment, kein erfolgreich trainiertesModell.

Weiter offen: umfassendere Zustands-/Backtest-/ML-/Testpruefung aller drei Projekte, geeignete lizenzkompatible Implementierungsuebernahmen, konkrete Feature-Verknuepfung und faire zeitliche Modellvalidierung.36Dateien, Beobachtungen und Klassifikationsscores ersetzen weder100produktiveStunden noch einen Profitnachweis.
