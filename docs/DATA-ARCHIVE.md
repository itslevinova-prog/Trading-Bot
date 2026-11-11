# Binance Spot – Datenarchiv

Stand: 2026-11-05. **Noch kein Vollimport in dieser Ausführungsumgebung nachgewiesen.** Dieser Text wird durch `pnpm data:report` aus der lokalen, separat gespeicherten Archivdatenbank aktualisiert.

## Quelle, Kosten und Geltungsbereich

- Nur öffentliches, kostenloses **Binance Public Data** (Spot-Klines), ohne Account, API-Key, Abonnement, Credits oder Cloud-Speicher.
- Monatliche ZIPs mit SHA256-`.CHECKSUM`, Symbol-Discovery aus dem öffentlich lesbaren S3-Bucket-Listing (einschließlich delisteter Märkte). Binance Spot verwendet ab 2025-01 Mikrosekunden.
- Standard: 2020-01 bis letzter abgeschlossener UTC-Monat, Quote USDT/EUR, 1h und 1d. 15m optional. Aktueller Monat nur ausdrücklich mit `--include-current`, dann aus abgeschlossenen Tagesarchiven.
- Rohdateien: `data/archive/raw/<interval>/<symbol>/<filename>.zip` (bytegetreu, nicht ins Git). Archiv-DB: `data/archive/binance-spot-archive.db`; **keine** Verbindung zur Paper-Datenbank.
- Aufbewahrung: Alle Roh-ZIPs und importierten SQLite-Daten lokal; keine automatischen Löschungen. Archive, deren Hash sich nach Import ändert, werden aus Sicherheitsgründen nicht still überschrieben.

## Bedienung

~~~sh
pnpm data:import
pnpm data:import --from 2022-01 --to 2022-12 --symbols BTCUSDT,ETHUSDT --intervals 1h,1d
pnpm data:import --intervals 15m
pnpm data:universe --date 2022-06-01 --top 20
pnpm data:report
~~~

`data:import` listet kostenlos verfügbare ZIPs, schätzt vor dem Start den Speicherbedarf und stoppt, wenn die Schätzung weniger als 20 % freien Platz übrig lässt. Maximal vier gleichzeitige Downloads. Verifizierte Rohdateien und bereits importierte Hashes werden übersprungen; fehlerhafte Downloads werden mit exponentiellen Pausen höchstens dreimal versucht. Wiederholen setzt den Import fort.

Die Daten-Splits sind in `docs/data-splits-v1.json` **unveränderlich** fixiert: Development 2020–2023, Validation 2024, Holdout ab 2025. `ArchiveCandleSource` verwendet den exakten vierparametrigen `CandleSource`-Vertrag. Validation-Zugriffe protokolliert sie lokal in `data/archive/holdout-access.log`. Holdout-Zugriffe werden ohne `new ArchiveCandleSource({allowHoldout:{reason:'...'}})` verweigert; erlaubte und verweigerte Versuche werden protokolliert. Alle Kerzen sind abgeschlossene UTC-Kerzen, aufsteigend und ohne Lückenfüllung. 4h-Kerzen entstehen nur aus vollständigen 1h-Gruppen.

`data:universe` verwendet ausschließlich die vorangegangenen 30 abgeschlossenen 1d-Kerzen pro Paar, mit Punkt-in-Zeit-Volumenranking. Stablecoin-Basen und Leveraged Tokens werden ausgeschlossen. Das Symbollisting schließt ehemalige/delistete Paare nicht aus.

## Qualitätsgrenzen / ausstehender Nachweis

Dieser Issue-Branch enthält **keinen mehrjährigen importierten Datenbestand**. In einer Umgebung ohne Netzverbindung und ausreichend lokalen Speicher konnten die geforderten ≥ 5 Jahre für ≥ 50 Paare nicht vollständig heruntergeladen werden. Dies ist keine Evidenz für Datenvollständigkeit.

Nach einem echten Import erzeugt `pnpm data:report` diesen Bericht erneut und schreibt `data/archive/report.json` mit Symbolanzahl, Zeitraum, Gaps je Symbol/Monat, Duplikaten, >50%-Ranges, Speicherbedarf und einem Vergleich aggregierter BTCUSDT-1d-Kerzen aus 1h mit den 1d-Archivdaten. Berichtet werden ausschließlich **beobachtbare** Lücken innerhalb vorhandener Kerzenreihen; fehlende Zeiträume außerhalb der ersten/letzten Kerze bleiben unbekannt. `regimes(date, btc_above_200d, btc_vol_30d_percentile)` liegt in derselben separaten Archiv-DB; frühe Warmup-Tage haben Nullwerte.

