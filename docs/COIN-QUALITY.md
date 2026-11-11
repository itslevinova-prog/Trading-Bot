# Coin-Qualitätsfilter – Issue #20

## Umfang und Sicherheitsgrenze

**Nur Paper/Backtest.** Keine privaten Binance-Endpunkte, keine API-Keys, keine Live-Orders,
kein automatisches Umschichten und keine kostenpflichtigen Quellen. Zuständigkeit: nur
`apps/server/src/coin-quality/`, `apps/server/test/coin-quality-*.test.ts`,
`package.json`, `.env.example` und diese Datei. Die existierenden Strategie-, Broker-,
RiskEngine-, Archiv- und Regime-Module bleiben unverändert.

Die Schnittstelle ist `CoinQualityProvider.check`, `checkAll` und `quoteHealth`.
Neueinstiege sind ausschließlich bei `allowed` erlaubt (`allowsEntry`).
`unknown` ist **nie** eine Freigabe. Ohne verdrahtete Paper-Execution
werden keine bestehenden Positionen automatisch gehandelt.

## Festgeschriebene Defaults

| Regel / ENV | Standard | Konsequenz |
| --- | --- | --- |
| Base Stablecoin/Fiat/Leveraged Token | immer ausgeschlossen | `hold-only` |
| `QUALITY_MIN_AGE_DAYS` | 90 | jünger: `hold-only`; ohne Datum: `unknown` |
| `QUALITY_MIN_QUOTE_VOLUME` | 5'000'000 Quote-Einheiten/Tag | Median aus 30 aufeinanderfolgenden abgeschlossenen UTC-Tageskerzen |
| `QUALITY_MAX_SPREAD_BPS` | 25 | Median aus mindestens drei unabhängigen, höchstens 24h alten bid/ask-Proben |
| Monitoring-/Seed-Tag | – | vorsichtig `exit` binnen 24h, normal/aggressiv `hold-only` |
| Delisting angekündigt | – | `exit`: vorsichtig sofort, normal binnen 24h, aggressiv vor Delisting |
| Symbolstatus ungleich TRADING | immer | keine Orders, `hold-only` |
| `QUALITY_DEPEG_BPS` | 50 (= 0,5 %) | bot-weit keine neuen Einstiege + Alarm |
| `QUALITY_SEVERE_DEPEG_BPS` | 200 (= 2 %) | nur Hinweis zur Cash-Umschichtung im Paper-Modus |
| `QUALITY_STALE_HOURS` | 48 (hart begrenzt) | danach `unknown` |
| `QUALITY_DELIST_HAIRCUT_PCT` | 10 | ex-post Schlusskursabschlag bei terminalem Archiv-Segment |
| `QUALITY_PROFILE` | `normal` | `vorsichtig` oder `aggressiv` |
| `QUALITY_QUOTE` | `USDT` im Beispiel | EUR-Fiat ist kein Stablecoin |

Der Liquiditätswert entspricht 5 Mio. USDT nur für USDT-Quotes. Eine andere
Quote erfordert für einen exakten Vergleich einen point-in-time FX-Kurs;
bis zu #14 bleibt das ein nominaler Betrag in Quote-Einheiten.
Keine Parameteroptimierung anhand von Validierungs- oder Holdout-Daten.

## Quellen und konservatives Fehlerverhalten

- **Offiziell**: Binance Spot REST ohne Key: `exchangeInfo`, `klines`
  (erste Tageskerze und letzte 30 komplett geschlossene Tageskerzen),
  `ticker/bookTicker` und `ticker/price`. Vorhandener Market-Code
  wird nur importiert und nicht verändert. Ein einzelner Spread-Snapshot
  ist kein Median; drei Proben mit mindestens 60 Sekunden Abstand sind nötig.
- **Offiziell**: EZB-EUR/USD-Referenz aus
  https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml.
  EURUSDT ist der unabhängige USD-Anker für USDT;
  USDCUSDT und FDUSDUSDT werden damit in USD umgerechnet.
  Fehlende, unplausible oder mehr als sieben Tage alte Referenz
  führt zu `unknown`, nicht zu einer Stablecoin-Entwarnung.
- **INOFFIZIELL, nicht dokumentiert/garantiert**:
  Binance-Website-Produktliste unter
  `/bapi/asset/v2/public/asset-service/product/get-products`;
  Monitoring-/Seed-Kennzeichnungen nur bei validiertem `tags[]` und
  nachgewiesener Symbolabdeckung. Schemaänderung bedeutet `unknown`.
