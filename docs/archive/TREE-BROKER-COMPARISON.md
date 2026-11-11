# Optional tree forecasts through the unchanged paper broker

Research only: the adapter now accepts an optional sealed tree snapshot and explicit tree choice. Ridge remains the original branch; missing/mismatched/tampered tree tags fail rather than fall back to another model. Target, fit clock, label maturity and known/ambiguous counts must match the corresponding ridge fold. Signal audit points to the model actually used. No active provider factory, account/config/dashboard or exchange functionality changed.

20adapter tests plus12tree tests passed. The full project suite passed1274main tests across98files,15offline tests, typechecks and build0ba84ead6c26ffa74755bb0a567f550bd5fb931e0de7ac5e17c9f3193c09a399. Core portfolio/risk engine is unchanged. The prior adapter is preserved in build archivee0ec7...; exact old/new source hashes are in barrier-broker-tree-extension-v1.json.

## Actual continuous164day broker results

Registered before these results: tree-broker-study-protocol-v1.json. Same known20survivor universe/164day test interval,100EUR start,0.1%fee,10bps spread/8bps slippage,15%Safe maximum/one-held-position, exact delayed12h signals/15m entry, independent2%stop/4%target/8h timeout and original broker limits. No cash resets or threshold/sizing search.

| Variant | Trades | Net portfolio return |
| --- | ---: | ---: |
| Original ridge reference |50|−4.39065250%|
| Original validation-selector reference |11|−0.87456182%|
| Fixed standalone tree |121|−7.19921142%|
| Extended validation selector |24|+0.49841955%|

Both old reference FULL result hashes match their original curves/fills/fees/reasons exactly after the optional-tree extension. The earlier unchanged hourly baseline is retained at−8.94089448%from its independently verified report; it was not replayed here. Cash stays0%. All26240model signal vectors/forecasts and model identities match frozen source forecasts. Independent412paid fills/62976curve points, budgets, fees, PnL, protection prices, minimum/lot rules, drawdowns and origin clocks passed verification. Study tree-broker-study-b38666f47be482b6.json, SHA256b38666f47be482b6a2153aa8d9019c31dba17cdec582f56e32b0e26a2366ee2e; proof tree-broker-verification.json.

The single tree performs worse than ridge despite extra complexity. Extended selection's small positive result is24dependent historical trades on already-consumed data, not evidence of high future profit probability, independent out-of-sample success or readiness. It remains disabled. Original label/execution/entry-bar uncertainty and survivor/later-metadata bias remain.

## Fixed-entry2xfee stress

Before inspecting a new stress result, tree-fee-stress-protocol-v1.json freezes ALL24base entry intents (the base has no rejected proposals). A same-fee replay first reproduces the FULL positive base result exactly. Then only taker fee doubles0.1%→0.2%, spread/slippage stay fixed. This is one predeclared scenario, not a fee sweep. The normal model adapter's fee-domain guard remains intact: an unmodified adapter would refuse mismatched costs. This isolated frozen-intent experiment measures sensitivity of the entry plan, not newly adapted forecasts or an enabled bot's behavior.

Same-fee result+0.49841955%, double-fee result−0.54208995%,24closed trades in both. Independent96fills/31488curve points, all ledger/price/risk-origin arithmetic pass. All24pair/entry clocks match;20absolute quantities,4exit clocks and2exit reasons differ as fee-inclusive stop basis and cash evolve. We do not claim fixed absolute exposure or fixed exits. Fees paid0.71634504EUR versus1.42170117EUR. The return delta is not just an assumed fee subtraction; the broker actually reruns protection and accounting. No entry, loser, rejection or dust was removed.

Stress report tree-fee-stress-44fc4391adc37a68.json, SHA25644fc4391adc37a684ff3c93605d570ddaa9cae7630623d715a0199ad5c0c75f4; independent proof tree-fee-stress-verification.json and alignment tree-fee-stress-alignment.json. The apparent base gain does not survive this cost scenario, so no robust edge is established. Fee assumptions are experimental values, not a statement of any user's current exchange tier.

The root working build changes only one previously present research adapter;120of121previous main runtime files remain byte-identical. Both actual active Paper processes keep their prior run/build/provider settings (mainnone/externalAIoff; frozenV3mock/externalAIoff). The research adapter is not registered as active, neither process was restarted, frozen contracts/accounts/data/default reference are untouched. See data/tree-broker-runtime-isolation-2026-11-02.json.

PASS23 additionally inspects pinned FreqAI recency/split options and demonstrates why ordinal weights should not be copied blindly into pooled same-clock asset rows. No recency/extra parameter was applied to this comparison. Next examine the four fee-induced changed exit paths and suitable time-dependent robustness methods against the pinned Jesse/OctoBot sources. Keep July locked and avoid changing margin/tree settings to rescue this small result.
