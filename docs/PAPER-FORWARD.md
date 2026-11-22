# Forschungs-Forward-Test, nicht freigegeben, keine Gewinnprognose

Issue #32, Hypothese H-025. Dieser getrennte Dateiledger verwendet ausschließlich Spielgeld und öffentliche Binance-Daten ohne Schlüssel. Er greift weder auf Paper-Konten noch die Server-Datenbank zu und erteilt keine Pipeline-Freigabe. `FORWARD_ENABLED` bleibt ungesetzt; in dieser Implementierungssession wird kein Forward-Test aktiviert.

## Einfrieren und Datengrenzen

H-025-Annahmen werden unverändert importiert: 10 000 USDT Startkapital, 0,1 % Gebühr, 10 bps Spread, 5 bps Slippage, 240 geschlossene Tageskerzen, mindestens 5 Mio. USDT Median-Quote-Volumen über 30 Tage. Strategieparameter: 20 % Zielvolatilität, Top 3, 20 % Rebalancing-Toleranz, ATR-Multiplikator 3. Die ursprüngliche v1 verwendet ganze Coin-Einheiten und mindestens 10 USDT; BTC und DCA verwenden dort acht Nachkommastellen. Die aktuelle CLI verwendet die unten separat registrierte Variante v2 mit echten Exchange-Mengenregeln für alle drei Konten.

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

