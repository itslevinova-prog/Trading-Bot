# Review pass11 — spread units and strict boundary semantics

Archived and read the small Freqtrade SpreadFilter.py at pinned7fea5ea24b3c3193cfdd4143b243f7baab66d661; source hash/URL/retrieval time are in freqtrade/manifest-spread-review.json. Total selected files44 including5licences; thorough whole-repository review remains incomplete.

The filter computes1-bid/ask (ask-relative ratio), rejects above max_spread_ratio, requires usable bid/ask ticker values and declares SupportsBacktesting.NO. Its configured zero disables the pairlist filter. Those units and zero semantics are not interchangeable with our hard entry cap. No GPL code was copied or executed, and no current ticker-based whitelist was retroactively applied to historical constituents.

Our broker already computes (ask-bid)/mid in basis points with1e-8 floating tolerance. The programmed paper-intelligence layer independently used (ask/bid-1)*10000, a bid-relative quantity. A10bps midpoint quote is about10.005bps relative to bid, causing every model entry in the initial new-period10bps-spread scenario to be vetoed. That cash-only result does not show intelligent market selection. All old reports are preserved.

Own fix: reuse the EXISTING entryQuoteGuard in paper-intelligence, same10bps hard cap and tolerance, rather than relaxing a threshold or adopting Freqtrade's differing formula/zero-disable meaning. Tests prove both layers agree at exact10bps, reject10.1bps, and allow a true zero spread at a zero cap. Evidence labels the cost guard implementation. No other strategy condition/risk limit is intentionally changed. Frozen prospective V3 remains on its old copied version.

The post-discovery source patch is registered separately before corrected January/April outcomes, with old strategy outputs retained. Corrected comparisons are explicitly a changed implementation on now-consumed periods, not pristine out-of-sample results. July outcome lock remains. Historical quotes/depth/slippage are synthetic assumptions, not archived actual books.

Primary source: https://github.com/freqtrade/freqtrade/blob/7fea5ea24b3c3193cfdd4143b243f7baab66d661/freqtrade/plugins/pairlist/SpreadFilter.py
