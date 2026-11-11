# Unified Backtest (Issue #5)

## No-cost execution

Only local archive/Paper SQLite data, existing Node/TypeScript dependencies and in-memory fixtures are used. No keys, credits, cloud execution, licensed datasets or paid services are required. Historical order books are unavailable, so synthetic execution costs are explicitly reported. **The default CLI source is the point-in-time Binance archive; no downloads happen automatically.**

## CLI

```sh
pnpm data:import --from 2020-01 --to 2023-12 --intervals 15m,1h,1d  # optional local public ZIP download, after disk-space check
pnpm backtest --source archive --quote USDT --top 20 --strategy rules --from 2022-06-01 --to 2022-07-01 --interval 15 --fill-model conservative-ohlc --trials 1
pnpm backtest --source paper --strategy hold --from 2026-08-01 --to 2026-11-01 --interval 15 --fill-model conservative-ohlc --trials 1
```

Dates mean UTC midnight; the end is exclusive for candle opens and inclusive for completed candle closing times. Archive mode requires historical 15-minute, hourly and daily candles (including 30 complete prior daily candles for selection), selects the previous-30-day top-volume universe each UTC midnight, and rejects a missing required series or an unresolved position after an asset's last archived candle. The archive's guarded 2025+ holdout remains sealed without recorded authorization; it is not bypassed by the CLI. `--profile` is parsed, documented and deliberately inactive until #10. `maker-queue` rejects rather than fabricating maker fills until #2. The current Paper DB supports 15m and 60m; the exact `CandleSource` protocol also supports 240m / daily sources in future without imports from #3.

Reports are generated under `data/backtests/<run-id>/report.json` and `report.html`. Run IDs are derived from reproducible input/config/code fingerprints; rerunning identical input intentionally refreshes the same path. Generated reports and the Paper database are never deleted by the CLI.

**Execution:** all symbols are advanced at their common closed-candle clocks. Production `feature()`, `paperMarketContext()`, `RuleBasedProvider` and `BuyAndHoldProvider` are called without rewriting their trading logic. The hold strategy's initial BTC order mirrors `Scheduler.buyHoldFirst()`, not the hold provider (which returns a hold action). The existing `validateRisk()`, `entryDrawdownGuard()`, `entryQuoteGuard()` and `entryFillGuard()` restrict orders. A buy is filled at the following bar open plus half-spread and slippage. Intrabar stops take precedence over target fills, and gap stops use the worse of stop/open minus selling costs. Each pair uses persisted `pairs.ordermin`, `costmin` and `lot_decimals`.

**Assumptions:** synthetic 10 bps spread, 8 bps adverse slippage and configured taker fee (unless explicitly varied in stress). No missing bars are fabricated. A strategy never sees a candle before its UTC close. In archive mode the membership is reconstituted at each UTC midnight with the *previous* 30 full daily candles via `ArchiveUniverse.universeAt` (including historically delisted pairs present in the public ZIP archive). Missing historical ZIPs/delistings remain unknown; a coin's presence in the public bucket is not proof of complete historical coverage. `--source paper` is a separate static-universe legacy/parity mode, **not** safe for claims about historical strategies. Benchmarks use observed daily intersections and idealised close-to-close prices, without fees or historic order-book costs. Backtest exposure, execution quality and decision snapshots differ from a full historical order-book replay.

**Statistics:** daily UTC equity, sqrt(365) crypto volatility/Sharpe/Sortino, net return, CAGR, max drawdown, duration, Calmar, worst observed calendar month, closed-trade win rate and payoff, turnover, costs as share of gross gain, exposure and annualized trade count. DSR uses skewness/kurtosis and trials; fewer than three returns yield `null`. CSCV PBO uses all 12,870 8/8 splits of 16 chronological blocks when >=2 return streams are supplied; otherwise `null`. Stationary bootstrap uses 1000 seeded paths with expected 10-day blocks, with P10/P50/P90 for final return and max drawdown.

