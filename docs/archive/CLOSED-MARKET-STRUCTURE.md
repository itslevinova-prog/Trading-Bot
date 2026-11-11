# Geschlossene Marktstruktur und zeitlich korrekte Kerzen

Neue deterministische Mockvariante paper-intelligence-v2, Hypothese vor Auswertung in structure-hypothesis-v1.json. Kein ML-Training, keine reale KI, keine kalibrierte Gewinnwahrscheinlichkeit. Korrigierter laufender Experiment-v2 verwendet weiterhin eingefrorenen Build5cad und Mockv1; beide Versionsnummern nicht verwechseln oder Ergebnisse vermischen.

## Marktverstaendnis

closedMarketStructure verlangt genau21aufeinanderfolgende geschlossene15mKerzen im vorgesehenen UTC-Fenster. Die20Vorgaenger bestimmen Support/Resistance; die letzte Signalkerze geht nicht in ihre eigene Vergleichsrange ein. Nettoveraenderung des Schlusskurses geteilt durch absoluten Weg misst die beobachtete Richtungseffizienz. Bekannte flache Preise ergeben0, Datenluecken/unmoegliche/konfliktierende Kerzen null. Vorherige oder zukuenftige Kerzen koennen fehlende aktuelle Evidenz nicht ersetzen. Berechnung ist innerhalb derselben geschlossenen Periode zeitstabil und gegen extreme positive Preise skaliert.

Die neue Mockvariante lehnt neue Trend-Einstiege bei Effizienz<=0.2, oberem Range-Durchstich mit Rueckschluss darunter, beidseitigem Sweep oder Schluss unter vorherigem Support ab. Unbekannte Struktur ist ein NO-TRADE-Grund. Bestehende bestaetigte baerische Positionsausstiege erfolgen vor diesen Einstiegsregeln; unveraenderte Schutzverkaeufe laufen weiter unabhaengig. Die Schwelle ist eine vorab gewaehlte Forschungshypothese, kein aus Geschichte nachgewiesenes Optimum. Weniger Trades sind nicht automatisch bessere Trades.

Alle neuen Belege bleiben im vorhandenen Kontext/API und Entscheidungsprotokoll. Vorhandene verlustfreie Feature-Spaltencodierung wird fuer Strukturwerte wiederverwendet, einschliesslich null/false und optionalen Feldern/Repacking. Produktionsgrenze115000Zeichen unveraendert. Ein synthetischer10Markt-Test benoetigt fuer die zusaetzlichen Pflichtbelege18000statt16000Zeichen; dies aendert weder Produktionslimit noch Risikoschwellen. Echte20Markt-/Exit-/Memory-Laufzeitpruefungen bleiben erforderlich.

## Gefundene Datenluecke und Clock-Inferenz

Echter Snapshot11:02:40UTC: alle20Strukturfenster unbekannt, BTCletzterClose10:45statt11:00. Kein neutrales Signal oder erfundene Trendstaerke daraus abgeleitet. Oeffentlicher BinanceTime/Kline-GET zeigt fertige10:45Kerze und einen Serverzeitpunkt spaeter als das lokale Antwortende. Beobachteter Mittelpunktversatz lokaleUhr minusServer etwa-1158ms bei999msRequestdauer; keine exakte NTP-Messung. Siehe public-clock-structure-check.json.

Quellcodepfad: final markiertes Streamkline wird gegen lokaleSchlusszeit geprueft und bei noch zukuenftigem Schluss bisher verworfen. Kombiniert mit beobachteter Uhrdifferenz ist dies eine plausible Ursache; der urspruengliche konkrete verworfene WS-Frame wurde nicht aufgezeichnet. Deshalb keine falsche Behauptung, dieser einzelne Frame sei direkt nachgewiesen.

