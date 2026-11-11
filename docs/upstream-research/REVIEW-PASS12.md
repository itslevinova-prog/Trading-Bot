# Review pass12 — profit offset versus a discrete closed-price exit

Re-read targeted Freqtrade strategy/interface.py sections around initial stop, dir_correct, bound/bound_profit and trailing_stop_positive_offset/trailing_only_offset_is_reached. Same pinned archive, no new file:44selected files including5licences, whole-repository review remains incomplete.

The code initializes a stop from open_rate, checks direction against low/high or current_rate, and uses the relevant candle bound/current profit to decide whether the positive-offset trailing update is eligible. For longs the backtest bound is high; for shorts it is low. It then calls the trade stop adjustment. We did not verify the entire upstream intrabar event model or assert it is erroneous. That is a different abstraction from our explicitly conservative closed-price-only hypothesis. No GPL code or upstream order adapter was copied.

Own implementation: a separate research provider can issue a discretionary full SELL after an older CLOSED mark >=one original modelled risk and a later current fresh bid net mark <=zero. Its48h witness is based on close points available before the current signal, scoped original fill/fee/stop and conservative cost assumptions. Actual first receipts/historical quotes are not known. No candle high/low watermark, native trailing stop, stop mutation, guaranteed breakeven fill or original stop removal is implemented.

Unit and complete synthetic-replay probes demonstrate the rule can execute after a real closed witness, ignores a high-only peak, and may still realize a small loss. Scope/origin/compound entries, missing/invalid grids, fee mismatch, stale evidence, future/current witnesses and partial holdings are checked. A recent existential witness may be valid without claiming complete older holding history. Baseline native/strategy exits keep priority.

Predeclared1R/48h values were not swept after the historical test. The known January/April full replay produced no additional exit, despite124/62 witness observations in base-fee scenarios. Other baseline exits or continued positive marks cover these observed cases; the consumed-history giveback count by itself did not establish a profitable or incrementally useful rule. Keep it unpromoted and prioritize entry/regime intelligence rather than repeatedly loosening exit thresholds to force an improvement.

Primary source: https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/strategy/interface.py
