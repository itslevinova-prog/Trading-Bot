# Projekt-Roadmap: kritischer Pfad und WIP-Limit

Stand: **06.11.2026, nach PR #49 und Backlog #90** · Verbindliche Planungsgrundlage: [Issue #32](https://github.com/itslevinova-prog/Trading/issues/32)

> **Kein Profitabilitätsnachweis.** Bisher waren nur 7 von 80 Holdouts positiv; die im Issue dokumentierten Juni-Replays lagen bei ungefähr −7,7 %. Ein guter Entwicklungs-Backtest ist kein Erfolg. Auch die Entscheidung, statt eines aktiven Bots nur einen Sparplan zu verwenden, ist ein zulässiges Ergebnis.

## Ziel und unverrückbare Grenzen

Das Ziel ist eine **nach sämtlichen Kosten** bessere risikoadjustierte Leistung als **BTC Buy & Hold und der Sparplan aus #13**, gemessen auf unberührten Daten anhand der in [#21](https://github.com/itslevinova-prog/Trading/issues/21) festgelegten Sharpe-/Calmar-Gates. Keine Behauptung von Überrendite ohne diese Nachweise.

- **0 CHF Zusatzkosten:** nur lokale Arbeit, kostenlose öffentliche Daten und vorhandene Infrastruktur. Keine kostenpflichtigen Dienste, Credits, Remote-LLMs, API-Keys oder Echtgeld-Orders.
- **Paper ist Standard:** `LIVE_ENABLED=false`, `AI_ALLOW_REMOTE=false`; `LIVE_ACK` bleibt ungesetzt.
- **Daten-Grenzen:** Holdouts bleiben gesperrt und werden niemals zur Parameterauswahl benutzt. Ein fehlgeschlagenes Gate bleibt fehlgeschlagen.
- **Hypothesenpflicht:** Jede neue Studie wird vor der Auswertung in `docs/research/hypotheses.json` registriert. Auch negative Resultate und die Zahl der getesteten Varianten werden dokumentiert.
- **Keine neuen Mikro-Audits** der alten 15m-Regelstrategie ohne registrierte, vorab festgelegte Hypothese.

## WIP und Startregeln

1. **Ein offener Pull Request pro Agent** (Agent A, B, C, D – siehe Bereichsaufteilung unten), einschliesslich Drafts. Insgesamt also höchstens vier. Ein Agent eröffnet erst einen neuen PR, wenn sein eigener gemergt oder geschlossen ist. PRs anderer Agents blockieren dich **nicht**.
2. Ein frei gewordener Slot entsteht erst durch **Merge oder Schliessung** eines anderen PR. Ein geparkter PR wird nicht ohne Prüfung der aktuellen Abhängigkeiten wieder geöffnet.
3. Ein abhängiges Issue darf erst gestartet werden, wenn **alle genannten Voraussetzungen auf `main` gemergt** sind. Ein Draft-PR oder ein grüner Feature-Branch reicht nicht.
4. Welle 1 vor Welle 2: Infrastruktur aus #16, #6, #3, #5 vor der Integration von #21. Eine bereits vorzeitig gestartete Arbeit erhält **keine** Ausnahme von Integrations-Gates.
5. Beim PR-Review zuerst Daten-/Kosten-/Holdout-Sicherheit, dann `pnpm verify` und CI prüfen. Ein roter Check wird nicht ignoriert; Tests werden nicht deaktiviert. Für jede neue Änderung: ein eigener Issue-Branch und ein Draft-PR.
6. **Dokumentationsänderungen** zählen zum PR-Slot des Agents, der sie macht.
7. **Parallele Agenten koordinieren:** Vor jeder Übernahme die Issue-Kommentare auf `🔒 in Arbeit` und die offenen Branches/PRs prüfen. Fremde Sperren respektieren, kein bereits übernommenes Issue doppelt beginnen und keine fremden Agent-Bereiche im eigenen Branch ändern. Benötigte Änderungen in einem fremden Bereich zuerst als Issue-Kommentar abstimmen.

Manuelle Kontrollabfrage vor jeder PR-Eröffnung:

```sh
gh pr list --repo itslevinova-prog/Trading --state open
```

Die Liste ist **keine automatische GitHub-Sperre**; jeder Agent prüft vor dem Öffnen nur seine **eigenen** offenen PRs.

