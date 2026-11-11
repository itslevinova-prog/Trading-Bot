# trend-vol-target-v1 (Issue #4) — Code und Offline-Fixtures

**Status:** vorregistrierter Paper-/Research-Provider, **nicht** in echten
Paper-Konten oder CLI aktiviert. Kein historischer Replay und **keine** Aussage
über Erfolg, Profitabilität oder erwartete Rendite.

## Fixierte Regeln

- Ein Signal nur zu geschlossenen 1d-UTC-Kerzen. Pro UTC-Tag maximal eine
  Rebalancing-Entscheidung; 240 lückenlos gültige tägliche Bars erforderlich.
- 20/50/100/200 EMA-Ensemble pro Coin: vier Stimmen in 0.25-Schritten.
- BTC über EMA200 erlaubt Long, sonst Cash; keine Shorts.
- Ranking: positives 50d-Momentum geteilt durch annualisierte 30d-Volatilität.
  Gewichte: Signalstärke × Vol-Ziel / Volatilität, maximal 30 % je Coin und
  maximal 100 % brutto, Top 3 nach risikoadjustiertem Momentum.
- Maximal tägliches Rebalancing und nur bei mindestens 20 % relativer
  Zielgewicht-Abweichung. Kein festes Take-Profit.
- ATR(14) ×3 als Trailing-Notbremse, sobald eine **belegte**
  High-Watermark pro Position vorhanden ist. Für neue Käufe wird
  der initiale Abstand auf 2–15 % begrenzt.
- Verbindliche Qualitätsverdicts `allowed` und explizite
  **angenommene**, nicht gemessene Roundtrip-Kosten (max. 40 bps)
  für neue Käufe. Mindestmenge/-notional und Lot-Präzision werden
  vor einem Auftrag konservativ gerundet.
- Ein separat bestehender RiskEngine-Gate muss alle resultierenden
  Orders prüfen und kann Grössen weiter begrenzen oder sperren.

Vier vordefinierte Konfigurationsdimensionen: Zielvolatilität 20 % p.a.,
Top K = 3, Toleranz = 20 %, ATR-Multiple = 3. Keine Anpassung auf
Validierungs- oder Holdout-Daten.

## Fehlende Schritte

Die reine `TrendVolTargetV1Provider`-Schnittstelle erhält über
`DecisionContext.execution.trendV1` ein explizit zeitpunktgenaues Paket.
Ohne dieses hält sie Cash. Ein getrennter Closed-Candle-Adapter und eigenes
Paper-Spielgeldkonto im Scheduler/DB/Dashboard fehlen noch.

Kein mit/ohne-Filter-Replay, keine Kosten- oder Performanceauswertung,
keine Heatmap, keine Jahresregimevergleiche. Es wurden nur deterministische
Fixtures verwendet; dies ist **kein Validierungsbeleg**. Hypothese H-025
steht im Register offen.
