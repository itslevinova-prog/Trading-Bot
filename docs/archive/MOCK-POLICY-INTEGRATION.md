# Getestete Paper-Kandidaten im vorhandenen Scheduler

31.10.2026. Neue Kandidaten sind jetzt über die vorhandene Scheduler-/Collector-/Brokerarchitektur auswählbar. Noch kein neuer prospektiver Prozess gestartet und keine neue Performance beobachtet. Standardprofile und laufender Main bleiben unverändert.

## Explizite sichere Auswahl

PAPER_MOCK_POLICY besitzt die Werte trend-v2(Standard), covariance-v1 und structure-exit-v1. Eine kleine Factory wählt ausschliesslich die passenden vorhandenen simulierten Provider; unbekannte Namen führen zum Fehler. Neue Varianten erfordern das isolierte Mock-Paper-Profil mit nichtleerer fester Marktliste. Die vorhandenen Schutzbedingungen für Binance/dedizierteDB/keineKeys/AIaus/Remoteaus gelten zusätzlich. Es gibt keinen Fallback auf einen realen Provider. Die Auswahl steht in öffentlicher/sanitisierter Konfiguration und deren Fingerprint. Entscheidungen tragen zusätzlich etwa mock:structure-exit-v1; originale Rule-/Holdrollen bleiben bestehen.

## Tatsächliche Datenanbindung

Der vorhandene SQLiteCollector lädt bereits bis9000geschlossene15mKerzen und2300Stundenkerzen jeAsset. Für neue Mockvarianten wird daraus mit dem gleichen expliziten now wie dem Entscheidungskontext die193Close-/192Return-Kovarianz berechnet. Die24Kerzen der kompakten Anzeige werden nicht als48hHistorie ausgegeben. Unfertige/zukünftige DB-Kerzen werden durch die bestehenden geschlossenen SQLgrenzen ausgeschlossen; fehlender Predecessor bleibt unbekannt. Eine leere Erfassung erfindet keinen Panel.

Scheduler legt den neuen Panel einmal in portfolioEvidence.covariance ab und erhält die vorhandene Portfolio-/Replayevidenz. Er wird aus marketContext entfernt, damit die vollständige Matrix nicht doppelt übertragen/persistiert wird. Die ursprünglichen Marktdaten/Features bleiben vollständig. Der genaue benutzte Risikokontext und die neue Providerevidenz werden über den vorhandenen dauerhaften Prepared-/Validatedpfad vor möglichen Paper-Aufträgen gespeichert. Bestehende Orderschutz-/Frische-/Stop-/Ownership-/Revision-/Duplikatregeln bleiben zuständig.

Der kompakte zukünftige echte KI-Prompt ist damit nicht als passend validiert. renderPrompt bewahrt bereits bei Überschreitung das vollständige Original im Kontextprotokoll und kennzeichnet den fehlenden begrenzten Prompt. Neue Varianten dürfen durch Env ausschliesslich Mock sein; kein realer Call wird damit freigeschaltet. Eine spätere echte Integration muss den relevanten Risikokontext verlustfrei im bestehenden Zeichen-/Tokenbudget nachweisen.

## Baselinebereitschaft

Für neue Varianten prüft die vorhandene PaperExperimentRuntimeController.start vor Registrierung aller drei gemeinsamen Epochen echte aktuelle aktive DB-Symbole,193geschlossene15mKerzen, vollständige Kovarianz und exakt passende aktuelle Feature-Schlusszeit/-preise. Fehlt diese Grundlage, wird keine Baseline angelegt. Auch die bestehende verbundene Markt-/Benchmarkbuch-/Policy-/Build-/Config-/Universumsprüfung bleibt bestehen. Im Test bleibt die Experimenttabelle vor vollständiger Historie leer; erst nach Einfügen sämtlicher gültiger193Closes entstehen die drei gemeinsamen Forwardpunkte atomisch.

Unterschiedliche echte Accountkontexte im laufenden Scheduler können weiterhin zu leicht unterschiedlichen Zeitpunkten gesammelt und Orders mit real modellierter Latenz ausgeführt werden. Das ist keine Behauptung millisekundengleicher Exogeninputs über verschiedene Accounts. Ein neuer prospektiver Vertrag muss diese vorhandene Semantik und unterschiedliche Rule-/AI-/Holdrisiken offenlegen; die alten historischen exakten Inputvergleiche bleiben separat.

## Prüfungen

8neue Tests:3Factory/Env/Trace,4echterSQLiteCollector/Scheduler,1zusätzliche Controller-Warmupprüfung.13gezielte Integrationstests inklusive vorhandener Controllerfälle bestanden. Der Test stellte Future-Candle-Unveränderlichkeit, den Unterschied192Renditen gegenüber24Anzeigekerzen, benötigten Predecessor, Legacy-Modus ohne Kovarianz, leere Daten, tatsächliche neue Providerkonsultation und dauerhaft identischen Originalrisikokontext fest. Keine echte/entfernte Anfrage und kein Auftrag im Scheduler-Holdfixture.

Erste Warmupfixture hatte falsch um5sverschobene Kerzen; am UTC-Raster korrigiert. Vollständige Typprüfung fand zusätzlich den optionalen gespeicherten Contextstring im Test; dessen tatsächliches Vorliegen wird jetzt ausdrücklich geprüft. Final883Haupttests+15Offline/Source-Test-WebTypchecks/Build bestanden. Buildcc12379e164c46d708a93bf730899eca00cbdc8378051ff580b05f49f03fc210(110Source/100Runtime). VollerOriginalRuleBasis-/Stressreplay nach neuer Verdrahtung exakt alte Daten-/Options-/Ergebnishashes, jeweils0%/0ClosedTrades. Das ist Parität, keine neue unabhängige Rendite.

Main weiterhin ursprünglicher Prozess/Runtime972d, neu gebaute Quellencc123noch nicht deployt. Keine.env-Änderung/kein Neustart/kein neuer Experimentstart. Alte Referenzpointer und wegen Universumsdrift gestoppter V2Root erhalten. Nachweise in mock-live-policy-proof.json. Kein API-Key/Finanzkonto/realer KI-Provider/paidCall/privateExchangeCall/echteOrder/Echtgeldimplementierung.

## Nächste konkrete Arbeit

Neue Prospektivserie zur bestehenden Prepare/Start/InspectFactory hinzufügen, da deren aktuelle Auswahl nurv1/v2erkennt. Neues unverwechselbares Manifest/Protokoll/Pins/vorherige Prüfbelege/Providerrolle/Build-/Konfigurationsversion registrieren und vollständige eingefrorene Source-/Dependencykopie erzeugen. Originale Rule-Baseline und BTC-Hold korrekt benennen; neue AI-Rolle explizit structure-exit-v1. Collector-/Mainversion kontrolliert zuordnen, niemals Buildhashüberprüfung übergehen. Erst nach tatsächlicher gemeinsam registrierter Baseline future sammeln; alteRoots nicht patchen oder rebasen. Nach Start Resultate kritisch auswerten, während weitere nützliche Regime-/Entry-/Reduce-/Exit-/ML-/OSS-Arbeit vorangeht. Passive Sammelzeit zählt nicht zu100aktiven Stunden.
