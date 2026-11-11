# Strategie-Pipeline (#21)

> **Kostenregel:** Kein Geld ausgeben. Ausschliesslich lokaler Code, Backtests, Paper und Testnet. Keine kostenpflichtigen Dienste, Credits oder Echtgeld-Orders. **Stufe 6 ist nur ein Bericht**, kein Schalter für Live-Handel.

## Voraussetzungen und aktueller Stand

Diese Pipeline ist ein strenges Gate vor der eigentlichen Live-Entscheidung. Sie erzeugt **keine** Handelsorders und verändert weder Strategie-Provider, RiskEngine, Broker, Backtest-Kern noch Dashboard. Stand 2026-11-06: **#3 (Archiv/Holdout-Sperre), #5 (Backtest) und #6 (Hypothesen-Register) sind auf `main` gemergt**, und dieser PR-Branch wurde mit `main` zusammengeführt. Die tatsächliche Integration ist **noch nicht abgeschlossen**: Die #5-CLI verwendet eine Paper-DB statt des Point-in-Time-Archivs und liefert derzeit kein `pipelineEvidence` mit sämtlichen Gate-Metriken. Die produktive Stufe 3 nutzt inzwischen den ausdrücklich protokollierten
#3-Holdout-Zugriff, **aber nur für genau eine vorab registrierte und bereits durch
Stufe 1/2 zugelassene Version**. Sie liest ausschliesslich BTC/ETH USDT aus dem Jahr
2025. Eine zweite Bewertung, ein anderer Datenabschnitt oder ein eigenes
`--evidence`-JSON sind nicht erlaubt. Ohne eine grüne Vorgeschichte bleibt der
Holdout versiegelt; ein nicht bestandener Lauf wird dauerhaft als failed gespeichert. #9 (Readiness), #12 (Monitoring) und #13 (DCA-Benchmark) fehlen weiterhin. Jede fehlende Original-Evidenz führt zu **failed**, nie zu einem erfundenen grünen Gate.

## Stufen und unveränderliche Gates

| Stufe | Name | Gate zum Aufstieg |
| --- | --- | --- |
| 0 | Idee | Registrierte Hypothese in `docs/research/hypotheses.json` mit ökonomischer Begründung, Erfolgsschwelle und Abbruchkriterium; abgelehnte Hypothesen nicht freigeben |
| 1 | Backtest, Entwicklung 2020–2023 | **Grüne Ampel aus #5** und bestandener, per SHA-256 belegter Look-ahead-Perturbationstest (#41) aller ausführbaren registrierten Strategien; Sharpe **oder** Calmar strikt besser als **beide** BTC Buy & Hold und Sparplan (#13); DSR-Wahrscheinlichkeit **≥ 0,95** mit ehrlicher Variantenanzahl; **PBO berechnet und < 0,20**; **≥ 100** abgeschlossene Trades **oder ≥ 3 Jahre Exposure**; Brutto-Edge **≥ 2 ×** positive Roundtrip-Kosten. P10 und P90 aus Block-Bootstrap zwingend |
| 2 | Validierung 2024 | **Einmaliger Lauf pro Version** auf 2024, Nettoergebnis **≥ P10** des unveränderten Entwicklungs-Bootstrap; alle Stress-Nettoergebnisse **≥ 0** |
| 3 | Holdout ab 2025 | **Einmaliger Lauf pro Version**, ausschliesslich **über die #3-Holdout-Sperre mit protokolliertem Grund `pipeline stage 3`**; Nettoergebnis **≥ P10** aus Stufe 1. Ohne vorherige bestandene Gates und exakt protokollierte Holdout-Freigabe wird kein Zugriff ausgeführt |
| 4 | Paper | **≥ 90 volle Tage** mit eingefrorenem Code-Hash; Überwachung aus #12 **nie rot** (Proof-Hash); Nettoergebnis innerhalb **P10–P90**; Start nach bestandenem Holdout |
| 5 | Testnet | **≥ 28 volle Tage**, **0** Reconciliation-Fehler mit Nachweis; Fill-Abweichung zum Paper-Schatten **≤ vorab festgelegte Toleranz**; Bereitschaftsprüfung **aus #9 referenzieren**, nicht neu implementieren |
| 6 | Bereit | Bericht `erfüllt alle Kriterien`; ausschliesslich informativ, **keine Order- oder Echtgeld-Freischaltung**; allein der Besitzer entscheidet |

