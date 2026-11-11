# Entry payoff and volatility assumptions

This post-outcome audit checks 269 recorded entries across dependent hourly/relative policies and fee scenarios. It does not generate new trades or estimate an edge. Original reports, broker logic, accounts and runtime remain unchanged.

The source policy requests max(2%, 2 times ATR as a percentage of signal close) for its stop, with a target twice that percentage (subject to existing bounds). The 2% floor binds in 135 of 139 base-fee hourly entries and 122 of 126 relative entries. The floor is an existing shared action-schema constraint, not an accidental missing ATR calculation. Lowering it requires a separately registered strategy and fair full-portfolio evaluation; these observations do not justify tuning it against past losses.

Median requested stop/ATR percentage ratios are 6.2000 and 6.0325; target ratios are 12.4000 and 12.0651. Exact actual price-distance medians differ: stops 6.2143 and 6.0460 ATR, targets 12.4162 and 12.0800 ATR. The reason is that requested percentages use signal close, actual stops use the fee-inclusive entry basis, and actual targets use entry fill. ATR measures true range, not standard deviation, target probability or holding duration.

The median conditional net reward/risk is 1.61994 and its two-outcome break-even arithmetic is 38.1689%. Neither is an estimated win probability. The hourly base exits are 16 targets, 92 strategy exits, 8 gap stops, 22 other stops and 1 end-censored liquidation. Relative exits are 15, 79, 9, 22 and 1 respectively. This multi-exit distribution cannot be evaluated by treating every trade as the same target/stop binary bet. No calibrated expected value or probability is available.

Scenario calculations use the existing policy slippage assumption of 15 basis points; actual historical executions use the registered spread/slippage convention. Recorded scenario prices and actual paid entry prices need not coincide. The independent verifier reconstructs normalized net cash flows without calling paperPayoff, checks serialized snapshots and fee-ledger geometry, and verifies all 269 rows. Existing paper-payoff tests: 9 passed (data/test-payoff-audit-2026-11-01.log).

Artifacts: entry-payoff-audit-protocol-v1.json; entry-payoff-audit-ac477e4a42f3fa43.json; entry-payoff-price-geometry.json; entry-payoff-verification.json. Recheck with node scripts/verify-entry-payoff-assumptions.mjs. The collector uses immutable output creation and should not be rerun over an existing artifact.

Next: inspect pinned upstream exit/target-label approaches and design a causal horizon-aware outcome contract before another entry filter or risk-floor change. Keep fixed-horizon gross labels separate from variable-exit policy PnL, retain censoring/first-barrier ambiguity, and preserve the unseen July evaluation. No model, active strategy, threshold or simulator change is justified by this audit. Profitability remains unestablished.
