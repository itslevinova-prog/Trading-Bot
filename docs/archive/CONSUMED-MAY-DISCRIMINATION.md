# Consumed May: do the forecasts rank coins usefully?

This is a diagnostic of the two already-inspected chronological May validation windows. It is not a new holdout, strategy selection experiment, win probability or broker replay. It consumes only the saved 400 rows / 20 shared clocks per window. No May21+, June or July outcomes were opened. Forecasts are checked against their original sealed pre-label artifacts. The original 0.005 net forecast margin is unchanged.

For each clock, compare only assets with both a forecast and a known costed barrier label. Correct order gets1, incorrect order0, tied forecasts0.5; equal labels provide no rank information and are counted separately. Average these proportions equally across clocks, retaining unavailable forecasts and unknown labels in the coverage counts. Comparisons share assets/clocks and are not independent observations. A constant forecast scores0.5 by construction; that number is not an empirical profit probability.

| Frozen model | May1–11 concordance | May11–21 concordance |
| --- | ---: | ---: |
| Zero / constant training mean | 0.500000 | 0.500000 |
| Plain ridge lambda10 | 0.450983 | 0.503774 |
| Calendar-weighted mean30 | not evaluated | 0.500000 |
| Calendar-weighted ridge30 | not evaluated | 0.482417 |

Hindsight labels above0.005 exist on18/20 early clocks and9/20 later clocks. All original model policies still have zero clocks with a forecast above the fixed margin. This establishes neither executable missed profits nor permission to pick a hindsight winner: the barriers assume their original synthetic execution geometry/costs, and positions/cash/latency/correlation/fill failures are not replayed here. Descriptive top ranks retain the actual label, including missing labels; they are not traded.

The later ridge's lower absolute forecast error than the zero/mean baselines did not translate into a clear descriptive cross-sectional ordering improvement. Early ridge ranks worse than the tied baseline; the recency-weighted version also does not demonstrate an improvement. No significance, independent sample count or profitability claim follows from20 overlapping shared clocks. The result argues against lowering the entry margin to force activity. It also shows why an overall regression error alone is insufficient for deciding which coin to buy.

Reproduce with `node scripts/audit-consumed-may-ranking.mjs` and `python scripts/verify_consumed_may_ranking.py`. Latest pointers bind immutable reports and raw byte hashes. The Python verifier independently recomputes signs, tie counts, exact rational equal-clock means, deterministic top rows and fixed-margin hindsight counts. Seven diagnostic unit tests cover known rank/reversed rank/ties/nulls/unequal clock sizes/negative forecasts/invalid evidence. The original saved target/feature-generation assumptions remain those of their separate independent audits; this arithmetic check does not independently reimplement the entire historical data pipeline.

The live Paper test remains the programmed trend-v2 mock strategy, not any of these fitted research models. No provider, account, risk threshold, runtime build or frozen reference was changed by this diagnostic. Next work should investigate a specific justified feature/target/decision limitation and preregister a genuinely unused chronology before evaluating a new candidate; do not search margins, horizons or half-lives on these consumed windows.