Grenzen sind inklusiv, wo `≥` oder `≤` steht. Eine fehlende, ungültige oder nicht-endliche Metrik besteht **kein** Gate. **PBO wird nicht bei fehlender Berechenbarkeit übersprungen**, sondern blockiert Stufe 1. Die Strategie darf nur in chronologischer Reihenfolge aufsteigen. Ein `failed` ist ein gültiges, unveränderliches Ergebnis. **Der eingecheckte `rules/v1/stage-1.json`-Datensatz dokumentiert ausschliesslich das Scheitern wegen fehlender #5/#6-Voraussetzungen; es wurde kein echter 2020–2023-Backtest ausgeführt und keine Kennzahl berechnet.** Kein Tuning auf Validierungs-/Holdout-Daten, keine zweite Auswertung derselben Version.

## Versionen und Registrierung

`docs/strategies/registry.json` erfasst pro Strategie `id`, `hypothesisId`, `description`, Benchmark-Flag und Versionen mit `version`, `configHash`, `codeHash`, `createdAt`, `stage`, `status`, `variantsTested`, `consumedStages`. Hashes basieren auf den SHA-256-Helfern in `provenance/`; der Code-Hash bindet Strategien sowie vorhandene ausführungsrelevante Quellen (Kontext, Markt, Broker, Backtest, Archiv, Shared, Config). Die Konfiguration wird kanonisch gehasht; sensible Schlüssel werden nicht gespeichert.

**Jede Code- oder Parameteränderung verlangt einen neuen Versionsnamen**, beginnend bei Stufe 1. Eine identische Code-/Konfigurationskombination darf nicht unter einer anderen Versionsnummer als Ausweg nach einem Fehlschlag erneut registriert werden. `variantsTested` wächst je Hypothese monoton, ausgehend von der historischen Anzahl aus #6, und wird beim Backtest an #5 übergeben. Die Datei aus #6 wird nur gelesen, nicht überschrieben. Sollte sie noch fehlen, bleibt die Hypothese unbestätigt und Gate 0 blockiert.

`hold` ist als **Benchmark, nicht in der Pipeline** gekennzeichnet und kann keine Stufen durchlaufen. `trend-vol-target` wird erst nach Merge von #4 registriert, falls sein ausführbarer Quellcode vorhanden ist; kein erfundener Provider.

## Befehle

```bash
pnpm pipeline:register --strategy rules --version v1 --hypothesis H-001
pnpm pipeline:register --strategy hold --version v1 --benchmark
pnpm pipeline:status
pnpm pipeline:evaluate --strategy rules --version v1 --stage 1
pnpm pipeline:evaluate --strategy rules --version v1 --stage 2
pnpm pipeline:evaluate --strategy rules --version v1 --stage 4 --evidence data/local-paper/evidence.json
pnpm verify
```

- `--hypothesis` muss der tatsächlich passenden ID aus #6 entsprechen. **H-001 ist im gemergten Hypothesen-Register als `rejected` markiert**; `rules/v1` darf deshalb nicht aufsteigen. Der historische Datensatz bleibt unverändert; eine neue Hypothese/Strategie erfordert eine eigenständige Registrierung.
- Der Registrierungsbefehl ermittelt Hashes automatisch; `--config data/.../config.json` erfasst zusätzliche explizite Parameter. Die laufende Umgebung beeinflusst über die sanitisierten Handelsparameter den Konfigurations-Hash. Live- und KI-Remote-Flags müssen aus bleiben.
- Stufen 1/2 rufen den **lokalen** `pnpm backtest` aus #5 mit fixem Zeitraum und `--trials` auf, sofern der Befehl existiert. Es muss genau ein neuer `data/backtests/<run-id>/report.json` entstehen und das Upstream-Format `pipelineEvidence` enthalten. Fehlt die Schnittstelle, wird das **explizit als failed** gespeichert; **kein Fallback auf die älteren Research-Skripte** und keine Kennzahlen erfinden.
- Lokale externe Nachweise für Paper/Testnet werden über `--evidence data/...json` eingelesen. Stufe 3 ruft **ausschliesslich** den lokalen
`ArchiveCandleSource` mit `allowHoldout: {reason: 'pipeline stage 3'}`
auf und kontrolliert die neue Zugriffs-Auditzeile. Der Versuch wird bereits
**vor dem Datenzugriff** als einmalig reserviert markiert. Bei fehlender
Archivhistorie, Identität oder Audit bleibt die Stufe für diese Version
gescheitert. Kein zweiter Versuch derselben Version.
- Test-Fixtures über `evidenceForTest` und `holdoutGuardForTest` sind im produktiven Prozess ausdrücklich verboten. Die Paper- und Testnet-Nachweise müssen mindestens über den deklarierten Kalenderzeitraum reichen; behauptete Laufzeiten ohne entsprechende Zeitspanne werden abgewiesen.
- Jede gestartete Bewertung wird **vor** der Ausführung in `consumedStages` registriert. Das gilt besonders für Stufe 2/3 selbst nach Prozessabbruch. Das Ergebnis liegt create-only unter `docs/strategies/<id>/<version>/stage-<n>.json`; vorhandene Ergebnisdateien werden **niemals überschrieben**. Das Register wird atomar aktualisiert. Der Registry-Lock verhindert konkurrierende lokale Bewertungen; bei einem Absturz kann der Lock manuell überprüft werden, **nicht** die reservierte Bewertung zurücksetzen.
- `pipeline:status` zeigt die Versionen, die aktuelle Stufe und den nächsten Schritt. Eine Zeitangabe zu Paper seit Holdout ist **nur die frühestmögliche Dauer**, kein Nachweis von echtem Paper-Betrieb.

