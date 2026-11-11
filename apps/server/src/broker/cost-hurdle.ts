/** Conservative paper/research cost estimates. None of these are observed fill outcomes. */
export type Liquidity = 'maker' | 'taker';
export type RoundtripAssumptions = {
  spreadBps: number;
  entrySlippageBps: number;
  exitSlippageBps: number;
  makerFeeRate: number;
  takerFeeRate: number;
  entryLiquidity: Liquidity;
  exitLiquidity: Liquidity;
};
export type CostEstimate = {
  feeBps: number;
  spreadBps: number;
  slippageBps: number;
  roundtripBps: number;
  source: 'assumption';
};
const nonnegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

/** A maker pays no taker half-spread in the assumed execution price.
 * Maker fill probability and adverse selection must be evaluated separately. */
export function estimateRoundtripCost(a: RoundtripAssumptions): CostEstimate {
  if (![a.spreadBps, a.entrySlippageBps, a.exitSlippageBps,
    a.makerFeeRate, a.takerFeeRate].every(nonnegative) ||
    a.makerFeeRate > 0.05 || a.takerFeeRate > 0.05 ||
    !['maker', 'taker'].includes(a.entryLiquidity) ||
    !['maker', 'taker'].includes(a.exitLiquidity))
    throw Error('Invalid roundtrip cost assumptions');
  const fee = (a.entryLiquidity === 'maker' ? a.makerFeeRate : a.takerFeeRate) +
    (a.exitLiquidity === 'maker' ? a.makerFeeRate : a.takerFeeRate);
  const spread = (Number(a.entryLiquidity === 'taker') +
    Number(a.exitLiquidity === 'taker')) * a.spreadBps / 2;
  const slippage = a.entrySlippageBps + a.exitSlippageBps;
  const roundtripBps = fee * 10000 + spread + slippage;
  if (!Number.isFinite(roundtripBps)) throw Error('Unrepresentable roundtrip costs');
  return {feeBps: fee * 10000, spreadBps: spread, slippageBps: slippage,
    roundtripBps, source: 'assumption'};
}
export type EdgeAdmission = {
  allowed: boolean;
  reason: string;
  minimumGrossMoveBps: number | null;
};
/** Unknown cost or absent expected gross move is a hard veto; not a zero-cost trade.
 * This gate does not predict edge or claim that the strategy is profitable. */
export function evaluateCostAdmission(input: {
  estimate: CostEstimate | null;
  expectedGrossMoveBps: number | null;
  maxRoundtripCostBps: number;
  edgeMultiple?: number;
}): EdgeAdmission {
  const {estimate, expectedGrossMoveBps, maxRoundtripCostBps} = input;
  const multiple = input.edgeMultiple ?? 2;
  if (!nonnegative(maxRoundtripCostBps) || !Number.isFinite(multiple) || multiple < 2)
    throw Error('Invalid cost admission limits');
  if (!estimate || !nonnegative(estimate.roundtripBps))
    return {allowed: false, reason: 'Cost evidence unavailable', minimumGrossMoveBps: null};
  const minimumGrossMoveBps = multiple * estimate.roundtripBps;
  if (!nonnegative(expectedGrossMoveBps ?? NaN))
    return {allowed: false, reason: 'Gross move estimate unavailable', minimumGrossMoveBps};
  if (estimate.roundtripBps > maxRoundtripCostBps)
    return {allowed: false, reason: 'Roundtrip cost limit exceeded', minimumGrossMoveBps};
  if (expectedGrossMoveBps! <= minimumGrossMoveBps)
    return {allowed: false, reason: 'Gross move does not exceed required cost multiple', minimumGrossMoveBps};
  return {allowed: true, reason: 'Assumption-based cost admission passed', minimumGrossMoveBps};
}
