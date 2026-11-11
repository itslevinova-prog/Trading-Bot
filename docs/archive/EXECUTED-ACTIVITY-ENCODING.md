# Lossless research transport for executed activity

Two opt-in research codecs now retain executed-activity evidence under the existing character budget. The active serializer, provider and115,000limit are unchanged.

`executed-activity-encoding.ts` stores consecutive identical activity states as named runs following marketContext.markets order. Runs explicitly distinguish an absent field from present null/false/zero or an unavailable object. Different available records retain all their fields, source identities, clocks and window values. Encoding applies only when it reduces the JSON size. Decoding validates counts, coverage, value presence and conflicts before applying changes; repeated values are cloned separately.

`executed-digest-encoding.ts` shares exact repeated64-character lowercase source-hash strings in a full-value table. It never truncates or recalculates a hash. Named references replace repeated values, including hashes already present in the old mandatory summaries. Metadata/reference collisions and malformed indices/tables are rejected. Ordinary contexts without executed activity produce exactly the original ordinary packet. These are JSON transport definitions, not semantic validation or a substitute for source/availability/risk gates.

`packExecutedActivityResearch` expands prior research transport before repacking, then uses the unchanged common packer. All existing omission and hard-budget rules remain. A packet still too large is rejected; unique evidence is not silently removed and limits are not raised. The full uncompressed context remains the research source of truth. Named format metadata and full digest values are part of the transmitted JSON; a consumer must understand these reference formats before any activation.

Measured on the unchanged20-market fixture98007631...:

| Case | Characters | Headroom at115,000 |
| --- | ---: | ---: |
| Original ordinary packet |114,758|242|
|20explicit unavailable records, research encoding |111,439|3,561|
| Two retained records plus18unknown, transport-only stress |114,719|281|

The mixed case preserves actual capture values and original capture timestamps, but that older fixture is not a decision-valid source for those records. It is strictly a transport stress test; the source wrapper would deny clock/venue incompatibility. It does not demonstrate20captured markets or general capacity for all available records. Larger unique evidence still blocks. Repacking preserves every evidence field; the common packer's existing omission metadata can change its byte count.

Twenty-four codec tests plus29adapter tests pass (53targeted). They cover full JSON equality, source immutability, missing/null/zero distinctions, exact precision, hash identity, independently cloned repeats, ordinary-packet equality, malformed/colliding transport, repacking, the actual-record stress case and mandatory overflow. Server/test typechecks and isolated build05f0154ae199a0306b499db2cd72805588f7e03236242b78b3be39c693164d9a pass (143source/133runtime). This does not claim a rerun of the full earlier suite.

Immutable witnesses are in data/executed-activity-encoding-witnesses-v1.json. An independent Python decoder restores the entire original pre-packing JSON in both cases, including all20market records and106full-hash references in each. Source/proof details: executed-activity-encoding-proof.json and executed-activity-independent-json-proof.json. No network request or model call occurred in this phase. Frozen datasets/accounts/processes/strategies remain unchanged; only the prior unregistered broker adapter differs among the old121runtime files.

This solves a measured transport constraint; it is not a trading-performance improvement. Further work should return to a fixed, justified trading-information hypothesis with exact source/clock/target provenance, unchanged controls and chronological validation. New retained historical fields must never be passed off as actual first-receipt observations or used to relax capture guards.
