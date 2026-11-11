# Echte gemeinsame Renditen für die Paper-Positionsgrösse

31.10.2026. Neuer opt-in CovariancePaperProvider verwendet den unveränderten Mockv2 und den unveränderten Paperbroker. Gemeinsamer BTC-Faktor wird hier durch direkte historische gemeinsame Schwankungen der tatsächlich betrachteten Assets ergänzt. Kein Prädiktor trainiert, kein Standardwechsel und keine externe KI-/Echtgeldanbindung.

## Exakte Datenbasis

context/portfolio-covariance.ts validiert193lückenlose geschlossene UTC15mKerzen jeAsset und berechnet192zeitgleiche logarithmische Renditen der letzten48h. Fehlender Predecessor, Duplikate, ungültiges OHLCV oder Zeitversatz ergeben unbekannt. Kein Auffüllen aus älteren Fenstern und keine paarweise Löschung. Unfertige, zukünftige und ältere Kerzen verändern den Snapshot nicht. Ein unvollständiges nicht benötigtes Asset macht die vollständige benötigte Teilmatrix nicht ungültig.

Die Matrix ist die gemeinsame Gram-Matrix der zentrierten Renditen geteilt durch191. Quellschlusskurse, Reihenfolge, Matrix und Zeitgrenzen sind gehasht. Kandidaten und gehaltene Positionen müssen zu diesen Schlusskursen/Zeiten passen, ihre aktuellen Bid-Marks frisch sein und ihre Mengen bekannt sein. Konstante notwendige Serien gelten nicht als sichere Nullrisikoassets. Historienschluss/Marktdaten sind weiterhin modellierte Simulation, keine nachgewiesenen historischen Erstempfangszeiten.

## Konkrete Budgetregel

Die bestehende risiko-/kosten-/slippagegeprüfte Kaufmenge liefert eine projizierte Bid-ExpositionB; vorhandene Mengen werden mit frischen Bids zuHbewertet. In Quote-Währung zum Quadrat:

- A=B²Cii ist die alleinige historische Varianz des ursprünglichen Kaufbudgets.
- cross=BΣHjCij verbindet den neuen Kauf mit vorhandenen Positionen.
- z=max(0,cross/A), alpha=1/(hypot(1,z)+z).
- Der Cashbetrag wird mit alpha multipliziert;0<alpha<=1. Dadurch liegt die modellierte neue Varianz höchstens bei bestehender Varianz+A, also dem Referenzbudget eines unkorrelierten zusätzlichen Kaufs.

Das ist eine **loglineare historische Varianznäherung**, kein VaR/ExpectedShortfall, keine Gewinnschätzung und keine maximale Verlustgarantie. Gemeinsame Drawdowns können stärker als diese48hSchätzung werden. Negative Kovarianz liefert keinen höheren Einsatz. Vorhandene Stop-/Exposure-/Drawdown-/Safe/Risky-/Kosten-/Frische-Hardlimits bleiben unabhängig; die vorhandene BTC-Halbierung wird ebenfalls nicht aufgehoben. Ein unter die Mindestorder verkleinertes Budget liefert NO TRADE. Bestehende Bearish-Verkäufe werden selbst bei fehlender Kovarianz unverändert übernommen.

Beispiel: zwei gleich grosse, perfekt gemeinsam schwankende Positionen ergeben den Zusatzfaktor√2−1≈0.4142; zwei entsprechende gehaltene Expositionen ergeben√5−2≈0.2361. Genau solche Fälle und die Varianzungleichung werden analytisch geprüft.

## Tatsächliches Ergebnis

18neue Szenario-/Analytiktests. Erste Vitestprüfung bestanden; vollständige Typprüfung fand zu eng abgeleitete Literaltypen in den Testserien, explizite number[] behoben. Final vollständig820Haupttests+15Offline/alle Typchecks/Build bestanden. Build7641b9f3acf327d4ca5c87e41d689b944c4f5b503b98002c057fc2d07b358233(107Source/97Runtime).

Vorab registriertes Protokolld81ee44d. Bekannte20Markt-Historie, identische Safe-Ausführung/1000EUR/5bpsSpread/5bpsSlippage/synthetische Tiefe1000Quote. Zweimal exakt derselbe Vergleich: covariance-study-88995ecf52b429fd.json, Bericht88995ecf52b429fdd8dc4c91841da4c1445ab2063d854ee894bae6954599a54c. OriginalMockv2 reproduziert vollständig sein altes Ergebnis; proGebührenszenario2593gemeinsame Entscheidungszeitpunkte ohne exogene Marktinputabweichung.

