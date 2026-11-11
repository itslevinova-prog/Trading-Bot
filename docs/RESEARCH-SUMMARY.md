# Forschungsstand

Die bisherigen retrospektiven Untersuchungen haben **keinen belastbaren, kostenrobusten Trading-Vorteil** gegenüber Cash nachgewiesen.  
Auf kurzen 15-Minuten-Horizonten begrenzen Gebühren, Spread, Slippage und häufig fehlende Brutto-Chancen die Wirtschaftlichkeit; selbst verschiedene Filter und Exits bleiben netto negativ.  
Einzelne Varianten senken historische Verluste, aber kleine positive Ausnahmen – etwa bei nur wenigen Trades – versagen im Gebührenstress oder stammen aus bereits konsumierter Historie.  
Asset-Zeilen, rollende Folds und wiederholt ausgewertete Uhren sind voneinander abhängig; die effektive unabhängige Stichprobe ist unbekannt und oft zu klein.  
Deshalb bleiben Echtgeldhandel und Remote-KI deaktiviert; der nächste Forschungsschritt braucht vorab registrierte Hypothesen, klare Abbruchkriterien und unverbrauchte prospektive Evidenz.  

**Stand: 5. November 2026.** Zusammenfassung vorhandener Berichte; keine neuen Renditen, Wahrscheinlichkeiten oder Messwerte berechnet. „Verworfen“ bezieht sich ausschließlich auf die jeweils untersuchte Variante und deren Daten, nicht auf jede denkbare Strategie der Kategorie. Die konservativen Zahlen in `variantsTested` zählen unterscheidbare Modell-/Regelarme (nicht Handelsbeobachtungen, Folds oder Gebührenfenster); unvollständige Varianteninventare bleiben eine Schätzung und müssen vor einer Deflated-Sharpe-Auswertung geprüft werden.

## Hypothesenregister

