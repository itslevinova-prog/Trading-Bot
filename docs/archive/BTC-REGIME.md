# BTC-Regime und gemeinsames Altcoin-Risiko

31.10.2026. Neuer `strategy/regime-paper.ts` mit RegimePaperProvider: bestehende DecisionProvider-Schnittstelle, deterministische Paper-Entscheidungen und getEvidence. Er verwendet den unveränderten geprüften Trend-Mock als Grundlage und ergänzt erklärbare marktübergreifende Einstiegsprüfungen. Forschungskandidat, nicht als Standard aktiviert; keine realen KI-Verbindungen, Konten, Schlüssel oder Orders.

## Entscheidungswissen mit konkreter Wirkung

Bei einer bereits grundsätzlich zulässigen Altcoin-Gelegenheit mit beobachteter BTC-Korrelation mindestens0.8 verlangt der Kandidat eine frische BTC-Referenz aus demselben geschlossenen Fenster. Ein bestätigter bearish Kurz-/Stunden-/4hTrend widerspricht dem neuen korrelierten Long-Einstieg. Fehlende, veraltete, zukünftige, doppelte, zeitlich abweichende oder zum aktuellen Quote stark dislozierte BTC-Daten liefern unbekannt und kein neues korreliertes Exposure.

Liegt bereits Bitcoin im Portfolio, bleibt die vorhandene Budgethalbierung erhalten. Sie wird nicht doppelt angewendet. Ohne BTC-Bestand, aber mit einer weiteren beobachtet stark BTC-korrelierten Altcoin-Position, halbiert der Kandidat das zusätzliche Budget einmal, unabhängig von der Zahl solcher Bestände. Reicht es dann nicht für die Mindestorder, folgt NO TRADE. Fehlende aktuelle Belege für den gemeinsamen Faktor vorhandener Altcoins werden nicht als Diversifikation behandelt. Niedrige/negative BTC-Korrelation verdient keinen erhöhten Risikobetrag und belegt keinen garantierten Hedge.

Das ist ausdrücklich ein gemeinsamer-BTC-Faktor-Proxy, keine gemessene Coin-Coin-Kovarianz. Die vorhandenen Schwellen0.8und0.5wurden ohne Suche aus dem bisherigen Risikocode übernommen. Wahrscheinlichkeiten/Erwartungswert bleiben unbekannt. Bestehende Verkaufsentscheidungen laufen unabhängig weiter. Abgelehnte Kandidaten können durch den nächsten vollständig zulässigen Kandidaten ersetzt werden; maximal ein neuer Kauf und insgesamt drei Empfehlungen. Paperbroker und Safe/Risky-Hardlimits bleiben zuständig.

## Geprüfte Wirkung und ihre Grenze

15Szenarien prüfen erlaubte/vetierte Käufe, fehlende/stale/future/mismatched/duplizierte/dislozierte Referenzen, niedrige/negative Korrelation ohne Budgetbonus, Clusterhalbierung, fehlende Clusterbelege, unabhängige Verkäufe, Mindestorder, alternative Auswahl, Determinismus/Schema und unveränderte Eingaben. Quote-Dislokation wurde bei der Prüfung zusätzlich abgesichert; Erklärung unterscheidet zusätzlichen Faktor und Gesamtfaktor. Vollständig802Haupttests+15Offline/Source-Test-WebTypchecks/Build bestanden.

Vor Auswertung registriertes Protokoll `btc-regime-protocol-v1.json`. Gleiche bekannte20Markt-Historie und Safe-Ausführung wie bisher:1000EUR, nominale Gebühren0.1%/0.2%, synthetische Next-open-Quotes mit5bpsSpread/5bpsSlippage und angenommener Tiefe1000Quote. Kein historisch beobachtetes Orderbuch oder unabhängiger Holdout. Unveränderter Mockv2 reproduziert seine vollständigen alten Ergebnisse exakt. Gemeinsame Entscheidungszeitpunkte besitzen identische exogene Marktinputs.

Final zweimal identischer Bericht `btc-regime-study-43a92c60d98f56b8.json`, Hash43a92c60d98f56b82f0e58a9b531d9e77815e105c10c79d419db38324b1a052a, Build79d5565e21f0df971e3005ddd1ee160c2b0025ba36e7c414b19ce431efb3f702(104Source/94Runtime).

**Kein gemessener Renditevorteil:** Basis weiter−3.9262%mit39Trades, doppelte adaptive Gebühr+0.3110%bei nur3Trades, jeweils identisch mit Mockv2. Wirtschaftliche Fills, Gebühren, komplette Equitykurve und Kennzahlen wurden exakt verglichen; Gründe/Versionen können andere Berichtshashes erzeugen. Keine zusätzliche Budgetreduktion oder neues Risikoveto wurde ausgelöst. Unter den39ausgeführten Basis-Altcoin-Trades besitzt nur einer Korrelation>=0.8; dort liegt kein auslösendes Gegen-/Cluster-Szenario vor. Im Gebührenstress liegt keine der drei Korrelationen über der Schwelle. Daher belegen die gezielten Szenarien die Implementierung, diese Historie aber keinen praktischen Schutz-/Renditeeffekt. Schwellen werden nicht abgesenkt, um auf bekannten Daten künstlich Wirkung herzustellen.

Das erste Entwicklungsartefakt d6cb18eb bleibt erhalten; der finale Quote-Qualitätsfall und präzisierte Erklärung besitzen eigenen Source-/Build-/Berichtshash. Nicht als zwei unabhängige Studien zählen. Kandidat bleibt opt-in; keine Empfehlung zum Echtgeldbetrieb. Vollständige Freigabe/Profitabilität nicht nachgewiesen.

## Erhalten und weiter offen

Alle93vorherigen kompilierten Module sind bytegleich; nur der neue Provider ergänzt den Offlinebuild. Der laufende Main mit ursprünglicher Runtime972d wird nicht neugestartet oder umkonfiguriert: nachlesend weiterhin verbunden,20Features/20Paare/Paper-only/AIaus/Remoteaus. Eingefrorene Referenzen, Daten und gestoppter V2-Versuch unverändert. Sources/Tests/Audit/Primärquellen und Logs gehasht in btc-regime-proof.json.

Vertiefte Anwendung der Jesse-Filter-/Positionspflege und OctoBot-Evaluatoraggregation: upstream-research/REVIEW-REGIME-APPLICATION.md. Eigene Komposition der bestehenden TypeScript-Bausteine, keine fremden GPL/LGPL-Pythonmodule kopiert oder ausgeführt.36ausgewählte Upstreamdateien sind weiterhin keine gründliche Gesamtuntersuchung.

Nächster fachlicher Bedarf: tatsächliche paarweise/Portfolio-Risikoschätzung mit belastbarer Datenbasis, weitere Regime-/Range-/Reversal-/Exitstrategien und fortgesetzte geeignete OSS-Untersuchung. Für eine prospektive Beobachtung neuen Vertrag mit fest registriertem Symboluniversum und aktuellen Metadaten erstellen; alten wegen Universumsdrift gestoppten Root nicht reparieren oder Baseline zurücksetzen. Das100Stunden-Ziel bleibt deutlich offen.
