# Lokaler Lernvergleich: erster retrospektiver Versuch

Protokoll learning-protocol-v1.json wurde vor der ersten Anpassung/Auswertung registriert. Die Preisgeschichte war bereits untersucht: dies ist weder eine neue unabhaengige Studie noch ein prospektiver Profitnachweis. Keine Protokollparameter nach den Testergebnissen angepasst.

## Verfahren

- Derselbe eingefrorene Datensatz d0066ea5e97b107a22c148dbfcfcd245a2ea37e555684a5af36a382134b14926.20bei Erfassung aktuelle EUR-Maerkte, damit Survivorship Bias. Daten/default-pointer unveraendert.
-8vorhandene technische Features; nur geschlossene15m-/Stundenkerzen. Beobachtung alle6UTC-Stunden. Hypothetischer Einstieg erst an der naechsten vollen15m-Kerze nach dem Entscheidungszeitpunkt, Ausstieg4Stunden spaeter. Luecken im Labelpfad werden nicht repariert. Historische Labelverfuegbarkeit ist fruehester Kerzenschluss, tatsaechliche Ankunftszeit unbekannt.
- Rollend14Tage Training,4Tage Validierung,4Tage Test,4Tage Schritt. Alle Maerkte teilen dieselben UTC-Grenzen. Trainings-/Validierungslabels muessen vor der naechsten Phase enden; Testlabels innerhalb des Testfensters. Featureskalierung nur auf Training, keine Test-Statistik. Modell-trainedAt ist die simulierte Informationsgrenze, nicht die Behauptung einer damaligen echten Modellanpassung.
- Nullprognose/NO TRADE, Trainingsmittel und Ridge(lambda10), unbestrafter Intercept. Keine Zusatzpakete oder externe KI. Zu alte Modelle/ungueltige Features und Eingaben ausserhalb6Trainings-Standardabweichungen ergeben Abstention. Dies ist eine Heuristik zur Datenabweichung, keine kalibrierte Unsicherheit.
- Auswahl nur nach Validierungs-MAE; identische Beobachtungen, fehlende Prognosen alsNull gewertet, mindestens95%Coverage fuer Ridge/Mean, konservative Gleichstaende. Keine Auswahl nach Testprofit. Erwartungswert und Gewinnwahrscheinlichkeit werden nicht kalibriert oder behauptet.
- Getrennte Kapitaldiagnose: Prognose muss die exakten angenommenen Round-trip-Kosten plus0,5Prozentpunkte uebersteigen. Hoechstens3Positionen mit je10%Kapital, RestCash. Fester4h-Ausstieg, keine beobachtete Tiefe/Queue, keine Stops, keine Intrahorizontbewertung. Lotrundung, Mindestordermengen und das reale Paper-Kontokapital werden in dieser normierten Kapitaldiagnose nicht ausgefuehrt. Ausstiegsweise gesampelter Drawdown ist kein vollstaendiger Intraperioden-Drawdown. Dies ist keine Ausfuehrung der aktuellen Rule-/Mockstrategie oder des Paperbrokers.

## Beobachtete Ergebnisse

Bericht33432b7d0ced9f3518a500d88776fcb88b4f0df6cc8af3a62f2e65c3541ae12e ist unter data/learning-reports mit vollstaendigem Modell, Split-Grenzen, Featureskalierung, Validierungswahl und Test-Prognosen archiviert. Gleicher erneuter Lauf ergab denselben Berichtinhalt/Hash.2140Beobachtungen entsprechen107Entscheidungszeitpunkten auf20korrelierten Maerkten, nicht2140unabhaengigen Experimenten. Je Fold1100Trainings-/300Validierungs-/300Testzeilen; nur15Zeitpunkte pro Validierungs-/Testphase. Folds ueberlappen zeitlich, also ebenfalls keine unabhaengigen Wiederholungen.

MAE nachfolgend inProzentpunkten der4h-Bruttorendite (interne Berichtsprognosen/Labels sind Dezimalbrueche):

| Testfenster | Nullprognose MAE | Trainingsmittel MAE | Ridge MAE | Ridge Coverage | Ridge Kapitaldiagnose | Vorher validierungsgewaehlt |
|---|---:|---:|---:|---:|---:|---|
|1|1,02283|1,03712|1,03580|99,33%|-0,13646%,2hypothetische Positionen|Trainingsmittel,0Positionen/0%|
|2|0,81779|0,81002|0,82603|100%|0Positionen/0%|Nullprognose,0Positionen/0%|

Kosten:0,1%je Seite,10bpsgesamter angenommenerSpread und8bpsSlippage je Seite, gemaess eingefrorenen Optionen. Diese angenommene Ausfuehrbarkeit ist kein historisches Orderbuch. Die2Ridgepositionen sind aus der gespeicherten Testprognose nach denselben Regeln rekonstruierbar; separate position-audit-Datei enthaelt Paar/Zeit/Prognose/Brutto-/Nettoszenario. Keine echten oder im laufenden Paperbroker ausgefuehrten Orders.

Ridge schlaegt in keinem dieser Testfenster die Nullprognose beiMAE. Der niedrigste Validierungsfehler garantiert nicht den niedrigsten Testfehler. Weder Ridge noch Auswahl zeigen hier einen Handelsvorteil. Null-Trades bei der Auswahl sind kein Profitbeweis. Modell bleibt ausschliesslich offline; keine Anpassung der bestehenden Handelsschwellen anhand dieser Testfenster.

## Nachweise und naechste Entscheidung

11Tests pruefen analytische Ridge-Loesung, chronologische Purge-Grenzen, Zukunftsvergiftung, Datenluecken/Dubletten, Mindeststichprobe, Feature-/Modellablehnung, Coverage/Gleichstaende, Kostenarithmetik, Kapitalbegrenzung und deterministische Reihenfolge. Vollsuite und Integrationsbelege werden separat im Arbeitsprotokoll/proof erfasst.

Reproduktion: `pnpm --filter @paper/server exec tsx ../../scripts/run-local-learning.ts`. Liest ausschliesslich den eingefrorenen lokalen Datensatz, schreibt versionierte Forschungsberichte; keine Datenbank/Konten/Provider/Broker. Der bestehende Full-period-Regelbaseline-Replay bleibt separat als0%/0geschlosseneTrades erhalten; das sind andere Strategie-/Zeitraumannahmen, kein falscher direkter Vergleich identischer Trades.

Naechste Arbeit: weitere Upstream-Strategie-/Regime-/Label-/Backtestpruefung, danach bewusst begruendete Features/Regimealternativen mit neuem fixierten Protokoll. Die hier angesehenen Testfenster sind fuer unabhaengige Bestaetigung verbraucht. Neue Kalibration/Deployment verlangt andere Evidenz und prospektive Paperbeobachtung; keine Gewinnwahrscheinlichkeit aus diesen wenigen abhaengigen Fenstern ableiten.
