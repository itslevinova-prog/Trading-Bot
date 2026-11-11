# Steuer-Export (Paper-Trades)

> **Keine Steuerberatung.** Diese Anwendung exportiert ausschliesslich **simulierte Paper-Daten (Spielgeld)**. Sie berechnet keine Steuern, reicht keine Unterlagen ein und trifft keine rechtliche Einordnung als privates oder gewerbliches Trading.

## Kostenlos und lokal

Der Export liest nur die eingestellte Paper-SQLite-Datenbank und schreibt ausschliesslich nach **data/exports/**. Die Daten werden nicht hochgeladen. Es werden keine kostenpflichtigen Steuerdienste, APIs, Abonnements oder Credits verwendet. Die einzige externe Datenquelle ist die kostenlose [EZB-Wechselkurshistorie](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip).

Beim ersten benötigten Währungsumtausch wird das EZB-Archiv nach **data/fx/eurofxref-hist.zip** heruntergeladen und dort zwischengespeichert. Nachfolgende Exporte verwenden den Cache offline. Fehlen Cache und Netzwerk, wird ein klarer Fehler ausgegeben. Der gesamte data-Ordner ist gitignored.

## CLI

    pnpm export:tax --year 2026 --currency CHF --method fifo
    pnpm export:tax --year 2026 --currency EUR --method average --account rules --delimiter ";"

| Parameter | Werte | Standard |
| --- | --- | --- |
| --year | Kalenderjahr | laufendes Jahr |
| --currency | CHF oder EUR | CHF |
| --method | fifo oder average | fifo |
| --account | Paper-Konto-ID | alle |
| --delimiter | Semikolon, Komma oder Tabulator | Semikolon |

Ausgabepfad: **data/exports/tax-JAHR-KONTO-WAEHRUNG-paper/**. Das Netzwerk ist damit im Ordnernamen und zusätzlich in allen Datenzeilen gekennzeichnet.

Die fünf Dateien sind:

- **trades.csv:** Buchungen einschliesslich Startkapital-Einzahlung (simuliert), Original- und Zielwährungsbeträge.
- **realized-gains.csv:** Gewinne/Verluste für jeden Verkauf und die verwendeten Kauf-Lots.
- **holdings-JAHR-12-31.csv:** Bestände per 31.12., 23:59:59 Europe/Zurich (Cash und Kryptowährungen).
- **summary.json:** Anzahl Trades, Umsatz, Gebühren, realisierte Gewinne, durchschnittliche Haltedauer, Cash- und PnL-Abgleich.
- **LIESMICH.txt:** Verwendete Methode, Annahmen und der Hinweis *keine Steuerberatung*.

Die CSVs verwenden **UTF-8 mit BOM**, standardmässig **Semikolon**, Dezimalpunkt und ISO-8601-Zeitstempel.

## Wichtige Spalten

| Spalten | Bedeutung |
| --- | --- |
| account, accountName, network, exchange | Konto und Herkunft aus gespeicherter DB-Identität |
| event, ts, tradeId, side, pair, base, quote | Buchungstyp, Zeitpunkt, Trade und Markt |
| qty, price, gross, fee, feeCurrency | Original-Menge, Ausführungskurs, Bruttobetrag und Gebühren in Quote-Währung |
| netCashDelta | Veränderung des Cash-Bestands in Quote-Währung |
| grossConverted, feeConverted, netCashDeltaConverted | Umgerechnete Transaktionswerte |
| fxRate, fxDate, fxSource, fxNote, targetCurrency | Kurs je Quote-Einheit, verwendetes Datum, Kursquelle, Annahmen, Zielwährung |
| strategy, reason | Strategie und ursprüngliche Buchungsbegründung |
| proceeds, costBasis, gain, gainConverted | Verkaufserlös nach Gebühr, Kostenbasis einschliesslich Kaufgebühr und Gewinn |
| holdingDays, lotsUsed | Mengengewichtete Haltedauer und einzelne zugeordnete Kauf-Lots |
| storedPnl, ledgerDifference, pnlReconciled | Vergleich mit gespeichertem Broker-Gewinn und Abgleichstatus (Toleranz 1e-6) |
| asset, isCash, value, priceDate, priceSource, valueConverted | Jahresend-Coin/Cash, Originalwert, verwendeter geschlossener Candle-Kurs, Quelle und Zielwert |
| disclaimer | Paper-Daten (Spielgeld), keine Steuerberatung |

Frei wählbare Texte werden CSV-korrekt escaped. Spreadsheet-Formeln aus Textfeldern werden neutralisiert.

## Kostenbasis und Abgleich

Vor den Verkäufen eines Exportjahres werden **alle früheren Trades seit Kontoeröffnung** chronologisch berücksichtigt. FIFO verbraucht zuerst ältere Kauf-Lots; die Durchschnittsmethode verteilt die Kostenbasis proportional auf die vorhandenen Kauf-Lots. Kaufgebühren erhöhen die Basis und Verkaufsgebühren mindern den Erlös. Teilverkäufe werden korrekt über die betroffenen Lots aufgeteilt.

Der aktuelle Paper-Broker rechnet **mit Durchschnittskosten**. Bei FIFO darf es daher eine sachlich begründete Abweichung zum gespeicherten Feld **realizedPnlEur** geben. Die Abweichung wird pro Verkauf in CSV und summary.json ausgewiesen, niemals stillschweigend als korrekt deklariert. Nicht gespeicherte PnL-Werte zählen nicht als abgeglichen.

Cash wird aus simuliertem Startkapital plus allen Käufen/Verkäufen rekonstruiert. Bei einem noch nicht abgeschlossenen Steuerjahr wird der erwartete Cash-Bestand mit accounts.cash verglichen. Für frühere Jahre wäre dieser Vergleich mit dem heutigen Cash falsch; deshalb steht dann actual auf null. Abweichungen werden explizit ausgewiesen.

## EZB, Stablecoins und Kursbewertung

Die EZB-Kurse basieren auf EUR. Währungsumrechnungen in CHF oder EUR verwenden die EZB-Kreuzkurse am oder vor dem Buchungsdatum. An Wochenenden und Feiertagen wird der letzte ältere verfügbare Kurs benutzt. Bei fehlendem Kurs wird der Export mit klarem Fehler abgebrochen.

**USDT und USDC werden als USD angenähert (Paritätsannahme 1:1).** Dies steht in **fxNote jeder betroffenen Zeile**. Die tatsächliche Stablecoin-Bewertung kann abweichen.

Coin-Bestände verwenden den letzten vollständig geschlossenen Kerzenschluss aus der lokalen candles-Tabelle **vor 31.12., 23:59:59 Europe/Zurich**. Fehlt ein Kurs, wird die Bewertung als fehlend markiert, nicht erfunden. Cash wird aus dem Ledger rekonstruiert. Exporte eines laufenden Kalenderjahrs sind vorläufig.

## Dashboard und lokale API

In **Übersicht** gibt es eine Karte **Export für Steuer** mit Jahres-/Währungsauswahl, Kostenbasis und ZIP-Download. Klarer Hinweis: **Paper-Daten (Spielgeld), keine Steuerberatung**.

    GET /api/export/tax?year=2026&currency=CHF&method=fifo
    GET /api/export/tax?year=2026&currency=EUR&method=average&account=rules

Die ZIP enthält alle fünf Dateien. ZIP-Name, Ordnername und Datenzeilen kennzeichnen das Paper-Netzwerk. Keine externe Tax-Plattform, kein Key und kein Upload.

## Grenzen

- Keine Steuerberatung und keine Zusicherung der Anerkennung durch Steuerbehörden.
- Eine Paper-Datenbank hat genau eine Börsen-/Quote-Identität. Trades mit anderer Quote werden abgelehnt; Netzwerke werden nicht gemischt.
- Paper-Gebühren sind ausschliesslich in Quote-Währung; feeCurrency ist für künftige Live-Fills vorgesehen.
- Das aktuelle Schema führt keine separate Ein-/Auszahlungshistorie und keine Live-Trades. Es wird hier nicht geändert.
- Jahresend-Candle-Werte können veraltet sein und entsprechen nicht zwingend einer amtlichen Steuerbewertung.
