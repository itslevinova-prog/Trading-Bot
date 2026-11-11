# Separater Mock-Paperversuch und gefundener Zeitfehler

31.10.2026: vorab registriertes Protokoll mock-forward-protocol-v1.json, Source799e5544485b, Port3200, eigene eingefrorene Source/Web/114Produktionspakete ohne Installation. Neue Datenbank nur mit26oeffentlichen Paaren und289678geschlossenen Kerzen; keine Konten-/Trade-/Memoryhistorie kopiert. Drei echte simulierte Anfangskonten ai/rules/hold je1000EUR, gemeinsame Baseline2026-10-31T10:27:25.406Z. JeLeg-Versionen bleiben absichtlich verschieden. Manifest/Seed/Env/Quellen/Abhaengigkeiten und tatsaechliche Registrierung/Run/Fills geprueft; zweiter Startaufruf verwendete denselben Prozess ohne neue Baseline.

Die BTC-Haltebenchmark kaufte simuliert0.01455BTC, Kosten998.6195397EUR plus0.9986195397EUR Gebuehr. Lot-Dust und abweichendes Hold-Risiko sind dokumentiert; kein exakter100%-Investitionsgrad oder vergleichbares Stop-Risiko behauptet. Anfangs fehlende Nach-Fill-Marks lieferten korrekt keine Metriken; spaeter echte zeitlich passende Beobachtungen. Wenige Minuten Cash gegen BTC sind kein Prognose-/Gewinnnachweis.

## Reales Integrationsproblem

Erste gespeicherte Mockentscheidung cc211254-96bc-40ed-a3e9-aa376ff0be6d: Entscheidungszeit1793442605236, Marktzeit1793442605239. Alle20Bewertungen lehnten deshalb mit missing-stale-or-mixed-market-evidence ab, obwohl15Orderbuecher frisch waren. Ursache: Scheduler erfasste timeUTC vor einem separaten Date.now im Collector. Der Future-Guard reagierte korrekt auf inkonsistente Metadaten; ihn zu lockern waere die falsche Reparatur.

Scheduler.context erfasst jetzt einen gemeinsamen Zeitpunkt fuer Datumsangaben, Haltedauer, Tagesgrenze, Featurefilter, Recall und collectMarketContext. Der Collector erlaubt explizites asOf und behaelt den bisherigen Default fuer andere Aufrufer. Regression vor Reparatur nachweislich fehlgeschlagen. Vier neue Faelle: gemeinsame Zeit bei fortschreitender Clock, frisches Buch, zu altes Buch, zukuenftiges Buch.25gezielte Tests sowie705Haupttests+15Offline/alleTypchecks/Build bestanden. Neuer Build5cadb6de7c67fd055b6167164ae1fc3b801ca843475087a8d4be37e8f3c00368.

Der eingefrorene Versuch wurde um10:41:30UTC beendet; Source, Seed, Konto-/Fill-/Beobachtungsdaten bleiben unveraendert erhalten. Status stopped-known-context-clock-defect, nicht als faire Strategiequalitaetspruefung auswerten und nicht mit nachtraeglich korrigierten Zeitstempeln reparieren. Letzten Bericht und Stop-Pruefeinschraenkung siehe mock-forward-proof.json. Hauptprofil bleibt separater Paperbetrieb off/AI none; keine reale KI, privaten Aufrufe, Finanzkonten, Keys, kostenpflichtigen Dienste oder echten Orders.

## Naechster Schritt

Neuen unvermischt versionierten Mockversuch mit korrigiertem Kontextzeitvertrag vorbereiten: bisheriger Pointer/Root bleibt Historie, explizit neuer Pointer/Protokoll/Source, gleiche echten Ausgangskapital-/Fill-/Markanforderungen. Vor Start integrierten Scheduler-Kontext durch Mockbewertung fuehren, sodass keine pauschale Zeitmetadatenablehnung verborgen bleibt. Keine ersten beobachteten Ergebnisse zum Schwellentuning nutzen. Danach direkte Regime-/Struktur-/Entscheidungsintelligenz und vertiefte OSS-Pruefung;28ausgewaehlte Dateien sind kein vollstaendiges Projekt-Audit. Gewinne/Unabhaengigkeit unbekannt. Passive Laufzeit zaehlt0Entwicklungszeit.
