# Zeitlich getrennte Lernvorbereitung

31.10.2026. Ausschliesslich lokale Paper-Forschung. Kein neuer Entscheidungsprädiktor trainiert oder aktiviert. Vorhandener laufender Hauptbot unverändert; alle92vorherigen kompilierten Module sind bytegleich. Neuer Offlinebuild9d2052fa1d972b8cd0e0abcbaf614c0e481b26d846899205510e37925aa2ffd5.

## Was jetzt konkret geschützt ist

`research/policy-learning.ts` nutzt `eligiblePolicyInputs` und die vorhandene Scope-/Hash-/Zeitprüfung. Ein Trainingsfenster enthält nur Einstiege ab seinem Beginn, deren konkretes Netto-Ergebnis vor der nächsten Entscheidungsgrenze verfügbar wäre. Ein Ergebnis genau an dieser Grenze wird ausgeschlossen: die Reihenfolge zweier Ereignisse mit demselben modellierten Zeitstempel ist nicht belegt. Alle Coins erhalten gemeinsame Zeitgrenzen. Doppelte IDs erhöhen das Gewicht nicht.

Die Sperre richtet sich nach dem tatsächlichen simulierten Exit und dessen modellierter Verfügbarkeit, nicht nach einem pauschalen4hHorizont. Das zusätzliche Embargo ist verstrichene Zeit in Millisekunden. Ein Zeilenabstand wäre bei unregelmässigen Trades/mehreren Coins unzureichend. Auch Validierungsergebnisse für eine spätere Modellauswahl müssen vor dem Testbeginn verfügbar sein. Test-Ergebnisse nach Testende bleiben ausgeschlossen.

Mittelwert, Populationsstandardabweichung und Gewichte der beobachteten Gewinn-/Verlust-/Nullklassen entstehen ausschliesslich aus reifen Trainingsdaten. Leere Trainingsmengen verweigern die Anpassung. Eine nie beobachtete Klasse hat Gewichtnull, keine erfundene Wahrscheinlichkeit. Klassengewichte sind Trainingshilfen und keine Erfolgsschätzung.

Fehlende Werte werden anhand des Trainingsmittelwerts transformiert und zusätzlich mit einer Missing-Maske markiert. Ein im Training nie beobachtetes Feld bleibt unsupported/null. War ein Feld im Training konstant, bleibt eine später erstmals auftretende Abweichung ebenfalls unsupported/null. Beobachtete konstante Nullen sind bekannte Werte. Das ist kein allgemeiner Out-of-distribution-Detektor. Ein künftiger Prädiktor benötigt eine ausdrücklich definierte Behandlung dieser Masken; ein stiller Ersatz unbekannter Fakten durch neutrale Evidenz ist nicht zulässig.

Feature-Reihenfolge, Trainings-IDs und Inputhashes, Zeit-/Scopegrenzen, Statistiken und Klassengewichte werden im Preprocessorhash festgehalten. Validierung und Test transformieren mit diesem unveränderten Preprocessor. Es gibt keinen zufälligen Split oder automatischen Rückgriff auf spätere Daten.

## Tatsächlich ausgeführtes Audit

Vor diesem Audit registriert: `policy-learning-protocol-v1.json`. Die Historie war bereits untersucht; das ist eine retrospektive Methodenprüfung und kein unabhängiger OOS-Nachweis. Zwei expandierende Fenster mit Validierungsbeginn an Tag7/14 und Testbeginn an Tag14/21. Kein Parameter wurde anhand der Resultate ausgewählt.

| Basisszenario | Fenster | Training | Validierung | Test |
|---|---:|---:|---:|---:|
| Mockv1 |1|16|12|15|
| Mockv1 |2|28|15|10|
| Mockv2 |1|11|7|11|
| Mockv2 |2|18|11|9|

Im ersten Testfenster wurde bei beiden Varianten je einer der16/12Einstiege wegen zu später Ergebnisverfügbarkeit ausgeschlossen. Entsprechend fehlt dieser Trade im Validierungsfenster des zweiten Durchlaufs. Das ist keine verlorene Datenzeile und kein Null-Ergebnis.

Im ersten Mockv2Training stehen1Gewinn und10Verluste, im zweiten2Gewinne und16Verluste. Es gibt jeweils15variierende Eingabefelder. Die gebührenverdoppelten Szenarien besitzen nur2–4Trainingsbeispiele und keine Testtrades. Solche Mengen rechtfertigen keine komplexe Anpassung oder belastbare Kalibrierung. Null Testtrades ergeben keinen messbaren Vorhersageerfolg.

Die Tradeauswahl stammt aus bereits ausgeführten Mock-Strategien: selektierte, überlappende und marktübergreifend korrelierte Beobachtungen. Das ist weder ein vollständiger Satz kontrafaktischer NO-TRADE-Ergebnisse noch eine unabhängige Stichprobe. Spätere Modelle dürfen daraus keinen universellen Tradevorteil ableiten.

Zweimal identische Fakten: `policy-learning-4053342b179c68a4.json`, SHA4053342b179c68a43cc517a233cb2a6816e454de21bebb9842fd145bf51898f9.14neue Vertragstests; vollständige787Haupttests+15Offline/alle Typchecks/Build bestanden. `policy-learning-proof.json` bindet Source/Test/Protokoll/Audit-/Prüflogs. Hauptlaufzeit nachlesend verbunden/20Features/20Paare/Paper-only/AIaus/Remoteaus. Kein Neustart notwendig, da bestehender Bytecode unverändert.

## Gezielte Anwendung der untersuchten Quellen

Das gepinnte [FreqAI BaseClassifierModel](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/freqai/base_models/BaseClassifierModel.py) passt die Featurepipeline auf train_features an und transformiert test_features mit derselben Pipeline. [DataKitchen](https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/freqai/data_kitchen.py) berechnet numerische Labelstatistiken aus train_labels; seine Splitrichtung ist konfigurierbar. Unsere eigene kleine TypeScript-Umsetzung übernimmt das Trennungsprinzip und ergänzt die konkrete Exit-Verfügbarkeit und Scopebindung. Kein GPL-Quelltext kopiert; archivierte Quellen/Lizenzen unverändert.

[scikit-learn: Datenleckagen](https://scikit-learn.org/stable/common_pitfalls.html#data-leakage) erläutert den ausschliesslichen Fit von Vorverarbeitung auf Training. [TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) definiert gap als Zahl ausgeschlossener Samples; daraus leiten wir ab, bei unseren unregelmässigen Trades stattdessen explizite Zeit-/Verfügbarkeitsgrenzen zu verwenden. Keine dieser Quellen belegt die Profitabilität unseres Mocks.

## Nächster fachlicher Schwerpunkt

Breitere Regime-/Strategie- und Ein-/Ausstiegsintelligenz mit vertiefter geeigneter Jesse-/OctoBot-/Freqtrade-Quellprüfung. Bisherige36ausgewählte Dateien sind keine gründliche Gesamtuntersuchung. Konkrete Gegenbeweise, Kosten und unveränderte Baseline berücksichtigen. Neue Regeln vor künftiger Auswertung registrieren; bekannte Verlusthistorie nicht auf Gewinne optimieren. Für einen neuen prospektiven Vergleich feste registrierte Symbols, aktuelle Exchange-Metadaten und einen neuen unverwechselbaren Vertrag nutzen; den wegen Universumsdrift gestoppten V2Root unverändert erhalten. Keine weitere Lerninfrastruktur als Ersatz für echte Entscheidungsarbeit.
