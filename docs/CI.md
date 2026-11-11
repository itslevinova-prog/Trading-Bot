# CI: automatische PR-Prüfung

Der Workflow [`verify.yml`](../.github/workflows/verify.yml) startet bei jedem **Pull Request** (unabhängig vom Zielbranch) sowie bei **Pushes auf `main`**. Neue Commits brechen ältere Läufe desselben Refs ab. Er nutzt ausschliesslich kostenlose GitHub-hosted Standard-Runner (`ubuntu-latest`) und kostenlose Open-Source-Actions, keine CI-Secrets und keine kostenpflichtigen externen Dienste.

## Was wird geprüft?

- **`verify`**: Node.js 22, pnpm 11.25.0 per Corepack, pnpm-Store-Cache, `pnpm install --frozen-lockfile` und `pnpm verify` (Typecheck, Tests, Offline-Tests, Build). Laufzeitlimit: **20 Minuten**.
- **`cost-guard`**: schneller Shell-Check **ohne Installation von Node-Paketen**. Er blockiert versionierte `.env`-Dateien, gefährliche Werte in `.env.example` (`LIVE_ENABLED`, `AI_ALLOW_REMOTE`, `LIVE_ACK`), nicht nachweisbar sichere Config-Defaults und typische versehentlich committete Schlüssel/PEM-Private-Keys. Laufzeitlimit: **3 Minuten**. Es werden keine gefundenen Schlüsselwerte in Logs ausgegeben.

Der `LIVE_ENABLED`-Standard liegt aktuell **nicht** in `apps/server/src/config.ts`, sondern in `.env.example`. Der Guard prüft dort `LIVE_ENABLED=false`; sollte `LIVE_ENABLED` später in `config.ts` ergänzt werden, muss dort ein explizites Zod-`.default('false')` dem erwarteten Format entsprechen. Auch `AI_ALLOW_REMOTE` wird in der Config auf diesen sicheren Standard geprüft. Bei geändertem Format scheitert der Check absichtlich konservativ; dann muss er bewusst angepasst werden. Die Muster erkennen typische Leaks, **ersetzen aber keine vollständige Secret-Prüfung**.

## Rotes Ergebnis lesen

Im PR auf **Checks → Details** klicken. Den fehlgeschlagenen Job (`verify` oder `cost-guard`) und seinen ersten fehlerhaften Schritt öffnen. `::error::` im Guard erklärt auf Deutsch, welche Regel verletzt wurde, ohne Schlüsselwerte zu zeigen. Beim `verify`-Job den eigentlichen Fehler aus Typecheck/Test/Build ansehen. Einen bereits vor dem PR bestehenden, möglicherweise netzwerkabhängigen Test **nicht deaktivieren**: Fehler im PR dokumentieren und ein Folge-Issue vorschlagen.

## Gratis-Kontingent

Für dieses **private Repository** ist gemäss Issue #16 mit **2'000 GitHub-Actions-Minuten pro Monat** zu planen; andere Workflows zählen mit. Als **grobe Schätzung, nicht als gemessener Wert**, benötigt ein kompletter Lauf mit Cache etwa **5–10 abrechenbare Runner-Minuten** für beide Jobs zusammen. Das entspräche rein rechnerisch **200–400 Läufen pro Monat**, sofern es keine weiteren Actions-Läufe gibt. Die Limits liegen bei 20 + 3 = **23 Runner-Minuten je Lauf** (bei maximaler Ausschöpfung also nur rund **86 vollständige Läufe**). Tatsächliche Werte in **Actions → Workflow runs** prüfen und bei Bedarf Cache/Laufhäufigkeit optimieren. GitHub kann Abrechnung und Freikontingente ändern; die angezeigte Nutzung im Konto ist massgeblich.

**Falls Actions deaktiviert ist:** Die Repository-Besitzerin oder der Repository-Besitzer muss es einmal unter **Settings → Actions** aktivieren. Erst dann sind grüne CI-Checks nachweisbar.

## Integritätsprüfung für gespeicherte Pipeline-Stages (#77)

Nach lokalem Backup/Restore kann **ausschliesslich lesend** geprüft werden:

