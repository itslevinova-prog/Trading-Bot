# Ausstieg bei bestätigter aktueller Strukturverschlechterung

31.10.2026. Neuer opt-in StructureExitPaperProvider verwendet den bestehenden Kovarianz-/Trendprovider und bleibt innerhalb desselben DecisionProvider/getEvidence-/PaperReplay-Designs. Keine Änderung an Standardprofilen/Schutz-Stops und keine reale KI-/Echtgeldanbindung.

## Was die Regel weiss

Für eine eindeutig gehaltene Position mit positiver bekannter Menge und bekanntem Eröffnungszeitpunkt muss nach dem Einstieg eine neue geschlossene Beobachtung vorliegen. Passende Feature-/Book-/Marktdaten und closed-structure-v1 mit bestätigtem, die Signalkerze ausschliessendem20Kerzen-Support sind erforderlich. Wenn der Schluss darunter liegt, unter EMA20 liegt und1hMomentum negativ ist, wird ein zusätzlicher vollständiger Strategieausstieg vorgeschlagen. Supportpreis und Downsidebreak-Flag müssen konsistent sein.

Ein Docht unter Support mit Schluss darüber, nicht negatives1hMomentum, Preis oberhalb EMA20, zukünftige/unfertige/veraltete/falsch zugeordnete Daten oder unbekannte Eröffnung erzeugen diesen zusätzlichen Exit nicht. Bestehende Bearish-Ausgänge bleiben selbst ohne diese Zusatzinformationen möglich. Schutz-Stops überwacht der Broker unabhängig. Bestehende bestätigte Ausgänge haben Priorität; optionale Ausgänge werden deterministisch ergänzt, maximal3Empfehlungen insgesamt und höchstens der bereits zulässige einzelne Kauf. Ein eigener Signalvorschlag ist keine bestätigte Ausführung.

Die Regel bewertet **aktuelle Marktstruktur**, nicht eine historisch rekonstruierte Einstiegsthese. Der Positionsdatensatz enthält die ursprüngliche These nicht ausreichend. Diese Unterscheidung steht ausdrücklich in Evidenz und Erklärung. Es gibt keine Gewinn-/Wahrscheinlichkeitsbehauptung und keine neue Sperre, die Verlustausstiege wegen fehlenden Gewinns verhindert.

## Prüfung und Vergleich

16gezielte Tests: erlaubter Ausstieg trotz noch positivem4hTrend und geringem Einstiegsvolumen, Docht-/Momentum-/EMA-Gegenfälle, fehlende/future/mixed/alte Daten, unbekannter/zu frischer Einstieg, doppelte Position, Nichtpaper, unabhängiger Baselineausgang, keine doppelten Exits, Determinismus/Schema/keine Kontextmutation. Vollständiger Typcheck fand zunächst den zu breiten Action-Pair-Typ im optionalen Sortierer; eine präzise Sell-Liste behebt das. Final836Haupttests+15Offline/Source-Test-WebTypchecks/Build bestanden.

Zusätzlich ein bestätigter UTF8-Fehler in der zuvor neu angelegten Kovarianz-Kauferklärung repariert. Der neue kompilierte Text lässt sich reversibel exakt in den vorherigen Hash zurücktransformieren; keine Risikorechenregel geändert. Alle alten Artefakte bleiben erhalten. Der Vergleich prüft die vollständigen wirtschaftlichen Kovarianz-Baselinefakten exakt gegen Bericht88995ecf; allein Reasonstrings werden für diese deklarierte Textreparatur ausgeklammert.

Vor Auswertung registriertes Protokoll7895a798. Bekannte20Markt-Historie/1000EUR/Safe/5bpsSpread+Slippage/angenommene Tiefe1000Quote, Gebühren0.1%und0.2%. Tatsächlich zweimal derselbe Bericht structure-exit-study-5e7a4bf0170e6610.json, Hash5e7a4bf0170e66101ad724fac8cafb79d73c82efa3484c3bef10297a9936dc99. Build38b76f73093d0b5ab8975f859a671a24fc316c93f0697f83eebde0c9c57b8886(108Source/98Runtime). JeSzenario2593gemeinsame Entscheidungszeitpunkte mit identischen exogenen Markt- und Kovarianzinputs.