| ID | Hypothese | Status | Ergebnis in einem Satz | Link |
| --- | --- | --- | --- | --- |
| H-001 | EMA-Kreuzung und Qualitätsfilter (15m) | verworfen | Im eingefrorenen Basis- und Stress-Replay 0 geschlossene Trades und 0 %; 33 der 33 bis zur ATR-Stufe gelangten Signale abgelehnt. | [Bericht](archive/RULE-DIAGNOSTIC.md) |
| H-002 | Breakout über 20 geschlossene Kerzen | verworfen | Sechs von sieben Monatsverlusten gegenüber der Quelle reduziert; alle sieben Kandidatenmonate trotzdem negativ, 153 statt 243 Basistrades. | [Bericht](archive/BREAKOUT-ENTRIES.md) |
| H-003 | Range- und Support-Reversion | verworfen | 334 Range-Beobachtungen, eine untere Rückeroberung, null wirtschaftlich zugelassene Setups; keine Strategie-PnL berechnet. | [Bericht](archive/RANGE-REGIMES.md) |
| H-004 | Steigende Stunden-EMA als Einstiegsgate | verworfen | 153 auf 139 Basistrades reduziert; dennoch alle sieben Kandidatenmonate negativ; 36 profitable und 102 verlustreiche reife Kandidatentrades. | [Bericht](archive/HOURLY-ENTRIES.md) |
| H-005 | Relative Stärke gegenüber BTC | verworfen | Tradezahl von 139 auf 126 reduziert, aber alle sieben Basismonate weiterhin negativ; Gebührenstress identisch mit der Quelle. | [Bericht](archive/RELATIVE-ENTRIES.md) |
| H-006 | BTC-Regime-Filter für korrelierte Altcoins | verworfen | Basis-Kandidat und Mock-v2 identisch bei −3,9262 % und 39 Trades; kein zusätzliches Veto ausgelöst. | [Bericht](archive/BTC-REGIME.md) |
| H-007 | Kovarianzbasierte Portfolioallokation | offen | Nettoverlust von −3,9262 % auf −3,0478 % und Drawdown von 3,9262 % auf 3,2658 % reduziert; immer noch schlechter als Cash. | [Bericht](archive/PORTFOLIO-COVARIANCE.md) |
| H-008 | Struktur-Exits bei Trendverschlechterung | verworfen | Gegen Kovarianz-Basis −3,0478 % verbesserte sich der Kandidat auf −1,8880 %; weiterhin unter Cash, Gebührenstress mit nur drei Trades unverändert. | [Bericht](archive/STRUCTURE-EXITS.md) |
| H-009 | Original-Support und 1R-Gain-Protection als Exits | verworfen | Original-Support-Regel: null zusätzliche Exits trotz 1.146 geprüfter Basiseinstiegsbeobachtungen; 1R-Regel ebenfalls ohne inkrementellen Vorteil. | [Bericht](archive/ENTRY-SUPPORT-EXITS.md) |
| H-010 | Lokale Ridge-Modelle auf 4h-Bruttorendite | verworfen | Ridge-MAE 1,17369 statt Null-MAE 1,12874 Prozentpunkte; validierungsgewählte Kapitaldiagnose +0,51154 % mit 13 Positionen, gepaarter Kostenstress −0,08852 %. | [Bericht](archive/LOCAL-LEARNING.md) |
| H-011 | Fixes 8h-Ziel statt 4h-Prognose | verworfen | Ridge −13,1808 % mit 232 hypothetischen Positionen, validierungsgewählte Version −1,8816 % mit elf; gleiche Entries bei 2× Kosten −21,9194 % bzw. −2,3686 %. | [Bericht](archive/FIXED-TARGET-LEARNING.md) |
| H-012 | Kostenbehaftete First-Barrier-Lernlabels | verworfen | 2.518 Stop-, 545 Target-, 4.216 Timeout- und ein ambiges Label; Ridge-MAE 0,014676 gegenüber Mittelwert 0,014351 (Renditeeinheiten). | [Bericht](archive/BARRIER-CLOCK-LEARNING.md) |
| H-013 | Lokale Barrier-Tree-Modelle | verworfen | Standalone Tree-Broker −7,1992 % (121 Trades); erweiterte Auswahl +0,4984 % (24 abhängige Trades), bei 2× Gebühren −0,5421 %. | [Bericht](archive/BARRIER-TREE-WALKFORWARD.md) |
| H-014 | Barrier-Ridge über den unveränderten Broker | verworfen | Unveränderte Hourly-Referenz −8,9409 % / 105 Trades, Ridge −4,3907 % / 50, Selector −0,8746 % / elf; keine Variante schlägt Cash. | [Bericht](archive/BARRIER-BROKER-COMPARISON.md) |
| H-015 | Direktionale ADX/DMI-Zusatzfeatures | verworfen | Die 10D-Zusatzfeature-Variante lag im Test-MAE hinter der ursprünglichen 8D-Ridge und dem Mean-Control; kein positiver Brokerbeleg. | [Bericht](archive/DIRECTIONAL-RIDGE-WALKFORWARD.md) |
| H-016 | Aggressor-Orderflow als Ridge-Feature | verworfen | Etwa 50 gewählte historische Uhren; mittlere prognostizierte Chance rund +0,0090, zugehöriges kostenbehaftetes Label −0,0057174; MAE nicht besser als Mean-Control. | [Bericht](archive/AGGRESSOR-RIDGE-WALKFORWARD.md) |
| H-017 | BTC-Common-Market-Ridge-Feature | verworfen | Neuntes BTC-Feature verschlechterte MSE und MAE; erweiterter Selector wählte Common-Market-Kandidat in null Folds. | [Bericht](archive/COMMON-MARKET-RIDGE.md) |
| H-018 | Volumen- und Aktivitätsdaten als Prädiktor | offen | 7.276/7.280 historische Volumenverhältnisse definiert, vier ausdrücklich unbekannt; zwei 96-Bar-Captures bestätigen nur Datenzugriff, keinen Handelsvorteil. | [Bericht](archive/VOLUME-ACTIVITY.md) |
| H-019 | Deterministische Mock-KI-Policies | verworfen | Mock-v1 −5,4928 % mit 54 Trades, Struktur-Mock-v2 −3,9262 % mit 39; Cash weiterhin 0 %. | [Bericht](archive/MOCK-STRUCTURE-STUDY.md) |
| H-020 | Kalendergewichtete Ridge-Refits im Mai | verworfen | Spätes Mai-Fenster: ungewichtete Ridge-MAE 0,0117320 gegenüber gewichteter Ridge 0,0118921; alle fünf Kandidaten ohne Chance über 0,005. | [Bericht](archive/EARLY-MAY-VALIDATION.md) |
| H-021 | Robuste Clock-Rankings und Validierungsziele | offen | 44/328 Leave-one-clock-out-Fälle änderten den gewählten Modellnamen; MSE-Selector fand sechs Chancen mit mittlerem costed Label −0,0072252. | [Bericht](archive/VALIDATION-EVIDENCE.md) |
| H-022 | Prospektive eingefrorene Paper-V3-Kohorte | offen | Paper-V3 gestartet und später unter dokumentierten Lücken fortgesetzt; keine belastbare unabhängige Profit-Evidenz oder ausreichende Stichprobe nachgewiesen. | [Bericht](archive/MOCK-FORWARD-V3.md) |
| H-023 | Sicherheits- und Ausführungsannahmen | offen | Beim Stundenkandidaten gross ausgewertete Nettosumme −11,866624 Quote-Einheiten trotz brutto −7,808999 vor expliziten Gebühren; Ausführungschecks belegen Robustheit, nicht Alpha. | [Bericht](archive/HOURLY-ENTRY-FAILURES.md) |

Alle vollständigen Ideen, ökonomischen Begründungen, Datenschnitte, Messgrößen, künftigen Erfolgshürden, Abbruchregeln, Varianten-Schätzungen und Originalbelege stehen in [research/hypotheses.json](research/hypotheses.json). Historische Protokolle und JSON-Ergebnisartefakte behalten ihre ursprünglichen Orte. Die alten vollständigen Arbeitsnotizen stehen unverändert unter [archive/WORK-LOG-bis-2026-11-05.md](archive/WORK-LOG-bis-2026-11-05.md).

## Was als Nächstes getestet wird

Neue Prüfungen nur nach vorher festgelegter Hypothese, Daten-/Kostenvertrag und echtem Abbruchkriterium; keine neue Auswertung bereits konsumierter Ergebnisse als angeblich unabhängigen Holdout.

- **#2**: nächste getrennt registrierte, wirtschaftlich falsifizierbare Forschung.
- **#4**: künftige Validierung und unabhängige Evidenz mit Kostenstress.
- **#11**: laufende Paper-Beobachtung und Datenqualität.
- **#13**: neue Forschungsansätze erst nach klaren Nettoertrags-/Roundtrip-Kostenhürden.

Für die genaue aktuelle Aufgabenbeschreibung die verlinkten Issues [#2](https://github.com/itslevinova-prog/Trading/issues/2), [#4](https://github.com/itslevinova-prog/Trading/issues/4), [#11](https://github.com/itslevinova-prog/Trading/issues/11) und [#13](https://github.com/itslevinova-prog/Trading/issues/13) beachten. Hier wird keine Zuständigkeit dieser Issues geändert.
