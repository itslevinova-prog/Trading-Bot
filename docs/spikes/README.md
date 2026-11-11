# Trend-1d-Spike – Issue #33

**Status: Skript implementiert, nicht ausgeführt.** Die beiden
Ergebnisdateien werden bewusst erst nach einem tatsächlich vorliegenden
und überprüften kostenlosen lokalen Archiv erzeugt:

- `docs/spikes/trend-1d-2020-2023.json`
- `docs/spikes/TREND-1D-SPIKE.md`

Nur Entwicklungszeitraum **2020-01-01 bis 2023-12-31** (Ende exklusiv
`2024-01-01T00:00Z`). Kein Datenabruf ab 2024, kein Holdout und
keine neue Abhängigkeit.

Für den späteren einmaligen lokalen Ausführungslauf lautet der Befehl
`pnpm trend:spike`. **In diesem PR nicht ausführen.** Vor dem Ausführen
sicherstellen, dass ArchiveCandleSource die vollständige tägliche
BTCUSDT-/ETHUSDT-Serie enthält. Das Skript stoppt bei einer Lücke,
ohne Ergebnisse zu schreiben. Bereits vorhandene Ergebnisse mit anderem
Inhalt werden niemals überschrieben.

Die Varianten, Benchmark-Definitionen, Kosten und Entscheidung 🟢/🟡/🔴
sind im Code fixiert. H-026 ist als **offen, 0 tatsächlich getestete
Varianten** registriert. Erst ein verifizierter echter Report darf den
Zähler auf 3 ändern und die Entscheidung ins Register übernehmen.

Nur die separat ausführbaren **netzfreien Unit-Tests** werden in
`pnpm verify` aufgenommen. Der eigentliche Archiv-Schnelltest ist nicht
Teil der CI.