## Lokales Evidence-Format

Das Backtest-Report-Adapter-Feld `pipelineEvidence` bzw. eine lokale Paper-/Testnet-Evidence-Datei muss mindestens diese Form haben:

```json
{
  "stage": 1,
  "strategyId": "rules",
  "version": "v1",
  "codeHash": "<sha256-of-registered-code>",
  "configHash": "<sha256-of-registered-config>",
  "periodFrom": "2020-01-01",
  "periodToExclusive": "2024-01-01",
  "dataHashes": {"candles": "<sha256>"},
  "source": "local:backtest",
  "metrics": {
    "trafficLight": "green", "lookaheadPassed": true, "lookaheadEvidenceHash": "<sha256-of-offline-perturbation-evidence>",
    "sharpe": 0, "btcSharpe": 0, "dcaSharpe": 0,
    "calmar": 0, "btcCalmar": 0, "dcaCalmar": 0,
    "dsrProbability": 0, "pbo": 0, "variantsTested": 1,
    "trades": 0, "exposureYears": 0,
    "grossEdge": 0, "roundtripCost": 0,
    "bootstrapP10": 0, "bootstrapP90": 0
  }
}
```

Die Zahlen oben sind **Schema-Beispiele, keine Backtest-Ergebnisse**. Alle Gate-Felder müssen aus der echten #5-Engine / #13-DCA-Benchmark kommen. Bei Stufe 2 sind `netReturnPct` und `stressNetReturnsPct` nötig, bei Stufe 3 `netReturnPct`, bei Stufe 4 `days`, `paperCodeHash`, `neverRed`, `monitoringEvidenceHash` und `netReturnPct`, bei Stufe 5 `days`, `reconciliationErrors`, `reconciliationEvidenceHash`, `fillDeviationBps`, `fillToleranceBps`, `readinessPassed`, `readinessEvidenceHash`. Stufe 6 erzeugt nur einen Bericht. Quelle, Daten-Hashes, Gate-Checks und Zeitpunkt werden bei jedem Ergebnis protokolliert. Externe Proof-Hashes ersetzen nicht die noch zu integrierenden Originalschnittstellen.

## Integrationsentscheidungen / Einschränkungen

