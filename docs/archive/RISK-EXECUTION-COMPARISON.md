# Paired execution-version historical comparison

This is a descriptive compatibility check of the risk/drawdown execution correction, with one fixed programmed StructureExitPaperProvider. It is not an external AI test, model training or a search for profitable parameters. The running main server uses provider none, so these historical mock decisions must not be presented as actual main-account trades or future AI results.

The four scenarios were fixed before execution: January2026 and April2026, each with the already registered0.1% and0.2% taker-fee assumptions, all other original options preserved. The earlier immutable study supplies source hashes/options, not an independent new holdout. Both months have already been inspected; July remains untouched. All20registered survivor markets are retained. Historical candle retrieval is not proof that the same prices, universe or receipt times were available to a real bot at those historical decisions.

The previous executor/risk code comes from the verified archived prior main build3b92fac27a6e17577dfdf400e0c75f44d62a870b9d106514b3cbf0405c086792. Baseline imports were relocated to explicit file URLs: its old risk module stays old; the five other direct dependencies use current files only after their bytes match the old archive. The baseline algorithm was not edited. Entire archive/source/runtime verification and the complete three-file runtime change list are checked. Each version gets a fresh provider/study and the same scenario scope/input data. Source/report pointers and old reports are preserved. Global fetch is forbidden for the comparison.

Protocol: `docs/risk-execution-comparison-protocol-*.json`. Full immutable result pointer: `docs/risk-execution-comparison-latest.json`. Independent80digitDecimal cash/fee/position-basis/realized-PNL/return reconstruction: `docs/risk-execution-ledger-independent-latest.json`. The independent ledger audit does not independently replay entry intelligence or establish realistic order-book fills.

No positive result would by itself establish profitability, and unchanged results would not make the boundary fix unnecessary. The existing25%drawdown limit is much larger than the observed few-percent losses in the first completed scenarios; those paths do not exercise the new gate. The dedicated synthetic broker/replay regressions cover breaches before execution, during latency and from known fill costs, while protecting sells and persisted peaks.

The higher-fee path may make fewer trades because the programmed entry logic already checks net costs. Its outcome is therefore a different sequence of decisions. A smaller total loss at higher fees is not evidence that paying higher fees improves the same trades, and must not be used to select a fee assumption or claim a new profitable strategy.

Detailed numerical results are generated from the sealed report below; these are total month portfolio returns on100units of simulated starting equity, not average per-trade returns. Paired variants/months/markets are dependent, and the comparison provides no new independent probability of profit. No active strategy/model, account, frozen reference, source capture or July data was modified.


| Month | Fee per side | Prior total return | Current total return | Closed trades per version | Entire result identical |
|---|---:|---:|---:|---:|---|
| 2026-01 | 0.1% | -3.073385% | -3.073385% | 44 | yes |
| 2026-01 | 0.2% | -0.706191% | -0.706191% | 2 | yes |
| 2026-04 | 0.1% | -2.860116% | -2.860116% | 45 | yes |
| 2026-04 | 0.2% | 0.000000% | 0.000000% | 0 | yes |

All8fullcurves/fill/equity results match within each pair exactly by canonical result hash. Independent ledger checks cover364fills/fees,182closedPNLs and all8fully liquidated cash balances. There is no positive trading return in these scenarios; zero trades/zero return is abstention, not a successful profit forecast.
