# Aggressor opportunity-ranking audit

The fixed protocol reuses the existing outcome-blind ranking function and the ORIGINAL0.005net-forecast margin. No fit, threshold search or new selector was introduced. All6,560test rows,328original12h clocks and41folds remain; source-missing forecasts abstain explicitly. Already costed barrier labels are attached only AFTER selecting the maximum-score candidate. Costs are not subtracted a second time.

| Variant | Ranked opportunities | Mean forecast | Mean known opportunity label |
| --- | ---: | ---: | ---: |
| Original8D ridge |50|0.00899812214249873|-0.005717407835070123|
| Fair common-row8D |50|0.008995802945912556|-0.005717407835070123|
| New9D aggressor |56|0.009008701557483732|-0.004800110897939689|
| Original validation selector |11|0.009657938021440321|-0.004427206417030649|
| Extended validation selector |11|0.009667506935936838|-0.004427206417030649|

Zero and mean baselines choose no opportunities at this margin. The new standalone model selects more opportunities but their mean costed label remains negative. Its mean winner forecast exceeds the mean outcome by0.0138088return units, about1.38percentage points. This is a descriptive optimism diagnostic on known history, not a calibrated error bound or probability.

Common8Dversus9D has272both-NO-TRADE clocks,43same-winner clocks,7switched candidates and6added candidates; none removed. The arithmetic sum of label differences is+0.017064181468883555across328clocks, but this is NOT a capital or portfolio return. The original and extended validation selectors have exactly the SAME candidate-or-NO-TRADE key at ALL328clocks, including the same11opportunities. Small aggregate forecast-error changes therefore did not change the selected opportunities. No continuous broker return is inferred or claimed rerun.

Result: aggressor-ranking-audit-fbcfb4343dd6bd93.json, SHA fbcfb4343dd6bd93fb8041dcffe32e78521ead2873cc7344a46f23b753e719a2. Entire original zero/mean/ridge/selected choice records reproduce exactly, including timing/label flags. Independent Python sorting checks45,920forecast rows,2,296clock choices,328matched differences, all label/bound/summary fields and selector-key equality. No ambiguous selected labels occurred; the one underlying ambiguous label is preserved in the original dataset. Eight existing rank-function tests pass, including outcome-independence. Proof: aggressor-ranking-independent.json.

No model or policy is promoted. These are ranked opportunities and idealized barrier labels, not56executed trades or independent samples. The fixed-margin audit provides no reason to implement a new broker variant now. Historical availability is still modeled; source/capture gates, baseline datasets, accounts, runtime configurations and the July lock remain unchanged.

The next useful risk investigation is training-support coverage and source-validity propagation. An accepted numerical forecast or outlier-inlier flag is not sufficient evidence that its inputs were observed, representative or profitable. See upstream-research/REVIEW-PASS27.md for the pinned dependency boundary and limitations.
