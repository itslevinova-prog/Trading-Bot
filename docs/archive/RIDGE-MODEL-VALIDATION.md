# Research forecast structural validation

A read-only synthetic reproduction found that a negative stored standard deviation changed a finite forecast from+.026 to-.006, while row count0, regularization0 and a ninth weight were accepted. Additional tests exposed a sparse8-slot input becoming an intercept-only prediction and null model/input exceptions. Original observation/source bytes preserved.

After the frozen hourly study terminated, own forecast validation now rejects malformed/non-object models, nonfinite/incorrect dimensions, nonpositive scales/lambda, invalid row metadata and sparse/non-array/nonfinite input. Existing model/target freshness and extrapolation abstention stay enforced. No arithmetic, target definition, trained model, provider or active strategy was changed. This is structural validation, not authentication of a valid-looking model or proof of its training provenance.

Before:6new regression cases failed. After: all23local-learning cases pass; full1132main+15offline/typechecks/build pass.120valid dense forecasts from separately transpiled original/current functions exactly match across three synthetic fitted models. These are numerical compatibility fixtures, not trading trials or deployed model fits. Details in ridge-model-validation-proof.json, contract, compatibility proof and raw logs.

Hourly research report remains pinned to study build411fdd18c00b6365f6ac19709d5edc48fe1f4c623b308083e7551251455f0e70 before this correction. That policy never called the ridge module. Current working build is separately recorded; old study results were not relabelled as a replay of the new build. Neither rule nor learner is promoted; July holdout remains locked.
