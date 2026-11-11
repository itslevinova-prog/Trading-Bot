# Causal entry/outcome attribution — development data only

January/April programmed trend and structure strategies were replayed at .001/.002fees with accepted-fill source snapshots from the existing shared interpreter. Every full result exactly matches its preserved corrected simulation, including fills, curves, costs and cash. No decisions were changed by this audit, no external or trained AI was evaluated, and July was not loaded.

177scoped rows represent only103distinct pair/entry clocks across different policies/fees. Neither count is a number of independent samples: markets, holding periods and policy variants overlap.176uncensored historical labels are available under the explicitly modelled maturity contract; one forced evaluation-end liquidation is censored. No future return/label exists in decisionInputs. Actual materializedAt remains on stored labels; semantic hashes exclude only actual materialization clocks. The stored facts and row hashes, original feature closure, modelled pre-maturity exclusion and post-maturity counts were independently verified after writing.

Original decision feature/structure/assessment hashes are captured from actually accepted buys. Rejected proposals produce no origin. Labels use existing full-roundtrip paid entry/exit arithmetic and scoped dataset/build/module/scenario identity. Decision inputs, entry RECEIPTS and postOutcome targets/diagnostics are separate: actual fills and future results must never be fed to a pre-entry predictor. Current feature.spreadPct is the recorded midpoint-percent field; the legacy21field input schema's bid-relative spreadBps is not silently treated as the same unit.

## Findings

For structure-exit at0.1% fees:
- January44entries:27rolling exits (22losses/5profits),10protective stops (all losses),7targets.15of32losses had a positive strictly interior hypothetical net close beforehand.
- April45entries:35rolling exits (31losses/4profits),4protective stops (losses),5targets and one other strategy loss.19of36losses had a positive interior hypothetical net close beforehand.

Thus34of68losses have documented positive interior CLOSE marks under assumed exit friction. They are not demonstrated recoverable profits: entry/exit bars are deliberately excluded, historical books/receipt delays are unknown, and these marks are not executable alternative fills. Protecting a prior gain may also terminate eventual winners, change subsequent entries/cash/exposure and increase fees. A full causal strategy replay is needed; selected losing-trade arithmetic is not an improvement claim.

Trend baseline also gives back gains: January15of26losses and April21of36losses had a positive interior close (one additional April end liquidation censored). Higher-fee cases have only two trades per January variant and none in April; no general inference from such tiny samples. Learner fitting, calibration and policy promotion are not performed here.

## Implementation and limits

policy-failure.ts classifies actual receipt exit reasons and computes ONLY strict interior closed-bar net marks. Missing/duplicate/off-grid/invalid interior history stays unknown, not interpolated. Same/next-bar exits yield null marks, not fake0% observations. Entry/exit/future extrema cannot fabricate an interior gain. These post-outcome fields remain diagnostics, never eligible decision-time inputs. No threshold scan or hypothetical perfect-price exit is run.

15new tests; full1004main+15offline/typecheck/build pass. Audit954c617d74217901615b62dbe576dc981a58739d61a90f6ed4eff7abfcf77238, verification/proof JSON and log retain exact sources. Working build36b78687b49cc5ac1f06a8ce18486d57c78ca0fc27c987eb937fab99ff2e0b47. Frozen V3 files unchanged; no restart/deployment, data reset, model service or real-money access.

Next: before looking at finer outcome distributions, specify a simple causal gain-protection rule based on available post-entry CLOSED observations and original recorded risk, test both losers and winners/fees/reentries, and retain July lock. A low-dimensional local learner is another research route, but one policy's January44rows remain a small, selected, dependent sample. No complex classifier or calibrated win probabilities should be forced from177pooled rows.
