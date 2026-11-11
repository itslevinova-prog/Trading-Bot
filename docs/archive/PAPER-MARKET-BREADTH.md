# Paper market breadth

The Paper collector now summarizes a single closed 15-minute clock. Feature coverage requires a matching pair, candle timestamp and close. Hourly trend coverage additionally requires the latest hourly endpoint and the existing hourly EMA evidence check. The 24-hour change uses all 96 closed candles and the preceding close. A duplicate or missing row makes that return unavailable. Duplicate pair rows and foreign quotes contribute to neither metric.

Counts include explicit denominators for hourly trends and 24-hour returns. An empty return sample has a null median. Partial samples are marked incomplete. For an even number of observed returns, the median averages the two middle values.

The change applies to the Paper context collector used by the dashboard and scheduler. The original context builder remains available to archived research. The new breadth is descriptive market evidence. This patch introduces no trading rule based on breadth.

The three regression cases cover stale features and missing anchors, duplicate and foreign pairs, and signed returns with an even sample. The April comparison uses 30 fixed daily noon clocks and 20 markets from the already inspected archive. All 30 have complete coverage, the median changes at all 30, and every field outside breadth matches the preceding calculation. Reproduce with node scripts/verify-paper-market-breadth.mjs after building. The comparison verifies arithmetic and compatibility. It does not estimate trading performance.

The previous build archive shows three pre-existing differences against the older hourly-trend research pins. The verifier confirms every file listed in those pins matches the immediately preceding build byte for byte. Historic replay using those older pins still requires the corresponding archived build.
