# Closed breakout entry research

Fixed own programmed rule, NOT a learned/external AI: new entries must have signal close strictly above the HIGH of20prior CLOSED candles, excluding that signal. Reuses existing closedMarketStructure, matched freshness, original trend/volume/cost/covariance/position risk and structure exits. No new numerical parameter search, stop mutation or probability. Every qualified assessment is gated before unchanged deterministic candidate sorting, so another valid coin may be selected. Held exits keep priority.

Preregistered seven previously explored months and two fee levels.100fakeEUR is RESET each month;10bps spread/8bps slippage, .001base and.002stress fees. These are not the older1000EUR/5bps42trade test. Full counterfactual portfolios, not subtraction of old losing trades. Cash0and same-cost BTCbenchmark included.28replays/14matched scenarios. Nine known full source results match prior artifacts EXACTLY. Shared same-clock exogenous features/markets/covariance hashes agree.

Base-fee results:

| Month | Source return | Breakout return | Source / breakout trades |
|---|---:|---:|---:|
| 2025-10 | -3.280% | -2.605% | 33 / 25 |
| 2025-11 | -4.787% | -1.969% | 38 / 25 |
| 2025-12 | -3.091% | -1.614% | 29 / 19 |
| 2026-01 | -3.073% | -1.717% | 44 / 30 |
| 2026-02 | -3.517% | -1.474% | 26 / 12 |
| 2026-03 | -0.634% | -1.481% | 28 / 17 |
| 2026-04 | -2.860% | -2.717% | 45 / 25 |

Six of seven improve against the losing source; March worsens. ALL seven candidate months are still negative and lose against cash.243source trades vs153candidate base-fee trades is an observed retrospective count, not a guarantee of fewer future trades. Stress has only two total candidate trades: Nov2025+0.942%with one, Dec2025-.739%with one; others no-trade0. Higher fees alter eligible trades, not expected profitability. No activation/promotion, no calibration or independent OOS claim. January/April and earlier source months were already consumed; July outcomes remain locked. Survivor universe/later lot metadata/later-informed design and synthetic books/fills remain important limitations.

15direct tests include cost/risk inheritance, exact-touch/no-breakout decline, invalid/stale/mixed source rejection, next-candidate selection, unchanged held exit, deterministic schema and evidence isolation. Full1047software+15offline/typechecks/build pass. Independent verifier recomputes every result hash/fee/paid roundtrip ledger and checks all155candidate BUYs (bothfees) directly against raw candle times and previous20highs. No future/signal-high substitution. Detail: breakout-entry-proof.json, verification and registered protocol.

Next concrete correctness issue discovered independently: feature() currently accepts only60quarter-hour bars and checks only last60continuity. Synthetic counterexamples demonstrate unavailable24hreturn becomes0 and a hole outside last60 can turn array-offset24hinto24.25h. Future candles correctly remain excluded. Captured in feature-history-gap-observation.json. These full-grid8day-warmup studies are unaffected. Next strengthen complete feature-history contract with adversarial tests and explicit frozen-module compatibility checks; do not silently alter old results or relax data guards to force ML.

Source pass14 archived two small JesseMIT files with hashes; Donchian last-window values include supplied signal unless caller shifts, while our prior range excludes it. Moving-block bootstrap's three-variable candle tuple is not proof of preserved cross-asset/volume relationships.46selectedfiles including5licences remain a partial three-project review. No upstream runtime/library installed, no GPL source copied, no new live/external-AI/paid function or financial account access.
