# Issue #44 – Einmalige 2024-Validierung: technische Vorbereitungen

**Stand:** Noch **keine** 2024-Validierung ausgeführt oder freigegeben. Die
Einmal-Sperre ist als überprüfbarer, lokaler Baustein vorhanden. Der vollständige
Stage-2-Runner und die GitHub-Actions-Integration sind **noch nicht** umgesetzt.

## Unverhandelbare Voraussetzungen

1. Entwicklungsergebnisse der Kandidaten, insbesondere v5.1, müssen aus
   **2020–2023** vollständig vorliegen. v5.1 ist bisher lediglich implementiert,
   aber nicht historisch ausgewertet. Die Ergebnisse gehören in Issue #3.
2. **Vor** dem ersten Zugriff auf 2024 muss im Issue **#44** genau **ein**
   Kandidat (`v5` oder `v5.1`) und dessen vier Profile dokumentiert und
   mit einem unveränderlichen Entwicklungsbeleg verknüpft werden.
3. Vorab definierte Kriterien: **Max-Drawdown unter 30 %** und
   **Calmar besser als BTC/ETH 50/50 Halten**. Keine Parameteränderung
   nach der 2024-Einsicht. Die ausgewählte Variante muss die regulären
   Pipeline-Gates für Stage 2 erfüllen.
4. Der Zeitraum ist ausschliesslich 2024-01-01 bis 2024-12-31,
   mit höchstens **2023 als Indikator-Vorlauf**, keinesfalls 2025+.
5. Ein verbrauchter Versuch darf **nie** wiederholt werden, auch
   nicht nach einem technischen Fehlschlag. Negative Ergebnisse werden
   unverändert veröffentlicht.

## Aktueller Schutzbaustein

`apps/server/src/pipeline/validation-2024-guard.ts` validiert die
unveränderte `docs/data-splits-v1.json`, die feste Vorregistrierung,
den einzelnen Kandidaten, die vier Profile und beide Erfolgskriterien.
`claimValidation2024Once` legt einen irreversiblen Marker mit
create-only-Dateiflag (`wx`) an. Tests prüfen Zweitversuche und
abweichende Zeiträume. Die Guard-Funktion liest **keine** historischen Kerzen.

Ein lokaler Marker allein **reicht bei GitHub Actions nicht aus**, weil
jede Ausführung einen neuen temporären Runner bekommt. Die Funktion `reserveValidation2024InRepository` erstellt den Marker
**serverseitig atomar im Repository** über die GitHub Contents API
(Create ohne vorhandene SHA) und lehnt eine erneute Reservierung ab.
Sie ist bewusst noch mit **keinem** Job verbunden und wurde **nicht**
gegen die reale API aufgerufen: Sie muss vor dem ersten 2024-Download
und nur nach Besitzerfreigabe mit `contents:write` in eine separate,
serialisierte Stage-2-Aktion eingebaut werden. Ein einfaches `exists`
vor dem Import wäre keine sichere Einmal-Sperre.

## Noch zu tun (kein stillschweigender Done-Status)

- Vorregistrierung im Issue nach Abschluss der v5.1-Entwicklungsdiagnose.
- Daten-/Ausführungspfad für exakt vier Profile der gewählten Version
  in 2024, ohne die 2020–2023-Ergebnisse zu ändern.
- Verdrahtung der vorbereiteten atomaren GitHub-Repository-Sperre, Stage-2-Pipeline-Prüfung,
  Eingabe `run_validation_2024`, unveränderliche Berichtserzeugung
  und Kommentar in #44 und #3.
- Erst dann darf der Repo-Besitzer den einen Validierungslauf explizit starten.

**Kein automatischer 2024- oder 2025-Zugriff. Keine Paper-/Echtgeld-Freigabe.**
