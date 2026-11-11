# Naechste isolierte Mock-Paper-Vergleichskohorte

Konkreter Architekturstand30.10.2026, noch kein gestarteter Versuch. Quelle: scripts/prepare-paper-candidate.mjs, candidate-files.mjs, research/forward.ts, research/cohort.ts und PaperExecutionAdapter.executionProvenance.

- Bestehende Einfrierung kann gepruefte Source-/Runtime-/Webdateien und114vorhandene Produktionsabhaengigkeiten ohne Installer/Netzwerk kopieren; Datenbankseed enthaelt nur Paare/geschlossene Kerzen, keine Konten/Orders/Ergebnisse. Diese Helfer wiederverwenden. Den vorhandenen paper-candidate-current-Pointer und dessen3100-Referenz nicht ersetzen; neuer eigener Experimentordner/Pointer/Port, belegte eigene Prozessidentitaet.
- Aktueller Candidate-Preparer/Verifier verlangt AI_PROVIDERnone und exklusiven bisherigen Pointer. Nicht einfach diese Guards umgehen. Eigenen expliziten Experimentvertrag fuer simuliertes AI_PROVIDERmock, AI_ENABLEDfalse, AI_ALLOW_REMOTEfalse, leere Keys und Livefalse pruefen. Kein realer Provider/Modellkontakt, keine Finanzkonten. Ridge bleibt offline; geprueft wird der deterministische Paper-Mock.
- Gleiche neue Anfangszeit/Quote/Kapital/Universum/Kosten und explizite harte Risikolimits registrieren, bevor Ergebnisse ausgewaehlt werden. Eigene frische Paper-Konten ai/rules/hold und DB. Den tatsaechlichen initialen BTC-Anteil/BuyHold-Regeln aus bestehendem Scheduler/Broker pruefen und offen ausweisen, nicht pauschal100%BTC behaupten.
- observeForward speichert bereits pro Konto/version eine saubere flache Baseline und Quellen-/Fill-/Gapbelege. AI kann grundsaetzlich eine eigene Serie erhalten. Der bestehende readForwardCohort laedt aber ausschliesslich rules und hold; compareForwardCohort verlangt dieseIDs UND identische evaluationVersion. Er ist keine fertige AI-Vergleichsauswertung.
- AI-Policyfingerprint fliesst in dessen strategy/evaluationVersion ein, rules/hold haben eine andere legitime Strategieversion. Fuer mehrere Strategien eine neue registrierte Experimentidentitaet mit jeweils eigener gebundener Leg-Version verwenden. Nicht Konto-IDs umbenennen, Versionshashes faelschen/angleichen oder die alten Vergleichsguards abschwaechen, nur um ein gruenes Resultat zu bekommen.
- Leg-Baselines muessen gleiche belegte Startzeit/Kapitalgrenzen erfuellen; Fills jeweils gegen die eigene registrierte Version/Herkunft kontrollieren. Universum/Kosten/Policy-/Codewechsel, fremde Fills oder fehlende Quellen kontaminieren die entsprechende Kohorte. Keine nachtraeglichen Baselinepreise oder geloeschten Luecken. Unbekannte/stale Bewertungen bleiben null.
- Erst Registrierung/Vertrags-/Versions-/Baseline-/Gap-/Filltests implementieren, dann isoliert starten und Rohdaten/Logs/Prozess-/Sourcehashes sichern. Den Hauptbot/Referenz/Altkonten unveraendert erhalten. Verlaufsbeobachtung liefert beschreibende Evidenz, keine Gewinnwahrscheinlichkeit oder Unabhaengigkeit.
- Unbeaufsichtigte Beobachtung zaehlt nicht als Arbeitszeit. Ausdrueckliche menschliche Pause respektieren. Alles bestehend/lokal/gratis, kein Installer, Kreditkauf, API-Key oder kostenpflichtiger Provider.


## Implementierungsstand31.10.2026

research/paper-experiment.ts und PAPER-EXPERIMENT-REGISTRATION.md implementieren jetzt den expliziten ersten Vertrag: gemeinsame Bedingungen plus eigene legitime Leg-Versionen, bestehende Policyberechnung/echteSQLite-Settings, atomare Ablehnung vorhandener Kontohistorie und unveraenderliche spaetere Wiederaufnahme.32Tests. Keine automatische Verdrahtung, neue Kohorte noch nicht gestartet. Naechstes Gate/Anfangsbeobachtung/Mehrleg-Auswertung vor Freeze/Launch implementieren.

Scheduler/Broker gelesen: Hold fordert acc.cash an, normaler Einstiegsrisikoblock ist fuer strategyhold ausgenommen und stopLossPrice wird aufnull gesetzt. Dies ist ein voller Cash-Kaufversuch mit Freshness/Quote-/Fill-/Feepruefungen, keine Garantie eines exakt100%Nominals nach Lot-Dust. Diese unterschiedliche Risikosemantik ist im Vertrag sichtbar.


## Ausgangsbeobachtungen und Mehrleg-Auswertung31.10.

paper-experiment-observations.ts/PAPER-EXPERIMENT-OBSERVATIONS.md implementieren nun atomare gemeinsame Ausgangspunkte, registrierteRuns, echte3Leg-Samples und eigenen schreibgeschuetzten Vergleich mit jeLeg-Provenance/Kosten-/Cash-/Gapbelegen.17neueTests; keine Fake-IDs/gleichenVersionshashes. Keine Scheduler-/APIverdrahtung oder gestarteteKohorte. index.ts startet aktuell Scheduler vor Markt; fuer Experimentmode Gate nach echter Marktinitialisierung und vor jedem Strategie-/Holdorder zuerst einbauen. Individuelle Legacy-Forwardcalls im Experimentfluss nicht doppelt zu denselben Zeitpunkten mitschreiben.


## Echte Ablaufanbindung31.10.

PAPER_EXPERIMENT_MODEmock und PAPER-EXPERIMENT-INTEGRATION.md: neue eigeneDB/profilstrikt, echterProducer/Markt-vor-Baseline-vor-Scheduler-Bootstrap, realeBrokerEntryguards vor/nachLatenz, Schutzverkaeufeunabhaengig, Source-Runregistrierung vor Resume-Ticks, echtergemeinsamerBewertungsbatch und bedingteRead-onlyAPI sourceintegriert.16neueTests,701+15gesamt, Hauptprofiloff/AInone/Route404realgeprueft. Noch kein separater eingefrorenerForwardprozess gestartet. Naechstesprepare/start/verifyeigeneRoot/Seed/114Abhaengigkeiten/Loopbackport, keineAlt-/Referenzkonten ueberschreiben. Danach Strategie-/Regimeintelligenz und weitereUpstreammodule priorisieren.
