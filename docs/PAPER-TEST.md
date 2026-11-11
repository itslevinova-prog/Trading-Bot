# Kostenloser Paper-Test

Öffne **http://127.0.0.1:3000/**. Auf der Übersicht steht „Paper-Test mit Spielgeld“.

1. „Paper-Test starten“ aktiviert das simulierte KI-Konto und prüft sofort die aktuellen Marktdaten.
2. Danach prüft die Strategie automatisch alle15Minuten. „Jetzt prüfen“ löst eine zusätzliche Prüfung aus.
3. „Kein Trade“ ist eine gültige Entscheidung. Begründungen stehen direkt im Testbereich und vollständig unter „Entscheidungen“. Tatsächliche simulierte Fills stehen unter „Trades“; abgewiesene Orders bleiben sichtbar.
4. „Pausieren“ verhindert neue KI-Einstiege. Schutzverkäufe für offene Positionen bleiben aktiv.
5. Unter „Einstellungen“ kannst du Safe/Risky und die Stop-Loss-Linie speichern. Das vorhandene Spielgeld und die bisherige Historie werden nicht zurückgesetzt.

Die Teststrategie ist programmiert/simuliert und verwendet **kein externes KI-Modell und keinen API-Key**. Sie nutzt öffentliche Binance-Kurse; Käufe/Verkäufe, Gebühren und Slippage werden mit Spielgeld berechnet. Ein prognostiziertes Signal erzwingt keinen Kauf: Datenfrische, Kosten, Positionsgröße, Tages-/Pausenlimits, Stop-/Drawdown-Risiko und tatsächliche Orderbuchtiefe werden weiterhin geprüft. Keine Gewinnzusage.

Nach einem PC-Neustart im Projektordner `pnpm paper:test` ausführen, dann die lokale Adresse öffnen. Der Befehl verwendet einen vorhandenen passenden Prozess weiter oder startet das gespeicherte kostenlose Paper-Profil nach einem beendeten Prozess. Er beendet niemals automatisch einen anderen laufenden Hauptprozess. Das Profil erzwingt Mock/keine Remote-KI/keine Schlüssel/kein Echtgeld; die eingefrorene Forschungsreferenz bleibt getrennt. Der PC und der lokale Server müssen für den Test laufen.

Technisch nutzt der Tester den vorhandenen Scheduler, die vorhandene Entscheidungsspeicherung, Trading-Profile und den Paper-Broker. Eine manuelle Prüfung betrifft ausschließlich das KI-Paper-Konto; Regeln-/Buy-and-Hold-Historie wird dabei nicht neu ausgewertet oder gelöscht. Manuelle Prüfungen sind gegen doppelte Klicks/parallel laufende Zyklen geschützt. Es gibt keine manuelle Kauf-Schaltfläche, die Schutzregeln umgeht.