- **INOFFIZIELL, nicht dokumentiert/garantiert**:
  Website-CMS `/bapi/apex/v1/public/apex/cms/article/list/query`
  (Delisting-Kategorie 161). Unklare Titel ohne eindeutige
  Symbolzuordnung, leere Antwort und unvollständige Schemas
  sind **keine** Entwarnung; ein einzelnes CMS-Fenster
  rekonstruiert keine frühere Delisting-Historie.
  Ohne belegbares Datum wird kein Termin erfunden.

Inoffizielle Quellen: 5s Timeout, generischer User-Agent, keine Redirects,
keine Captcha-Umgehung; höchstens ein Versuch je Quelle/Stunde inklusive
Ausfälle. Versuche und letzte erfolgreiche Antwort sind lokal gespeichert.
Ein überprüfter Cache gilt höchstens 48h, dann `unknown`.
Fehlt die echte Quelle oder ein belastbarer Spread-Median, sind
Neueinstiege gesperrt. Das ist die bewusst konservative Vorgabe.

## Kommandos und tägliche Historie

- `pnpm quality:check BTCUSDT` liefert Status, Gründe und Quellen.
- `pnpm quality:report` prüft die konfigurierte Auswahl (fixierte Paare
  bzw. Top-N-Spotpaare plus BTC) und zeigt die Änderungen seit dem letzten
  UTC-Tag.
- `pnpm quality:report --watch` startet den separaten **Paper-Nebenprozess**:
  sofort einen Snapshot und danach alle 24 Stunden.
  Maximal eine Instanz pro `QUALITY_DATA_DIR` starten und
  im Paper-Deployment ausdrücklich als Nebenprozess aktivieren.

