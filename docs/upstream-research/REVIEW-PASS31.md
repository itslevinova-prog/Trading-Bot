# Pinned follow-up31: chronological weighting versus continual learning

Retained Freqtrade commit7fea5ea24b3c3193cfdd4143b243f7baab66d661/GPL-3.0 only. data_kitchen.py make_train_test_datasets lines126–160 optionally constructs weights before its configured split, defaults shuffle false if absent; set_weights_higher_recent around407–417 uses exponential row-position decay. LightGBMRegressor.py around40–60 forwards sample_weight/eval_sample_weight and init_model. freqai_interface.py get_init_model around784–795 returns an old model only if it exists and continual_learning is enabled. These separate weighting, train/test setup and model reuse. The code alone is not a universal no-leakage guarantee; feature selection/scaling, label maturity and configuration still require their own checks.

For our multiasset pooled observations, a row-index decay cannot be assumed to be calendar recency or shared-clock mass. Own outcome-blind/calendar-maturity/group-normalized weights and optional weighted local ridge were implemented without copying vendor source or installing LightGBM/Freqtrade. Default actual8479rowfit exactlymatches sealed oldmodel;52tests/types/build/independent80digit8479weights+matrix checks pass. Thirty-day witness is numerical only; no May retest or new profit claim. CALENDAR-CLOCK-WEIGHTING.md records scope and next preregistered evaluation constraints.

No new source files, code port, licence changes, provider activation or framework execution. Inventory56incl6licences remainspartial. RecheckedSHA256:
- docs/upstream-research/freqtrade/source/freqtrade/freqai/data_kitchen.py: 00a0d1089dab1a8ae47ef5282ca6aa1c1fbb71cb95dc27193fee61c1d1bce82e
- docs/upstream-research/freqtrade/source/freqtrade/freqai/prediction_models/LightGBMRegressor.py: aa3a3e7cb6b2c0be75c8266650efc7997496b49bebe1ec3ae661e578378880cf
- docs/upstream-research/freqtrade/source/freqtrade/freqai/freqai_interface.py: fa0c3d1835ea3e2804d23617095d877d760b357bfd02ec30a954b4ae16154065
