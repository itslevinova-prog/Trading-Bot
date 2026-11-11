> Aktualisierung31.10.: ausdruecklicher isolierterMock-Modus jetzt Source-integriert. Siehe PAPER-EXPERIMENT-INTEGRATION.md. Noch kein neuer eingefrorenerForwardprozess gestartet. Nachfolgender Komponentenbericht dokumentiert den vorherigen Stand.

# Paper-Experiment: Registrierungsvertrag v1

Implementiert in research/paper-experiment.ts. Dies ist die Registrierungsgrundlage, noch kein gestarteter Versuch und noch keine fertige Drei-Strategien-Auswertung. Kein globaler Datenbank-Init, Scheduler-/API-Hook oder neuer Modellkontakt: nur ein ausdruecklicher Aufruf fuer eine eigene neue Experimentdatenbank darf den Vertrag speichern.

## Gebundene Fakten

- Exakt die neuen aktiven Paper-Konten ai/rules/hold mit gleicher Startbilanz und gleichem noch unberuehrtem Kassenbestand. Keine geerbten Positionen, Trades, Entscheidungen, Forward-Epochen oder Equity-Samples. Datenbankidentitaet muss Binance/registrierteQuote entsprechen.
- Gemeinsame Build-/Basisstrategie-/Universumsidentitaet, Kosten, Buchalter-/Latenzgrenzen, harte Positions-/Portfolio-/Drawdown-/Frequenz-/Cooldown-/Stoplimits. Nur verifizierter Paperbetrieb, AI_PROVIDERmock, AI_ENABLEDfalse, Remotefalse und Livefalse. Fehlende Flags werden nicht wie sichereFalse-Werte behandelt.
- AI-Einstellungen inklusive Mode/Stop/Revision/Quellzeit explizit. Fingerprint wird mit der vorhandenen effectiveTradingPolicy-Funktion aus echten Settings und Hardlimits nachgerechnet; die SQLite-TradingPolicyStore-Einstellung muss dazu passen, auch beim Fortsetzen mit einem alten Runtime-Snapshot.
- Jede Strategie behaelt ihre eigene richtige evaluationVersion. AI bindet Policyfingerprint und Basisstrategie, rules/hold die unveraenderte Basis; alle binden das gleiche Universum mit der bestehenden evaluationFingerprint-Funktion. Keine Gleichsetzung/Umbenennung von Versionshashes oder Konten.
- BTC-Hold-Semantik im Vertrag ausdruecklich: Scheduler fordert einmal den gesamten Kassenbestand fuer BTC an; Broker nimmt hold von normalen Einstiegsrisikokappen aus und setzt keinen Stop. Freshness/Quote-/Fill-/Gebuehrenpruefungen bleiben. Tatsaechlicher Fill, Fee und Lot-Dust werden spaeter aus den Belegen ausgewertet; keine Behauptung exakt100%investierten Nominals oder gleicher Strategie-Beta.

## Speichern und Wiederaufnahme

Der kanonische Vertragsha256 ist die Experiment-ID. Erstregistrierung verlangt denselben einmal erfassten aktuellen Millisekundenzeitpunkt in Vertrag/Aufruf. Saubere Konten und leere Historientabellen werden innerhalb einer SQLite-Transaktion geprueft. Neue Registrierung in einer bereits registrierten DB ist verweigert; ein spaeterer identischer Wiederaufnahmeaufruf liefert dieselbe ID ohne Baseline-Reset, auch wenn mittlerweile Trades/Beobachtungen existieren. Er prueft weiterhin aktuelle Risiko-/Runtime-Identitaet. Vergangene Daten werden niemals durch einen neuen Start ueberschrieben.

Lesen prueft Vertragsschema, kanonischen Hash und separat gespeicherten Registrierungszeitpunkt. Dies sind nachvollziehbare Integritaetspruefungen, keine manipulationssichere Attestierung des lokalen Computers. Der spaetere Bootstrap muss Runtimewerte aus dem echten geprueften Prozess/Adapter ableiten; frei behaupteteJSON-Werte sind keine externe Vertrauensquelle.

32isolierte SQLite-Tests decken unterschiedliche legitime AI-/Baseline-Versionen, atomare Ablehnung vorhandener Historie, Kapital-/Status-/Strategie-/Venueabweichungen, Sicherheitsflags/Versionen/Kostenrisiko, DB-Policy-/Quellzeitmanipulation, Wiederaufnahme zu spaeterer Zeit und unveraenderlichen Start ab. Legacy-Regel-/Hold-Komparator unveraendert.

## Noch vor einem Versuch umzusetzen

Bootstrap-Gate nach frischer DB-/Account-/Policyinitialisierung und vor aller Strategie-/Hold-Ausfuehrung; echte Runtime-/Marktidentitaet anbinden. Eine gemeinsame flache Ausgangsbeobachtung aller3Legs mit registrierter Zeit/Kapital und jeLeg-Version sichern. Dann getrennte, quellengebundene Beobachtungen/Fills und ihre Versions-/Universum-/Policywechsel/Luecken pruefen. Erst danach eigene Frozen-Source-/Dependency-/Marketdata-Seed-Helfer und isolierten Mock-Prozess starten. Hauptkonto, alten Referenzpointer und eingefrorene3100-Kohorte erhalten.

Der vorhandene rules/hold-Komparator wird nicht durch Fake-ID-/Versionsadaptionen auf AI erweitert. Ein eigener registrierter Mehrleg-Vergleich muss fehlende/stale Bewertungen als unbekannt, Downtime als Luecke und Kontamination als solche ausweisen. Keine kalibrierte Wahrscheinlichkeit, Unabhaengigkeit oder Profitabilitaet behaupten. Ridge bleibt mangels robustem Vorteil offline; alle neuen Trades waeren ausschliesslich simuliert.
