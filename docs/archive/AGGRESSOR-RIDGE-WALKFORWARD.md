# Fixed9D aggressor ridge comparison

One registered linear ablation adds the fixed4h quote-volume-weighted aggressor imbalance to the original eight features. It uses the newly verified original raw-page sidecar, not newly fetched data. Historical close availability is explicitly modeled; actual first receipt remains unobserved. Original survivor/known-history limitations remain.

All41original purged14/4/4-day chronological folds, original costed2%stop/4%target/8h labels, ridge lambda10,200known-row minimum, train-only population scaling and z6/ten-day abstention guards are preserved. No parameter, horizon, feature or threshold search occurred. Common8D and9D models train on IDENTICAL source-available known rows. Source-missing queries abstain for both; no zero input is invented. Entire original training labels, including ambiguous labels, are validated and must mature strictly before training. Query payloads contain features only. Local existing NumPy performs numerical fitting; no external AI/model/service is used.

| Forecast | Test MAE | Coverage |
| --- | ---: | ---: |
| Original train mean |0.014350822607371427|1|
| Original full8D ridge |0.014676210501317951|0.9824695121951219|
| Common-row8D ridge |0.01468138865370275|0.98125|
| New9D aggressor ridge |0.014673582894196388|0.98125|
| Original validation selector |0.0147416063388946|0.9954268292682927|
| Extended validation selector |0.014737944753734173|0.9952743902439024|

The extra feature produces only a tiny aggregate MAE change relative to its fair8Dcontrol and remains worse than the mean baseline. This is not a robust edge or a reason to activate it. Extended choices are zero8, mean24, originalridge3, commonridge3, aggressor3; selection uses validation MAE/95%coverage/conservative ties, never test outcomes. Test data contains6,560dependent forecasts,6,559known payoff labels,1ambiguous label and8source-missing rows. None of these counts is a trade count, independent sample count or win probability. Abstentions are scored as zero forecasts consistently with the original protocol; unknown payoff labels are not scored.

Result: aggressor-ridge-walkforward-9e6096906eea1521.json, SHA9e6096906eea152134caed8459188588a1beb4af80cf0a5aff2daf8d4bf5a916. All old zero/mean/full8D metrics reproduce exactly. Native/common8Dcontrol prediction differences are at most6.39e-16. Independent verification checks697train-only normal equations (maximum residual4.49e-15),26,240native raw queries including32explicit missing results,32,800saved test forecast values, matched training/query identities, original controls and every metric/validation choice. See aggressor-ridge-verification.json. Three synthetic Python tests verify query-fit independence, explicit missing queries, source domain, label maturity, duplicate/invalid data and the unchanged200-row gate.

No broker portfolio return, profit probability or model activation is inferred. No active provider, prompt budget, account, database, frozen reference or process changed, and no network request was needed. The earlier fee-stress failure and July lock remain. Forecast MAE alone does not assess which opportunities a strategy selects; the next decision-focused audit should reuse the EXISTING fixed0.005ranking margin and outcome-blind clock-ranking function, preserve all controls, and distinguish opportunity-label diagnostics from actual continuous broker returns. Do not tune a new threshold to rescue this result.
