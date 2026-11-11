# Historischer Mockvergleich: weniger Verlust, kein Profitabilitaetsnachweis

Festes Protokoll mock-structure-study-protocol-v1.json vor Auswertung; bestehendes bereits eingesehenes20Markt-Archiv d0066ea5e97b, Zeitraum2026-10-01T19:30:00+00:00bis2026-10-28T19:45:00+00:00. Kein neues Training/Schwellensuche. Kapital1000EUR pro Variante, deklarierter Spread5bps/Slippage5bps, hypothetische1000EURTiefe jeSeite. Keine beobachteten historischen Orderbuecher/Queues/erstenKerzenempfangszeiten. Originaldaten/Defaultpointer und fruehere Baselines unveraendert.

| Variante | Netto Basis | Max. Drawdown | Geschlossene Trades | Gewinnanteil | Profitfaktor |
|---|---:|---:|---:|---:|---:|
| Eingefrorener Mock-v1 | -5.4928% |5.7468%|54|18.52%|0.5288|
| Struktur-Mock-v2 | -3.9262% |3.9262%|39|15.38%|0.5073|
| Cash |0%|0%|0|unbekannt|unbekannt|

Der Rueckgang des Verlusts um1.5666Prozentpunkte begleitet weniger Einstiege/Gebuehren und geringere mittlere Exposition(10.95%→9.31%). Durchschnittlicher realisierter Netto-PnL pro Trade bleibt etwa-1EUR. Die neue Variante liegt im Basisszenario unter Cash und der simulierten terminal liquidiertenBTC-Referenz(-3.4466%,ohneLot-Dust). Gewinnanteil/Profitfaktor verbessern sich nicht. Von vier aufeinanderfolgenden Wochenabschnitten verbessert sich die neue Variante in zwei und verschlechtert sich in zwei. Diese Abschnitte tragen Positionen weiter und sind keine unabhaengigen Walk-forward-Testfolds.

## Gebuehrenstress richtig lesen

Mit doppelter Gebuehrenannahme(0.2%jeFill) und neu durchlaufenen Freigaben entstehen nur4(v1) bzw3(v2)Positionen: +0.9051%gegen+0.3110%. Kandidat liegt hier0.5941Prozentpunkte zurueck. Der Kostenfilter entfernt viele fruehere Einstiege, auch Stops/Auftragsmengen koennen sich aendern. Die kleinen positiven Endwerte sind keine Aussage, dass hoehere Kosten helfen oder eine robuste profitable Regel gefunden wurde.

Dieselben Basisfills mit unveraenderten Mengen/Preisen und lediglich zusaetzlichen Gebuehren ergeben algebraisch -7.0588%(v1)und-5.0658%(v2). Das ist eine monotoneKosten-Diagnose, kein erneut ausfuehrbares Portfolio. Der Ergebnisbericht zeigt die Verdopplung relativ zur jeweils eigenen Szenario-Gebuehr; unter dem bereits verdoppelten Szenario waere dies nochmals doppelt und darf nicht mit der Basis-2x-Diagnose verwechselt werden.

## Verlustursachen am selben simulierten Pfad

Basev1: Netto-54.928EUR, davon15.660EURGebuehren und11.745EURangenommene Spread-/Slippagebelastung. Bei denselben Mengen/Referenztriggern verbleiben-27.524EURPreis-PnL. Basev2: Netto-39.262EUR,11.396EURGebuehren/8.547EURSpread-Slippage/19.319EURnegativerReferenzpreis-PnL. Diese additive Zerlegung rekonstruiert keine gebuehrenfreie Strategie und laesst Ausfuehrungs-/Trigger-/Mengenentscheidungen fest. Auch vor diesen Kosten ist der beobachtete Pfad negativ. Stop-/Gap-/Trendexit-Gruende sind separat in mock-structure-cost-attribution.json erhalten; keine Verlustgruppe nachtraeglich zur Handelsregel erklaert.

## Implementierte faire Studiensemantik

replayRulesPortfolio hat einen expliziten optionalen paper-mock-study-Modus. Bisheriger Standard/erhaltene Regelquelle bleibt unveraendert; kompletter eingefrorener Basis-/Stressreplay bestaetigt erneut0%/0geschlosseneTrades und exaktalteResultathashes. Studienmodus verwendet dieselbe effectiveTradingPolicy/entryPolicyGuard wiePaper, tagesbezogen nurKaeufe, globale120minKaufpause, unabhaengigeStrategie-/Schutzverkaeufe, ausgewaehlteStopgrenze auf gebuehreninklusiveEinstandsbasis sowie echte strengereSafePositions-/Spread-/Risikokappen. Lockerere HardCaps koennen diese Policy nicht umgehen.

Historische Kontextproduktion bekommt ausschliesslich vorher geschlossene15m/1hKerzen und modellierteNextOpenQuotes; keine zukuenftigenHigh/Low/Close/Volumenfelder des Ausfuehrungsbalkens. Fuer beidePrototypen benoetigte Feature-/24h-/48h-/21Bar-Belege verwenden vorhandene Berechnungen; ungenutzteNews/Memory/7-90TageKontexte fehlen explizit. Der vollstaendige Produktionskontext ist unveraendert. BeideMockvarianten erhalten jeSzenario an allen2593gemeinsamenEntscheidungszeiten exaktgleicheexogeneFingerprints; Portfoliozustaende duerfen aufgrundabweichenderHandelspfade unterschiedlich sein.2593Zeiten/51860Marktassessments sind keine unabhaengigenStichproben.

Die zusaetzlicheRule-Referenz laeuft bei denselben deklariertenKosten/Kapitalgrenzen mit ihren originalenRollenregeln(Tageszaehlung/Exit-/Konfidenzlogik verschieden),0%in beidenSzenarien. Die isolierteStrukturwirkung wird deshalb primaer zwischenMockv1/v2verglichen. Source5cad und beide eingefrorenenPaperexperimente wurden nicht nachtraeglich veraendert.

## Nachweise und Konsequenz

742Haupttests+15Offline, Typchecks/Build bestanden. Acht neueReplayfaelle pruefen echtenKontext, realeMock-Positivkontrolle, Kausalitaet, Exitfreiheit, Kaufpause/Tagescap, Stopbasis, manipuliertePolicy/Fee-Widerspruch undstrengereSafeLimits. Sourcebuild93002bbc5f0bbfb42c9ea86861834d2b8b2b744fba78872f716ca37320415c10(100Source/90Runtime). Vergleich zweimal vollstaendig ausgefuehrt, exaktgleicher Berichtshash7e873da81fec4c98e37988a4ce02d0b04ad8098a2fe73bfcd77ba32981597cc4; bestehender Bericht beim zweitenLauf nur verifiziert, nicht ueberschrieben. Ausfuehrungslogs und fullreport enthaltenPfad/Kosten/Evidenzzaehlungen/Hashes.

NeuerAdapter machtfaire Pruefungen moeglich; er beweist keine bessere Prognose. Keine Kalibrierung/Unabhaengigkeit/Profitabilitaet abgeleitet. Mock bleibtForschungsheuristik, MainKIweiterdeaktiviert. WeitereArbeit: testbareMarkt-/Strategiehypothesen und tieferpassendeOSS-Implementierungen/Labels untersuchen, feste bekannteHistorie alsEntwicklungsdaten behandeln, neue Tests/Prospektivdaten saubertrennen. Keine Schwellenanpassung an diesesErgebnis, keinselektivesBewerben der3positivenStresstrades.100produktiveStunden und vollerScopebleibenoffen.