**Bereichsaufteilung (seit 07.11.2026):** A = backtest/, pipeline/, research/, regime/, strategy/ · B = recorder/, archive/, coin-quality/, cost/, fill-models, simulated-broker · C = risk/, live/, Paper-Broker · D = apps/web/, tax/, backup/, dca/. Branch-Präfix `agent-<x>/`. Issue vor Start mit „🔒 in Arbeit von Agent X“ markieren.

## Aktueller Status der Grundlagen

| Issue | PR | Tatsächlicher Stand am 06.11.2026 | Folge |
| --- | --- | --- | --- |
| #16 CI/Kostenwächter | #22 | **Gemergt** | Neue PRs auf CI prüfen |
| #6 Hypothesen-Register | #25 | **Gemergt** | Alle Studien registrieren |
| #3 Mehrjähriges Datenarchiv | #24 | **Code gemergt; lokaler Import aus #36 offen** | Ohne Entwicklungsarchiv keine echte #33-Auswertung |
| #5 Backtest-/Paper-Parität | #30 | **Code gemergt; Pipeline-/Paritätsbelege teils offen** | #21 darf fehlende Stage-1-Nachweise nicht als bestanden ansehen |
| #17 Marktdaten-Recorder | #26 | **Code gemergt; lokale Aufzeichnung offen (#36)** | Keine realen Spread-/Fill-Werte ohne Recorder-Lauf behaupten |
| #20 Coin-Qualitätsfilter | #29, #46 | **Code und Einstiegsgate gemergt, Issue offen** | Historische Qualitätsnachweise fehlen |
| #21 Stage-Gate-Pipeline | #31, #37, #49 | **PRs gemergt, Issue offen** | Originales Stage-1-Evidence, Monitoring und Readiness offen |
| #18 Lokale Backups | #27 | **Code gemergt, Issue offen** | Lokale Restore-Prüfung (#36) steht aus |
| #14 Steuerexport | #23 | **Gemergt** (06.11.2026, auf Wunsch des Repo-Besitzers) | Weiterentwicklung erst nach Stufe 3 |
| #19 Marktregime | #35 (ersetzt #28) | **Gemergt** (06.11.2026), Hypothese H-024 | Einmalige Validierung 2024 noch offen |
| #2 Kosten/Maker-Modell | #44 | **Bausteine gemergt, Issue offen** | Broker-Verdrahtung, echte Messung und Vergleich fehlen |
| #4 Tages-Trendfolge | #47 | **Provider gemergt, Issue offen** | Runner, Paper-Konto und historische Tests fehlen |
| #7 Portfolio-RiskEngine | #39, #45 | **Paper-Kern und Risikoanzeige gemergt, Issue offen** | Live-/Testnet-Adapter und echte Entwicklungstests fehlen |
| #13 DCA-Sparplan | #38 | **Code gemergt, Issue offen** | Vollständiger Kosten-/Benchmark-Nachweis fehlt |
| #33 Trend-Schnelltest | #48 | **Skript gemergt, nicht ausgeführt** | Nur 2020–2023 nach Datenimport lokal auswerten |
| #40 / #41 PIT-Universum und Look-ahead | #43, #42 | **Gemergt** | Nicht erneut als Issue anlegen |
| Alter Spread-Coverage-Report | #1 | **Geschlossen, nicht gemergt** | Wird durch #17/#2 ersetzt |

Die PR-Zustände sind eine **Momentaufnahme**, kein automatischer Live-Status. Vor jedem neuen Schritt die Abhängigkeiten erneut auf `main` prüfen.

## Kritischer Pfad – nächste Entscheidungen

