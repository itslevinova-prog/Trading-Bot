# Verbindliche Regeln für alle KI-Sessions

**Kostenregel: kein Geld ausgeben, keine Credits kaufen, keine kostenpflichtigen APIs oder Dienste, keine Cloud-LLMs, keine Echtgeld-Orders, keine Keys anlegen, `LIVE_ENABLED=false`, `AI_ALLOW_REMOTE=false`, `LIVE_ACK` nie setzen.**

## Git-Identität (Datenschutz)

**Vor jedem Commit** diese Identität setzen, damit weder echter Name noch private E-Mail-Adressen in Commits landen:

```bash
git config user.name "itslevinova-prog"
git config user.email "353031426+itslevinova-prog@users.noreply.github.com"
```

- Vor dem Push mit `git log -1 --format='%an <%ae> / %cn <%ce>'` prüfen: Es dürfen nur `itslevinova-prog` und die Noreply-Adresse erscheinen (Ausnahme: der Bot-Account des jeweiligen KI-Tools, z. B. `Claude <noreply@anthropic.com>`).
- Niemals echte Namen, private oder geschäftliche E-Mail-Adressen, lokale Benutzerpfade (z. B. `C:\Users\<name>`) oder Links zu privaten Chats in Dateien, Commits, PR-Texte, Issues oder Kommentare schreiben. Das gilt auch für Attributionszeilen: **keine Session- oder Chat-Links** (z. B. `Claude-Session: …`) in Commit-Nachrichten oder PR-Beschreibungen.
- **Dieses Repository ist öffentlich.** Alles, was hier landet, kann jeder lesen. Der Besitzer wird nur als „Repo-Besitzer“ bezeichnet.
- Der **Datenschutz-Wächter** (`.github/workflows/privacy-guard.yml`) prüft jeden PR, jeden Push auf `main` sowie Issues und Kommentare automatisch. Lokal vor dem Push ausführen: `node .github/privacy-guard/check.mjs`. Private Wörter stehen nur im GitHub-Secret `PRIVACY_BLOCKLIST` und dürfen nie in Dateien, Hashes, Logs oder Texte geschrieben werden. Ein Fund muss behoben werden, nicht umgangen; die Regeln nicht abschwächen.

## Projektüberblick

- **Issue-Nummern:** Ältere Dokumente, Code-Kommentare und Commits nennen Issues/PRs mit den Nummern des früheren privaten Arbeits-Repos. Die Zuordnung zu den aktuellen Issues steht in [`docs/ISSUE-MAP.md`](docs/ISSUE-MAP.md). Neue Texte verwenden nur noch die aktuellen Nummern.

- `apps/server`: Backend, Paper-Trading und Ausführungslogik.
- `apps/web`: Weboberfläche.
- `packages/shared`: gemeinsame Typen und Logik.
- `scripts`: lokale Prüf-, Forschungs- und Betriebswerkzeuge.
- `docs`: Dokumentation, Studien und unveränderte JSON-Belege.
- `data`: lokale Daten und Forschungsartefakte; niemals löschen.
- **Paper**: simulierte Orders ohne echtes Geld; Standardmodus.
- **Testnet**: getrennte Übungsumgebung ohne Echtgeld-Orders.
- **Live**: Echtgeldbetrieb; gesperrt und nicht aktivieren.
- Ergebnisbelege, Protokolle und Holdout-Grenzen müssen nachvollziehbar bleiben.

## Befehle

- `pnpm install`
- `pnpm verify` (typecheck + test + test:offline + build)
- `pnpm start`

## Arbeitsregeln

- **Eine Session = ein Issue.** Zuständigkeit und Sperrbereiche des jeweiligen Issues strikt beachten.
- Routineentscheidungen ohne Rückfragen treffen und im Draft-PR unter **Entscheidungen** dokumentieren.
- Für jedes Issue einen eigenen Branch verwenden und am Ende einen **Draft-PR** erstellen.
- Tests niemals löschen, umgehen oder deaktivieren; bestehende Prüfungen ausführen.
- Nichts aus `data/` löschen; Belege und Archivmaterial erhalten.
- Keine Mikro-Audits ohne Bezug zu einer registrierten Hypothese.

## Forschungsregeln

- Jede neue Studie referenziert eine Hypothesen-ID aus [`docs/research/hypotheses.json`](docs/research/hypotheses.json).
- Holdout-Daten nur mit protokolliertem, überprüfbarem Grund verwenden.
- Ideen verwerfen, deren **Brutto-Vorteil weniger als das Doppelte der Roundtrip-Kosten** beträgt (≥ 2× als Mindesthürde).
- Negative Resultate, Stichprobengrößen, Gebühren und Varianten vollständig und ehrlich dokumentieren.

## Sprache

- UI und Dokumentation: **Deutsch mit korrekten Umlauten**.
- Code und Kommentare im Code: **Englisch**.
