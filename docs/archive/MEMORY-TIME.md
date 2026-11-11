# Zeitlich belegtes Paper-Gedaechtnis

Version paper-memory-v2. Vorstufe fuer Lernen/Strategievergleiche, kein trainiertes Modell und kein Profitnachweis. Implementierung: memory/store.ts; Scheduler uebergibt seinen expliziten UTC-Kontextzeitpunkt und die Paper-Konto-ID. Die unveraenderte Regelbaseline und der neue deterministische Mock verwenden diese Nachbarschaftstreffer nicht als Handelssignal.

## Zeit- und Datenvertrag

- Alte memory_entries bleiben erhalten. Zwei additive Tabellen enthalten neue Beobachtungs-/Outcome-Belege: memory_observations und memory_outcomes. Alte Werte ohne Belege bleiben unbestaetigt; keine erfundene Migration auf eine neue Bedeutung.
- Eine neue Beobachtung speichert die geschlossene15m-Featurezeit, den zugehoerigen Preis-Schlusszeitpunkt und den tatsaechlichen Speicherzeitpunkt. Unfertige, unaligned, ueber20Minuten alte und nicht endliche Featurevektoren/ungueltige Preise werden nicht aufgenommen.
-1h/4h/24h-Preisveraenderung beginnt am Feature-Schluss, nicht am spaeteren Ausfuehrungszeitpunkt. Nur die exakte15m-Kerze mit Schlusszeitpunkt Feature-Schluss plus Horizont liefert ein Outcome. Fehlende Anker bleiben unbekannt; keine nahegelegene Ersatzkerze. Quelle und erster Berechnungs-/Verfuegbarkeitszeitpunkt werden aufbewahrt.
- Ein Rueckblick erhaelt asOf zwingend. Beobachtung und4h-Outcome muessen dann verfuegbar und abgeschlossen sein. Die Begrenzung auf2000zeitlich geeignete Kandidaten, Skalierung, Dublettenauswahl und Nachbarschaftssuche verwenden ausschliesslich diese Teilmenge. Keine globale, zukuenftige Featurestatistik, kein Tagescache.
- Zusaetzliche1h/24h-Outcomes werden einzeln nach ihrem eigenen Horizont UND Verfuegbarkeitszeitpunkt maskiert. Spaeter vorhandene Outcomes duerfen einen historischen Rueckblick nicht veraendern.
- Gleicher Feature-Schluss zaehlt einmal. Aus den naechsten Treffern werden hoechstens5nicht ueberlappende4h-Preisfenster ausgewaehlt. Das beweist keine statistische Unabhaengigkeit: Markt-/Regimeabhaengigkeit bleibt unbekannt. Kontoherkunft ist explizit; der Scheduler mischt keine Paper-Kontolabels.
- Rohe Preisveraenderungen sind keine Netto-Traderenditen. PnL wird nicht aus unbelegten Altspalten uebernommen; tradePnlEur bleibt im Rueckblick null. Bestehende gespeicherte Werte bleiben unangetastet. Ein kuenftiger Fill-/Gebuehren-/Teilausstiegsabgleich ist separat erforderlich.

## Belege und Grenzen

SQLite-Fixtures pruefen exakt geschlossene Horizonte, spaete Verfuegbarkeit, fehlende exakte Anker, Zukunftsvergiftung der Skalierung, maskierte24h-Ergebnisse, erhaltene Altwerte, Kontoabgrenzung, fehlerhafte Vektoren, Dubletten/ueberlappende Fenster, ungueltige Kerzen und unveraenderliche bereits gespeicherte Outcomes. Die Kompaktkodierung rekonstruiert neue Zeit-/Evidenzfelder exakt.

Ein synthetisches Maximalpaket mit20Marktuebersichten,20belegten Offline-Exitverlaeufen und5Hits je Ausgangs-Memory erreichte zunaechst korrekt die Budgetsperre. Wiederkehrende verschachtelte evidence-Records werden nun durch die vorhandene verlustfreie v3-Kodierung geteilt. Dasselbe Paket passt mit114084von115000Zeichen:8nach bestehender Prioritaetsregel ausgewaehlte Erinnerungen/40Hits, alle20Markt-/Regime-/Feature-/Buchdaten, Policy/Limits und20Exits exakt. Sichtbare bisherige Auslassungen von Rohkerzen/weiteren Erinnerungen bleiben dokumentiert, kein Modell aufgerufen. Reproduzierbar mit `pnpm --filter @paper/server exec tsx ../../scripts/check-memory-budget.ts`; Fixture ist explizit synthetisch und kein historisches Orderbuch.

Verfuegbarkeit wird konservativ erst bei Berechnung angenommen; sie rekonstruiert keine unbekannten frueheren Datenankunftszeiten. Neue Belege koennen erst nach echten Horizonten entstehen, ohne Wartezeit als Entwicklung zu zaehlen. Keine automatische Nutzung der Treffer als Prognose, keine Kalibration/ML oder unabhaengige Out-of-sample-Evidenz nachgewiesen. Naechster Schritt: vorab registrierter Vergleich und robuste Lern-/Regimeverfahren nach weiterer Upstream-Pruefung, nicht eine Gewinnwahrscheinlichkeit aus Nachbar-Trefferquoten.
