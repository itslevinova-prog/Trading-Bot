# Additional historical regimes and spread-definition repair

January, April and July2026 were registered before fetching new data, as calendar-quarter samples rather than dates picked for good returns. All20 symbols from the previous frozen study were retained. With8days warmup, the immutable source cache contains74,880January,72,960April and74,880July closed15minute candles:222,720total,240public GET reservations below the360cap. No keys, private accounts, models, services or trading access were used. Each canonical raw page has a checksum/actual retrieval timestamp. Loaded prices are reconstructed from those pages and must exactly equal the normalized archive; no missing/duplicate/future/malformed rows are padded, silently discarded or market-excluded.

These are earlier-period tests with a later selected survivor universe and later lot/minimum metadata assumptions. Strategy design was already informed by consumed October2026 data. They are not proof of historical deployability or a clean full-pipeline walk-forward result. Historical first receipt/queue/depth/latency were not observed. July prices were validated for coverage only; strategy outcomes remain locked before evaluation. A future local learner requires adequate real simulated policy labels; none is claimed trained here.

## What actually decides trades

Every reported decision maker is PROGRAMMED logic: programmed-rules, programmed-mock-trend-v2 or programmed-mock-structure-exit-v1. No external or learned AI model produced these results. Returns describe complete historical simulations, not average per-trade returns or the current forward account. Trade counts are closed simulated positions, not separate software tests.

## Why initial cash-only results were misleading

The first registered evaluation reused the frozen default Rule options:100fakeEUR capital,10bps symmetric midpoint spread,8bps fill slippage, .001/.002fees. The mock Safe entry cap is10bps. The broker measures spread relative to midpoint, while paper-intelligence independently measured ask/bid-1 relative to bid. A synthetic10bps midpoint quote therefore appeared as10.005bps to the strategy. January diagnostics show59,520/59,520mock assessments blocked by that spread check. Its0trades/0% therefore cannot be credited to intelligent market selection. Original January and April reports remain untouched.

The working strategy now reuses the existing broker entryQuoteGuard, including the same units,10bps cap and floating tolerance. No limit was relaxed. Tests cover exact boundary, just over boundary and true zero spread at zero cap. Cost guard evidence explicitly identifies the implementation. Freqtrade's separate ask-relative ratio and zero-disables semantics were reviewed but not copied. Frozen V3 source/runtime remains old and unchanged.

The fix was separately registered after the diagnostic, before corrected results. Corrected results are therefore revisits of now-consumed periods. Final repeated reports use a script hash captured at startup and exactly reproduce full previous corrected economic results. One earlier diagnostic runner hash may include a July-only lock added while it ran; that hash alone is insufficient to identify the exact executed script. Its full economic results equal the first immutable run, and the final corrected recaptures avoid this provenance issue.

## Actual corrected results

All rows below use100fakeEUR, not the1,000fakeEUR used in the older October mock study; minimum-order/rounding effects prevent assuming perfect capital-scale invariance. Different quote/slippage assumptions also prevent treating months as one identical-settings return series.

| Period / fee | Simple Rule | Mock trend | Mock structure exits |
|---|---:|---:|---:|
| January /0.1% |−1.7576%,4trades|−1.8980%,39trades|−3.0734%,44trades|
| January /0.2% |−1.8688%,4trades|+0.0309%,2trades|−0.7062%,2trades|
| April /0.1% |0%,0trades|−3.5958%,45trades|−2.8601%,45trades|
| April /0.2% |0%,0trades|0%,0trades|0%,0trades|

Higher fees change the accepted opportunity set. A tiny positive result from two trades or cash-only result is not evidence that higher costs improve a strategy. Cash0% exceeds every negative base result. The structure variant helps relative to trend in April and hurts in January; no general profitable advantage is established. Do not choose a winning month/fee retrospectively, calibrate probabilities from these dependent samples or unlock July to tune a candidate.

Compatibility check: every full covariance/structure October result, including fills/curves/reasons, exactly matches the preserved original5e7a4report under its original5bps assumptions. This is regression evidence, not new profit evidence. Full989main+15offline tests/typechecks/build passed, including strict page/grid/raw provenance, original-action/identity and cost-unit tests. Original default dataset and prospective V3 are preserved; no deployment/restart or new trading mode was activated.

Exact report identities, source hashes and separate assumptions are in historical-regime-proof.json; source data proof in historical-capture-proof.json; current source review in upstream-research/REVIEW-PASS11.md. Next: analyze causal failure/regime context and information adequacy on development/validation data, design a concrete candidate without changing the July holdout, and continue substantive open-source/learning research.100productive hours and the full scope remain incomplete.