Der API-Probelauf benötigt freigegebenen Zugriff auf `data-api.binance.vision`. Die offizielle [GitHub-Dokumentation](https://github.com/github/docs/blob/main/data/reusables/actions/scheduled-workflows-disabled.md) nennt 60 Tage ohne Repository-Aktivität, ohne Branch-Einschränkung. Sie garantiert die konkrete Aktivitätszählung für `paper-forward` nicht ausdrücklich. Deshalb keine Behauptung dauerhafter Cron-Aktivität: Der Repo-Besitzer prüft monatlich den Workflow-Status und reaktiviert ihn nötigenfalls. Ein automatischer Push auf `main` ist nicht eingerichtet; die Anforderung einer monatlichen Statusaktualisierung bleibt bis zur eindeutigen Klärung offen.

## Umsetzungsstand vor Aktivierung

Die Definition of Done von #32 ist noch nicht vollständig erfüllt. Zusätzlich zum echten API-Probelauf fehlen ein belastbarer Nachweis der Ausführungsparität mit dem Forschungs-Backtest einschließlich Portfolio-RiskEngine sowie historische Point-in-Time-Metadaten für nachgeholte Tage. Der Adapter bildet derzeit den reinen Strategieplaner und synthetische Fills ab. Er darf nicht als validierter Ersatz des vollständigen Backtest-Brokers ausgegeben werden. Bis diese Punkte geklärt und geprüft sind, `FORWARD_ENABLED` ungesetzt lassen.

## Variante v2: echte Binance-Mengenregeln (PR #33)

Die CLI verwendet jetzt `trend-vol-target-v1-binance-lots-v2`, registriert bei H-025; `variantsTested` wurde von 1 auf 2 erhöht. Dies ist keine nachgewiesene Leistungsverbesserung, sondern eine separat gezählte Ausführungsvariante. Die ursprünglichen Forschungsannahmen, `engine.ts` und die Ganzcoin-Version bleiben unverändert. Die neue Implementierung liegt in `engine-v2.ts`.

`LOT_SIZE.stepSize` und `LOT_SIZE.minQty` sowie `MIN_NOTIONAL.minNotional` beziehungsweise `NOTIONAL.minNotional` stammen aus dem öffentlichen `exchangeInfo`. Bei beiden Notional-Filtern gilt die strengere Grenze. Mengen werden mit exakter Dezimalarithmetik auf ein Vielfaches von `stepSize` abgerundet; erst danach werden tatsächliches Mindestnotional, Mindestmenge und Gebühren angewendet. Die Regeln gelten für Strategie, BTC-Referenz und DCA. Fehlende oder ungültige Regeln sperren den Lauf. Der unveränderte Strategieplaner unterstützt höchstens acht Nachkommastellen; feinere Regeln werden ausdrücklich abgelehnt.

Die sortierte Regeltabelle wird im Zustand eingefroren und ist Teil des Konfigurationshashes. Geänderte Filter oder ein geänderter Marktbestand erzeugen eine getrennte Serienkennung und verlangen für einen neuen realen Lauf ein neues prospektives Startdatum; alte Serien werden nicht umgeschrieben. Der aktuelle Snapshot ist kein Beleg für historische Mengenregeln. Bestehende Einschränkungen zur Point-in-Time-Abdeckung und RiskEngine-Parität bleiben offen.

Alle öffentlichen REST-Abfragen laufen ausschließlich über `https://data-api.binance.vision/api/v3/`. HTTP 451 führt sofort zu einer verständlichen Standort-/Rechtssperren-Meldung ohne Retry oder Fallback auf einen Handelsendpunkt. Netzwerk- oder API-Verfügbarkeit wird durch Fixture-Tests nicht belegt.

### Manueller Dry-Run

`workflow_dispatch` hat die boolesche Eingabe `dry_run`, standardmäßig `true`. Damit läuft die Prüfung auch ohne `FORWARD_ENABLED`. Sie verwendet das aktuelle UTC-Datum als prospektives S, lädt öffentliche Daten als Vorlauf und schreibt keine Ergebnisdateien, Commits oder Pushes. Am Starttag gibt es noch keinen abgeschlossenen Forward-Ergebnistag; der Dry-Run kann daher null verarbeitete Tage melden. Für Signal-/Fill-Prüfungen dienen synthetische Fixtures.

Ein echter Tageslauf (`dry_run=false` oder Cron) bleibt strikt an `FORWARD_ENABLED=true` und `FORWARD_START` gebunden. Die Speicherung ist im Dry-Run vollständig übersprungen. Nur der Speicherschritt bindet das vorhandene `PRIVACY_BLOCKLIST`-Secret für den Datenschutz-Wächter ein; sein Inhalt wird nicht ausgegeben.

Fixtures für die CLI brauchen jetzt zusätzlich `lotRules`, zum Beispiel `{"BTCUSDT":{"stepSize":"0.00001000","minQty":"0.00001000","minNotional":"5.00000000"},"ETHUSDT":{"stepSize":"0.00010000","minQty":"0.00010000","minNotional":"5.00000000"}}`. Das sind ausschließlich synthetische Testregeln, keine verbindlichen aktuellen Börsenwerte.

Entscheidung: Die Ganzcoin-Referenz wird aus Gründen der Nachvollziehbarkeit nicht nachträglich korrigiert. v2 bekommt eigene Hashes und Serien; weder die Pipeline-Freigabe noch die Aktivierung des Forward-Tests ist Bestandteil dieses PR-Nachtrags.

## Aktivierung (13.11.2026)

Der Repo-Besitzer hat den Forward-Test aktiviert. Statt Repository-Variablen stehen die Standardwerte im Workflow: Start `2026-11-22`, aktiv, solange `FORWARD_ENABLED` nicht auf `false` gesetzt ist. Zum Stoppen die Repository-Variable `FORWARD_ENABLED=false` anlegen. Eine gesetzte Variable `FORWARD_START` überschreibt den Standard und beginnt eine neue Serie.

## Fehlerbehebung (16.11.2026)

Die Serie mit Start 14.11.2026 kam nie zustande: Im ersten Lauf gab es noch keinen abgeschlossenen Tag, daher wurde kein Startzustand geschrieben und der Speicher-Schritt brach beim Kopieren ab. Folgeläufe sahen keine Serie und lehnten das inzwischen vergangene Startdatum ab. Jetzt wird der Startzustand einer neuen Serie immer gespeichert, der Speicher-Schritt beendet sich ohne Ausgabe sauber, und der Standardstart ist der 17.11.2026.

## Drei Risikoprofile und Begründung (ab Serie 22.11.2026)

Neben der Basis-Strategie laufen die drei vorregistrierten, gedeckelten Papier-Risikoprofile `vorsichtig`, `normal` und `aggressiv` (`resolvePaperRiskProfile`) als eigene Konten mit je 10 000 USDT. Signale, BTC-200d-Regime, ATR-Ausstieg, Kosten und Lot-Regeln sind identisch. Es unterscheiden sich nur das Volatilitätsziel, die maximale Positionsanzahl, die maximale Positionsgrösse (höchstens 30 %) und die Investitionsgrenze. Das ist ein beschreibender Vergleich, keine Freigabe und kein Ersatz für Stage-Gates.

Jede Tagesdatei `days/JJJJ-MM-TT.md` enthält: Entscheidung, BTC-Schluss gegenüber der 200-Tage-EMA mit Abstand in Prozent (und wie viel bis zum Kaufsignal fehlt), die Rangliste der Kandidaten, die Entscheidung je Konto, eine Tabelle der Kontostände und die simulierten Trades. Das `README.md` der Serie zeigt den Gesamtstand aller sechs Konten, die letzte Begründung und die letzten sieben Tage samt Wochenveränderung.

Hinweis: Weil sich Code und Konfiguration ändern, beginnt eine neue Serie. Die Serie vom 17.11.2026 (ein ausgewerteter Tag) bleibt unverändert im Branch `paper-forward` erhalten.

## Serienidentität und Lot-Regeln

Eine bestehende Serie verwendet immer den beim Start eingefrorenen Lot-Snapshot aus ihrer `state.json`. Neue oder entfernte Binance-Listings ändern die Serie nicht mehr. Vorher führte jede Listing-Änderung zu einer neuen Serienkennung; der Lauf am 20.11.2026 brach deshalb ab („New real-data series must start prospectively“). Die Serie vom 19.11.2026 (ohne ausgewerteten Tag) bleibt im Branch `paper-forward` erhalten. Danach startete die Serie am 20.11.2026.

## Stablecoin-Filter (ab Serie 22.11.2026)

Neue Stablecoins wie RLUSD, XUSD oder U fehlten in der gemeinsamen Ausschlussliste und standen wegen ihrer sehr geringen Volatilität oben in der Rangliste. Der Forward-Test schliesst deshalb zusätzlich jeden Coin aus, dessen Schlusskurs an den letzten 30 Tagen immer zwischen 0.90 und 1.10 USDT lag und dessen annualisierte Volatilität unter 5 % liegt. Die gemeinsame Liste `excludedBase` bleibt unverändert, damit historische Forschungsergebnisse reproduzierbar bleiben. Ausgeschlossene Coins werden in der Tagesbegründung genannt. Liegt BTC unter der 200-Tage-EMA, nennt die Begründung jetzt ausdrücklich das Cash-Regime als Grund für „kein Trade“. Die Serie vom 20.11.2026 (zwei Tage, nur Benchmark-Käufe) bleibt erhalten.
