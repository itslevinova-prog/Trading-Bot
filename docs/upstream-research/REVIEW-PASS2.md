# Zweiter gezielter Quellenvergleich: Lernpipeline und Signalgueltigkeit

30.10.2026. Sechs weitere Dateien derselben gepinnten Commits rein lesend archiviert, eigene manifest-pass2.json pro Projekt. Damit20ausgewaehlte Dateien insgesamt, weiterhin keine vollstaendige Projektpruefung. Fruehere Manifeste und Erstbericht bleiben unveraendert erhalten. Keine Programme installiert/ausgefuehrt und kein fremder Quelltext in die Anwendung uebernommen.

## Freqtrade / FreqAI

[BaseRegressionModel](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/freqai/base_models/BaseRegressionModel.py) trennt Feature-/Labelfilterung, Split, fit_transform auf Training und transform auf Test. Die konkrete Modellanpassung liegt in fit der abgeleiteten Klasse. Vorhersagen werden durch die gespeicherte Pipeline transformiert; Outlier-Maske und Vorhersagewerte sind getrennt. [BaseClassifierModel](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/freqai/base_models/BaseClassifierModel.py) besitzt denselben Grundablauf fuer Klassifikation. Das ist kein Beleg fuer Profitabilitaet eines bestimmten Modells.

Das schon archivierte [Interface](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/freqai/freqai_interface.py) behandelt ein abgelaufenes Modell in einem nachfolgenden Rueckgabepfad mit eigener do_predict-Kennung; die Strategie muss diese beruecksichtigen. Initiale Vorhersagerueckgabe ist ein eigener Pfad. Nicht pauschal behaupten, dass irgendeine numerische Null eine gueltige neutrale Prognose sei.

Konkrete Ableitung: lokale kuenftige Lernprototypen muessen Features/Labels, Trainingsgrenze, Labelverfuegbarkeit, Skalierungsparameter, Gueltigkeitsmaske und Modellalter explizit speichern. Fit nur auf zeitlich zulaessigen Trainingsdaten, Test nur transformieren. Unsere neue Memory-Skalierung nutzt ausschliesslich zu asOf reife/belegte4h-Kandidaten. Das ist eine vergleichbare zeitliche Trennung, keine Uebernahme von FreqAI und noch kein trainiertes Modell. GPL-Hauptlizenz/Komponentenhinweise erhalten; vor Quellcodeintegration Kompatibilitaet konkret pruefen.

## Jesse

[AiModel](https://github.com/jesse-ai/jesse/blob/aded4b9d51d432d411a8f7fbf45e47572dff6629/jesse/models/AiModel.py) speichert Provider-/Modell-/Zugangsparameter. Der [AI-Controller](https://github.com/jesse-ai/jesse/blob/aded4b9d51d432d411a8f7fbf45e47572dff6629/jesse/controllers/ai_model_controller.py) verwaltet diese Datensaetze. Diese beiden Dateien enthalten keinen lokalen historischen Trainings-/Tradingpraediktor. Daraus folgt keine Behauptung ueber saemtliche anderen Jesse-Dateien.

Fuer unseren Auftrag diese Providerverwaltung ueberspringen. Keine Zugangsdaten erstellen, keine fremde Datenbank oeffnen, keine Controller importieren. Wertvolle weitere Jesse-Prueffelder bleiben Strategie-/Warm-up-/Order-/Backtestsemantik und Tests unter MIT, nicht eine zusaetzliche externe KI-Anbindung.

## OctoBot

[StrategyEvaluator](https://github.com/Drakkar-Software/OctoBot/blob/c45fdc2c95c5bd3d649251fa90c327e2e8f86b00/packages/evaluators/octobot_evaluators/evaluators/strategy_evaluator.py) fuehrt getrennte Evaluator-/Symbol-/Zeitrahmen-Updates und prueft Werte/Zeitgueltigkeit in der Matrix mit erlaubter Zeitabweichung. [TAEvaluator](https://github.com/Drakkar-Software/OctoBot/blob/c45fdc2c95c5bd3d649251fa90c327e2e8f86b00/packages/evaluators/octobot_evaluators/evaluators/TA_evaluator.py) markiert regulaere Kerzen-Schlussausloesung; Re-Evaluierung besitzt einen gesonderten Pfad mit eigenem Status. Nicht jede aktualisierte Nachricht bedeutet automatisch einen neuen abgeschlossenen Zeitschritt.

Ableitung fuer kuenftige Regime-/Strategieauswahl: jede Evidenz braucht Quellzeit/Zeitrahmen/Gueltigkeit; doppelte Re-Evaluierungen eines Fensters liefern keine neuen unabhaengigen Samples. Unsere Memory-Belege unterscheiden Feature-Schluss, Beobachtung und Outcome-Verfuegbarkeit und entfernen gleiche/ueberlappende Fenster aus den ausgewaehlten Hits. Das ersetzt keine vollstaendige Evaluatoraggregation. Beide Dateien tragen LGPLv3+-Hinweise; Originale/Lizenzdatei bleiben erhalten.

## Naechste fachliche Umsetzung

1. Unveraenderte Regelbaseline und neue Trend-Forschungsheuristik mit offenem Gueltigkeitsstatus erhalten. Kein unvalidiertes Nachbar-Erfolgsverhaeltnis als Kaufwahrscheinlichkeit verwenden.
2. Vor lokalem Lernen chronologische Trainings-/Validierungs-/Testsplits mit mindestens Labelhorizont-Abstand definieren, Labelverfuegbarkeit kontrollieren und Quellen-/Feature-/Kosten-/Modelversion speichern. Schon eingesehene Historie bleibt retrospektive Entwicklungs-/Stresstest-Evidenz; neue unabhaengige prospektive Daten gesondert sammeln.
3. Konkrete Regressions-/Regime-Auswahlvariante gegen einfache konstante/NO-TRADE-/Regel-/Hold-Vergleiche pruefen, bevor sie Entscheidungslogik steuert. Keine externe KI, neuen Dashboards, Exchangeanbindungen oder bezahlten Dienste. Modelle muessen bei fehlenden/ungueltigen Daten oder veraltetem Training abstimmen koennen, ohne hartes Risiko zu umgehen.
4. Noch offen: umfangreichere Strategie-/ML-/Simulationsmodule und Tests aller drei Projekte, historische Walk-forward-Auswertung und beobachtete Paper-Ergebnisse. Umfang ist ausdruecklich nicht abgeschlossen.