Neue ClosedCandleBuffer-Logik nimmt nur vom vorhandenen Feed final markierte15m/1hNachrichten an. Ist der lokale Schluss maximal2s entfernt und OHLCformgueltig, bleibt die Nachricht bis zum echten lokalen Schluss unsichtbar. Dann erneute Zeit-/Datenpruefung, erst danach Datenbank/Feature-/Candleevent. Kein Vorziehen der lokalen Uhr und keine Verwendung offener Kerzen. Weiter entfernte Zukunft/ungueltigeDaten bleiben verworfen. DuplicatePending ersetzt einenSlot, Shutdown verwirftRestarbeit; Speicherfehler werden gemeldet, nicht als erfolgreiche Daten angenommen. Bestehende oeffentliche REST-Reparatur bleibt Rueckfall fuer Luecken; andere Uhrfehler sind nicht automatisch behoben.

Analytische Tests decken monotone/pendelnde/flache Pfade, Rangeausschluss, Wick/Sweep, fehlende/duplizierte/falsche/future Daten, Zahlenextreme, wirksame Eintrittsvetos und unveraenderte Bestandsexits ab. Buffer-Tests simulieren eine1sfruehe finalNachricht, feste Zeitgrenze, Duplikate, Shutdown, zurueckspringende Uhr und asynchroneSpeicherfehler. Echte zukuenftige Perioden bleiben separat zu beobachten; aktive Entwicklungszeit schliesst passive Beobachtung aus.

## Ausstehende Wirksamkeitspruefung

Neue Strukturvariante noch nicht fair als Netto-PnL-Verbesserung validiert. Vorhandener historischer Regel-Replay bleibt identische Referenz und beweist keinen Vorteil der neuen Mockvariante. Naechstes: identische kausale historische Eingaben/Kosten fuer eingefrorenenMockv1 und neueVariante herstellen, historische Tiefe/Ausfuehrung explizit simuliert/unbekannt halten, Strategieausstiegs-/Tageslimitsemantik vor Vergleich angleichen ohne die Regelbaseline zu veraendern. Keine Schwellentunings aus schon gesehenen Testfenstern, keine Unabhaengigkeit oder Prognosewahrscheinlichkeit erfinden. Weitere31ausgewaehlteUpstreamdateien sind noch kein gruendlicher Gesamtaudit.


## Live-Nachweis nach finalem Build

Build0b5876971d7be8c206e9e7edd3eb4a75fabbe756e595ebfc625cec19fd5993c1:734Haupttests+15Offline/Typchecks/Build bestanden; Source99/Runtime89. HauptPaperPID3760/Start11:11:26.2246164UTC, KI/remote deaktiviert. Vollständiger unveränderter Regel-Replay weiterhin0%/0geschlosseneTrades,2518alteMemoryzeilenexakt erhalten(2878gesamt beimCheck). Laufzeit11:13:03UTC20Features/17frischeBooks/114282gepackteZeichen unter unverändertem115000Limit.

Begrenzte reineLese-Beobachtung des natürlichen11:15Schlusses beendet: um11:15:00.187UTC lagen füralle20Märkte neue geschlosseneKerzen vor; beobachteteSnapshots enthieltenkeinefutureKerzen. Das ist Verfügbarkeitsbeleg, kein Nachweis des exakten ursprünglichen Empfangszeitpunkts oder dass jederFrame denPufferzweig nahm. ProbePassivlauf0Entwicklungszeit.

GespeicherterechterScheduler-Kontext11:15:05.010UTC hat20vollständigeStrukturfenster. Ausschließlichoffline durch neueMockfunktion ausgewertet, keineVorschlägeausgeführt:20Assessments/Versionpaper-intelligence-v2, je1Veto durchgeringeRichtungseffizienz/oberemWick, weitereTrend-/Volumen-/Spread-/Frische-/Accountgründe. GespeicherterOriginalstatusnot_sent bleibtunverändert. DasrealeHauptkonto darfweiterpausiert/ungeeignetsein; keinUnpausevorgenommen. VorschlagHOLD, Prognosewahrscheinlichkeitnull/Performanceunvalidiert. Belege structure-actual-scheduled-context.json/next-closed-candle-observation.json/structure-proof.json. KeinProfitvorteiloderUnabhängigkeitabgeleitet.
