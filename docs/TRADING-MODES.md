# Safe / Risky und Stop-Loss

Stand 30.10.2026. Kostenlos implementiert, keine neue Abhängigkeit, kein Modell/Schlüssel aktiviert. Auswahl unter **Einstellungen → KI Trading-Modus**. Gilt für das KI-Paper-Konto und neue Einstiege im separaten nativen Börsenprozess; Regeln und Buy & Hold bleiben getrennte Vergleichskonten. Der Börsenprozess bleibt deaktiviert und übernimmt die Auswahl erst bei einer gesonderten späteren Freigabe. Keine privaten Börsenanfragen oder realen Orders zur Prüfung.

| Einstiegslimit | Safe Trade (Standard) | Risky |
| --- | --- | --- |
| Max. Position pro Coin | 15 % Kontowert | 30 % |
| Max. offene Positionen | 2 | 4 |
| Max. Käufe je UTC-Tag | 4 | 10 |
| Mind. Abstand zwischen Käufen, coinübergreifend je KI-Konto | 120 Minuten | 30 Minuten |
| Pause nach Verkauf desselben Coins | 120 Minuten | 60 Minuten |
| Geschätztes gesamtes Stop-Risikobudget | 1,25 % Kontowert | 2,5 % |
| Max. Einstiegsspread | 10 Basispunkte | 20 Basispunkte |
| Max. Einstiegsslippage | 15 Basispunkte | 30 Basispunkte |
| Filter auf unkalibrierten Modell-Score | mindestens 0,80 | mindestens 0,60 |

Strengere bestehende Konfigurationsgrenzen gelten zusätzlich. Mindestorder und Gebühren gelten weiter; kleinere Konten können deshalb ohne zulässigen Einstieg bleiben. Safe bedeutet kleinere Grenzen, keine Gewinn- oder Sicherheitsgarantie. Die Modell-Scores sind keine Gewinnwahrscheinlichkeiten; ihre Filterwerte sind nicht kalibriert. Die Parameter sind prospektive Produktvorgaben, keine auf dem eingefrorenen historischen Datensatz optimierte Strategie. Nicht belegt, dass mehr oder weniger Trades damit rentabel werden.

## Verlustlinie

2–15 % einstellbar, Schnellwahl −5 % / −10 %. Bezug ist der durchschnittliche Einstand inklusive Kaufgebühren, kein Kontodrawdown und kein Trailing-Stop. Neue Position: Stop = durchschnittlicher Einstand × (1 − gewählte Verlustgrenze). Die KI darf einen engeren Stop wählen, den ausgewählten maximalen Abstand aber nicht überschreiten. Beispiel: Einstand100, Stop5 % → Linie95.

Bestehende Positionen und Zukäufe dürfen die Linie nur anheben. Eine Umstellung von5 % auf10 % senkt einen vorhandenen5-%-Stop nicht. Beim Speichern werden vorhandene Stops und Auditbeleg atomar aktualisiert; frische vorhandene Bid-Bücher werden sofort erneut geprüft. Bei Bid ≤ Stop wird ein voller Schutzverkauf unabhängig von KI-Zyklus, KI-Aktivität, Kaufpause oder Tageskaufgrenze gestartet. Die bestehenden dauerhaften Trigger und Wiederholungsregeln bleiben erhalten. Eine Pause deaktiviert Schutzverkäufe nicht.

Die Ausführung erfolgt zum verfügbaren Orderbuchpreis mit Gebühren und Slippage. Keine Garantie für sofortigen Fill oder einen maximalen tatsächlichen Verlust: Kurslücken, veraltete Bücher, Mindestgrössen und fehlende Tiefe bleiben mögliche Hindernisse. Fehlgeschlagene Schutzverkäufe werden dauerhaft gelatcht, nach gültigen Folgeticks erneut versucht und blockieren neue Käufe. Chartlinien zeigen offene Positionen der ausgewählten Konten, keine simulierte Börsenorder.

## Nachvollziehbarkeit und Schnittstellen

- `GET /api/accounts/:id/trading-policy`: wirksame Auswahl sowie beide durch globale Limits begrenzte Vorschauen; nur KI-Konten.
- `PUT` auf dieselbe Route: striktes JSON `{mode:"safe"|"risky",stopLossPct:0.02..0.15,expectedRevision:integer}`. Fremde Origin403, falsche Werte400, veraltete Revision409. Ändert keine Börsen-/Modellfreigaben.
- SQLite `account_trading_settings`, `trading_policy_changes`, `paper_trade_policy`: dauerhafte Auswahl, Änderungen mit Stop-IDs, atomarer vollständiger Policy-Beleg jedes neuen KI-Trades. Ältere Trades erhalten keine rückwirkend erfundene Zuordnung.
- KI-Kontext enthält wirksame Policy und passende numerische Limits. Offene alte Entscheidungen und Käufe, bei denen sich die Policy während simulierter Latenz ändert, werden abgewiesen. Ein Wechsel setzt weder Tageskäufe noch Kaufpausen zurück.
- Policy-Fingerprint und Revision fließen in KI-Strategie-/Forward-Identität ein. Regeln behalten ihre eigene Identität; der unveränderte eingefrorene Replay ist kein Nachweis für diese neuen Modi. Aggregierte Kontoperformance kann ältere Modi enthalten; originale Tradebelege und Forward-Versionen prüfen.

