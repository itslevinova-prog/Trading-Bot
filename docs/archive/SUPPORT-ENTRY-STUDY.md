# One fixed empirical training-support entry rule

This is an opt-in research candidate, not an active trading rule. The source-support diagnostic suggested a possible coverage risk on known history. The candidate was chosen after that diagnostic, so its subsequent evaluation is explicitly exploratory/retrospective, not independent unseen evidence.

ONEfixed rule uses the95thnearest-rank percentile of each frozen training snapshot's clock-excluded nearest distances. It never sees query outcomes or uses a threshold sweep. The95is an empirical row quantile, NOT95%confidence, win probability, independent coverage or a loss guarantee. Same-clock asset siblings remain excluded from training reference distances; minimum200rows and existing source/clock/z6guards stay intact.

`supportGuardedForecasts` derives a separate masked entry-score array while preserving every original prediction. Missing original forecasts never reactivate. Missing source/invalid/degenerate geometry stays unavailable. Crucially, ALLcandidates are masked BEFOREmaximum-score ranking, allowing a supported second candidate to replace an unsupported first candidate. The helper takes no orders or sell actions; protective/discretionary exits must never be routed through it. No active strategy, serializer, model or risk limit was changed.

Protocol support-entry-study-protocol-v1.json was saved before evaluation. All6,560test rows/328clocks/41folds are retained for both matched8D/9Dspaces, with the original0.005net-forecast margin and costed target. No predictive model was refitted and no new validation selector was chosen.

| Space | Before: ranked opportunities | After | After mean costed opportunity label |
| --- | ---: | ---: | ---: |
| Common8D |50|36|-0.004729082386472118|
| Aggressor9D |56|42|-0.0034430054718428893|

Both averages remain negative. Scores were newly masked on309common8Dand301aggressor9Dquery rows, including54and51above-margin candidates. Four common and six aggressor clocks select a supported alternative candidate after the old first choice is masked. No new opportunity clock is created, no null forecast becomes valid, and original control records are unchanged. These are idealized opportunity labels, not actual fills or portfolio returns. This result does not justify activation, a threshold adjustment or a new broker model.

Result support-entry-study-fde9532cba7b6072.json, SHA fde9532cba7b6072a7311118b9447ac998cb918aa0a8b163e9cb4c603d3e8c7b. Independent Python verification checks82training-only cutoffs,13,120entry-score rows,656clock decisions, correct before-ranking masking, all controls and all label/statistic fields. Six new guard tests plus12support and8ranking tests pass (26total); server/test typechecks and isolated build pass. Proof: support-entry-independent.json. No source row imputation, protective-exit change, parameter search, July access, external model, paid call or private order occurred.

Keep the failed/tiny-result research chain visible. Before proposing another entry condition, examine whether the validation objective and its available clock-level sample can support conditional model selection. Numerical outlier status, empirical training coverage and expected profit are different concepts; none should substitute for the others.