| Basis | Mockv2 | Kovarianzkandidat |
|---|---:|---:|
| Nettoertrag |−3.9262%|−3.0478%|
| Max.Drawdown |3.9262%|3.2658%|
| Geschlossene Trades |39|39|
| Gewinnrate |15.3846%|15.3846%|
| Profitfaktor |0.5073|0.5715|
| Gebühren |11.3959|10.2345|
| Mittlere beobachtete Exposition |9.3078%|8.0334%|

Einstiegs-/Ausstiegspaare, Zeiten und Preise sind identisch; Mengen und dadurch Kapitalpfad ändern sich.25Kandidatenbewertungen mit zusätzlicher Reduktion sind **keine25bestätigten Ausführungen**. Keine benötigte Kovarianz/Marke wurde in diesem Lauf als unbekannt abgelehnt. Relative Risikoreduktion gilt gegenüber dem ursprünglichen Vorschlag im selben Kontext; spätere Ordergrössen müssen durch den geänderten Kapitalpfad nicht immer kleiner als in einem anderen Baselinepfad sein.

Die vier chronologischen Carry-Slices zeigen geringere Verluste, sind aber keine unabhängigen Walk-forward-Folds. Kandidat bleibt negativ und hinter Cash0%. Weniger Risiko/Gebühren erklären einen Teil der Differenz. Ein rein algebraischer, auf denselben Gesamteinstiegskostenfaktor0.897665skalierter Baseline-Fillpfad ergäbe−35.2442QuotePnL gegenüber Kandidat−30.4783. Diese nachträgliche Kontrollrechnung ist kein ausführbarer Replay, keine unabhängige Strategie und kein kausaler Profitnachweis.

Bei adaptiv verdoppelten Gebühren bleiben beide Varianten gleich:+0.3110%mit nur3Trades/keinen zusätzlichen Reduktionen. Dass dieselben Basisfills mit verdoppelten Gebühren algebraisch für den Kandidaten−4.0713%ergäben, bleibt gesondert von diesem adaptiven Pfad. Diese wenigen Stress-Trades belegen keine Kostenrobustheit.

Keine Schwellen-/Parameteroptimierung. Historie war bereits untersucht; keine unabhängige OOS-/Kalibrations-/Profitabilitätsbehauptung. Risikowirkung im beobachteten Verlustpfad ist messbar, ein positiver Handelsvorteil nicht.

## Integration und Nachweise

research/covariance-replay.ts ergänzt die vorhandene ReplayStudy-Factory und erhält bestehende Portfolioevidenz. Der Provider implementiert die vorhandene DecisionProvider/getEvidence-Schnittstelle und wird mit echten bestehenden Fill-/Fee-/Risikofunktionen getestet. Der volle Kovarianzpanel wurde nicht in ein reales Modellpaket integriert oder auf dessen Zeichenbudget validiert; dafür wäre eine relevante verlustfreie Teilansicht mit vorhandenen Kontextgrenzen erforderlich. Kein Modell wird aktiviert.

Alle94vorigen kompilierten Module sind bytegleich. Hauptlaufzeit/Defaultprofile/alteReferenzen und eingefrorene Versuche bleiben unverändert, Main nachlesend20Features/20Paare/Paper-only/AIaus/Remoteaus. Neuer Provider bleibt Forschungskandidat. Artefakte/Source/Tests/Logs und Diagnosewerte in covariance-proof.json.

Drei neue gehashte Freqtrade-Archivdateien sowie vertiefte Jesse-Einzelrisikoprüfung: upstream-research/REVIEW-PASS6.md. Insgesamt39ausgewählte Archivdateien inklusive5Lizenzen sind keine abgeschlossene gründliche Gesamtanalyse. Nächste fachliche Arbeit: Marktregime-/Range-/Reversal-/Ausstiegslogik und weitere geeignete OSS-Module/Tests; neuer prospektiver fester Marktvertrag für faire Beobachtung, alte Roots erhalten.100produktive Stunden und breiter Zielumfang bleiben offen.