| Basisszenario | Kovarianzv1 | Mit Struktur-Exit |
|---|---:|---:|
| Nettoertrag |−3.0478%|−1.8880%|
| Max.Drawdown |3.2658%|2.9417%|
| Geschlossene Trades |39|42|
| Gewinnrate |15.3846%|23.8095%|
| Profitfaktor |0.5715|0.6628|
| Mittlerer Netto-PnL |−0.7815|−0.4495|
| Gebühren |10.2345|11.4221|
| Zusätzliche Strukturausgänge |0|27|

Hier27Vorschläge und27im Paper-Ledger nachgewiesene Strukturausgänge; das beweist nicht, dass jeder davon einzeln Geld sparte. Früheres Schliessen verändert freie Slots, Kapital und spätere Wiedereinstiege. Tradeanzahl und Gebühren steigen. Die zusätzliche Ausstiegslogik hat also eine echte Wirkung auf Entscheidungen und Ausführung im Modell.

**Keine verlässlich profitable Strategie:** das Ergebnis bleibt negativ/hinterCash0%, PFunter1. Nur zwei von vier Carry-Wochensegmenten sind besser; zwei sind schlechter. Frühere positive Wochen gleichen spätere grössere Verluste aus. Diese Slices sind wegen mitgetragener Positionen keine unabhängigen Walk-forward-Folds. Bekannte Entwicklungsdaten und mehrere untersuchte Hypothesen erlauben keinen unabhängigen OOS-/Profitnachweis. Keine Schwellenoptimierung und keine automatische Übernahme jüngster Gewinner.

Adaptive doppelte Gebühren: beide Varianten gleich+0.3110%bei nur3Trades, kein zusätzlicher Strukturausgang. Der neue Basis-Fillpfad mit nochmaligen Basisgebühren ergäbe algebraisch−3.0302%, kein ausführbarer Gebührenstress. Die wenigen tatsächlichen adaptiven Trades belegen keine Kostenrobustheit.

## Erhalten und noch offen

Originale Main92Runtime-Module und Referenzpointer bytegleich. Hauptlaufzeit ohne Neustart/Umkonfiguration weiterhin verbunden20Features/20Paare/Paper-only/AIaus/Remoteaus. Neuer Kandidat nicht als Standard freigegeben. Vollständige Belege/Logs/Sourcehashes in structure-exit-proof.json. Reales Modell-/Tokenizer-/KI-Paketbudget weiterhin ungeprüft; kein API-Key/Provider aktiviert.

Zwei passende gehashte Freqtrade-Dateien hinzugefügt, gezielte Exit-/Testabschnitte gelesen; REVIEW-PASS7.md.41ausgewählte Archivdateien inklusive5Lizenzen sind keine vollständige Untersuchung. Nächster wichtiger Schritt ist unabhängige prospektive Evidenz: für einen neuen isolierten Versuch ein fixes registriertes Symboluniversum bei weiter geprüften aktuellen Exchange-Metadaten herstellen. Alte wegen Universumsdrift gestoppte Roots unverändert erhalten. Danach weitere geeignete Regime-/Entry-/Reduce-/Exit-/ML-Intelligenz und zeitlich korrekte Lernziele. Die bisherigen39/54Policylabels gehören zu anderen Entscheidungs-/Exitversionen und dürfen nicht ungekennzeichnet zum Lernen der neuen Politik dienen. Originale Einstiegsevidenz muss erst echt aufgezeichnet/verknüpft werden, statt eine spätere Supportlinie als damalige These auszugeben.

100produktive Stunden und der gesamte autorisierte Umfang bleiben offen; Gewinne werden nicht versprochen.