~~~sh
pnpm pipeline:verify-integrity
~~~

Der Befehl liest nur `docs/strategies/registry.json` und vorhandene Stage-Berichte. Für jede reservierte Stage verifiziert er Identität, Schema, Status und Checks, Code-/Config-Hashes, Evidenzhash-Format und den SHA-256-Integritätsanker in der Registry. Fehlende, beschädigte oder nicht durch den Registry-Anker versiegelte ältere Stage-Berichte führen zu einem `blocked`-Ergebnis (Exitcode 1). **Es wird nichts neu gerechnet, überschrieben oder repariert**, insbesondere weder Validierung noch Holdout. Ein Legacy-Bericht ohne unabhängige Verankerung wird nicht durch blosses Lesen nachträglich als verifiziert ausgewiesen. Für solche Fälle ist eine separat dokumentierte manuelle Sicherungsprüfung erforderlich.

## Ungeklärte Pipeline-Versuche (#78)

Ein Stage-Versuch wird **vor** der Ausführung inklusive Reservierungszeitpunkt dauerhaft in der Registry markiert. Ein Prozessabbruch zwischen dieser Reservierung und dem create-only Stage-Bericht hinterlässt eine endgültig verbrauchte, **ungeklärte** Stage. Die konkrete Abbruchursache ist ohne einen Abschlussbericht unbekannt und wird nicht erfunden.

Die Befehle `pnpm pipeline:preflight --strategy ... --version ... --stage ...`, `pnpm pipeline:status` und `pnpm pipeline:incidents` zeigen den Zustand ohne Datenzugriff oder Änderungen. Die Vorfallsansicht gibt eine stabile JSON-Fingerprint und Exitcode 2 bei ungeklärten Reservierungen zurück. Eine verbrauchte Validierung oder ein verbrauchter Holdout kann **nicht** erneut gestartet oder still zurückgesetzt werden. Forschung darf nur mit einer neu registrierten, unabhängig geprüften Strategieversion fortgesetzt werden; die alte Vorfallhistorie bleibt unverändert.

## Rechenabgleich der Paper-Konten (#74)

Zur lokalen, **datenbankseitig rein lesenden** Kontrolle nach Neustart oder Restore:

~~~sh
pnpm paper:reconcile
~~~

Der Befehl öffnet ausschliesslich die vorhandene Paper-SQLite-Datei lesend und berechnet pro Konto aus den zeitlich sortierten Trade-Fills und (für das DCA-Konto) den tatsächlich gespeicherten Einzahlungen **Cash, Positionen, Gebühren und Kostenbasis** neu. Ein SHA-256-Snapshot-ID und alle Abweichungen werden als neues, nach Fingerprint benanntes lokales JSON unter `data/paper-reconcile/` abgelegt. Kein Eintrag im Handelsjournal und keine Position wird korrigiert; unvollständige Herkunft ergibt einen gesperrten Status. Auch ein an sich passender Cash-Wert kann keine fehlenden Fills beweisen. Peak-Equity und historische Orderbücher lassen sich aus Fills allein nicht unabhängig rekonstruieren.

Beim Start des Paper-Adapters wird dieselbe Prüfung für alle Konten ausgeführt. Bei Abweichungen wird eine separate, **dauerhafte Entry-only-Sperre** mit Fehlercode und Snapshot-Hash in `paper_reconcile_blocks` festgehalten; jeder Kauf prüft erneut, auch nach der simulierten Latenz. **Schutzverkäufe und andere Verkäufe werden durch diese Sperre nicht blockiert.** Die Sperre wird nicht bei der nächsten Prüfung automatisch gelöscht. Eine nachweislich geprüfte, manuelle Aufarbeitung ist vor einer späteren Freigabe erforderlich; dieses Issue liefert ausdrücklich keinen Reset-/Bypass-Schalter.

CI-Tests verwenden ausschliesslich temporäre SQLite-Fixtures: korrekte und manipulierte Cash-/Positionswerte, DCA-Einzahlungen, fehlendes Journal und einen unterbrochenen Schreibvorgang. Es werden keine echten Konten, Schlüssel, Marktdaten oder Echtgeldorders verwendet.