**Stress:** fee x2, slippage x2, one-candle execution delay, 5% seeded signal suppression. Robustness is fail-closed: missing/nonfinite PBO **or** DSR probability produces `insufficient_evidence` (grey), never `robust`. When both are calculable, robust requires positive baseline and every stress scenario, DSR >=.95, PBO <.2; fragile means baseline <=0 or PBO >=.5; otherwise questionable.

**Parity:** actual `decisions` and `trades` are compared to same-symbol/same-closed-clock backtest entries; identical buy/sell/hold actions, average/max fill differences in bps, realized PnL difference and mismatch categories are recorded. The 95% agreement target is tested but not assumed. Order-book and latency causes are *indicators*, not definitive forensic attribution without captured book data. When there are no Paper decisions in the chosen time span, the report marks parity unavailable; use the fixture parity unit test for a transparent example. No local Paper database content is bundled in this repository.

## Script audit

The original inventory contained **195** files, of which **13** remain active and **182** were moved byte-for-byte (git tree rename) to `scripts/archive/`; no scripts were deleted. Active paths referenced by `package.json`, `apps/server/package.json`, Docker build, Node tests, or active runtime launch chains remain. Archived scripts may need their relative import paths restored before manual reuse; they are preserved for reproducibility, not supported as active launchers.