1. **Kein Aufweichen wegen offener Abhängigkeiten:** Keine selbst erfundene DSR-, PBO-, DCA- oder Datenarchiv-Implementierung im Zuständigkeitsbereich von #21.
2. **Ausserhalb der Stufe 1 keine erfundenen Daten:** Ohne echte #5-Reportstruktur scheitert der Versuch mit einer konkret genannten Ursache. Die Registry kann später erst nach den Upstream-Merges vollständig benutzt werden.
3. **Einmalig heisst auch nach Crash einmalig:** Reservierte Validierung/Holdout-Versuche bleiben verbraucht und können nicht rückgesetzt werden. Deswegen muss eine lokale Arbeitskopie inklusive Register und Stage-Ergebnissen gesichert werden.
4. **Paper-Kontenzulassung (nach Merge von #31, Nacharbeit #36):** Der lokale Paper-Server verdrahtet die Sperre jetzt **an jeder Buy-Order im PaperExecutionAdapter und erneut nach simulierter Latenz**. Für `rules` muss `PAPER_RULES_PIPELINE_VERSION=vN` gesetzt sein, für `ai` entsprechend `PAPER_AI_PIPELINE_VERSION=vN`. Es werden nur registrierte Versionen mit bestandener Stufe 3, aktuellem Code-Hash und nicht fehlgeschlagenem Status zugelassen; bei fehlender Version oder falschem Hash werden Einstiege begründet abgelehnt und protokolliert. Ausstiege bleiben möglich. Das fest eingebaute Konto `hold` ist nur als explizit im Register gekennzeichneter Benchmark ausgenommen. **Aktuell hat keine Regel- oder KI-Version Stufe 3 bestanden, deshalb sind neue aktive Paper-Einstiege absichtlich gesperrt.** Die Datenfeeds und der reine Read-only-Prozessstart laufen weiter. Die Sperre gilt für den normalen Server `index.ts`; andere separate Paper-Prozesse müssen denselben Broker-Guard explizit verdrahten.
5. **Testnet:** Stufe 5 kontrolliert nur den signierten Readiness-Nachweis aus #9. Keine eigene Broker-Implementierung und keine Echtgeld-Freigabe.

Die Tests in `apps/server/test/pipeline-gates.test.ts` verwenden ausschliesslich temporäre Verzeichnisse und In-Memory-Evidence, **kein Netzwerk und kein Echtgeld**.

## Ergänzung 06.11.2026: harte Paper-Zulassung und echter Stage-3-Adapter

`PaperExecutionAdapter` prüft die Stage-3-Zulassung vor und nach
der simulierten Latenz für aktive `rules`-/`ai`-Einstiege.
Die beiden ausdrücklich als Benchmark registrierten Konten
`hold` und `dca` dürfen unter diesem Ausnahmegrund ebenfalls
simulierte Paper-Buchungen erzeugen; sie werden nicht zu Pipeline-Kandidaten
und können nicht als Stage-Pass gelten. Ausstiege bleiben unberührt.
Die beabsichtigte Folge ist, dass derzeit **keine aktive Strategie
Paper-Einstiege beginnen darf**: Die vorhandene `rules/v1`-Version
hat unveränderlich Stage 1 **failed**.

Stufe 3 verlangt einen echten, protokollierten Holdout-Zugriff
mit eingefrorener Strategieidentität; ihr Runner ist an
`src/pipeline/holdout.ts` gebunden. Dieser verwendet einen
konservativen stündlichen Backtest auf **2025** (kein Zugang zu
Daten nach 2025), feste BTC/ETH-USDT-Paare, keinerlei
Parameteroptimierung und schreibt nur einmal eine lokale
Evidence-Datei unter `data/pipeline-holdout/`.
Die Guard-Aufzeichnung muss genau den Grund
`pipeline stage 3` enthalten. Fehlt die Historie oder
stimmt die frühere Vorregistrierung der zwei Märkte nicht,
gilt die Evaluation als **failed**; eine zweite Stage-3-Prüfung
derselben Version ist ausgeschlossen. Bis Stage 1 und Stage 2
mit originalen #5-Ergebnisdaten bestanden sind, kann kein
echter Holdout-Lauf stattfinden.

**Einschränkungen:** Die #5-Standard-CLI liefert weiterhin
nicht alle für Stage 1 nötigen DSR/PBO- und DCA-Zusatznachweise,
insbesondere solange die mehrjährige Archivdatenbasis nicht
lokal installiert ist. Die bestehenden 90-Tage-Paper- und
28-Tage-Testnet-Gates bleiben unverändert; keine dieser
Zeitspannen darf durch Fixtures ersetzt werden.
`pnpm verify` überprüft nur die Offline-Fixtures und
nicht historische Performance oder eine tatsächliche
mehrmonatige Paper-Phase. Daher ist #21 noch nicht
vollständig abgenommen.


## Sicherer Vorabcheck für einmalige Prüfungen

Neu: `pnpm pipeline:preflight --strategy <id> --version <v> --stage <1..6>`.
Der Befehl arbeitet **ausschliesslich lesend**: Er kontrolliert die eingefrorene
Quell-/Konfigurationsidentität, das noch nicht verbrauchte Stage und die
Identität eines erfolgreich absolvierten Vorgängers. Er startet **keinen**
Backtest, prüft **keine** Live-Order, liest **keine** Candle-/Holdout-Daten
und erstellt **keine** Stage-Ergebnisdatei. Er nennt die tatsächlich fehlenden
Abhängigkeiten vor einem unwiederholbaren Prüfversuch. Eine grüne Vorprüfung
ist **keine** bestandene Performance-Prüfung.

`trend-vol-target` verweist für spätere Registrierung ausdrücklich auf
`apps/server/src/strategy/trend-vol-target-v1.ts` und Hypothese H-025.
Der Provider von #4 ist zwar auf `main`, aber noch **nicht** mit dem
zeitpunktgenauen Paper-/Backtest-Context verbunden. Deshalb wird keine
fingierte `v1` mit Stufe 1 erstellt und keine Versuchsreservierung erzeugt.
Zuerst die originale Evidenzschnittstelle aus #5 und den DCA-Benchmark
nachweisen; historische Datenauswertungen sind nicht Teil dieses PRs.
