# Pinned upstream follow-up30: validity at decision and risk boundaries

Revisited retained source only; whole-project investigation remains partial. No new source files, no vendor code port or execution, no packages/services installed. Authoritative inventory remains 56 distinct retained source files including six licences.

Freqtrade strategy/interface.py at pinned7fea5ea24b3c3193cfdd4143b243f7baab66d661 (GPL-3.0), custom stop update around1565–1590: custom callback result is guarded against NaN/Infinity before updating the stop, with callback failure/default handling. This is a specific numeric validation example, not proof all upstream inputs or our risk limits are safe. General lesson: validity must be checked where a decision can change risk.

Jesse strategies/Strategy.py at pinnedaded4b9d51d432d411a8f7fbf45e47572dff6629 (MIT), prepare buy/sell/stop paths around720–780: order shape normalization and explicit InvalidShape errors precede submission. General lesson: malformed strategy state should be rejected at its consumer boundary. No claim that Jesse uses our percentage/count/time contract.

OctoBot-Tentacles mixed_strategies.py retains its LGPL-3.0-or-later header, configured evaluator timeout and typed matrix/evaluator validity helpers. The inspected excerpt confirms event/evidence gating is a separate concern from merely having a numerical note. This pass did not rerun its evaluators or establish universal freshness/risk guarantees. No signal aggregation code was copied.

Own shared risk review found concrete malformed buy-state/config acceptance, including duplicate pair exposure subtraction, negative trade counts and NaN last-sale cooldown bypass. Fourteen new regression cases failed before the correction. Own deterministic boundary fix plus19 newcases, all1622server tests/typechecks/build and5000valid differentialcases preserve normal outputs while rejecting malformed buys. Protective sells bypass entry-only validation. RISK-INPUT-CONTRACT.md and its immutable proof document exact scope; synthetic checks are not profit evidence. Normal database pair uniqueness means the duplicate witness is a shared-contract robustness case, not proof production accounts were duplicated.

Retained source SHA256 values verified against authoritative inventory:

- docs/upstream-research/freqtrade/source/freqtrade/strategy/interface.py: 87f06f0f2df0c3298949002a250d99cf801b9cee794f332deffcc875c2c6f4a1
- docs/upstream-research/jesse/source/jesse/strategies/Strategy.py: e2f89664377714d87c5971fdfe13ad244845eda2e1daa449b8bf182de8e660ab
- docs/upstream-research/OctoBot/source/packages/tentacles/Evaluator/Strategies/mixed_strategies_evaluator/mixed_strategies.py: 6ad600f312614b6509ef239488d66cddb45a487a6d66c37e8d1feeb0881b78c8
