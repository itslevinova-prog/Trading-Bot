# Lernlabels für abgeschlossene Paper-Positionen

`policy-labels-v1` berechnet das Nettoergebnis einer vollständig geschlossenen simulierten Position aus den bereits geprüften Replayfills. Die Einstandsbasis enthält die Kaufgebühr; der Verkaufserlös wird um die Verkaufsgebühr gekürzt. Dataset, Replaybuild, Entscheidungscode und Kostenszenario bestimmen gemeinsam den Geltungsbereich jedes Labels.

## Verfügbarkeit und unbekannte Ergebnisse

- `entryFeatureClosedAt` liegt spätestens am Beginn der Einstiegskerze.
- `modeledAvailableAt` liegt fünf Sekunden nach dem Schluss der Ausstiegskerze. Das ist eine ausdrücklich angenommene historische Verfügbarkeit; tatsächliche frühere Empfangszeiten wurden nicht beobachtet.
- `materializedAt` dokumentiert getrennt, wann das Artefakt tatsächlich erstellt wurde.
- Historische Abrufe verlangen `mode: historical-simulation` und berücksichtigen nur zu diesem simulierten Zeitpunkt verfügbare Ergebnisse. Die Live-Memory bleibt unverändert.

Offene Positionen und eine künstliche Liquidation am Ende des Testfensters erhalten keine trainierbare Klasse oder Rendite. Fehlende Zukunftswerte bleiben unbekannt. Scale-ins, Teilverkäufe, ungepaarte Exits und widersprüchliche Nettoarithmetik werden abgewiesen. Gleiche Episoden zählen innerhalb eines Geltungsbereichs einmal; unterschiedliche Strategie- und Kostenstände werden getrennt gehalten.

Noch nicht verfügbare Ergebnisinhalte beeinflussen auch die Validierung eines früheren Trainingsabrufs nicht. Sobald das betreffende Ergebnis verfügbar wäre, werden fehlerhafte Daten abgewiesen. Dieser Randfall wurde zunächst durch einen fehlschlagenden Test reproduziert und anschließend behoben.

## Tatsächlich erzeugte Daten

Quelle ist der unveränderte historische Vergleich `7e873da8`. Die Gruppen werden einzeln ausgewertet:

| Szenario | Variante | Abgeschlossene Episoden | Gewinn / Verlust |
|---|---|---:|---:|
| Basis | Mock-v1 | 54 | 10 / 44 |
| Basis | Mock-v2 | 39 | 6 / 33 |
| Doppelte Gebühren, adaptive Freigaben | Mock-v1 | 4 | 2 / 2 |
| Doppelte Gebühren, adaptive Freigaben | Mock-v2 | 3 | 1 / 2 |

Diese 100 Datensätze umfassen überlappende, korrelierte Trades verschiedener Versionen und Kostenannahmen. Sie sind keine 100 unabhängigen Lernbeispiele. Das Artefakt wurde zweimal erzeugt beziehungsweise verifiziert, mit demselben Facts-Hash `36f127c80f92ffe0fdd2ebccdad6c57adb9a61c78b516d35808c424c04efab0d`. Der zweite Lauf überschreibt die erste Materialisierung nicht.

Bei den Basisvarianten haben 36 von 54 beziehungsweise 29 von 39 Positionen einen aus den Kerzen berechneten Haltezeit-Oberwert über vier Stunden. Die Mediane dieser Oberwerte betragen 7,25 und 8,5 Stunden, das Maximum jeweils 26,75 Stunden. Die Werte beschreiben keine exakten Intrabar-Fillzeiten. Ein fixes Vierstunden-Preislabel beantwortet daher eine andere Frage als das vollständige Strategieergebnis.

An den vier zeitlichen Stichtagen stehen für Mock-v1 nur 16 / 28 / 43 / 54 reife Ergebnisse zur Verfügung; für Mock-v2 sind es 11 / 18 / 29 / 39. Die spätere Gesamtzahl darf nicht in frühere Trainingsfenster zurückgetragen werden.

Ein konstanter Klassifikator, der immer Verlust vorhersagt, hätte auf den Basisdaten bereits 81,48 % beziehungsweise 84,62 % Genauigkeit. Diese Zahlen sind lediglich die größten Klassenanteile; ein solches Modell wurde nicht trainiert. Daraus folgen weder eine Fähigkeit zum Erkennen profitabler Einstiege noch kalibrierte Wahrscheinlichkeiten. Die FreqAI-Beispiele und ihre Score-Metrik sind mit Primärquellen in `upstream-research/REVIEW-PASS5.md` eingeordnet.

## Prüfung und nächste Arbeit

16 neue gezielte Fälle prüfen Zeitgrenzen, Nettoarithmetik, Zensierung, Duplikate, getrennte Geltungsbereiche und spätere Ergebnisänderungen. Die gesamte Suite besteht mit 758 Haupttests und 15 Offline-Tests; Source-, Test- und Web-Typchecks sowie Build sind ebenfalls erfolgreich. Build: `4e804c12af50f8d9fda9791c5c74af2774659315ba5493bda11f05a81e22e121` mit 101 Source- und 91 Runtime-Dateien.

Als Nächstes müssen die Labels kausal mit den ursprünglichen Einstiegsfeatures, Marktregimen und Kostenbelegen verknüpft werden. Trainingsfenster müssen bis zur konkreten Ergebnisverfügbarkeit bereinigt werden. Die Daten enthalten nur tatsächlich von den jeweiligen Prototypen ausgewählte Trades; nicht gehandelte Gelegenheiten sind damit nicht bewertet.

Es wurde kein Modell trainiert, keine Wahrscheinlichkeit abgeleitet und keine Strategie automatisch aktiviert. Die bisherigen Studien bleiben verlustreich oder nicht robust. Bereits eingesehene Historie bleibt Entwicklungsdaten. Das Ziel von mindestens 100 produktiven Stunden und die breitere Untersuchung der drei Open-Source-Projekte sind weiterhin offen.
