# Gemeinsame Paper-Beobachtung und Drei-Strategien-Auswertung

research/paper-experiment-observations.ts erweitert den expliziten Registrierungsvertrag. Noch keine automatische Verdrahtung in den Hauptbot und noch kein gestarteter isolierter Versuch. Alle Versuche in Tests verwenden neue In-memory-Paperdatenbanken.

## Start und Wiederaufnahme

startPaperExperiment registriert den Vertrag und erstellt innerhalb derselben SQLite-Transaktion exakt3flache Forward-Ausgangsbeobachtungen auf derselben wirklich erfassten Zeit und Kapitalbasis. Jede behaelt ihre eigene echte Strategie-/Policy-/Universumsversion. Der bestehende observeForward-Helfer wird wiederverwendet, Konten/Versionshashes nicht umbenannt. Fehler an der letzten Leg rollen Vertrag, Epochen, Punkte und Samples zusammen zurueck.

Ein neuer Lauf braucht eindeutigeRun-ID, frischen Quellzeitpunkt und bei Erststart verbundenen oeffentlichen Markt. Bei Wiederaufnahme muessen die urspruenglichen3Baseline-/Cashbelege vollstaendig und unkontaminiert bestehen. Fehlende Baselines werden nicht nachgeholt; kein neues Kapital-/Zeitfenster wird gesetzt. Neue gleichartige Run-IDs werden vor Folgebeobachtungen registriert.

## Bewertungen

observePaperExperiment erhaelt alle3realen Brokerbewertungen mit ihren eigenen Zeitstempeln. Sie muessen hoechstens1000ms vom gemeinsamen Erfassungszeitpunkt entfernt, nicht zukuenftig und nicht vor dem registrierten Lauf entstanden sein. Cash, Status und Positionsanzahl werden gegen den echten Paper-SQLite-Stand abgeglichen. Bei fehlender Bewertung bleibt Equity null; Disconnection wird als Quelle gespeichert, niemals alsNullrendite.

Source-Run, Forward-Punkt und gemeinsames Sample sind ueber Epochen-/Zeitbelege verbunden. Alle3werden atomar gespeichert. Ein identischer/doppelter Zeitpunkt ist keine neue Beobachtung; ein Fehler einer Leg hinterlaesst keine halbe Vergleichsserie.

## Auswertung

readPaperExperimentComparison arbeitet in einem konsistenten schreibgeschuetzten SQLite-Transaktionssnapshot. Es prueft den unveraenderlichen Vertrag, echte DB-Risikopolitik,3Baselines und jeLeg-Ausfuehrungsprovenance. Nur registrierteRun-IDs, passende Build-/Strategie-/Universumsversionen und zeitlich richtige positive Ausfuehrungen mit endlichen Cash-/Feewerten zaehlen. Gezahlte Paper-Fee muss zum registrierten Kostensatz passen. Cash jeder gespeicherten Bewertung wird aus Startkapital und bis dahin belegten Kaeufen/Verkaeufen/Fees abgeglichen; unzugeordnete Cashaenderung ist kein Handelsgewinn.

BTC-Vergleich erfordert genau einen belegten anfaenglichen BTC-Kauf, keine andere Waehrung oder spaetere Umschichtung. Der Scheduler fordert allenCash an und Hold ist von normalen Einstiegskappen/Stops ausgenommen; tatsaechliche Kapitalbindung/Fill/Fees/Lot-Dust koennen davon abweichen. Kein pauschaler gleicher Beta-/Risikoanspruch.

Aktuelle Vergleiche werden nur aus dem neuesten vollstaendigen, frischen gemeinsamen Sample nach allen bisherigen Fills ausgegeben. Veraltete/fehlende/ungueltige Bewertungen liefern keine aktuellen Kennzahlen; kein letzter guter Wert wird als jetzt ausgegeben. Unterbrechungen ueber90s und ungueltige Samples bleiben sichtbar, auch wenn spaeter wieder ein frischer Endpunkt existiert. Endpunktrenditen sind beschreibend; observedCadenceComplete beschreibt nur Sample-Kadenz, keine vollstaendig beobachteten Markt-/Stop-Pfade.60000Quellzeilen sind eine explizite Lesegrenze, kein stilles Abschneiden.

Alle Kennzahlen bleiben Paper-Marks mit bereits gezahlten Fill-Fees; hypothetische Ausstiegsgebuehren/Queue/Tiefe und Intraminutenpfad werden nicht erfunden. Equity vertraut der tatsaechlichen Brokerbewertung, ist keine neue unabhaengige historische Quote-Rekonstruktion. Keine manipulationssichere Computerattestierung, Profitvalidierung oder unabhaengige Stichprobengroesse.

## Geprueft und noch offen

17zusaetzliche Tests pruefen atomarenStart/Rollback, getrenntelegitimeVersionen, Wiederaufnahme, fehlende Baseline, eigentliche3-Rollen-Vergleiche, Disconnection/Nullbewertungen, Zukunft/Skew/Dubletten, Cash-/Fee-/Fill-/Runzuordnung, aktuelle Policy, nicht erfundene Renditen und erhaltene Luecken. Bisherige32Registrierungsfaelle bleiben erhalten. Vollsuite/Build/Runtime-Nachweise stehen im Arbeitsprotokoll.

Naechster konkreter Integrationspunkt wurde in index.ts gelesen: derzeit ruft der Hauptbot scheduler.start() vor market.start() auf. Fuer den neuen Experimentmodus zuerst frische Markt-/Universums-/Provenanceinitialisierung, dann Register/Start mit derselben erfassten Zeit, erst danach Strategie-/Hold-Ausfuehrung. Hauptprofil unveraendert lassen. Aktuelle Runtime-/Policywerte aus dem echten Adapter ableiten; diese Funktionen sind keine Autorisierung fuer behauptete JSON-Flags.

Danach Bewertungen aus dem echten broker.valuation in die neue Schicht leiten und einen eigenen registrierten Bericht anbieten. Erst nach echten Integrationstests separate Source-/Dependency-/Marktseed-Kopie und isolierten Mock-Prozess starten. Alter Referenzpointer, Altkonten und Hauptbot bleiben erhalten. Ridge bleibt offline. Danach weitere konkrete Upstream-Regime-/Strategieintelligenz priorisieren.
