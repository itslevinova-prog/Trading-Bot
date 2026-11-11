# Spot Trading Lab – V0.4

Lokale Forschung und Paper-Trading mit öffentlichen **Binance-Spot-Daten**, optional Kraken, ausführlichem KI-Kontext und einem getrennten, standardmässig ausgeschalteten Testnet-/Live-Prozess. Keine Schlüssel werden angelegt, kein bezahlter Dienst aufgerufen. Standardbetrieb: kostenlos, lokal, ohne echtes Geld.

**Profitabilität ist nicht nachgewiesen.** Im ersten Lauf über 20 EUR-Märkte, rund 90 Tage und vier feste Research-Modelle waren nur sieben von 80 jüngsten Holdouts positiv. Das bewertet kein angeschlossenes KI-Modell. Ergebnisse stehen in `docs/research-latest.json`.

**Aktuelle Prioritäten und WIP-Grenze:** [Roadmap und kritischer Pfad](docs/ROADMAP.md) (Issue #32). Maximal drei offene PRs, abhängige Arbeiten erst nach Merge der Voraussetzungen.

## Start

Node.js 22 oder neuer, pnpm 11.25.0 und Internet für öffentliche Daten:

```powershell
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install
Copy-Item .env.example .env  # nur wenn noch keine eigene .env existiert
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Dashboard: <http://127.0.0.1:3000>. `pnpm dev` startet zusätzlich Vite auf Port 5173. Das Dashboard simuliert ausschliesslich Trades und hat keinen Button für private Börsenorders.

Verifiziert: vollständige Typprüfung, Build, 82 Vitest-Tests, 15 zusätzliche Offline-Tests und öffentlicher Binance-EUR-Feed mit 20 Märkten und rund 90 Tagen Historie. Keine privaten Testnet-/Live-Fills und kein echtes Modell getestet. Aktuelle Arbeiten und offene Nachweise stehen in `docs/WORK-LOG.md`.

## Börse und Währung

```dotenv
EXCHANGE=binance
QUOTE_CURRENCY=EUR
HISTORY_DAYS=90
AI_ENABLED=false
AI_PROVIDER=none
AI_ALLOW_REMOTE=false
LIVE_ENABLED=false
```

Binance wurde wegen seiner Verbreitung und Spot-Liquidität ergänzt ([CoinGecko-Marktforschung](https://www.coingecko.com/research/publications/centralized-crypto-exchanges-market-share)). Binance unterstützt EUR, USDT und USDC; Kraken weiterhin EUR. Es gibt keine automatische Währungsumrechnung. Alte Feldnamen wie `amountEur`, `costEur` und `volume24hEur` bedeuten bei anderen Quotes die jeweilige Kontowährung.

Standarddateien: `data/binance-eur-paper.db`, `data/kraken-eur-paper.db` usw. Eine gespeicherte Identität verhindert das Vermischen von Börsen/Währungen. Alte unmarkierte Datenbanken gelten als Kraken/EUR; für Binance einen neuen Pfad verwenden. Bestehende Konten werden nicht übertragen oder gelöscht.

Binance lädt geschlossene Historie paginiert und empfängt Top-20-Orderbuch, Ticker und 15m-/1h-Kerzen per WebSocket. Reconnects verwerfen alte Bücher und ergänzen Historie. Kraken REST liefert weiterhin maximal 720 Kerzen pro Abruf. Das Interface `market/types.ts` trennt Börse, Strategie und Broker.

## KI-Kontext und kostenloser lokaler Anschluss

Der vollständige Kontext umfasst Konto, Positionen, Nettoergebnisse, Gebühren, Drawdown, Limits, frühere Situationen, bekannte Ergebnisse und Lektionen. Dazu kommen geschlossene Kerzen mehrerer Zeitebenen, EMA/RSI/ATR, Volumen, Spread, Volatilität, VWAP, lokale Hochs/Tiefs, sichtbare Buchtiefe, Imbalance, Quellenalter, Datenlücken, Marktbreite und BTC-Korrelation. Lokale historische Research-Ergebnisse zeigen auch negative Befunde. Research-Modelle und tatsächliche Regeln sind getrennt gekennzeichnet.

Standardmässig `CONTEXT_EXTERNAL_ENABLED=true`: öffentliches Alternative.me-Sentiment, Binance-BTC-/ETH-Perpetual-Funding sowie Cointelegraph-/CoinDesk-RSS-Schlagzeilen mit Quelle und Zeitstempel. Mit `false` lassen sich diese öffentlichen Zusatzabfragen abstellen; Artikeltexte werden nicht gespeichert. Derivate dienen nur als Kontext. Ausfälle sind unbekannt; kostenpflichtige News, On-Chain-Analytics und Makrotermine werden nicht erfunden.

Vollständige Snapshots und vorbereitete Prompts bleiben lokal im Entscheidungsprotokoll. `AI_MAX_CONTEXT_CHARS` begrenzt nur die Modellübertragung; Kürzungen sind ausgewiesen. Passen Pflichtdaten nicht ins Budget, entfällt der Aufruf. Confidence verändert kein Risikolimit. Dashboard: **KI-Kontext**; JSON: `/api/context`, `/api/readiness`.

Ein bereits lokal laufendes Modell mit kompatiblem `/v1/chat/completions`-Endpunkt:

```dotenv
AI_ENABLED=true
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_MODEL=NAME_DES_LOKALEN_MODELLS
AI_API_KEY=
AI_ALLOW_REMOTE=false
```

Die Software lädt kein Modell und bucht keinen Dienst. Remote-Ziele sind standardmässig technisch gesperrt. Eine ausdrückliche spätere Änderung von `AI_ALLOW_REMOTE` könnte die kostenlose Betriebsgrenze verlassen. Hier wurde kein solcher Aufruf durchgeführt. Unvollständige/ungültige Modellantworten, unbekannte Paare und Fehler führen zu keinem Trade, ohne API-Retry. Ohne Modell bleibt das KI-Konto inaktiv; Kontext wird trotzdem vorbereitet. `mock` testet mit Zufallsentscheidungen, `claude` bleibt ein inaktiver Alt-Platzhalter.

## Simulation und Kosten

KI, feste Regeln und BTC Buy & Hold starten mit je 100 Quote-Einheiten. Simulierte Ausführung nach 300–900 ms anhand des neuesten gültigen Buchs, mit Gebühren, Bid/Ask, Mindestgrössen und sichtbarer Liquidität. Das Regelkonto verwendet EMA-Kreuzungen und sechs Qualitätsprüfungen. Einstiege unterliegen zusätzlich harten Spread-/Slippage-Grenzen von 20/30 bps und einem gemeinsamen Stop-Risikobudget von standardmässig 2,5 %. Positionsgrenzen, Tageslimit, Cooldown und Drawdown begrenzen Einstiege. Schutzverkäufe dürfen das reguläre Tageslimit überschreiten.

`TAKER_FEE_RATE` ist eine konfigurierbare Schätzung. Ohne Override: Binance 0,001; alter Kraken-Pfad 0,008. Tatsächliche Kontogebühren können abweichen. Die Simulation verwendet weiterhin `number`; Queue-Position, vollständiger Marktimpact und alle Gebührenwährungen werden nicht modelliert.

## Getrennter Testnet-/Live-Prozess

```powershell
pnpm live:cycle  # ein Zyklus; Standard sendet nichts
pnpm live:run    # wiederholte Zyklen; ebenfalls standardmässig aus
```

Ein späterer Anschluss benötigt eigene Binance-Schlüssel, ein angebundenes Modell und die lokalen Freigaben aus `.env.example`. Standardnetz ist `testnet`; Produktion erfordert zusätzlich den ausdrücklich gesetzten `LIVE_ACK`. Aktuell bleiben alle Freigaben aus. Keine Konten/Schlüssel werden erstellt. Testnet-Schlüssel müssen zum Testnet gehören.

Der Prozess bewertet das tatsächliche Spot-Konto und verwendet eine eigene Datenbank mit Netzwerk, Währung und Schlüsselfingerabdruck. Ein dediziertes Konto wird vorausgesetzt. Fremde Orders, nicht bewertbare Assets, ungeschützte Bestände, Drawdown und ungeklärte Orderabsichten sperren Einstiege. Standard: maximal zehn Quote-Einheiten je Einstieg und 0,5 % nominales Risiko inklusive geschätzter Kosten. Kurslücken können Grenzen übersteigen.

Käufe erfordern native Binance-OPOCO-Unterstützung: Limit/FOK-Einstieg mit Stop-Loss und Gewinnziel für die erhaltene Nettomenge. Eindeutige IDs, Prozesssperre und ein vor dem Senden synchron gespeichertes SQLite-Journal verhindern automatisches erneutes Senden nach Crash/Timeout. Ein unklarer Status setzt eine dauerhafte Sperre, die nicht still zurückgesetzt wird.

**Offene Live-Grenzen:** Modell-Verkäufe sind gesperrt, damit keine laufenden Schutzorders aufgehoben werden. Ausstiege nur über native Stop-/Zielorders. Keine automatische Notfallglattstellung nach abgelehnter Schutzorder. Keine privaten Integrationstests mit eigenen Schlüsseln, keine Gewinnnachweise. Kein Hebel, Short, Transfer oder Auszahlungsendpunkt. Echter Börsenhandel verursacht später Gebühren und kann Geld verlieren; der jetzige Betrieb ist kostenloses Paper-Trading.

Nach Prozessabbruch eine verbliebene `.lock` erst prüfen, statt sie bei möglicherweise laufendem Prozess zu entfernen. `pnpm reset` betrifft nur die ausgewählte Paper-Datenbank, niemals das Live-Journal oder Börsenkonto. `pnpm reset -- --full` löscht dort zusätzlich Historie, Erinnerungen und Lektionen; Server vorher stoppen.

## Forschung, Langzeittest und Fortsetzung

```powershell
pnpm research:report
pnpm research:portfolio
pnpm test:offline
pnpm soak --hours=10
```

Der Bericht enthält Dataset-Hash, Kosten, Datenschnitt und alle vier festen Modelle. Keine automatische Gewinnerauswahl. 70/30-Teilung, drei chronologische Prüffenster, Kostenstress und Lückenprüfung ersetzen weder unabhängige Marktzyklen noch langfristiges Forward-Trading. Die vier Research-Modelle sind separate Experimente. `research:portfolio` ruft zusätzlich den tatsächlichen Regelprovider mit gemeinsamen Konten-/Risikogrenzen auf; seine historischen Fills bleiben OHLC-Näherungen. Sein erster 20-Markt-Lauf ergab −0,6807 % und nur zwei geschlossene Positionen, also keinen belastbaren Gewinnnachweis. Versionierte Forward-Registrierungen unter `docs/forward-registrations/` sind unveränderlich; `deploymentVerified=false` kennzeichnet den noch offenen Deployment-/Versionsnachweis. Wiederholtes Betrachten verbraucht Holdout-Unabhängigkeit.

Der Soak-Test beobachtet ausschliesslich lokale Paper-Endpunkte und schreibt nach `data/soak/`; keine Modell- oder privaten Börsenanfragen. Passive Messzeit zählt nicht als aktive Entwicklungszeit. Arbeitszeit und Fortsetzung stehen in `docs/WORK-LOG.md` und `docs/work-state.json`. Die Heartbeat-Fortsetzung benötigt eingeschaltete App/Rechner und verfügbare enthaltene Nutzung; keine Zusatzcredits werden gekauft ([offizielle Dokumentation](https://learn.chatgpt.com/docs/automations?surface=app)).

## Docker und Referenzen

`docker compose up --build -d` bindet Port 3000 nur an 127.0.0.1 und speichert Daten im Volume `paper-data`. Containerbetrieb wurde hier noch nicht getestet.

- [Offizielle Binance-Spot-Dokumentation](https://github.com/binance/binance-spot-api-docs)
- [Börsenfilter](https://github.com/binance/binance-spot-api-docs/blob/master/filters.md)
- [OPO-/OPOCO-Verhalten](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/opo.md)
- [Kraken-v2-Orderbuch](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/book)

V0.3-Dokumentation als Historie: `docs/README-V03.md`. Sie beschreibt nicht den aktuellen Umfang.


## Herkunft und prospektive Paper-Messung

`/api/provenance` nennt den tatsächlich gestarteten Quellen-/Laufdatei-Build, die Konfiguration ohne Schlüssel und den Marktuniversums-Fingerprint. Neue Trade-Metadaten werden zusammen mit Fills und Cash atomar gespeichert. Alte Trades bleiben unzugeordnet. Builds und Quellen bleiben lokal unter `data/build-archives/`, historische Portfolio-Berichte unter `docs/research-runs/`. Ein Bericht passt nur bei gleicher verifizierter Strategie- **und** Universumskennung zum aktuellen Lauf.

`/api/forward-evidence` und das Strategie-Labor zeigen prospektive Paper-Messabschnitte. Start je Konto und Version nur mit leerem Portfolio, aktiver Marktverbindung und vor dem ersten Fill dieser Version. Bewertungsprobleme, Unterbrüche und Neustarts bleiben sichtbar. Fremde/ungeprüfte Fills oder ein Kontoreset entwerten den bisherigen Abschnitt dauerhaft; Daten werden nicht rückwirkend bereinigt. Bestände aus alten Versionen verhindern einen sauberen Neustart. Die Rendite basiert auf frischen besten Geldkursen und bereits bezahlten Fill-Gebühren, ohne hypothetische Liquidationsgebühren und ohne vollen Marktimpact. Das ist noch kein unabhängiger langfristiger Performance- oder Gewinnnachweis.


## Fehler bei simulierten Schutzverkäufen

Ausgelöste Paper-Stops und Gewinnziele bleiben bei einem abgelehnten oder technisch gescheiterten Verkauf ausgelöst. Je Position gibt es höchstens einen laufenden Versuch. Der nächste Versuch benötigt einen neuen gültigen Kurs und wartet mit wachsendem Abstand von einer bis höchstens 60 Sekunden. Schon der ausgelöste Trigger wird vor der simulierten Ausführung gespeichert. Ablehnungsgrund, Versuchszähler und Wartezeit überstehen Neustarts; auch eine Kurserholung vergisst einen bereits ausgelösten Stop nicht. Neue Käufe und manuelles Fortsetzen bleiben bis zur Auflösung gesperrt; Schutzverkäufe funktionieren auch im pausierten Konto. Ein späterer erfolgreicher Verkauf setzt das Konto nicht automatisch wieder aktiv.

Die Risikoanzeige und `/api/protective-exits` zeigen offene Fehler. Technische Exception-Texte werden nicht als Modellkontext veröffentlicht. Auch ausgefallene Diagnosespeicherung darf keine ungefangenen Promise-Fehler oder schnellen Wiederholungen erzeugen; im laufenden Prozess gilt dann ein zusätzlicher Abstand im Speicher. Geordnetes Beenden wartet auf bereits laufende Aufgaben und verwirft verspätete Modellaktionen. Diese Wiederholungen betreffen ausschliesslich die Simulation; der separate private Client wiederholt keine unklaren echten Orders.


## Kostenlose Historien-Reparatur

Der Binance-Feed sucht beim Start, beim Reconnect und alle 15 Minuten nach fehlenden geschlossenen Kerzen im gesamten konfigurierten Historienfenster. Ein Reconnect ist nicht mehr auf die letzten zwei Tage beschränkt. Vollständige Reihen laden nur die beiden jüngsten geschlossenen Kerzen erneut. Benachbarte/zu zahlreiche kleine Lücken werden zusammengefasst, maximal 1.000 Zeilen je Seite und ein hartes Abfragebudget je Markt/Intervall begrenzen die öffentlichen Requests. Es gibt keinen direkten Retry einer Rate-Limit-Antwort.

Fehlende oder nicht verfügbare Daten bleiben fehlend; keine künstlichen OHLC-Kerzen und kein angenommener Zeitraum vor dem Listing. Der Modellkontext enthält pro Markt einen Bericht mit Zeitpunkt, Anzahl Requests, geschriebenen Kerzen und verbleibenden Lücken oder einen ausdrücklichen Fehlerstatus. Beim Beenden wird ein später zurückkehrender Abruf nicht mehr in eine geschlossene Datenbank geschrieben. Dies verbessert Datenabdeckung, belegt aber keinen Gewinnvorteil.


## Vergleichbare feste Forschungsdaten

`pnpm research:portfolio` friert beim ersten Lauf Preise, Marktfolge, Mindestgrössen, Prüfzeitraum und Kosten lokal ein. Spätere Standardläufe verwenden genau diese Eingaben, auch wenn neue Kurse eintreffen oder das Volumen-Ranking andere Paare auswählt. Die komprimierte Datei unter `data/research-datasets/<Prüfsumme>.json.gz` wird vor jedem Replay validiert. Beschädigte oder verlorene Defaults werden nicht still durch neue Stichproben ersetzt. Die Auswahl ist gegen gleichzeitige Änderungen gesperrt; eine nach Absturz verbliebene Auswahl-`.lock` vor manuellem Entfernen auf einen laufenden Prozess prüfen.

```powershell
pnpm research:portfolio                          # denselben Standarddatensatz erneut prüfen
pnpm research:portfolio -- --refresh-dataset     # ausdrücklich neue Stichprobe und Default-Auswahl
pnpm research:portfolio -- --dataset=PRUEFSUMME  # archivierte Stichprobe, separater Vergleichsbericht
```

`--dataset` erwartet die vollständige 64-stellige Kennung, keinen Dateipfad. Der explizite Vergleich verändert weder Standarddatensatz noch den Standardbericht. Ein bewusster Refresh erhält alle älteren Dateien und Auswahlprotokolle. Defaults sind nach Börse und Quote-Währung getrennt. Maximal 64 MiB komprimierte / 256 MiB entpackte Daten pro Datei begrenzen den lokalen Ressourcenbedarf; ein zu grosser Datensatz wird abgelehnt.

Berichte nennen den Datensatz und kennzeichnen, ob Preise/Marktfolge, Universum/Mindestgrössen und Kosten/Zeitfenster gegenüber dem vorigen Bericht gleich sind. Nur dann ist eine beschreibende Renditedifferenz zulässig. Ändert sich die laufende Risikokonfiguration oder das aktuelle Universum, passt der feste Bericht ausdrücklich nicht mehr zum aktuellen Simulator. Ein neuer Erstellungszeitpunkt oder wiederholter Replay liefert keine neue unabhängige Evidenz. Die bereits betrachtete Historie und die Auswahl heutiger Marktteilnehmer bleiben als Grenzen sichtbar; Gewinne sind nicht nachgewiesen.


`node scripts/verify-fixed-replay.mjs` prüft nach einem Build zwei vollständige Standard-Replays auf identische Ergebnisse und einen expliziten Vergleich mit abweichender Lauf-Gebühr. Er prüft, dass Standardbericht und Default-Zeiger dabei bytegleich erhalten bleiben. Alle Aufrufe sind lokal, ohne Modell oder private Börsenanfragen; die Nachweise enthalten Build-/Datensatzkennung und werden unveränderlich archiviert.


## Native Restmengen und Bewertungsgrenzen

Der vorbereitete Binance-Ausführer bewertet jeden positiven Bestand, auch deutlich unter einer Quote-Einheit. Frei und gesperrt werden als Dezimalzahlen einzeln geprüft und exakt addiert; negative, doppelte oder ungültige Salden werden abgelehnt. Eine kleine Quote-Bewertung allein beweist keine Ausnahme von nativen Filtern: Market-Notional kann eine Referenz-/Durchschnittsnotierung verwenden.

Nur Restmengen, die nach den aktuellen `LOT_SIZE`-/`MARKET_LOT_SIZE`-Mengenregeln nachweislich keinen positiven nativen Verkaufsauftrag erlauben, dürfen ohne bestätigten Stop verbleiben. Ihr voller markierter Wert zuzüglich Puffer belegt das Portfoliorisikobudget. Grössere Restmengen, ungültige Stops und überzählige Schutzmengen sperren Einstiege. Mengenreste werden nicht als Cash ausgegeben. Sie zählen nicht als ausführbare Positionsplätze; Aufstockung desselben Assets einschliesslich Restbestand bleibt bis zu einem ausdrücklich entwickelten Konsolidierungspfad gesperrt.

Binance-OPOCO passt die erhaltene Nettomenge nach Gebühren an die Mengenfilter an und gibt ungenutzte Menge frei. Der Ausführer reserviert deshalb bereits vor dem Einstieg einen vollen gemeinsamen Mengenschritt im Risikobudget und prüft eine konservative Netto-Schutzmenge sowie deren Filter. Dies kann bei kleinem Kapital zusätzliche Paare sperren; das Risikolimit wird dafür nicht automatisch gelockert. Gebührenreserve bleibt eine Schätzung, keine verifizierte kontospezifische Provision. Native Aktivierung muss weiterhin bestätigt werden.

Jede Bestandsnotierung nennt ihren Empfangszeitpunkt. Kontoprüfungen älter als 15 Sekunden und einzelne Bestandskurse älter als fünf Sekunden sperren neue Einstiege. Der Snapshot-Zeitpunkt wird nicht erst am Ende langsamer Netzabfragen künstlich erneuert. Bestes Bid ist eine Bewertungsnäherung, keine garantierte Liquidationssumme; Kurslücken und Markttiefe bleiben Risiken. Alles wurde mit injizierten Antworten geprüft, ohne private Börsenanfragen oder echte Orders.

Paper-Bewertung: Jeder gehaltene Markt benötigt ein gültiges, frisches öffentliches Orderbuch mit nicht zukünftigem Zeitpunkt und bestehender Verbindung. Fehlt das, sind Gesamtwert, laufender PnL und aktueller Drawdown ausdrücklich unbekannt; Einstand/Ticker ersetzen keinen aktuellen Preis. Neue Käufe sind vor und nach der Latenz gesperrt, eigene frische Schutzverkäufe bleiben erlaubt. Keine künstlichen Equity-Samples/Peaks, kein Fortsetzen ohne gültige Bewertung. Historische Samples vor dieser Prüfung bleiben Legacy-Daten; Forward-Nachweise sind gesondert versioniert. Top-Bid-Bewertung enthält keine vollständige Liquidationstiefe/Gebühren und garantiert keinen erzielbaren Verkaufserlös.


Eingefrorener kostenloser Paper-Referenzlauf: `data/paper-candidate-current.json` zeigt auf eine separate Kopie des verifizierten Server-/Shared-Builds, des Dashboards, der Prompts und installierter Pakete. Keine Verknüpfung zeigt auf veränderlichen Workspace-Code. Die eigene Datenbank wurde nur mit öffentlichen Paaren und bereits geschlossenen historischen Kerzen initialisiert; Konten, Trades, Positionen, Entscheidungen, Erinnerungen und private Konfiguration wurden nicht übernommen. Neue Konten starten mit je 100 Quote-Einheiten. Regelkonto und BTC Buy & Hold registrieren dadurch neue flache Forward-Baselines. Diese wenigen Minuten sind kein belastbarer Gewinnnachweis.

Der Referenzlauf ist unter http://127.0.0.1:3100/ erreichbar, der Entwicklungsserver weiter auf Port 3000. KI bleibt deaktiviert; der Referenzprozess erbt nur erlaubte Systemvariablen und seine ausdrücklich kostenlose Konfiguration. Keine Zugangsschlüssel, Installer oder kostenpflichtigen Modelle. Den laufenden Referenzordner bei normaler Weiterentwicklung erhalten und unverändert lassen.

- `node scripts/prepare-paper-candidate.mjs`: einmalig aus geprüftem Build/Archiv und nur lesender öffentlicher Historie vorbereiten. Verweigert das Ersetzen eines vorhandenen Referenzkandidaten.
- `node scripts/start-paper-candidate.mjs`: einmal starten oder vorhandenen Lauf nach Prüfung wiederverwenden; startet keinen zweiten Prozess und setzt keine Baseline zurück.
- `node scripts/verify-paper-candidate.mjs`: Manifest, Dateien, tatsächliche Paket-Verknüpfungen, Dashboard, kostenlose Flags und eigene Deployment-ID prüfen. Kein Schutz gegen eine Person, die alle Prüfdateien manipuliert; Host/Node bleiben gemeinsame Infrastruktur.
- `node --test scripts/candidate-files.test.mjs`: Isolation bei veränderten Originaldateien, zyklische/optionale Pakete, veränderte kopierte Dateien und zurückgebogene Workspace-Verknüpfungen prüfen.
- `node scripts/snapshot-paper-candidate.mjs`: konsistentes SQLite-Backup samt Prüfsumme und Epochennachweis erstellen, während der Paperbetrieb weiterläuft. Ein solches Backup nach dem Start ist ausdrücklich kein rekonstruierter ursprünglicher Seed. Künftige Vorbereitungen archivieren den Seed zusätzlich vor dem ersten Kontostart.

Referenzbelege stehen in `docs/paper-candidate-latest.json` und `docs/paper-candidate-checkpoint.json`. Gespeicherte Performance bleibt nach Gebühren und Datenlücken zu beurteilen; eingefrorener Code ersetzt keine unabhängige langfristige Prüfung. Es gibt weiterhin keine geprüfte automatische modellgesteuerte Live-Verkaufslogik und keine privaten Testnet-/Live-Fills.


Nach unterbrochenem Hostbetrieb bleibt eine vorhandene Referenzdatenbank erhalten: `node scripts/start-paper-candidate.mjs --resume-stopped` startet nur bei nachweislich nicht laufender gespeicherter PID und freiem Port neu. Lebende oder wiederverwendete PIDs führen zur Prüfung des vorhandenen Laufs. Ein exklusiver Start-Lock verhindert parallele Starts; alte Prozessnachweise bleiben archiviert. Es wird keine Baseline zurückgesetzt. Die öffentliche Volumenauswahl kann sich nach einem Neustart ändern und damit eine andere Ausführungsversion erzeugen; ein bereits geerbter BTC-Bestand bekommt dann keinen erfundenen neuen flachen Start.

`/api/forward-cohort` und der Modellkontext enthalten einen rein beschreibenden Vergleich des Regelkontos mit dem BTC-Buy-&-Hold-Konto und unverzinstem Cash. Beide Konten benötigen zeitlich höchstens eine Sekunde auseinanderliegende, gleich hohe, saubere Baselines derselben Ausführungsversion. BTC muss tatsächlich genau einmal mit verifizierter Provenienz gekauft worden sein. Paarweise Messpunkte dürfen höchstens eine Sekunde auseinanderliegen; alte oder unbekannte aktuelle Vergleiche bleiben `null`. Gebühren, Teilverkaufs-Fills, Verknüpfung zu ursprünglichen Entscheidungsdatensätzen und erst nach einem Fill geschriebene Datensätze werden getrennt ausgewiesen. Keine Gewinnwahrscheinlichkeit, kein statistisch bestätigter Vorteil.

`node scripts/report-paper-cohort.mjs` wertet den laufenden eingefrorenen Kandidaten **nur lesend** mit dem aktuellen gebauten Reader aus. Kandidatenbuild und Readerbuild werden getrennt angegeben; alle früheren vollständigen Kohorten bleiben gelistet, ohne einen Sieger auszuwählen. Ein Universumswechsel erzeugt keine künstliche BTC-Baseline. `currentGapMs` misst das Alter des letzten gepaarten Datensatzes, `valuationGapMs` das Alter des letzten gültigen Wertepaares. Die registrierte Fensterabdeckung enthält auch den unbeobachteten Rest bis heute; Intervalle über 90 Sekunden und unbekannte Zwischenwerte werden nicht als beobachtete Abdeckung gezählt. Fehlende Ausführungen während Stillstand werden nicht nachträglich erfunden.


Referenz-Monitor: `SOAK_URL=http://127.0.0.1:3100` mit `node scripts/soak.mjs --hours=10 --label=reference` schreibt separat nach `data/soak/reference/`. Der bestehende Entwicklungsmonitor auf3000 behält seine Rohdaten und Fehler. Pro Label verhindert ein Start-Lock doppelte Schreiber; der alte locklose Default-Monitor wird zusätzlich anhand seiner gespeicherten PID erkannt. Neue Monitorquellen und Hilfsdateien werden als gemeinsamer Hashsatz unverändert im jeweiligen Datenordner archiviert.

Jede Probe liest Provenienz vor und nach Health/Konten und verweigert gemischte Lauf-/Build-/Universumsidentitäten. Prozess- und Versionswechsel, unbewertete Konten, unterbrochene Verbindungen, fehlende Features sowie unerwartete KI-/Remote-Flags bleiben eigene Zähler. Veraltete Bücher ungebundener Märkte bleiben sichtbar; ein bestandener Stichprobenlauf behauptet keine ständige Frische aller Märkte.

`completed=true` bedeutet nur, dass das monotone Zeitlimit ohne ausdrücklichen Stop erreicht wurde. Erst `sampledRunPassed=true` erfordert alle erwarteten Proben ohne beobachtete Endpoint-/Identitäts-/Uhr-/Takt-/Bewertungsprobleme. Bis dahin steht `resultStatus=in_progress` bzw. `in_progress_with_issues`. Grosse Abstände und unbeobachtete Schlussintervalle bleiben Lücken; Wandzeit-/Monotonzeit-Unterschiede und rückwärts laufende Uhren sind Anomalien. Ein nach Suspend/Hoststillstand bloss abgelaufenes Zeitlimit ist kein bestandener Zehnstundentest. Kein Monitorlauf zählt als aktive Entwicklungszeit oder als Gewinnnachweis.

Lokale Monitor-/Wiederaufnahme-/Isolationstests: `node --test scripts/soak-core.test.mjs scripts/soak-cli.test.mjs scripts/process-guard.test.mjs scripts/candidate-files.test.mjs`. Die CLI-Tests verwenden nur einen lokalen HTTP-Fixtureserver und kurz eingestellte Timer; sie prüfen auch echte NDJSON-Rohzeilen, getrennte Ausgabeordner und abgewiesene Remote-/Credential-URLs.


Modellidentität und tatsächlicher Eingabekontext: KI bleibt standardmässig aus. Der neue Standardmodus `AI_MODEL_MODE=ollama-local` verlangt ein bereits installiertes lokales GGUF-Modell, vom lokalen Server bestätigte deaktivierte Cloud-Funktionen und `AI_EXPECTED_MODEL_FINGERPRINT`. Der Fingerprint bindet exakten Modellnamen, API-gemeldeten Modell-Digest, Serverversion und Metadaten einschliesslich Templates/Parametern. Vor und nach jeder Inferenz muss er unverändert passen. Ein lokaler URL allein ist keine ausreichende Aussage über Cloud-Routing; die aktuelle [Ollama-Dokumentation](https://docs.ollama.com/api/openai-compatibility) beschreibt auch Cloud-Modelle über den lokalen Server.

`node apps/server/dist/model-inspect.js` liest nur lokale `/api/tags`, `/api/show`, `/api/version` und `/api/status`. Es erzeugt keine Antwort, installiert/pullt/lädt kein Modell, erstellt keinen Schlüssel und ändert keine .env. Mit später konfiguriertem `AI_MODEL` liefert es den einzutragenden Fingerprint. Ohne passende Metadaten/Cloudsperre bleibt Inferenz blockiert. Der geprüfte native Vertrag folgt den [offiziellen API-Typen](https://github.com/ollama/ollama/blob/main/api/types.go) und dem [offiziellen Client für /api/status](https://github.com/ollama/ollama/blob/main/api/client.go). Cloud-Abschaltung wird in der [Ollama-FAQ](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features) beschrieben. Kein echter Modellserver wurde hier freigeschaltet oder als getestet ausgegeben.

Für lokale Inferenz wird `/api/chat` mit explizitem `AI_CONTEXT_TOKENS` (standardmässig 131072), begrenzter Ausgabe, `truncate=false` und `shift=false` verwendet. Die [FAQ](https://docs.ollama.com/faq#how-can-i-specify-the-context-window-size) erklärt das standardmässig kleinere Serverfenster und `num_ctx`. Beworbene Modellkapazität wird vorab geprüft; Client-UTF8-Bytes, Template/System-Bytes, Ausgabe und Framingreserve werden konservativ berücksichtigt. Rohkerzen dürfen nur mit sichtbaren Kürzungen entfallen; alle Pflicht-Marktübersichten bleiben erhalten oder der Aufruf entfällt. Dies ist keine exakte Tokenizer-/Gewicht-/Prozessattestation. API-gemeldete Tokenzahlen bleiben Messdaten des Servers; `modelArtifactVerified=false` bleibt ausdrücklich bestehen.

Generischer kompatibler Transport heisst `compatible-unverified` und benötigt ausdrückliches `AI_ALLOW_REMOTE=true`, auch bei einem lokalen Proxy. Er bietet keine lokale Ausführungs-/Identitätsgarantie. Dieser Modus und entfernte oder kostenpflichtige Modelle werden in der automatischen Arbeit nicht aktiviert.

Vor Inferenz wird der vollständige ursprüngliche Kontext gespeichert. Unmittelbar vor dem POST werden tatsächlich übertragener System-/User-Prompt und Request-Hash dauerhaft erfasst; ein fehlgeschlagener Speicher-Hook verhindert den Modellaufruf. Identitätsprüfung/validiertes Ergebnis und Belege müssen vor Brokeraktionen gespeichert sein; Speicherfehler blockieren diese Aktionen. Neue Providerbelege liegen in `decision_evidence` und `/api/decisions/:id/evidence`. Alte Datensätze werden nicht nachträglich mit erfundenen Belegen versehen. Nachträglich scheiternde Statusfinalisierung macht bereits atomar gespeicherte Fills nicht rückgängig; Fill-/Provenienzdatensätze bleiben massgeblich.

Der getrennte, weiterhin deaktivierte Live-Zyklus behält Kontexte/Übertragungen/Belege je Versuch unveränderlich unter seinem `*-decisions/`-Ordner. Die bisherigen Latest-Dateien bleiben nur bequeme Ansichten. Modellgesteuerte Live-Verkäufe sind weiterhin nicht implementiert; keine privaten Börsenfills oder echte Modellgewichte geprüft und kein Gewinnvorteil nachgewiesen.

Marktkontext Version2 verankert 24h-/48h-Kennzahlen an der letzten vollständig geschlossenen UTC-15m-Grenze. Kalenderfenster und erwartete Kerzen-/Returnzahlen stehen im Kontext. Fehlende Kerzen werden nicht durch ältere ersetzt; unvollständige Support-/Resistance-/Bar-VWAP-, Volatilitäts- und BTC-Korrelationsfenster bleiben null. Für96 Renditen wird auch der vorherige Schlusskurs benötigt. `barApproxVwapLast24h` ist ein OHLC-/Volumen-Näherungswert, kein beobachteter handelsgenauer VWAP. Vollständige konstante Kurse ergeben echte Nullvolatilität, aber keine definierte Korrelation. Diese Datenkorrektheit ist kein Gewinnnachweis.

Native Ausstiegsgrundlagen: Das gesonderte Live-Journal speichert neue Absichten und jeden zulässigen Phasenwechsel gemeinsam mit einer überprüfbaren lokalen Belegkette. Alte Einträge bleiben ausdrücklich ohne rekonstruierte ursprüngliche Belege. Orderlisten und Schutzbestätigungen werden gegen numerische IDs, gespeicherte Client-IDs, Preise und Mengen geprüft. `prepareOpocoExit` liefert ausschliesslich einen lesenden Plan mit mutationAuthorized=false; exakte Mengen-/Preisrundung und ein geschätzter verbleibender Schutz werden vorab geprüft. Der vollständige Effekt-/Wiederaufnahme-Treiber für Modellverkäufe ist noch offen; native Modell-SELLs bleiben gesperrt und zusätzliche private Mutation-Endpunkte bleiben unerreichbar. Details und offene Fälle: `docs/NATIVE-EXIT-DESIGN.md`.

Native Einstiegsbestätigungen behalten die tatsächlich gelesenen Order-/Schutzbelege im Journal. Der spätere native Modellkontext unterscheidet Auftragsabsichten und aufgezeichnete Beobachtungen von einer weiterhin nicht verifizierten Fill-/Gebührenhistorie; grosse Rohpakete bleiben im Journal, sichtbare Zusammenfassungen tragen ihre Hashes. Unmittelbar vor dem nativen Mutations-Transport wird Datenfrische nach Commit/Uhrabgleich erneut geprüft. Native Modellverkäufe bleiben weiterhin gesperrt.

Das Standard-Zeichenbudget beträgt115000 bei weiterhin explizitem lokalen131072-Fenster. Zwanzig native Intent-Zusammenfassungen mit Hashes und sämtliche20 Marktübersichten werden gemeinsam geprüft. Zusätzlich gilt die konservative UTF8-/Template-/Ausgabegrenze; bei nicht passenden Pflichtdaten entfällt der Aufruf. KI bleibt deaktiviert, es wird kein Modell aktiviert.

`node apps/server/dist/rule-funnel-report.js` analysiert ausschliesslich den bestehenden eingefrorenen Datensatz mit dem unveränderten tatsächlichen Regelprovider. Kein Refresh, keine neuen Parameter-/Strategievarianten, kein Modell-/Datenbank-/Börsenclient. `node scripts/verify-rule-funnel.mjs` prüft beobachtete Base-/Stress-Ergebnishashes gegen die frühere wiederholte Baseline und unveränderte Datensatz-/Optionsidentität. Rohbericht und unveränderliche Archive liegen unter docs; `/api/rule-funnel` und der Modellkontext enthalten validierte kompakte Zählungen samt klarer Versions-/Datensatzzuteilung. Fehlende Werte bleiben unbekannt. Sequentielle erste Ablehnungen und überlappende unabhängige Fehlbedingungen haben unterschiedliche Nenner; Featurehäufigkeiten sind keine Gewinnwahrscheinlichkeiten und frühere Forschungssuchläufe werden nicht zurückgesetzt.


## Doku & Forschung

- [Forschungsüberblick](docs/RESEARCH-SUMMARY.md): zentrale Ergebnisse, negative Befunde und nächste Issues.
- [Hypothesenregister](docs/research/hypotheses.json): IDs, ökonomische Begründungen, Kostenhürden, Abbruchkriterien und Ergebnisbelege.
- [Archivierte Forschungsberichte](docs/archive/): bisherige Markdown-Berichte im Originalwortlaut.
- [Aktuelles WORK-LOG](docs/WORK-LOG.md) und [historisches WORK-LOG](docs/archive/WORK-LOG-bis-2026-11-05.md).
- [Kompakter Arbeitsstand](docs/work-state.json) und [unverändertes Arbeitsstand-Archiv](docs/archive/work-state-2026-11-05.json).
- [AGENTS.md](AGENTS.md): verbindliche Kosten-, Sicherheits- und Forschungsregeln für KI-Sessions.

**Kostenregel:** Keine Ausgaben, keine bezahlten APIs oder Cloud-LLMs, keine Keys, keine Echtgeld-Orders; nur Paper und kostenlose lokale Forschung.

## Historische Daten

Das separate, kostenlose Binance-Spot-Archiv unterstützt eine mehrjährige, survivorship-freie Forschung. Symbole einschließlich delisteter Paare kommen aus dem öffentlichen Bucket-Listing; ZIPs werden vor dem lokalen Import mit SHA256 geprüft. Standard: 2020-01 bis letzter abgeschlossener Monat, 1h und 1d für USDT/EUR; 15m optional. Kein API-Key, Account, Cloud-Speicher oder bezahlter Anbieter.

```sh
pnpm data:import
pnpm data:universe --date 2022-06-01 --top 20
pnpm data:report
```

SQLite-Daten liegen ausschließlich unter `data/archive/binance-spot-archive.db` (gitignored, vollständig getrennt von der Paper-Datenbank). Die Daten-Splits sind in `docs/data-splits-v1.json` unveränderlich festgelegt: Development 2020–2023, Validation 2024 (protokolliert), Holdout ab 2025 (standardmäßig gesperrt und nur mit begründeter Freigabe protokolliert). Vierstündige Kerzen entstehen aus vollständigen 1h-Blöcken; fehlende Kerzen werden nicht ergänzt.

Speicherplatz- und Quellenlimits sowie das Vorgehen bei einem noch ausstehenden Vollimport stehen in [docs/DATA-ARCHIVE.md](docs/DATA-ARCHIVE.md). Die Archivarbeit setzt **keine** Profitabilität voraus.
