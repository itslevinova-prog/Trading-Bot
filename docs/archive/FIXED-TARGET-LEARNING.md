# Explicit fixed-target local research

The prior8D ridge predicted4hour gross returns; actual hourly-policy holding times had median405minutes and range15..2025. This mismatch motivated a separately declared8hour target, not a claim that changing horizons would be profitable. Legacy4h6h builder/capital code remains unchanged.

New fixed-target contracts bind horizon, stride, delayed entry, gross-return units, explicit ordered8feature schema, bounded750 source policy and data scope. Every row carries its target hash. Model body/contract hashes prevent accidental corruption or target conversion; they are not cryptographic authentication of true training provenance. Mixed contracts, future labels, malformed vectors/models and mismatched inference abstain/reject.8h rows cannot pass the legacy4h diagnostic. Complete closed source windows, exact future paths and independent raw verification are required; no fabricated gaps. Initial available history is limited by source warmup even though cap750 matches runtime policy.

Six existing Oct2025..Mar2026 training datasets were joined continuously across20survivor symbols.441600input bars contain76800identical overlapping warmup bars, producing364800unique source bars. Conflict/missing paths reject.7280exact8hour observations at364UTC12hclocks form a NEW gross-target corpus, not additional selected-policyPnL labels. The old196mature policy labels remain below their gate; no pooling to200. Every target and feature vector independently verified against raw candles, independent UTC-hour aggregation and preserved original feature formulas on complete windows. No external request or new capture budget.

Before model outcomes, froze one8h/12h study with lambda10,14day train/4validation/4test,4day step, strictly matured labels and original fixed MAE/95%coverage choice among zero/mean/ridge.41nonoverlapping historical test windows contain6560rows. Each560-row train window has only28distinct decision clocks across20correlated assets; validation/test each160rows across8clocks. These are descriptive structures, NOT independent sample counts. No horizon/feature/parameter search. Train-only moments and ridge normal equations, all6560test forecasts, validation choices and591capital positions including stress independently checked.

| Fixed8h diagnostic | Base return | Entries | Same-entry2xcost return |
|---|---:|---:|---:|
| Zero/cash |0%|0|0%|
| Training mean |0%|0|0%|
| Ridge | -13.1808% |232| -21.9194% |
| Validation-selected | -1.8816% |11| -2.3686% |

Ridge MAE.0190448 vs zero.0175211 is worse. Selection chose zero27windows, mean10, ridge4. Adaptive2xcost returns(-11.5261%ridge,-1.3359%selected) are less negative because eligibility changes; this is NOT better execution. Paired stress retains selected symbols/clocks and the10%allocation rule, not identical absolute quantities after cash paths diverge.

These normalized fixed-horizon capital results are NOT actual broker/mock policy returns and are unrelated to the older42-trade/-1.89% test. Assumed delayed open/exact8hclose, max3positions per12hclock,10%allocation each, no stops/depth/queues/lot minima/outages/intrahorizon valuation. Settlement clocks are explicit; future proceeds cannot fund overlapping entries. Sparse predictions/overflow cannot create a result. Costed4h reference math at matched clocks exactly equals legacy diagnostic arithmetic in tests.

Full1163main+15offline/typechecks/build green. Current working66dd06... adds only2offline research modules; all113previously loaded main runtime files remain byte-identical. Main staysc2f35b...AInone/off, V3cc123...same mock run.41local numerical matrices were fitted for research, NO provider/model was activated, July outcomes untouched. Negative results do not justify tuning knobs to rescue this target or claiming profit. Next select a source-informed, falsifiable market-context hypothesis with proper costed evaluation; deeper OSS architecture/ML/strategy review remains incomplete.
