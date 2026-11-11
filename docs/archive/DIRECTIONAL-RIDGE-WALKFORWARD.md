# Fixed directional-strength ridge ablation

One new feature contract, `closed-vector8-plus-dmi2-v1`, appends closed-window ADX14/100 and signed directional-movement balance to the unchanged eight original inputs. ADX slope, duplicate DI sides, interactions, extra volume proxies and tuned thresholds are deliberately outside this registered comparison. No active model or prompt schema is widened.

Protocol `directional-ridge-protocol-v1.json` was saved before fitting. The local numerical Python fitter uses existing NumPy only, with fixed ridge lambda 10 and training-only population scaling. There is no external AI, service, package installation, parameter search or provider integration. Four synthetic tests cover query/model independence, unavailable/duplicate/nonfinite labels, feature domains, extra query-label rejection and constant columns.

All 41 original chronological folds and their 14/4/4-day train/validation/test windows are preserved. Labels must mature strictly before the next phase; the original full label/target validator checks training rows, including unknown paths, before known labels are sent to NumPy. Validation/test query payloads contain features only. The original ten-day freshness and z-score-six abstention rules remain. Coverage-qualified validation MAE selects in stable zero/mean/8D/10D order with conservative ties; no test outcome chooses a model.

| Forecast | Test MAE in return units | Coverage |
| --- | ---: | ---: |
| Train mean | 0.014350822607371427 | 1 |
| Original 8D ridge | 0.014676210501317951 | 0.9824695121951219 |
| New 10D directional ridge | 0.014789622389956793 | 0.9824695121951219 |
| Original validation selector | 0.0147416063388946 | 0.9954268292682927 |
| Extended validation selector | 0.0147163588071611 | 0.9952743902439024 |

The standalone added-feature model is worse than both the original ridge and train mean. The selector's small change also remains worse than the mean; it establishes no robust improvement. Extended choices: zero 8, mean 24, original ridge 5, directional ridge 4. These are 6,560 test forecasts with 6,559 known labels and one explicit unknown, not trades or independent observations. No portfolio return or win probability is calculated. Known retrospective survivor data and previously inspected outcomes remain limitations; adding causal features does not make the experiment independent unseen evidence.

Result: `directional-ridge-walkforward-bf3f0f7644d7fe9c.json`, SHA `bf3f0f7644d7fe9cc15acf4cf69343fa5098d778fda664115bc04996bd1a9dea`. All old zero/mean/8D metrics reproduce exactly. Native 8D predictions match old sealed models within 3.61e-16; native/portable 10D prediction difference is at most 2.09e-17. The separate verifier checks 738 train-only normal equations (maximum residual 6.12e-15), 26,240 native raw query predictions and 26,240 saved test forecast values, source/query identities, original controls, metrics and validation choices. Verification is in `directional-ridge-verification.json`.

The new model remains offline and unregistered. No broker rerun or new strategy gate is justified by this forecast result alone. Preserve the unsuccessful comparison; do not tune its strength cutoff, added columns, ridge penalty or test window to rescue it. Earlier fee-stress failure remains unchanged, July remains locked, and the frozen forward references continue under their original rules. Next examine a distinct volume/data-availability contract from pinned upstream sources before proposing another feature hypothesis.