Für eigenständige Nachprüfungen ist der Import offline nicht erforderlich: Fixture-ZIPs und Checksums liegen unter `apps/server/test/fixtures/archive/`; alle `archive-*.test.ts` laufen ohne Netzwerk.

**Datenquelle:** https://github.com/binance/binance-public-data (öffentliche Spot-Kline-Archive und Formatbeschreibung).

## Unabhängiger Quellenvergleich (#53)

Die Parität von 1h- und 1d-Kerzen aus demselben Archiv erkennt keine gemeinsamen Import- oder Parserfehler. Ein **separater, ausschliesslich lesender** Prüfbefehl vergleicht deshalb einzelne historische Entwicklungstage mit den kostenlosen öffentlichen Binance-Spot-REST-Kerzen (`GET https://api.binance.com/api/v3/klines`), ohne API-Key, Account, externe Dienstkosten oder automatische Reparatur.

~~~sh
pnpm data:verify-source --seed archive-check-v1 --samples 12
~~~

Die Stichprobe wird mit einem reproduzierbaren SHA-256-Ranking aus lokal vorhandenen Symbolen, Intervallen (15m/1h/1d) und **UTC-Tagen 2020–2023** ausgewählt. 2024 (separate Validierung) und ab 2025 (Holdout) sind für diese Prüfung ausgeschlossen. Der Befehl läuft nur nach manuellem Aufruf, niemals in GitHub-CI; CI verwendet ausschliesslich künstliche Offline-Fixtures und einen injizierten REST-Stub.

Für jeden Stichprobentag werden Anzahl und Reihenfolge der Kerzen, UTC-Zeitstempel und Skalierung, OHLC, Basis-/Quote-Volumen und Trade-Anzahl geprüft. Preis- und Volumentoleranzen betragen maximal `max(1e-8, max(|archiv|, |quelle|) × 1e-10)`; Zeitstempel und Trade-Anzahlen müssen exakt übereinstimmen. Ausgewiesen werden SHA-256 der archivierten Werte und der unveränderten REST-Antwort, Anfrage- und Empfangszeit sowie die ersten und letzten von der Quelle gemeldeten Zeitstempel.

**`match`**: alle benötigten Kerzen sind vollständig und konsistent. **`conflict`**: belegte Abweichung oder ungültige Skalierung/Sortierung. **`unknown`**: REST-Ausfall, Rate-Limit, unvollständige aber nicht widersprüchliche Zeitreihe oder zu wenige Vergleichstage. Kein fehlender Beleg gilt als bestanden. Ergebnisse werden als separate, nach Fingerprint benannte lokale JSON-Berichte unter `data/archive/source-verification/` abgelegt; bestehende Berichte werden nie überschrieben. Archivdaten und Roh-ZIPs bleiben unverändert. Der tatsächliche mehrjährige Quellenvergleich steht noch aus, solange das lokale Archiv nicht befüllt und der Befehl nicht ausdrücklich ausgeführt ist.


## Historische Funding-Raten als ausschliesslich lesende Spot-Forschungsdaten (#82)

`apps/server/src/archive/funding-source.ts` ergänzt einen separaten, optionalen Datenadapter für die **kostenlose öffentliche** Binance-USDⓈ-M-Funding-Historie: `GET https://fapi.binance.com/fapi/v1/fundingRate`. Die Daten dienen nur der Untersuchung von Spot-Marktbedingungen – **keine Futures-/Hebelpositionen, keine Order- oder Kontoschnittstellen**. Der Adapter wird nicht von selbst ausgeführt; `fetchFundingDevelopment(symbol, fromMs, toMs, options)` muss explizit aufgerufen werden. Es wurde kein historischer Komplettimport durchgeführt.

