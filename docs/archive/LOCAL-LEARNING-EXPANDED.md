# Breiter Lernvergleich und zwei Kostentests

Protokoll learning-protocol-v2-expanded.json vor der erweiterten Auswertung fixiert. Modelle/Features/lambda/14-4-4Tage-Folds/Validierungswahl unveraendert. Alle vorhandenen Maerkte teilen den Zeitraum ab gemeinsamem Historienbeginn plus3Tage Warm-up, auf6h aufgerundet, bis gemeinsamem letzten Kerzenschluss. Originaldatensatz und Defaultpointer nicht geaendert, keine weiteren Daten oder Modelle heruntergeladen.

6940Beobachtungen auf347UTC-Zeitpunkten/20korrelierten Maerkten.17ausgewertete, chronologische Testfenster mit insgesamt5440Testzeilen/272Zeitpunkten. Train-/Validierungsfenster ueberlappen zwischen Folds. Weder Zeitpunkte noch Maerkte werden als unabhaengige Experimente behauptet; schon bekannte Historie bleibt retrospektiv. Testfenster im separaten Register-v2 festgehalten, v1-Ergebnisse/Protokoll unveraendert erhalten.

| Modell/Auswahl | Test-MAE inRendite-Prozentpunkten | Coverage | Basis-Kapitaldiagnose | Positionen |2xKosten mit neuer Freigabe |2xKosten, gleiche Basispositionen |
|---|---:|---:|---:|---:|---:|---:|
| Nullprognose/NO TRADE |1,12874|100%|0%|0|0%|0%|
| Trainingsmittel |1,15120|100%|0%|0|0%|0%|
| Ridge |1,17369|97,08%|-3,54803%|64|-1,68677%(7Positionen)|-6,32828%(64Positionen)|
| Vorherige Validierungswahl |1,13867|99,76%|+0,51154%|13|-0,12647%(1Position)|-0,08852%(13Positionen)|

Ridge verbessert Null-MAE nur in3von17Testfenstern. Validierungswahl:11malNull,4malTrainingsmittel,2malRidge. Die kleine positive Basis-Kapitaldiagnose ist nicht kostenrobust und begruendet keine Aktivierung. Null-/Mittelwertvarianten bleiben unter der festen Kaufgrenze und eroeffnen keine Positionen. Abweichende Coverage ist sichtbar; Abstention wird fuer MAE wie eine Nullprognose auf denselben Zeilen bewertet.

Die zwei Stresssichten beantworten unterschiedliche Fragen. Mit hoeheren Freigabekosten werden weniger Signale ausgefuehrt: das kann verlierende Positionen entfernen. Bei Ridge ist dadurch-1,69% hoeher als-3,55%, ohne dass bessere Ausfuehrungskosten entstanden waeren. Gepaarte Nachbewertung behaelt die urspruenglichen Positionen/Zeitpunkte und preist nur die Ausfuehrung teurer. Fuer jede Position und die ganze feste Sequenz ist der Nettoertrag dann nicht besser; diese Invarianten werden im Runner geprueft. Basisrechnung wird unabhaengig gegen den vorhandenen Kapitaldiagnostik-Helfer abgeglichen.

Basis: je0,1%Gebuehr,10bpsGesamtspread,8bpsSlippage je Seite. Stress:0,2%Gebuehr,20bpsSpread,16bpsSlippage. Prognoseaufschlag weiter0,5Prozentpunkte. Feste4h-Haltezeit, maximal3x10%Kapital, RestCash; keine beobachtete historische Tiefe/Queue, Lot-Minima, Stops oder Intrahorizont-Marks. Das ist kein Ergebnis der laufenden Rule-/Mockstrategie oder tatsaechlicher Paperbroker-Ausfuehrung. Es fehlen unabhaengige/prospektive Evidenz und belastbare Prognosekalibration.

Bericht d93b5722d7484b417c77197009dcbf275834b75c54c02abfee12458d66dd2533 enthaelt alle Fold-Grenzen, Train-only-Skalierung/Koeffizienten, Validierungswahl, Testprognosen und pro hypothetischer Position Paar/Zeit/Brutto-/Netto-Kostenszenarien. Zwei Laeufe erzeugten exakt denselben Inhalt/Hash. Reproduktion: `pnpm --filter @paper/server exec tsx ../../scripts/run-local-learning-extended.ts`. Keine Datenbank-/Konto-/Provider-/Brokeranbindung; Modell bleibt offline.

Die11numerischen/chronologischen Lerntests wurden gezielt erneut bestanden. Produktionsmodul, v1-Protokoll/Runner/Bericht, komprimierter Referenzdatensatz und Defaultpointer gegen bisherigen Proof unveraendert gehasht. Bestehender Build a755b9284075b5a532ee3b9f4b6578f5a327fce2cda9370887c3d503e9b3daea schreibgeschuetzt geprueft, laufendes Profil Paper/AI_PROVIDERnone/AI_ENABLEDfalse/RemoteAIfalse. Kein Neustart oder neue Komplettsuite noetig: diese Runde aendert nur Forschungstool/Protokoll/Belege.

Naechste Entscheidung: Ridge nicht in Produktion uebernehmen oder an diese Testfenster anpassen. Konkrete Regime-/Strategieideen aus weiterer Upstreampruefung untersuchen, vorab neue Hypothese/Splits/Kostenannahmen festhalten. Fuer echte Paper-Evidenz eigene neue Vergleichskohorte korrekt registrieren; vorhandener rules/hold-Komparator ist noch keine Mock-Vergleichsfunktion.
