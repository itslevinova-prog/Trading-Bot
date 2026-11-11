# Fixed rising-hourly breakout entry hypothesis

Design registered in hourly-entry-design-v1.json before candidate implementation/outcomes. Exact implementation, source hashes and comparison runner frozen in hourly-entry-protocol-v1.json before historical candidate outcomes. Paper research only; not registered in the active provider factory, no new external AI or trading route.

The candidate composes the unchanged breakout policy, retaining its structure/risk/cost/covariance/position filters and exits. Every risk-qualified breakout entry assessment must additionally contain complete source-validated closed-hourly direction from the shared helper, with current/previous EMA and endpoint matching the exact feature snapshot. Future/stale/missing/contradictory/flat/falling evidence declines entry. A rising mean is descriptive evidence, not a winning-trade probability.1e-12relative tolerance is the numerical flat boundary, not a searched economic threshold.

All qualified candidates are filtered BEFORE the existing deterministic best-netRewardRisk/lexicographic selection, so a valid second symbol can be selected. Budget, stop, target, action cap and exits remain unchanged. No entry condition is imposed on a source sell or independent simulator protective stop. Existing mock architecture remains; programmed rules decide this experiment, no real or trained AI model.

25new direct unit cases plus existing15breakout cases pass; full1123main+15offline/typecheck/build pass before comparison. Synthetic fixtures isolate policy logic and are not performance evidence. Seven already-consumed months, each at existing.001/.002fee rates, are compared as full portfolio paths rather than deleting old losing trades. Frozen source complete-result hashes, same-clock exogenous evidence, original raw-data hashes/options, accepted entry origins, cash0 and costed BTC benchmark are checked. An independent verifier reconstructs closed hours and the original750-hour-tail EMA from raw15m candles without using production EMA/aggregation helpers. Final results/conclusions require the terminal report and verifier, not partial logs.

July outcomes remain locked. No parameter sweep, activation, independent out-of-sample label, learned model or profit claim. Stress-fee runs can have different opportunities or zero trades; they are not paired fee deductions from unchanged trades. The original structure-exit returns remain available from the same frozen report as an additional reference. Survivor symbols, later metadata, synthetic books/fill assumptions and exploratory prior knowledge limit historical deployability claims.


## Verified completed comparison

28full replays,14paired scenarios; all14old breakout full results exactly match. Every141candidate BUY has independently verified raw21bar breakout, independently recomputed original750hour-tail EMA, feature origin/clocks/paid fill identity and captured evidence. Study build411fdd18c00b6365f6ac19709d5edc48fe1f4c623b308083e7551251455f0e70, reportfd783d6c607d1d30daf3d2364b94554fbff298227ba92d5877f7a0ec353a26f0.

| Monat | Breakout % | Mit Stundenfilter % | Trades vorher/nachher |
|---|---:|---:|---:|
| 2025-10 | -2.6046 | -2.2737 | 25/24 |
| 2025-11 | -1.9689 | -2.4672 | 25/22 |
| 2025-12 | -1.6143 | -1.6143 | 19/19 |
| 2026-01 | -1.7166 | -1.3827 | 30/27 |
| 2026-02 | -1.4738 | -0.8814 | 12/9 |
| 2026-03 | -1.4807 | -1.1518 | 17/16 |
| 2026-04 | -2.7175 | -2.3162 | 25/22 |

Basefee5months smaller loss, November worse, December exactly unchanged. All7candidate months negative: cash0 beats every one; total closed trades153->139. March still worse than original structure source despite improvement against breakout. Do not concatenate these independent monthly resets into a claimed deployed equity curve or treat monthly/asset outcomes as independent trials.

Stressfee candidate has only2closed trades total, exactly the same two as breakout: November+.941545%, December-.739430%; all other stress months0trades/0return. This is opportunity filtering, not proof of robustness or extra alpha. No active provider promotion, changed thresholds, forced learning fit or July outcome access. Correctness/explainability improved; profitable strategy still unproven. Next prioritize a falsifiable diagnosis of entry adverse excursion/cost/market-state limitations, not blind slope/threshold optimization. Forward process health after human shutdown must be revalidated before claiming continued collection; no restart was done here.
