# Einstiegsmerkmale und spätere Nettoergebnisse

`policy-entry-inputs-v1` verbindet die vorhandenen Ergebnislabels mit kausal erneut erfassten Einstiegsmerkmalen. Die ursprünglichen Live-Eingaben wurden damals nicht aufgezeichnet. Die Daten stammen aus einer Wiederholung derselben historischen Simulation und sind entsprechend gekennzeichnet.

## Nachweis der Gleichheit

Vor der Wiederholung werden 13 ausführungsrelevante JavaScript-Abhängigkeiten gegen den archivierten Studienbuild `93002bbc` bytegenau geprüft: Replay, Kontextproduktion, Indikatoren, Fenster-/Strukturberechnung, Risikoregeln, Policy, Ausführungsgrenzen und gemeinsame Datentypen. Beide Entscheidungsmodule stimmen mit ihren aufgezeichneten Hashes überein.

Für jede der vier Gruppen wird anschließend das gesamte Replayergebnis einschließlich Fills, Gebühren, Kurve, Ausstiegsgründen und Annahmen gegen den unveränderten Ergebnisbericht `7e873da8` verglichen. Alle vier Ergebnisse sind exakt gleich. Nur tatsächlich ausgeführte Einstiege werden den Labels zugeordnet; Modellvorschläge, die an Ausführungs- oder Risikolimits scheitern, erhalten kein erfundenes Tradeergebnis.

| Szenario | Variante | Erfasste Kaufvorschläge | Zugeordnete ausgeführte Einstiege |
|---|---|---:|---:|
| Basis | Mock-v1 | 67 | 54 |
| Basis | Mock-v2 | 47 | 39 |
| Doppelte Gebühren | Mock-v1 | 5 | 4 |
| Doppelte Gebühren | Mock-v2 | 3 | 3 |

Die Erfassung wurde vollständig wiederholt. Beide Läufe liefern den Facts-Hash `ea2bb7642d52d94f9e99742930aa4fe875f5c95ae1ef10624609a834dc0de66d`. Das bestehende Artefakt wird beim zweiten Lauf verifiziert und nicht überschrieben. Die 100 Datensätze überschneiden sich zwischen Strategien und Kostenannahmen; sie sind keine unabhängigen Stichproben.

## Eingaben und Ziel bleiben getrennt

Die feste Liste enthält 21 mögliche Markt-, Struktur- und Kostenmerkmale: RSI, EMA-Abstände, vergangene Preisänderungen, ATR, Volumenverhältnis, Spread, Gebühren, Slippageannahmen, Richtungseffizienz, Abstände zu vorheriger Unterstützung und Widerstand, BTC-Korrelation sowie beobachtete Ausbruchs-/Wickzustände.

Fehlende Struktur oder Korrelation bleibt `null`; ein bekanntes falsches Flag bleibt `0`. Unmögliche numerische Werte werden abgewiesen. Spätere Rendite, Ausstiegszeit, Verfügbarkeit des Ergebnisses und beliebige zusätzliche Kontextfelder gehören nicht zum Merkmalsvektor. Der vollständige Produktionskontext bleibt erhalten; dieser Forschungsdatensatz ist eine ausdrücklich begrenzte Auswahl für spätere Modelle.

Zuordnungsschlüssel sind Einstiegsbalken, Paar, Schlusszeit der zugrunde liegenden Features und exakter Versions-/Kostengeltungsbereich. Historische Trainingsabrufe verwenden zuerst die bestehende zeitliche Label-Freigabe und validieren anschließend nur die tatsächlich verfügbaren Eingaben. Eine spätere beschädigte Eingabe kann dadurch einen früheren Trainingsabruf nicht beeinflussen. Skalierung, Imputation und Klassenwichtungen müssen später ausschließlich aus dem jeweiligen zulässigen Trainingspräfix gelernt werden.

## Grenzen und nächste Arbeit

15 neue gezielte Tests prüfen die Whitelist, analytische Einheiten, zeitliche und versionsbezogene Zuordnung, unbekannte Werte, Duplikate, spätere Änderungen und unmögliche Werte. Die Gesamtsuite besteht mit 773 Haupttests plus 15 Offline-Tests; Typchecks und Build sind erfolgreich. Es wurde kein Modell trainiert oder aktiviert und keine Live-Memory verändert.

Die bekannten historischen Verluste bleiben unverändert. Der Datensatz enthält nur Gelegenheiten, die die damaligen Policies tatsächlich ausgewählt und ausgeführt haben. Kleine und korrelierte Gruppen mit bis zu 21 Merkmalen erlauben keine Behauptung zuverlässiger Vorhersagen. Als Nächstes folgen ein festgelegter zeitlicher Trainings-/Validierungsvertrag mit Bereinigung bis zur konkreten Ergebnisverfügbarkeit sowie nur dann ein lokales Lernexperiment, wenn die Daten dafür ausreichen.

## Unterbrechung und Paperbetrieb

Die mehrstündige Unterbrechung am 31.10.2026 wird nicht als aktive Entwicklungszeit gezählt. Der Haupt-Paperdienst wurde nach bestätigtem Prozessende mit seiner vorhandenen Datenbank wieder aufgenommen. Eine Erfassung während der Lücke wurde nicht nachsimuliert.

Der getrennte eingefrorene Vergleich konnte nicht mit demselben Vertrag fortgesetzt werden: Die neue Volumenauswahl enthielt APT/RENDER statt POL/VET. Die Universumsprüfung sperrte Einstiege; der eindeutig identifizierte Wiederaufnahmeprozess wurde beendet. Alter Vertrag, Baseline, Fills, Beobachtungen und ursprünglicher Quellstand bleiben erhalten. `mock-v2-resume-universe-drift.json` dokumentiert die Abweichung. Ein erneuter Start dieses beendeten Versuchs wird vor Prozessstart abgewiesen. Für einen künftigen Versuch muss eine feste Marktauswahl vorab registriert werden; geänderte Handelsmetadaten dürfen dabei nicht versteckt werden.
