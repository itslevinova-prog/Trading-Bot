# Forschungs-Forward-Test, nicht freigegeben, keine Gewinnprognose

Issue #32, Hypothese H-025. Dieser getrennte Dateiledger verwendet ausschließlich Spielgeld und öffentliche Binance-Daten ohne Schlüssel. Er greift weder auf Paper-Konten noch die Server-Datenbank zu und erteilt keine Pipeline-Freigabe. `FORWARD_ENABLED` bleibt ungesetzt; in dieser Implementierungssession wird kein Forward-Test aktiviert.

## Einfrieren und Datengrenzen

H-025-Annahmen werden unverändert importiert: 10 000 USDT Startkapital, 0,1 % Gebühr, 10 bps Spread, 5 bps Slippage, 240 geschlossene Tageskerzen, mindestens 5 Mio. USDT Median-Quote-Volumen über 30 Tage. Strategieparameter: 20 % Zielvolatilität, Top 3, 20 % Rebalancing-Toleranz, ATR-Multiplikator 3. Die konservative Forschungs-Lot-Annahme bleibt ganze Coin-Einheiten, Mindestnotional 10 USDT. BTC und DCA verwenden wie die vorhandenen Referenzen acht Nachkommastellen.

Config und relevante Quelldateien einschließlich Forward-Adapter werden mit dem vorhandenen Provenance-Digest gehasht. Der Serienordner enthält Startdatum und beide Hashes. Änderungen erzeugen getrennte Ordner; frühere Serien bleiben erhalten. Kein Überschreiben fremder Serien. Strategieentscheidungen verwenden nur Daten vor dem Ausführungstag; Fills erfolgen am nächsten Open mit halbem Spread plus Slippage und Gebühren. Ergebnisse entstehen ausschließlich ab S. Der aktuelle UTC-Tag ist ausgeschlossen.

Das Addendum `data-splits-forward-addendum.json` grenzt den offenen v1-Holdout gegen S ab. Vor Aktivierung muss der Repo-Besitzer den abgeschlossenen vollständigen USDT-Forschungslauf in #3 dokumentieren und S festlegen. Die bisherigen versiegelten Entwicklungs-Simulatoren und Pipeline-Gates bleiben unverändert.

## Starten und stoppen

Nach Review und Merge setzt ausschließlich der Repo-Besitzer `FORWARD_START=YYYY-MM-DD` und anschließend `FORWARD_ENABLED=true` als Repository-Variablen. S darf nicht rückdatiert werden. Der Workflow läuft täglich um 00:17 UTC und kann manuell ausgelöst werden. Zum Stoppen `FORWARD_ENABLED` entfernen. Bei neuer Strategie/Annahmen ein neues prospektives S festlegen. Ein verpasster Lauf wird nachgeholt; bereits verarbeitete Tage bleiben unverändert.

Lokaler Probelauf ohne Schreiben:

```bash
LIVE_ENABLED=false AI_ALLOW_REMOTE=false pnpm forward:run --dry-run --start YYYY-MM-DD
LIVE_ENABLED=false AI_ALLOW_REMOTE=false pnpm forward:run --dry-run --start YYYY-MM-DD --fixture /tmp/forward-fixture.json
```

Fixture-Format: `{"until": <UTC-Millisekunden exklusiv>, "rows": {"BTCUSDT": [<Candle>], "ETHUSDT": [<Candle>]}}`. Kerzen enthalten `ts`, OHLC, `volume`, `quoteVolume`; 260 Tage Vorlauf vorsehen. Fixtures dürfen keine als real ausgegebenen Daten erzeugen.

## Speicherung und Fehler

Nur Branch `paper-forward`, niemals Force-Push. Pro Serie: Zustand, Fill-Ledger, Tageswerte und deutsche Tagesberichte. Fehlende notwendige Tagesdaten sperren alle Konten für den Tag; Bewertung bleibt unbekannt statt erfunden. Netzwerk- und Validierungsfehler führen zum roten Workflow ohne Commit. Der nächste Lauf liest weiterhin den letzten erfolgreich gepushten Zustand. Konkurrenz wird ohne Abbruch serialisiert.

Die BTC-Referenz investiert einmalig; der klassische Sparplan verwendet die vorhandenen Budgethelfer mit monatlich 10 000 USDT und 70/30 BTC/ETH. Zusätzliche Einzahlungen sind kein Strategievorteil: Endvermögen ist nicht direkt vergleichbar. Keine Rückschlüsse auf Profitabilität oder Freigabe.

## Noch offene Validierung

Der API-Probelauf benötigt freigegebenen Zugriff auf `api.binance.com`. Die offizielle [GitHub-Dokumentation](https://github.com/github/docs/blob/main/data/reusables/actions/scheduled-workflows-disabled.md) nennt 60 Tage ohne Repository-Aktivität, ohne Branch-Einschränkung. Sie garantiert die konkrete Aktivitätszählung für `paper-forward` nicht ausdrücklich. Deshalb keine Behauptung dauerhafter Cron-Aktivität: Der Repo-Besitzer prüft monatlich den Workflow-Status und reaktiviert ihn nötigenfalls. Ein automatischer Push auf `main` ist nicht eingerichtet; die Anforderung einer monatlichen Statusaktualisierung bleibt bis zur eindeutigen Klärung offen.

## Umsetzungsstand vor Aktivierung

Die Definition of Done von #32 ist noch nicht vollständig erfüllt. Zusätzlich zum echten API-Probelauf fehlen ein belastbarer Nachweis der Ausführungsparität mit dem Forschungs-Backtest einschließlich Portfolio-RiskEngine sowie historische Point-in-Time-Metadaten für nachgeholte Tage. Der Adapter bildet derzeit den reinen Strategieplaner und synthetische Fills ab. Er darf nicht als validierter Ersatz des vollständigen Backtest-Brokers ausgegeben werden. Bis diese Punkte geklärt und geprüft sind, `FORWARD_ENABLED` ungesetzt lassen.
