# Kostenhürde – vorläufige Infrastruktur (#2)

Der Code unterscheidet angenommene Maker-/Taker-Gebühren, Spread und Slippage.
Die Entscheidungssperre verlangt einen expliziten erwarteten Brutto-Move von mehr
als dem Zweifachen der angenommenen Roundtrip-Kosten. Fehlende Zahlen ergeben ein
Veto statt einen Nullwert.

Die PaperMakerQueue ist eine eigenständige, deterministische Paper-Fixture. Sie
sendet **keine** Orders und führt **noch keine** Ledger-Transaktionen aus. Ein
hypothetischer Fill zählt erst bei einem späteren öffentlichen Trade **durch**
das Limit mit mindestens der angefragten Menge. Berührungen zählen nicht. Nach
Ablauf wird ein verpasster Fill protokolliert. Dies bleibt eine vereinfachte,
konservative Regel und kein Nachweis von realer Queue-Position oder Fill-Quote.

Der Recorder enthält Spread und aggregierte 10-/25-bps-Tiefen, aber nicht genug
Buchdetails für glaubwürdige 10-/50-/100-Quote-Slippage. Solche Werte und eine
gemessene Mindest-Edge bleiben daher **null / unbekannt**.

Noch offen: Broker-/Backtest-Ledger-Anbindung, dauerhafte Pending-Orders,
öffentlicher Trade-Stream, exakter Report mit echten Daten für mindestens
20 Märkte in zwei Quotes, Dashboard und versiegelter Maker/Taker-Vergleich.
Bis dahin unveränderte Taker-Ausführung und keine Profitabilitätsaussage.