| Reihenfolge | Arbeit | Start-/Abschlussbedingung | Priorität / Entscheidung |
| --- | --- | --- | --- |
| 1 | #16, #6, #3, #5: Grundlagen | **Alle gemergt** | Erledigt |
| 2 | **#33: 1d-Trend-Schnelltest** | Code aus #48 gemergt, lokaler Archivimport offen; ausschliesslich 2020–2023 | Drei vorregistrierte SMA-Varianten, Ergebnis einschliesslich Rot dokumentieren; keine Holdout-Daten |
| 3 | **#2: echte Kostenhürde/Maker-Ausführung** | Teilcode #44 gemergt; echte Recorder-Daten und Integration offen | Ausführung und Gebühren zuerst prüfen |
| 4 | **#4: 4h–1d-Trendfolge** | Provider #47 gemergt; Priorität anhand **unverändertem** #33-Ergebnis festlegen | Nur vorab definierte Varianten und Kosten; kein Nachoptimieren auf Holdout |
| 5 | **#13: DCA-Sparplan** | Teilcode #38 gemergt; Benchmark-Kostenbelege offen | Verbindlicher Vergleich gegen aktives Trading |
| 6 | **#21: Stage-Gates** | Code #31/#37/#49 gemergt; fehlende Stage-1-Evidenz nicht als Erfolg werten | Die Gates entscheiden, nicht ein einzelner Backtest |
| 7 | **#7 Risk-Engine und #12 Überwachung** | Vor längerem Paper-Betrieb integriert und geprüft | Keine 90-Tage-Paper-Phase ohne Schutz- und Monitoringanforderungen |
| 8 | **#21 Stufe 4: ≥90 Tage Paper** | Eingefrorene, nach Gates zulässige Version | Keine nachträgliche Umdeutung eines Fehlers; Mindestdauer einhalten |
| 9 | **#9: Testnet/Live-Readiness** | Paper-Gates erfüllt, Reconciliation und Monitoring vollständig | Nur Testnet und Readiness, **kein Echtgeld-Livebetrieb** |

#33 darf nach dem Merge von #3 parallel zur Arbeit an #5 erfolgen; #5 ist inzwischen ebenfalls gemergt. Die tatsächliche Reihenfolge offener Arbeiten bestimmt **zusätzlich** das Limit ein offener PR pro Agent. Die Stage-Gate-PRs #31, #37 und #49 sind inzwischen gemergt. **Issue #21 bleibt offen**, bis die fehlenden Nachweise und Folge-Gates erbracht sind. Vor diesem Dokumentations-PR waren keine PRs offen; die WIP-Grenze dennoch vor jedem PR live prüfen.

### Entscheidung nach #33

