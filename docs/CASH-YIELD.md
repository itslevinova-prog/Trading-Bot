# H-025: Hypothetischer Cash-Zins (Issue #43)

## Vorab registrierte Annahme
**0 % (Standard) / 3 % / 6 % APY.** Tägliche Gutschrift nur auf
nicht investiertes Quote-Cash: `Cash × APY / 365`.
Es werden **keine historischen Zinsdaten** behauptet oder importiert.

> Annahme, kein belegter historischer Zins; Gegenparteirisiko nicht modelliert.

Stablecoin-Depeg, Börseninsolvenz, Auszahlungssperren, Steuern und
variierende Zinsen sind **nicht** berücksichtigt. Ein höherer simulierter
Backtest-Ertrag gilt nicht als bessere Handelsstrategie.

## Backtest und v5-Sensitivität
`runBacktest({ ..., cashYieldApy: 0.03 })` ist eine ausdrückliche
Forschungsoption für Tageskerzen; ohne Option gilt unverändert 0 %.
Die Gutschrift wird nur an verarbeiteten, geschlossenen Tagen innerhalb
des Auswertungsfensters gebucht. Sie ist keine Order und verursacht keine
Börsengebühr. Fingerprints trennen Zins-Varianten, die Null-Variante
behält die bestehenden Felder und Resultate.

Im manuellen Workflow `Research-Daten und Schnelltest` steht
`run_v5_cash_yield=false` zur Verfügung. Bei Auswahl sind die Pflichtangaben
wie für H-025 v5 einzuhalten: `from=2019-01`, `to=2023-12`,
`intervals=1d`, `symbols=BTCUSDT,ETHUSDT`. Die zwölf
Berechnungen (vier unveränderte Profile × drei APYs) werden als separate
Artefakte und mit Datenschutzprüfung im Issue #43 veröffentlicht.
**Der Forschungslauf wird nicht im Rahmen dieser Implementierung gestartet.**

## Forward-Test
Die bestehende `engine-v2` verwendet standardmässig **keine Zinsen**.
Eine neue ausdrücklich getrennte Forschungsserie kann über
`--cash-yield-apy 0.03` oder `--cash-yield-apy 0.06` gestartet werden.
Der Wert ist Bestandteil des Konfigurationshashes und kann nicht
nachträglich in einer bestehenden Serie geändert werden. Die
Zinsgutschrift gilt dort nur für das ungenutzte Strategie-Cash an
vollständig auswertbaren Tagen; die unverzinsten BTC-/DCA-Benchmarks
bleiben Vergleichsmassstäbe.

**Keine bestehenden Forward-Serien oder Paper-Konten migrieren.**
Ein Code-Hash-Wechsel kann selbst bei 0 % eine neue Serie erfordern.
Daher die bestehende Forward-Installation nicht allein wegen dieser
Forschungsoption umstellen. Live-Trading, echte Einzahlungen und
Zinsprodukte bleiben ausgeschlossen.
