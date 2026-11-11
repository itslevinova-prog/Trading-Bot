---
name: Aufgabe
about: Aufgabe mit klaren Zuständigkeiten, Kostenregel und Definition of Done
title: ""
labels: ""
assignees: ""
---

> **💸 Kostenregel (verbindlich):** Für dieses Issue darf **kein Geld ausgegeben werden**. Keine Credits kaufen, keine kostenpflichtigen APIs oder Dienste, keine Cloud-LLMs, keine Echtgeld-Orders und keine Keys anlegen. `LIVE_ENABLED=false`, `AI_ALLOW_REMOTE=false`, `LIVE_ACK` niemals setzen. Sind kostenlose Lösungen nicht verfügbar, die Lücke dokumentieren.

> **🌙 Welle / Parallelität:** Welle **[Nummer]**, läuft parallel zu **#[Issue], #[Issue]**. Zuständigkeiten strikt einhalten und Konflikte vermeiden.

## Problem
<!-- Was funktioniert aktuell nicht oder fehlt? -->

## Ziel
<!-- Welches überprüfbare Ergebnis soll entstehen? -->

---

## Zuständigkeit (nur diese Bereiche ändern)

| ✅ Darf geändert/erstellt werden | ⛔ Nicht anfassen |
|---|---|
| <!-- konkrete Dateien/Ordner --> | <!-- Grenzen und andere Issues --> |

---

## Arbeitsanweisung Schritt für Schritt

### Schritt 1: <!-- Titel -->
<!-- Konkrete Umsetzung und erlaubte Mittel -->

### Schritt 2: <!-- Titel -->
<!-- Weitere Schritte, Testanforderungen, Fehlerbehandlung -->

---

## Definition of Done
- [ ] Alle genannten Arbeitsschritte und Tests umgesetzt
- [ ] `pnpm verify` grün (vorbestehende Fehler unverändert im PR dokumentiert)
- [ ] Keine Tests gelöscht oder deaktiviert, nichts aus `data/` gelöscht
- [ ] Ausschliesslich Dateien aus der Zuständigkeit geändert
- [ ] **Kein Geld ausgegeben**, keine kostenpflichtigen Dienste, keine Echtgeld-Orders und keine Keys verwendet
- [ ] Änderungen und Entscheidungen im Draft-PR nachvollziehbar dokumentiert

## Arbeitsweise für unbeaufsichtigte KI-Sessions
- Keine Rückfragen: Bei Unklarheit die einfachste robuste Lösung wählen und im PR unter «Entscheidungen» begründen.
- Ein Issue pro Session, eigener Branch, kleine Commits, am Ende ein **Draft-PR**.
- Die Kostenregel und die Zuständigkeiten sind verbindlich; keine fremden Issue-Bereiche ändern.
- `pnpm verify` ausführen; Tests nie löschen oder deaktivieren und keine vorhandenen Daten löschen.
- Fehler, nicht getestete Annahmen und offene Risiken im PR dokumentieren.