- **Nur Entwicklungszeitraum 2020–2023:** ganze UTC-Tage, höchstens 366 Tage pro Aufruf, maximal 24 öffentliche Requests pro Aufruf (Standard), Tagesfenster ohne Überschneidung und höchstens 500 Zeilen pro Antwort. Ein voller, leerer, fehlerhafter oder widersprüchlicher Response wird nicht als komplette Historie interpretiert.
- **Fortsetzbarer, unveränderlicher Cache:** `data/archive/funding/<SYMBOL>/YYYY-MM-DD.json`, mit SHA256 des tatsächlichen Seitennachweises, Symbol, Endpoint, UTC-Zeitfenster, Ereigniszeit und erstmaligem lokalem Empfang. Bestehende Dateien werden verifiziert und niemals still ersetzt. Fehlende Tage bleiben `unknown`. Der gesamte Coverage-Status besitzt einen reproduzierbaren Fingerprint.
- **429/418, Ausfall, fehlende Beobachtungen:** sofort abbrechen, keine aggressiven Wiederholungen oder synthetischen Daten; noch fehlende Tage werden gesondert ausgewiesen. Die Methode ist bei einem späteren, ausdrücklich gestarteten Aufruf wieder aufnehmbar.
- **Kausale Verfügbarkeit:** Binance liefert `fundingTime`, aber **keinen belegten historischen Erst-Publikationszeitpunkt**. `publicationAtMs` bleibt deshalb `null`; `firstReceivedAtMs` ist die tatsächlich bei der lokalen Anfrage beobachtete Zeit. `fundingKnownAt` lässt einen Wert nur zu, wenn **sowohl** dessen Ereigniszeit **als auch** der belegte Empfang vor dem Entscheidungscutoff liegen. Ein 2026 abgerufenes 2022-Funding darf folglich **nicht** nachträglich als 2022 verfügbar ausgegeben werden. Ohne unabhängigen Publikationsnachweis ist die damalige Live-Verfügbarkeit unbekannt.
- **Tests:** `apps/server/test/archive-funding-source.test.ts` nutzt nur injizierte Offline-Antworten (Veröffentlichungs-/Empfangsverzug, Duplikate, Lücken, 429/418, Integrität und Holdout-Sperre); CI startet keine Webabfragen und schreibt nicht in `data/`.

Die Aufzeichnung dieser API-Werte belegt weder ausführbare Trades noch einen profitablen Funding-Filter. Neue Forschung benötigt eine vorgängige Hypothesenfreigabe nach `docs/ROADMAP.md`; die Stage-/Holdout-Grenzen bleiben unverändert.


## Synchronisierte Spot-/Perpetual-Basis (nur Daten, #83)

`apps/server/src/archive/basis-source.ts` ergänzt eine **rein lesende**, nicht automatisch gestartete Quelle für öffentliche Binance-USDⓈ-M-**Markpreis-Tageskerzen** über `GET https://fapi.binance.com/fapi/v1/markPriceKlines`. Die parallelen Spot-Schlusskurse werden ausschliesslich über die vorhandene `ArchiveCandleSource`-Schnittstelle mit `interval=1440` referenziert. Keine Futures-Konten, Positionen, Hebel, Margin oder Orders.

- **Grenzen:** 2020–2023 in vollständigen UTC-Tagen; maximal 366 Tage und 24 Requests pro manuellem Aufruf. Nur USDT-Symbole mit eindeutigem Spot-/Mark-Paar; pro Tag genau **eine** vollständig abgeschlossene, unverändert belegte `1d`-Markpreis-Kerze.
- **Unveränderlicher Cache:** `data/archive/perp-mark/<SYMBOL>/YYYY-MM-DD.json` mit SHA256 und getrenntem Exchange-Schluss- und tatsächlichem erstmaligem Empfangszeitpunkt. Fortsetzen liest und verifiziert vorhandene Dateien; manipulierte, fehlende oder unvollständige Tage bleiben `unknown`, niemals 0. 429/418 und unerwartete Antworten führen ohne Retry zum Abbruch.
- **Berechnung:** `Basis = (Markpreis Schluss − Spot Schluss) / Spot Schluss`, `Basis-bps = Basis × 10 000`. Spot und Perpetual müssen denselben abgeschlossenen UTC-Tag und die tatsächlichen Beleg-Zeitpunkte teilen. Erst nach **beiden nachgewiesenen Empfangszeitpunkten** darf `spotPerpetualBasisAt` einen Wert ausgeben. Die öffentliche Futures-Historie besitzt keinen belegten ursprünglichen Publikationszeitpunkt; historisch nachgeladene Kerzen dürfen daher nicht als vor Jahren live bekannt rückdatiert werden.
- **As-of-Prüfung:** `readSpotArchiveClose` liest die vorhandene Spot-Archivquelle, registriert aber ausschliesslich die tatsächliche Leserezeption, nicht eine erfundene historische Empfangszeit. Fehlende Spot-Paare, Mark-Kerzen oder zeitgleiche Empfangsbelege liefern `unknown` samt Fingerprint. Der Status bescheinigt keine handelbare Arbitrage oder Funding-Cashflows.
- **Offline-Gates:** `apps/server/test/archive-basis-source.test.ts` prüft zeitversetzte Mark-Beobachtungen, Handrechnung, Symbol-/UTC-Ausrichtung, fehlende Spot-Tage, Rate-Limits, Resume/Hash und Entwicklungs-/Holdout-Grenzen, ohne Netzwerk oder `data/`-Schreibzugriff.

Kein historischer Import wurde in dieser Sitzung ausgeführt. Diese Daten-Funktion erteilt weder eine Hypothesen-Freigabe noch rechtfertigt sie eine Handelsentscheidung; für Research gelten weiter #32 und die unveränderten Stage-Gates.
