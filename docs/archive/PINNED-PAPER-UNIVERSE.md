# Registriertes Marktuniversum für neue Paper-Versuche

31.10.2026. Konkrete Voraussetzung für die noch fehlende unabhängige Prospektive implementiert. Noch kein neuer Versuch gestartet, kein bestehender Versuch entpausiert und keine neue Rendite gemessen. Alle alten eingefrorenen Roots/Daten/Referenzen bleiben erhalten.

## Modus und Gültigkeit

`PAPER_FIXED_PAIRS` ist eine optionale JSON-Liste eindeutiger Grossbuchstaben-Spotpaare. Leer bedeutet die bisherige normale Auswahl nach Volumen inklusive BTC und gehaltenen Assets. Eine nichtleere Liste ist nur im bereits streng isolierten Mock-Paper-Profil erlaubt: PAPER_EXPERIMENT_MODE=mock, Binance, AI_PROVIDER=mock, AIaus/Remoteaus/leereKeys/dedizierteDB. Alle Paare müssen dieselbe konfigurierte Quote besitzen, BTC enthalten und der erklärten TOP_N_PAIRS-Anzahl entsprechen. Die Liste wird für Config/Provenance kanonisch sortiert und in den Konfigurationsfingerprint aufgenommen.

Der Marktadapter verwendet bei festen Mitgliedern keine erneute Rangselektion. Neue Top-Coins und fallendes oder0Volumen verändern die Mitgliedschaft nicht;0Volumen ist keine behauptete Liquiditätsfreigabe, die Entry-/Book-/Kostenregeln bleiben unabhängig. Ein vorhandener Bestand ausserhalb der registrierten Liste führt zum Fehler statt zur stillen Ausweitung/Verdrängung des Universums.

**Aktuelle Metadaten bleiben zwingend:** alle Mitglieder werden neu aus exchangeInfo/ticker gelesen. Handelbarkeit/Spot-/Market-Orderfähigkeit, eindeutige passende Symbol-/Tickerzuordnung, endliche positive Preise und unterstützte LOT_SIZE-/PRICE_FILTER-/Notionalangaben werden geprüft. Fehlende/ausgesetzte Mitglieder, unbekannte Ticker oder nicht darstellbare Schritte scheitern vor Datenbank-Aktivierung und vor Löschen der In-Memory-Symbolmap. Kein Rückgriff auf alte Seed-Metadaten. Frische Änderungen von Mindestmenge/Notional/Dezimalstufen werden an die vorhandene Vertrags-/Driftprüfung weitergegeben.

Der vorhandene Paperbroker stellt Mengen/Preise über Dezimalstufen dar. Nicht einheitenbasierte Schritte wie0.005werden für den neuen festen Modus ausdrücklich abgelehnt, statt eine falsche Unterstützung vorzutäuschen. Damit werden keine vollständige reale Börsenkonformität oder sämtliche optionalen Börsenfilter behauptet. Es gibt keine Echtgeldfunktion.

## Nachweise

36Parser-/Selector-/Profil-/Provenanzfälle plus3Tests am tatsächlichen BinanceMarket.selectPairs mit gemocktem öffentlichen Transport/DB. Sie prüfen stabile Mitgliedschaft bei Rangwechsel/0Volumen, normale Auswahlparität, ungültige/duplizierte/fehlende Daten, erforderliche Mitglieder/Bestände, vorgezogene Fehler ohne Aktivierungsänderung sowie erneut gelesene aktuelle Limits. Ein Syntaxfehler im ersten Testdouble wurde korrigiert. Final875Haupttests+15Offline/Source-Test-WebTypchecks/Build bestanden.

Build520b221b817df99f6f87b5e27720d96900694715e35d1c48fab98d8c4667b03c(109Source/99Runtime). Voller unveränderter Original-Rule-Replay auf festem Datensatzd0066ea5:Basis/Stress jeweils0%/0geschlosseneTrades mit exakt den alten Ergebnis-/Daten-/Optionshashes. Das ist Parität, keine neue Performance- oder Unabhängigkeitsbehauptung.

Tatsächlicher kostenloser Public-Read17:33:34UTC:20aktuelle öffentliche Main-Symbole gegen exchangeInfo und24hTicker geprüft. Paarliste und aktuelle vollständige Metadaten in fixed-universe-public-probe.json, Hash52b6003c26dbf46606bb1ab24bc6dd556aac560eb3751e3cc783babb72ac6b98. Im selben Readonlyprobe künstliche Rangumkehr/0Volumen verändert die Liste nicht; künstlich auf BREAK gesetztes Mitglied wird abgelehnt.2öffentlicheRequests, keine DB-/Profiländerung, kein Konto-/Key-/Orderzugriff.

Main läuft weiterhin mit seiner vorher gestarteten Runtime972d; neue Arbeitsquellen/Build520b sind vorbereitet. Kein Neustart und keine Änderung der Main.env. Das ist eine ausdrücklich dokumentierte unterschiedliche Lauf-/Arbeitsversion, keine Behauptung, dass neuer Code schon im Mainprozess aktiv wäre. Alte Referenzpointer und der wegen echter Universumsdrift gestoppte V2Root unverändert. pinned-universe-proof.json bindet Source/Tests/Logs/öffentliche Probe und vollständige Referenzprüfung.

## Nächster notwendiger Integrationsschritt

Die alte Experimentfactory unterstützt nur die bereits existierenden/retiredv1/v2 und einen einfachen Mock. Für einen neuen isolierten Vergleich müssen neue Serie/Protokoll/Quelle/Providerrolle/Pins vor zukünftiger Beobachtung registriert und die neue Kovarianz-/Strukturexitentscheidung an passende gemeinsame Live-Paper-Kontexte angeschlossen werden. Vollständige Kovarianz benötigt193geschlossene Kerzen; die kompakte24Kerzen-Ansicht im Modellkontext reicht dafür nicht. Die bestehenden Rohdaten im Collector sind nutzbar, dürfen aber nicht gegen spätere Daten ausgetauscht werden. Bestehende Kontext-/Safety-/Stopregeln und Budgetgrenzen erhalten. Factory/Main-Buildzuordnung transparent herstellen, keinen Hashoverride nutzen.

Keinen alten gestoppten Root patchen, keine Baseline zurücksetzen und keinen neuen Lauf als bereits beobachtet ausgeben. Neue Baseline erst mit tatsächlichen Markt-/Source-/Konfigurationsversionen und zukünftigen Daten vergleichen. Die bisherigen verbesserten Verlustwerte bleiben bekannte retrospektive Entwicklung, keine verlässliche Profitabilität. Breitere Strategie-/Regime-/ML-/OSS-Arbeit und mindestens100aktive Stunden bleiben offen.
