# Portfolio-Risk-Engine – vorbereiteter Kern (#7)

Die neue `PortfolioRiskEngine` ist **eine reine, offline-testbare Pre-Trade-Risikoberechnung**. Sie sendet keine Orders, hat keine externen APIs und arbeitet ausschliesslich mit bereits vollständig abgeschlossenen Marktkerzen. Alle Schwellen sind konfigurierbar und werden vor Verwendung validiert.

## V1-Regeln (konservativer Ausgangspunkt)

| Zustand | Schwelle | Aktion |
| --- | --- | --- |
| Normal | Drawdown < 5 % | Neue Käufe nur innerhalb der Risikoobergrenzen |
| Vorsicht | Drawdown >= 5 % | Neue Kaufbeträge maximal halbiert |
| Exit-only | Drawdown >= 10 % | Alle Neueinstiege gesperrt, Ausstiege bleiben möglich |
| Hard-stop | Drawdown >= 15 % | Sperre eingerastet, explizite Besitzerfreigabe erforderlich |
| Feed | Feed älter als 30 s / getrennt / mehr als 3 Reconnects pro Stunde | Neueinstiege gesperrt |
| BTC-Schock | Letzte geschlossene 1h-Rendite > rollierendes P99 der vorherigen 30 Tage | Neueinstiege gesperrt |
| Historie | BTC oder Position ohne 60 lückenlose **vorherige** Tagesrenditen | Neueinstiege gesperrt |
| Portfolio-Vola | Geschätzte annualisierte Vola > 30 % | Kandidat verkleinern oder ablehnen |
| BTC-Beta | Gesamt-Beta > 0,8 | Kandidat verkleinern oder ablehnen |
| Korrelation | Hoch-Beta-Cluster (Beta >= 0,8) > 40 % Kontoexposure | Kandidat verkleinern oder ablehnen |

Zusätzlich gelten positionsweise maximal 30 % Kontoexposure, inverse Volatilitätsbegrenzung und vorhandenes Cash. Alle Entscheidungen enthalten Gründe und geschätzte Vola, Beta, Cluster-Exposure, damit sie später protokolliert werden können. Die Schätzung ist **kein garantierter Verlustschutz**.

## Absichtlich noch nicht als fertig markiert

Die reine Engine ist noch **nicht an den bestehenden Paper-/Backtest-/Testnet-Broker** verdrahtet: eine gemeinsame Quelle für 60 Tage geschlossene 1d- und 30 Tage 1h-Kerzen (einschliesslich lückenlosem Feed-Monitoring und manueller Reset-Auditierung) muss zuerst integriert werden. Ohne diese Schnittstelle wird kein Risikoschutz vorgetäuscht. Insbesondere ist eine längere Backtest-Paarprüfung über 2021/2022 mit echten Archivdaten noch nicht durchgelaufen. Auch die Risiko-Dashboard-Seite fehlt.

**Es gibt keine Verifikation auf echter Markthistorie und keinen Profitabilitätsnachweis.** Teste nach Integration dieselbe Engine bei Paper und Backtest, ohne Schwellen an Validierung oder Holdout anzupassen.

## Integrationen im aktuellen PR

Die identische, reine `PortfolioRiskEngine` wird über den
`PaperPortfolioRiskGateway` vor jedem simulierten Paper-Kauf
der **aktiven** Konten `rules` und `ai` aufgerufen, ein zweites Mal nach
Ausführungslatenz. Der Gateway prüft mindestens 61 vollständig vergangene
Tagesabschlüsse sowie 721 vergangene BTC-Stundenabschlüsse aus der
lokalen Paper-Datenbank, niemals die laufende Kerze. Fehlen Bars,
ist der Feed alt oder ein Limit überschritten, wird der Einstieg
verkleinert oder abgelehnt. Jede Entscheidung und Begründung steht in
`portfolio_risk_audit`. `hold` und `dca` bleiben separat gekennzeichnete
Benchmarks, keine automatisch risikoverwalteten aktiven Strategien.
Die zentrale Engine ist nur eine Pre-Trade-Sperre; sie garantiert keine
Stop-Ausführung bei Kurslücken.

**Persistenter Drawdown-Hardstop:** Er wird in der lokalen Datenbank
über Neustarts hinweg gespeichert. Ein bewusstes Zurücksetzen ist nur
lokal möglich:

```sh
LIVE_ENABLED=false pnpm risk:reset --account rules --ack I_ACKNOWLEDGE_MANUAL_RISK_RESET
```

Anschliessend den Paper-Server neu starten; bevor neue simulierte
Einstiege möglich sind, müssen **alle** Risikoprüfungen erneut bestehen.
Es gibt **keine HTTP-Reset-API** und keine Echtgeld-Freischaltung.
Zustand, letzte geschätzte Portfolio-Volatilität, Beta, Cluster,
Ablehnungsgrund und Hardstop erscheinen unter
`GET /api/portfolio-risk` sowie auf der Seite Risikoanalyse.
Fehlende Werte bleiben als fehlend sichtbar.

### Historischer Vergleich ohne Look-Ahead

```sh
LIVE_ENABLED=false pnpm risk:compare
```

Verglichen wird derselbe Rule-Provider auf demselben historischen
Entwicklungs-Archiv 2021–2022, jeweils ohne und mit RiskEngine.
Die drei vorab festgelegten Regime sind Mai 2021, Juni 2022 und
November 2022. Beide Arme nutzen identische Candle-Fingerprints,
eine gemeinsame 62-Tage-Aufwärmphase und reale Kostenannahmen.
Nur bei vollständiger lokaler 1h-/15m-Historie wird ein
reproduzierbares JSON unter
`data/backtests/portfolio-risk-regimes-2021-2022.json`
**create-only** geschrieben. Fehlen Daten, bricht der Vergleich
ab und enthält keine erfundenen Renditen. Auch ein negativer
Vergleich ist ein gültiges Ergebnis.

### Verbindliche Restarbeiten

Der eigenständige deaktivierte Live-/Testnet-Prozess ist hier **noch
nicht** mit der Engine verbunden; er darf deshalb nicht als
risikogeschützt oder bereit gelten. Eine Zeitreihe mit
ununterbrochenen Paper-Feeds bzw. Reconnect-Stürmen und ein
tatsächlicher lokaler Regimevergleich sind weiter zu belegen.
Das neue Dashboard zeigt die zuletzt protokollierte Messung,
nicht eine fortlaufend berechnete Portfolio-Risikozeitreihe.
**Issue #7 bleibt bis zum Testnet-Anschluss und Daten-Nachweis offen.**
