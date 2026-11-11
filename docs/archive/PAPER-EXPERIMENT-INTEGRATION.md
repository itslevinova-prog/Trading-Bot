# Isolierter Mock-Modus: echte Ablaufanbindung

Neue Komponenten market/bootstrap.ts und research/paper-experiment-runtime.ts sind mit index.ts, Scheduler und dem vorhandenen PaperExecutionAdapter verdrahtet. Nur der ausdrueckliche PAPER_EXPERIMENT_MODE=mock aktiviert diese Pfade. Das Hauptprofil bleibt off/AI_PROVIDERnone, keine neue Kohorte wurde in dieser Runde gestartet.

## Profil und Reihenfolge

Der Experimentmodus verlangt Binance, die eigene relative Datenbank ./data/mock-experiment.db, AI_PROVIDERmock, AI_ENABLEDfalse, Remotefalse und leere Providerkeys. LIVE_ENABLED muss ausdruecklichfalse sein. Falsche realeProvider/Keys/Originaldatenbank werden vor einem sinnvollen Experimentstart abgewiesen. Kein Modell-/Private-Exchange-Client wird erstellt.

Im Standardprofil startet der Scheduler weiterhin vor dem oeffentlichen Marktfeed. Im Experimentmodus erfolgt zuerst genau eine oeffentliche Marktinitialisierung, dann echte Build-/Konfig-/Universums-/Policypruefung und atomarer gemeinsamerBaselinepunkt, erst danach Scheduler und initialerBTC-Hold-Auftrag. MehrereRetry-Callbacks oeffnen keine doppeltenFeeds; misslungeneRegistrierung erlaubtkeineHandelsaufgaben undwiederholt nicht denbereitsgestartetenFeed. ShutdownwaehrendInitialisierungkann keinen spaeterenSchedulerstart ausloesen.

Der Producer leitet Versionen und wirksamePolicy aus dem echten Broker/SQLite ab. Alle registrierten Features und der Benchmarkbook muessen beimStart hinreichendfrischsein. Aktuell aufDisk verifizierteBuild-ID muss exakt die beimProzessstart erfassteBuild-ID sein; ein anderer, ebenfalls formal gueltigerBuild genuegt nicht. Aktuelle sanitisedConfig-, Datenbankpfad- und Endpointfingerprints muessen zum Start passen.

## Schutzgrenzen und Neustart

Scheduler prueft die Registrierung vor Providerentscheidungen und Holdinitialisierung. Der echte Paperbroker prueft neue Einstiege nochmals vorOrderpruefung und nachsimulierterLatenz; Driftfuehrt zu dokumentierterAblehnung ohneCash/Positionseffekt. Sells/Schutzverkaeufe werden durchdiesesEinstiegsgate nicht gesperrt; die normalen Quote-/Fillgrenzen bleiben.

Bei Wiederaufnahme registriert derController die neueRun-ID schon vor demStart oeffentlicherTicks, sofern die alteKohorte unveraendertgueltig ist. Das verhindert, dass ein unabhaengigerSchutzverkauf durch den erstenfrischenTick vor der neuenRunregistrierung entsteht. NeueEinstiege bleiben trotzdem bis zum vollstaendigenMarkt-/Startgate geschlossen. AlteBaselines werden nicht zurueckgesetzt.

## Bewertungen und Bericht

Experiment-Scheduler unterdrueckt die alten einzelnenobserveForwardAccount-Aufrufe und produziert nach demEquitytick genau einen neuen gemeinsamenBatch aus echtenbroker.valuation-Werten mit ihren eigenen Zeiten/Status/Cash/Positionsanzahlen. Derselbe realeZeitpunkt wird nicht perTimestamp+1 erfunden: derProducer meldet same_source_instant und zaehlt keinen neuenSample.

Nur im Experimentmodus gibt es den schreibgeschuetzten GET/api/paper-experiment-Bericht. Noch nicht bereit, Verbindungsabbruch, Build-/Policy-/Configdrift und fehlende aktuelleBewertungen liefern keine aktuellenVergleichsmetriken. Die eigene echteMehrlegauswertung bleibt vom Legacy-rules/hold-Komparator getrennt; keine ID-/Versionsangleichung.

## Nachweise und naechster Schritt

16neueTests:5Ablauf-/Retry-/Shutdownfaelle,5Producer-/Profil-/RealPolicy-/Build-/Resumefaelle und6mit echtemPaper-Scheduler/Broker fuer fehlendeBaseline, finalenLatenzguard, erhaltenenSchutzverkauf, doppelfreieBatches und nichtaustauschbareGuards. KeineNetzwerk-/Modellprovider, Fakekonto-Ausfuehrungen nur im vorhandenenTestdatenbestand. VorhandeneRegistrierungs-/Mehrlegtests bleiben erhalten; Vollsuite/Build/RuntimeimWORK-LOG.

Die Profil-/Lifecycleverdrahtung ist Source-integriert und getestet. Noch offen ist die separate versionsfesteSource/Web/114-Dependency-/Marktseed-Kopie, ihr eigenerStart/Verifier und eine echte oeffentlichePaper-Forwardbeobachtung. Fuer diesen Prozess eigeneRoot/Pointer/Port verwenden, keineHaupt- oderReferenzkonten kopieren/ueberschreiben. Erst danach Ergebnisse beurteilen; Tests und simulierteStartpunkte sind kein unabhaengigerGewinnnachweis. Ridge bleibtoffline.
