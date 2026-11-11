# Frozen early-May validation result

The preregistered first10Maydays (1May00:00UTC through11May00:00UTC exclusive) were evaluated once with the frozen zero/training-mean/ridge-lambda10candidates. All400pair slots at20shared12hour clocks were retained. These are20dependent temporal observations, not400independent trading trials. No model was refitted and no cost/threshold/model-age parameter was changed.

Before reading target labels, a separate scoring registration pinned the frozen model bytes, source bindings, null forecast handling and fixed0.005ranking margin. All400feature/prediction rows were then saved immutably before the future target-path stage. Feature inputs were filtered to candles closed at each decision, with the prior April archive supplying continuous history; overlapping April/May warmup bars matched exactly. Both15minute and hourly input windows retain their existing750cap. Later May outcomes, June and July were not evaluated.

All400labels were known (328horizon-close/24target/48stop). These are fixed costed idealized barrier labels with delayed entry, not broker fills, realized portfolio trades or profit probabilities. The independent80digitDecimal audit reconstructed every label from original raw pages and checked all1,200candidate prediction slots against saved parameters/age/z6guards, MAE/RMSE/coverage, selection and ranking. It relies on the separately tested past-only indicator pipeline for the stored feature vectors; it does not independently reimplement indicators.

| Frozen candidate | MAE, return fraction | RMSE, return fraction | Forecast coverage | Above fixed0.005margin | Ranked opportunity clocks |
|---|---:|---:|---:|---:|---:|
| Zero / abstain baseline |0.0108607659|0.0145271854|100%|0|0|
| Training mean |0.0113242063|0.0155220794|100%|0|0|
| Ridge lambda10 |0.0113858346|0.0156150044|99.75%|0|0|

The frozen selector chooses **zero**. Ridge has one positive forecast below the entry margin and one null forecast from its existing support guard. That null remains null in the forecast record and denominator; its known-label scoring loss is explicitly the zero-abstention loss, not a fabricated zero model forecast. The learned candidates are less accurate than the zero baseline on these target errors. No candidate proposes a ranked opportunity on any of the20clocks. This establishes no prediction or profit advantage. MAE/RMSE are prediction errors, not trading returns; zero-opportunity output is abstention, not a successful profitable model.

Evidence pointers: `docs/early-may-validation-latest.json` and `docs/early-may-validation-independent-latest.json`. The main report references scoring registration, frozen forecasts, frozen models and their hashes. Runners: `scripts/validate-early-may-models.mjs` and `scripts/verify_early_may_validation.py`.63existing fixed-target/barrier/learning/ranking/validation contract tests pass. No production runtime/provider/account/reference changes were made.

These May validation outcomes are now consumed and must not be advertised as untouched holdout data for another tuned model. Preserve this negative result. Future changes need a justified hypothesis and preregistered unused chronological evidence; do not lower the entry margin, drop abstention clocks, weaken model-age bounds or fit on May validation rows to make this test pass. Review targeted upstream adaptive-learning/decision contracts and this model's limitations before choosing further implementation. The100hour goal remains incomplete.