| Original file under `scripts/` | Status | Rationale |
|---|---|---|
| `__pycache__/fit-aggressor-ridge.cpython-312.pyc` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `__pycache__/fit-barrier-tree.cpython-312.pyc` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `__pycache__/fit-common-market-ridge.cpython-312.pyc` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `__pycache__/fit-directional-ridge.cpython-312.pyc` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `archived-public-activity.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit_momentum_attribution.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-aggressor-ranking.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-april-breadth-redundancy.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-clock-ranking.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-common-shock-witnesses.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-consumed-may-ranking.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-consumed-momentum-peers.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-entry-payoff-assumptions.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-fee-stop-paths.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-first-barrier-recorded-entries.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-hourly-entry-failures.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-intrabar-assumptions.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-may-breadth-stress.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-may-validation-readiness.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-momentum-concentration.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-native-activity-bridge.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-policy-failures.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-policy-learning.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-public-ws-capture.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-range-setups.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-regime-errors.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-support-opportunities.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-validation-behavior.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-validation-evidence.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-validation-loss.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `audit-volume-clocks.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `build-policy-labels.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `build-policy-training-corpus.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `candidate-files.mjs` | behalten | soak runtime + script tests |
| `candidate-files.test.mjs` | behalten | existing dependency test |
| `capture-historical-periods.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `check-memory-budget.ts` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `check-memory-preservation.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `check-packet-budget.ts` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `collect-archived-aggressor-corpus.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `collect-barrier-clock-corpus.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `collect-directional-clock-corpus.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `collect-feature-support.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `collect-fixed-target-observations.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `collect-public-activity.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `compare-breakout-entry.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `compare-btc-regime.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `compare-covariance.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `compare-entry-support.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `compare-feature-history-compatibility.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `compare-gain-protection.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `compare-hourly-entry.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `compare-hourly-trend-compatibility.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `compare-mock-structure.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `compare-relative-entry.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `compare-risk-execution.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `compare-structure-exit.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `describe-public-activity.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `evaluate-historical-period.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `evaluate-may-breadth-timing.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `extend-training-through-april.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `fit-aggressor-ridge.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `fit-barrier-tree-batch.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `fit-barrier-tree.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `fit-common-market-ridge.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `fit-directional-ridge.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `fit-early-may-models.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `fit-later-may-models.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `freeze-june-timing-choices.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `historical-period-files.mjs` | behalten | apps/server/test/history-runtime-patch + historical-period-files |
| `mock-experiment-files.mjs` | behalten | apps/server/test/experiment-tools |
| `observe-next-closed-candle.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `prepare-mock-experiment.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `prepare-paper-candidate.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `probe-archived-aggressor.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `probe-fixed-universe.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `process-guard.mjs` | behalten | soak / resume / paper test runtime |
| `process-guard.test.mjs` | behalten | existing guard test |
| `recapture-policy-inputs.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `replay-june-frozen-portfolio.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `replay-may-frozen-portfolio.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `report-paper-cohort.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `report-paper-vetoes.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `requirements-tree-research.txt` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `resume-main-paper.mjs` | behalten | spawned by start-paper-test |
| `run-aggressor-ridge-walkforward.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `run-barrier-broker-study.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `run-barrier-net-walkforward.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `run-barrier-tree-walkforward.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `run-common-market-ridge.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `run-directional-ridge-walkforward.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `run-fixed-target-walkforward.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `run-local-learning-extended.ts` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `run-local-learning.ts` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `run-support-entry-study.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `run-tree-broker-study.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `run-tree-fee-stress.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `snapshot-capture-rollout.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `snapshot-paper-candidate.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `snapshot-paper-rollout.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `snapshot-paper-test-rollout.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `snapshot-risk-rollout.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `soak-cli.test.mjs` | behalten | existing soak CLI test |
| `soak-core.mjs` | behalten | soak runtime + core test |
| `soak-core.test.mjs` | behalten | existing core test |
| `soak.mjs` | behalten | pnpm soak |
| `start-mock-experiment.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `start-paper-candidate.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `start-paper-test.mjs` | behalten | pnpm paper:test |
| `test_aggressor_ridge.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `test_barrier_tree.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `test_common_market_ridge.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `test_directional_ridge.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `validate-early-may-models.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `validate-later-may-models.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_aggressor_ranking.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_april_training_extension.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_archived_aggressor_corpus.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_archived_aggressor_probe.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_calendar_weighted_fit.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_common_market_ridge.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_common_shock_paper.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_consumed_may_ranking.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_directional_strength_reference.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_early_may_fit.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_early_may_validation.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_executed_activity_encoding.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_executed_activity_reference.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_feature_support.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_june_timing_choices.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_later_may_training.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_later_may_validation.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_may_breadth_stress.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_may_breadth_timing.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_may_evidence_source.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_public_activity_reference.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_public_ws_capture.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_risk_execution_ledger.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_support_entry_study.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_support_opportunities.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_synchronized_stress.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_ticker_context.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_validation_behavior.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_validation_evidence.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_validation_loss.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_volume_clock_reference.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_ws_activity_journal.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify_ws_activity_windows.py` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-aggressor-ridge-walkforward.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-barrier-broker-study.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-barrier-clock-corpus.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-barrier-net-walkforward.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-barrier-tree-walkforward.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-breakout-entry.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-calendar-weighted-training.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-capture-rollout.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-clock-ranking.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-complete-replay-parity.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-directional-clock-corpus.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-directional-ridge-walkforward.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-entry-payoff-assumptions.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-executed-activity-encoding.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-executed-activity-replay.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-first-barrier-recorded-entries.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-fixed-replay.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-fixed-target-observations.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-fixed-target-walkforward.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-frozen-v3-resume-nov04.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-hourly-entry-failures.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-hourly-entry.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-long-horizons.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-main-paper-rollout.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-native-cache-reuse.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-native-policy.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-native-public-context.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-paper-candidate.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-paper-market-breadth.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-paper-resume-2026-11-03.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-paper-test-rollout.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-policy-training-corpus.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-regime-errors.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-relative-entry.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-replay-parity.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-risk-input-contract.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-risk-rollout.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-rule-funnel.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-runtime.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-synchronized-stress.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-ticker-context.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-tree-broker-study.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-tree-fee-stress.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-volume-clocks.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-ws-activity-journal.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `verify-ws-activity-windows.mjs` | archivieren | Keine aktive Paket-/Test-/Docker-Referenz; verschoben nach scripts/archive/ |
| `write-build-manifest.mjs` | behalten | apps/server/package.json build |
