# Warum der unveränderte Regelvergleich keine Trades ausführt

Stand 2026-10-29T18:50:10.834Z. Unveränderter eingefrorener Datensatz `d0066ea5e97b107a22c148dbfcfcd245a2ea37e555684a5af36a382134b14926`, Binance/EUR. Geprüftes Ausführungsfenster 01.10.2026 19:30 bis28.10.2026 19:45 UTC. Die Historie war bereits angesehen; diese Diagnose ist keine unabhängige neue Prüfung und kein Gewinnnachweis.

| Stufe | Eingänge | Bestanden | Erste Ablehnung an dieser Stufe |
| --- | ---: | ---: | ---: |
| Geschlossene Featurebeobachtungen | 51860 | 51860 | 0 fehlende Featureplätze |
| EMA20 kreuzt EMA50 aufwärts | 51860 | 498 | 51362 |
| Preis über stündlicher EMA50 | 498 | 259 | 239 |
| RSI45 bis70 | 259 | 160 | 99 |
| Volumenverhältnis mindestens1,2 | 160 | 46 | 114 |
| Spread höchstens0,3% | 46 | 46 | 0 |
| Zusätzlicher Qualitäts-Trendfilter | 46 | 42 | 4 |
| Technische Stärke | 42 | 42 | 0 |
| Engerer Momentumfilter | 42 | 33 | 9 |
| Volumenqualität | 33 | 33 | 0 |
| ATR auf15m zwischen0,8% und5% | 33 | 0 | 33 |

Es gab 2593 tatsächliche Providerentscheidungen über20 Märkte. Alle erwarteten Featureplätze waren verfügbar. Von46 Grundsignalen bestanden nach den zusätzlichen Trend-/Momentumprüfungen33 Kandidaten; alle33 scheiterten am vorhandenen Volatilitätsfilter. Es wurde keine Kaufaktion erzeugt, deshalb wurden keine Käufe erst nachträglich durch Cash-, Lot-, Mindestorder- oder Risikogates verhindert.

Unabhängig von der Reihenfolge verletzten44 der46 Grundsignale die ATR-Bedingung. Die zwei mit zulässiger ATR scheiterten an anderen Qualitätsbedingungen. Überlappende Fehlbedingungen darf man nicht als unterschiedliche blockierte Kandidaten addieren. Median der ATR bei Grundsignalen: 0.261955%, p90 0.400362%, Maximum 0.846679%. Dies sind15m-ATR-Werte, keine Tagesvolatilitäten. Die Kosten-/Liquiditätsbedingung wurde unabhängig bei allen46 geprüft und bestand; im geordneten Funnel erreichte nach ATR jedoch keiner mehr diese letzte Stufe.

Schwellenwerte, tatsächlicher Provider, Risikoregeln und Datensatz blieben unverändert. Die Diagnose lockert keinen Filter, sucht keine profitabel aussehende Variante und berechnet keine hypothetischen Renditen für gelockerte Regeln. Base und bestehender Stressfall erzeugen weiterhin0% nominale Rendite und0 geschlossene Trades. Gleiche0%-Ergebnisse unter höheren Kosten belegen bei fehlenden Trades keine Kostenrobustheit.

Die beobachteten vollständigen Ergebnishashes entsprechen sowohl dem gewöhnlichen Replay als auch der zuvor wiederholten Baseline. Ein separater, bewusst künstlicher positiver Testfall erzeugt mit demselben tatsächlichen Provider vier geschlossene Trades; beobachteter und gewöhnlicher Replay bleiben vollständig identisch. Dieser Funktionstest ist kein Marktresultat.

Der ausführliche Bericht enthält alle Märkte und Tage, exakte Nenner sowie unabhängige und geordnete Ablehnungen. `/api/rule-funnel` und der KI-Kontext liefern eine validierte kompakte Sicht. Historische Datensatz-/Options-/Ergebnishashes müssen übereinstimmen. Abweichendes aktuelles Marktuniversum bleibt ausdrücklich als nicht zur Laufzeit passend markiert. Unbekannte Werte werden nicht als0 oder neutral ergänzt.

Regelverkäufe dürfen vorhandene Ausstiege erhalten, auch wenn mehr als drei Positionen gleichzeitig ein Verkaufssignal liefern. Der separate KI-JSON-Vertrag hat die eigene Aktionsgrenze. Die Diagnose verändert diese Regeln nicht.

Die [Forschung zu Backtest-Überanpassung](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) und [Mehrfachsignalauswahl](https://www.nber.org/papers/w21329) begründet, weshalb eine nach Sichtung gewählte bessere Variante keine unabhängige Erfolgsbestätigung wäre. Diese Diagnose setzt frühere Forschungssuchläufe nicht zurück. Featurebeobachtungen sind zeitlich und zwischen Märkten korreliert; ihre Häufigkeiten sind keine Gewinnwahrscheinlichkeiten. Für das spätere KI-Modell liegt weiterhin kein tatsächlicher Modell-/Gewinnnachweis vor.