Die Schwellen in [Issue #33](https://github.com/itslevinova-prog/Trading/issues/33) sind **vorab fixiert** und dürfen nach Datenansicht nicht geändert werden:

- **Grün:** mindestens eine der drei Varianten schlägt 50/50 Buy & Hold **netto sowohl bei Calmar als auch bei Sharpe** → #4 erhält Vorrang nach #5.
- **Gelb:** bessere Kennzahl nur bei Calmar **oder** Sharpe → #4 ohne Vorrang.
- **Rot:** keine Variante ist in einer der beiden Kennzahlen besser → #4 zurückstufen, #11 und #13 neu priorisieren.

#33 dient ausschliesslich der Priorisierung: Sein Entwicklungszeitraum ist **kein** unabhängiger Nachweis nach #21. Eine neue Optimierungsrunde auf denselben Daten ist keine zusätzliche Evidenz.

## Unterstützend und geparkt

**Unterstützend (nur bei freiem WIP-Slot):** #18 Backup (PR #27 gemergt; Restore lokal prüfen), #19 Marktregime (PR #35 gemergt; Datenprüfung offen), Recorder #17 und Coin-Filter #20 (Grundcode gemergt, Evidenz offen). Für #7 und #12 gilt zusätzlich die harte Abhängigkeit vor Paper-Betrieb.

**Geparkt bis mindestens Stufe 3 einer geeigneten Strategie:** #8 KI-Filter, #10 Risikoprofile, #14 Steuerexport (PR #23 gemergt), #15 Dashboard. #11 Multi-Strategie ist ebenfalls grundsätzlich geparkt; das Issue #32 nennt #11 zugleich als möglichen zweiten Ansatz nach einer gescheiterten #4. Diese Spannung wird **nicht** durch einen stillschweigenden Start von #11 umgangen: vor einem solchen Ausnahme-Start müssen Reihenfolge, Hypothese und Gates im Roadmap-Issue ausdrücklich festgelegt werden.

Das Schliessen eines geparkten Draft-PR **löscht keine Branches oder Commits**, aber liefert auch keinen Merge und keinen abgeschlossenen Issue-Nachweis. Wiedereröffnung nur mit freiem Slot und erneuter Prüfung von `main`.

## Abbruch statt Ergebnisjagd

Nach Prüfung von #4 und gegebenenfalls dem in #32 vorgesehenen zweiten Ansatz #11 gilt: **Besteht keine Strategie Stufe 3 von #21, wird das Scheitern dokumentiert und #13 (Sparplan) als operative Alternative priorisiert.** Nicht zusätzliche Varianten derselben verbrauchten Holdout-Daten erfinden. Bei widersprüchlichen Voraussetzungen zu #11 zuerst das Issue klären, ohne die Gates zu lockern.

## Review-Check vor jedem nächsten PR

- [ ] Freier WIP-Slot: der eigene Agent hat keinen anderen offenen PR
- [ ] Alle ausdrücklich genannten Abhängigkeiten auf `main` gemergt
- [ ] Keine Zusatzkosten oder Echtgeld-/Remote-Freigaben
- [ ] Hypothese mit Varianten, Datenfenstern und Kosten vorab erfasst (falls Forschung)
- [ ] Holdout unberührt beziehungsweise Zugriff rechtmässig und einmalig dokumentiert
- [ ] `pnpm verify` und CI erfolgreich oder Fehlschlag nachvollziehbar dokumentiert
- [ ] Entscheidungen, Grenzen und negative Ergebnisse ehrlich im Draft-PR notiert

Bei Änderungen am kritischen Pfad diese Datei **und** [Issue #32](https://github.com/itslevinova-prog/Trading/issues/32) synchron halten, damit keine widersprüchlichen Statuslisten bestehen.

## Backlog-Erweiterung nach PR #49 (Issue #90)

Die [Backlog-Übersicht #90](https://github.com/itslevinova-prog/Trading/issues/90) enthält **40 zusätzliche, einzeln prüfbare Issues #50–#89**, mit konkreten Dateien, Tests, Prioritäten und Voraussetzungen. Neue Einträge ersetzen die bereits offenen #2/#4/#7/#9/#12/#21 oder die Stop-Regel aus #32 **nicht**.

**Prioritäten:** P0 (12: #50, #51, #52, #56, #58, #59, #66, #69, #70, #74, #77, #78), P1 (23: #53, #54, #55, #57, #60, #61, #62, #63, #64, #65, #67, #68, #71, #72, #73, #75, #76, #79, #80, #81, #82, #83, #89), P2 (5: #84–#88; **geparkt**).

| Welle | Umsetzungsreihenfolge (alle neuen Issues) | Startbedingungen |
| --- | --- | --- |
| **A – Integrität** | #52 → #55 → #53 → #56 → #58 → #77 → #78 → #50 → #76 → #74 → #75 | Existierender Archiv-, Risk- und Pipeline-Code auf `main`; #77 vor #78; fehlende Belege und #36 beachten |
| **B – Kosten & Risiko** | #69 → #68 → #59 → #65 → #89 → #51 → #66 → #73 → #81 → #70 → #67 | Zuerst Restumfang #2/#7/#17, #52 vor #66, #65 vor #89, #73 vor #81 |
| **C – Diagnostik & Zusatzdaten** | #57 → #61 → #63 → #72 → #62 → #64 → #54 → #71 → #60 → #79 → #80 → #82 → #83 | #56 vor #57, #63 vor #72, #54 vor #71, #50/#51 vor #60, #60 vor #79, #82 vor #83 |
| **D – geparkte Hypothesen** | #84 → #85 → #86 → #87 → #88 | **Nur** nach ausdrücklicher, dokumentierter Freigabe unter #32; sonst nicht ausführen |

**Planungsabschluss #90:** Die Einordnung der 40 zusätzlichen Arbeiten und ihre Abhängigkeiten sind in dieser Roadmap dokumentiert. Das Schliessen des Planungsissues #90 bedeutet **nicht**, dass die Implementierungs-Issues #50–#89 erledigt oder ihre Gates bestanden sind. Einzelne Issue-Claims, Tests, Reviews und Merges bleiben weiterhin erforderlich.

Diese Wellen sind Planungsreihenfolge, keine Ausnahme von den **individuellen Issue-Abhängigkeiten**. Für jeden neuen Branch und Draft-PR gilt die Grenze ein offener PR pro Agent. Code für neue Strategien nur nach Vorregistrierung einer eindeutigen Hypothesen-ID samt fixen Varianten und Abbruchkriterien. **Keine Entwicklung auf 2024 oder 2025+:** 2024 wird ausschliesslich in der einmaligen #21-Validierung geprüft; ab 2025 ist der Holdout gesperrt. Keine erfundenen Daten oder Gewinne, keine Echtgeld-/Derivateorders, keine privaten Keys oder neue Kosten.

**Stop bei fehlendem Erfolg:** Falls #4 und gegebenenfalls #11 Stufe 3 von #21 nicht bestehen, wird der negative Befund akzeptiert und #13 als Sparplan-Alternative priorisiert, statt #84–#88 automatisiert zu testen. Keine KI-Strategie vor bestandenem Stage-3-Gate.
