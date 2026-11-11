# Frozen local models in the existing paper broker

Research only. The adapter in apps/server/src/research/barrier-broker-provider.ts is not registered as an active provider. It supplies frozen chronological model forecasts to the existing unchanged offline broker, with exact prior-feature origin and a15minute delay between the12h signal clock and entry. It cannot access an exchange, database, financial account or external model.

Six known historical months/20survivor symbols form a continuous164day test interval,19Oct2025 through1Apr2026, with no4day cash resets. Original100EUR start, fee0.1%, spread10bps, slippage8bps, exchange minimums/lot rounding, Safe mode, risk/drawdown/cooldown limits and independent protection remain. A model may propose one entry only when no position is held, net forecast exceeds the previously fixed0.005 margin, and both signal and current source/clock/book/cost/valuation checks pass. Budget uses the existing Safe15% maximum, with common broker limits still authoritative. This differs explicitly from the old10% equal-fraction capital diagnostic.

The target is fixed2% fee-inclusive stop/4% fill-based target and8h maximum holding. Timeout sells use the first available decision open, which can differ from the label's horizon close. The existing broker retains conservative stop-first ambiguity, worse gap stops, conservative favorable targets, failed exit/dust handling and final-liquidation convention. Model training labels do not silently override actual fills.

Registered before this broker result: barrier-broker-design-v1.json and barrier-broker-protocol-v1.json. Runner saves hash-verified per-variant checkpoints; never restart a live job because of an observation timeout. Frozen model snapshots/validation choices are from the prior41fold comparison. No parameter, model, fee or horizon sweep.

## Verified result

Study barrier-broker-study-41357259f1631864.json, facts SHA25641357259f1631864199767b38b395aba3f2b4db5505c87505549d55a1e0c39a4:

| Complete decision system | Closed trades | Net return | Final equity from100EUR |
| --- | ---: | ---: | ---: |
| Unchanged hourly-rule baseline |105|−8.94089448%|91.05910552|
| Frozen ridge model policy |50|−4.39065250%|95.60934750|
| Validation-selected zero/mean/ridge policy |11|−0.87456182%|99.12543818|
| Cash/zero/nonpositive mean controls |0|0%|100|

Cash/zero/mean are analytical no-entry controls: all frozen means are nonpositive and cannot pass the fixed net-forecast margin. They were not separately replayed; no fictitious curves or executions were generated. The hourly-rule baseline is unchanged source, but model systems have different entry frequency/exits/single-position exposure. Reduced loss cannot be attributed solely to learning, and NONE beats cash here. No model is promoted, calibrated probability claimed, or profit established. This is retrospective evaluation on already-consumed data with survivor/later metadata bias, not independent unseen or deployable performance.

Independent verifier checked ALL332paid fills,47232mark-to-market curve points, cash/fee/PnL conservation, initial ATR-based source stops/targets or fixed model barriers, exact raw exit references, drawdown/lot/minimum rules, model timing/ranking/sizing and13120signal vectors/forecasts. Every observed model signal exactly matches the original bounded750past-only corpus and frozen predictions. Proof barrier-broker-verification.json; recheck node scripts/verify-barrier-broker-study.mjs.

The supplementary barrier-label-broker-alignment.json retains61accepted model roundtrips. One ridge entry has unresolved entry-bar timing; no accepted label was both-barrier ambiguous. Ten ridge and two selected outcomes differ materially from their costed training labels (up to0.00971497of trade basis). These are not portfolio-return deltas or executable alternatives; they demonstrate why exact broker evaluation matters. No losses, uncertain cases or broker rejections were removed.

Full1238main/15offline tests, typechecks and build passed (data/verify-barrier-broker-2026-11-01.log). Sixteen direct adapter tests include actual shared-broker minimum rejection and timeout. Build e0ec7f7af9ac946947a1e8ea94cfd93d373b3d094a0ecc0c142fe18e945dba85,131source/121runtime. All113runtime files from the previously loaded main are byte-identical; new adapter has no active-provider import. Current process availability is a separate observation, not implied by successful historical tests.

Upstream pass21 verifies pinned Jesse opening-gap accounting and red/green intrabar path heuristics. Own same-OHLC/two-opposite-first-hit counterexample justifies retaining ambiguity instead of importing a favorable path assumption. No foreign code was ported, no dependencies installed, no original engine/frozen reference/dataset/account/active configuration changed. July remains locked.

Next: restore the existing stopped free paper references only after process/port/build ownership checks, preserve the shutdown observation gap, then investigate regime/cost-conditioned model errors before a separately registered new hypothesis. Do not tune the margin to rescue this result or turn on the losing model.


Paper observation resumed 2026-11-02T14:56:58.707Z after explicit stopped-process/free-port checks and backups. Main31844/runf4164d25-1028-443c-9b61-c47f1fe017d8; frozenV322760/runeaff91e9-2e7e-4f68-8d3e-2a8d43d76441 with original cc123 build/contract/epochs/hold receipt unchanged.48main oldepochs and3frozen oldepochs/trades retained. Both expose only Paper, external AI off; no candidate activated. Actual forward gap85408411ms is retained, not reconstructed. See data/paper-resume-proof-2026-11-02.json.