## Primärquellen auf GitHub

Gelesen am30.10.2026, konzeptionelle Orientierung; kein Fremdcode oder neue Bibliothek übernommen:

- [Freqtrade: Stoploss](https://github.com/freqtrade/freqtrade/blob/develop/docs/stoploss.md): statischer Verlustabstand; Unterscheidung zwischen botgesteuertem und börsenseitigem Schutz. Ein Triggerpreis ist kein garantierter Fillpreis.
- [Freqtrade: Protections](https://github.com/freqtrade/freqtrade/blob/develop/docs/includes/protections.md): Pause nach Ausstieg und weitere getrennte Risikogrenzen.
- [Jesse: Strategy.py](https://github.com/jesse-ai/jesse/blob/master/jesse/strategies/Strategy.py): gesonderte Stop-/Take-Profit-Strukturen und Validierung geänderter Exitwerte vor Austausch. Unsere Implementierung bleibt eigenständig.
- [Offizielle Binance OPO-FAQ](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/opo.md): native Folgemenge erst nach vollständiger Füllung und Berücksichtigung der Provision/Filter; kein Ersatz für echte Account-/Fill-Nachweise.

## Native Anbindung (weiter deaktiviert)

`live/trading-policy.ts` liest dieselben Präferenzen aus der Dashboard-Datenbank über frische schreibgeschützte Verbindungen. Börse/Quote, KI-Konto, Revisionsaudit und Zeitstempel werden geprüft. Kein Paper-Cash oder Paper-Bestand wird als echtes Konto übernommen. Fehlende oder unpassende Quelle verweigert neue native Einstiege; keine implizite Ersatzkonfiguration. Root-Policy-Fingerprint ist vor der Modellausgabe und nach dem dauerhaften Intent-Commit unmittelbar vor einer Mutation erneut erforderlich. Die letzte Modellgrenze prüft nach der Policy-Datei nochmals Konto-/Buchfrische.

Native Limits sind die Schnittmenge mit den zusätzlichen Börsenlimits. Das bestehende native Tagesbudget reserviert weiterhin Ein- und Ausstieg: max. `floor(MAX_TRADES_PER_DAY/2)` Einstiegsversuche (mindestens1), zusätzlich begrenzt durch das Profil. Bei global10 deshalb Safe≤4, Risky≤5; keine Lockerung der ursprünglichen nativen Grenze auf10Einstiege. Fehlgeschlagene/nicht gefüllte Versuche zählen konservativ mit, sofern nicht sicher vor Übermittlung abgewiesen. Moduswechsel und Neustarts setzen die Historie nicht zurück. Ein bereits nativer geschlossener Vorgänger wird über eigene List-/Child-Belege gelesen; die Wiederkaufpause beginnt frühestens bei der validierten Beobachtung des Verkaufs, niemals bei einem geratenen Verkaufskurs oder beim alten Kaufzeitpunkt. Unbelegte Ausstiegszeit sperrt den erneuten Kauf desselben Coins.

Neue native Stops werden anhand des maximalen FOK-Arbeitspreises plus Gebührenreserve konservativ geschätzt und nach oben auf den Tick gerundet. Die tatsächliche Fill-/Gebührenbasis ist weiterhin nicht verifiziert. Die vollständige gewählte Policy samt wirksamen nativen Grenzen und Stop-Basis wird atomar im Intent gespeichert, diese lokalen Zusatzfelder werden nicht an den Börsenendpunkt gesendet. Begrenzte historische Modusangaben gelangen zusätzlich zu Plan-/Beobachtungsdaten in den Modellkontext; unbekannte Metadaten ersetzen keine gültigen Fill-Belege.

**Bestehende Börsen-Schutzorders werden durch diese Anbindung nicht ersetzt oder gelockert.** Bei engerer gewählter Verlustlinie oder unbekannter ursprünglicher Basis werden neue Einstiege und Modellfreigabe blockiert; der vorhandene Schutz bleibt bestehen. Ein vollständiger verifizierter Austausch sowie diskretionäre native SELL-/Recovery-Effekte sind weiter offen. Das Dashboard weist diese Grenze ausdrücklich aus. Die vorhandene Paper-Linie wird dagegen beim Speichern sofort enger gesetzt.

[`scripts/verify-native-policy.mjs`](../scripts/verify-native-policy.mjs) vergleicht die tatsächliche gespeicherte Auswahl mit dem laufenden Dashboard ohne private Börsen- oder Modellaufrufe. `docs/native-policy-proof.json` ist ein technischer Präferenznachweis, kein Handels-/Gewinnnachweis.

Offen: echte KI-/Forward-Validierung dieser Profile, private Testnet-/Börsen-Validierung, genaue Fill-/Gebührenhistorie sowie vollständiger nativer Stop-Austausch und SELL-/Recovery-Treiber. Keine dieser offenen Freigaben wird hier aktiviert.