Lokal liegen `data/coin-quality/sources/*.json` (Abrufstatus),
`spreads/*.json` (Spread-Proben), `latest.json` (letzte Prüfung)
und `snapshots/YYYY-MM-DD.json` (tägliche Historie).
Änderungen/Depeg-Alarme werden nach `decisions.ndjson` geschrieben.
Das vorhandene Gitignore schützt diese Daten vor Git-Commits.
Das Dashboard (#15) kann später das Entscheidungsprotokoll lesen.

**Einschränkung:** Da `apps/server/src/index.ts` ausserhalb der Zuständigkeit
liegt, ist die Startverdrahtung in den bestehenden Paper-Server nicht
automatisch implementiert. Ohne ausdrücklichen Start von `--watch`
läuft keine tägliche Historisierung.

## Backtest ohne Look-Ahead

`ArchiveCoinQualityProvider` nimmt die strukturelle `CandleSource` aus #3/#5.
Er verwendet ausschliesslich Kerzen mit `ts + interval <= asOf`,
ohne nachträgliches Lückenauffüllen. Die älteste *beobachtete*
Tageskerze zählt konservativ als Untergrenze des Alters; sie ist
nicht zwingend der echte Listing-Zeitpunkt.

`QualityStore.asOf` liefert nur zum Zeitpunkt bereits aufgenommene
Snapshots (maximal 48h alt). Historische Monitoring-Tags oder
Delisting-Ankündigungen lassen sich gratis nicht rückwirkend rekonstruieren.
Heutiges `exchangeInfo` und heutige Webmeldungen dürfen niemals
ein früheres Backtest-Urteil bestimmen. Ohne zeitgenössische
Daten ist das Ergebnis `unknown`.

Ein Archiv-Ende ist **kein** vorab bekanntes Delisting-Signal.
Erst nach Abschluss des Replay-Segments darf der simulierte Broker
`settleTerminalArchivePosition` verwenden: letzte abgeschlossene
Kerze, abzüglich 10% (konfigurierbar). Die Strategie sieht das
spätere Datenende nicht. Ob ein Delisting-Verlust tatsächlich
vermieden wurde, ist ohne zeitgenössische Delisting-Ankündigung
nicht nachweisbar.

### Mit/ohne Filter: deterministische Fixture-Gegenüberstellung

| Fixture | Ohne Qualitätsfilter | Mit Qualitätsfilter |
| --- | --- | --- |
| 130 Tage, 8 Mio. Quote-Volumen, 12 bps, Quellen vollständig | Einstieg möglich | `allowed` |
| 10 Tage alt | Einstieg möglich | `hold-only` |
| Median-Volumen 1 Mio. | Einstieg möglich | `hold-only` |
| Später delisteter Coin ohne zeitgenössische Warnung | keine Vorwarnung | ebenfalls **keine Vorwarnung** |
| Letzter Schlusskurs 100, 10% Abschlag | nicht definiert | ex-post Abrechnung bei 90 |

Dies ist ein Testfall-Vergleich der **Eintrittsberechtigung**, ausdrücklich
kein ausgeführter Performance-Backtest, keine PnL-Angabe und
keine empirische Zahl vermiedener Delisting-Verluste.
#3 und #5 waren beim Start dieser Arbeit noch **offen**,
weshalb ein echter identischer Strategie-/Fill-Vergleich noch nicht
belastbar ausgeführt werden konnte.

## Anbindung nach Merge

1. **#3/#5**: Echte CandleSource anschliessen und zur Orderentscheidung
   `check(symbol, t)` nutzen; `unknown` und `hold-only` sperren Einstiege.
   `exit` nur über Paper-Broker/Risk-Schnittstelle. Terminal Settlement
   erst am Replay-Ende. Danach dieselbe Strategie/Fills mit und ohne
   Filter vergleichen, PnL und echte vermeidbare Delisting-Verluste berichten.
2. **#4/#7**: Qualitäts-Guard an den bestehenden Eintritts- und
   Risikobewertungs-Schnittstellen vor dem Orderauftrag einhängen;
   keine Strategie- oder RiskEngine-Logik duplizieren.
   Das Universum ebenfalls mit `checkAll` filtern.
3. **#10/#14/#17/#15**: Profile aus #10 konfigurieren, FX aus #14,
   Spread-Historie aus #17 und Dashboard-Anzeige aus #15 anbinden.
   Alle Änderungen nur in den jeweiligen Issues durchführen.

## Teststatus / offene Punkte

Offline-Fixtures unter `test/coin-quality-rules.test.ts` decken
Profile, Delistings, Markierungen, junge/illiquide Tokens, leere/
kaputte Quellen, Caching, Median, Depeg, Look-Ahead und
terminales Settlement ab. Die Tests benötigen keine Verbindung.

**Der Draft ist noch nicht mergefertig:** #3 und #5 sind nicht
auf `main` integriert, auf `main` existiert kein Workflow
unter `.github/workflows/` und es steht hier kein vollständiger
Checkout mit installierten pnpm-Abhängigkeiten für
`pnpm verify` zur Verfügung. Deshalb kann weder ein
grüner Verify-Lauf noch die echte Backtest-Anbindung behauptet werden.

Es wurden keine kostenpflichtigen APIs, Credits, Lizenzen oder
API-Keys benutzt. Der Produktionsmodus bleibt unverändert aus.

## Zusätzlicher Entry-Gate-Anschluss (Folgearbeit zu #20)

Der Paper-Broker prüft jetzt bei jedem **Kauf** vor und nach simuliertem
Ausführungsdelay die öffentliche CoinQualityProvider-Schnittstelle.
Bei `unknown`, `hold-only`, `exit`, unerreichbarer Quelle oder
ungültigem Zeit-/Symbolbezug ist ein Neueinstieg verboten. Schutzverkäufe
bleiben verfügbar. Die Prüfung liegt vor der PortfolioRiskEngine, damit
kein regulärer Strategiepfad sie umgehen kann. Sie ist im Paper-Bootstrap
standardmäßig aktiv und verwendet nur öffentliche Binance-Daten.
Für Kraken gibt es noch keinen äquivalent belegten Provider: Neueinstiege
werden statt einer unsicheren Gleichsetzung blockiert.

Der Backtest-Runner akzeptiert optional einen historischen
`coinQuality`-Provider und prüft jede Buy-Aktion (inklusive Buy-&-Hold-
Initialisierung) exakt beim simulierten Entscheidungszeitpunkt. Urteile aus
der Zukunft werden abgewiesen. Ohne zeitgenössische Qualitäts-Snapshots
werden Eintritte abgelehnt; ein aktuell sauberer Coin ist kein Beleg für
seinen historischen Status. Der Callback wird bewusst nicht automatisch
im historischen CLI eingeschaltet: zuerst ist ein belegbarer point-in-time
Datenstand samt Fingerprint nötig, sonst wäre ein Nettoperformance-Vergleich
unbegründet.

Diese Anschlussarbeit weitet die ursprüngliche Dateizuständigkeit aus:
Die erforderlichen Broker-/Runner-Hooks sind rein Gate-orientiert und
ändern keine Strategie-Signale und keine PortfolioRiskEngine-Formel.
**Weiter offen**: reale point-in-time Verfügbarkeit und
Backtest-Vergleich, Universumsauswahl `checkAll`, gesicherter
Exit-Ablauf für `exit`-Urteile, Dashboard und Kraken.
