/** Exact public #19 regime contract. This module never calls a broker or executes orders. */
export type Regime = 'risk-on' | 'neutral' | 'risk-off';
export type RegimeState = {
  asOf: number;
  regime: Regime;
  score: number;
  components: { trend: number; volatility: number; breadth: number };
  reasons: string[];
};
export interface RegimeProvider { getRegime(asOfMs: number): Promise<RegimeState>; }

/** Structural copy of the immutable #3 / #5 CandleSource boundary. */
export type Candle = { ts: number; open: number; high: number; low: number; close: number; volume: number; quoteVolume?: number };
export interface CandleSource {
  getCandles(symbol: string, intervalMinutes: 15 | 60 | 240 | 1440, fromMs: number, toMs: number): Promise<Candle[]>;
  listSymbols(): Promise<string[]>;
}
export type UniverseAt = (dateMs: number, options: { quote: 'USDT'; topN: number }) => Promise<string[]> | string[];
export type RiskProfile = 'vorsichtig' | 'normal' | 'aggressiv';
const multipliers: Record<RiskProfile, Record<Regime, number>> = {
  vorsichtig: { 'risk-on': 1, neutral: 0.5, 'risk-off': 0 },
  normal: { 'risk-on': 1, neutral: 0.7, 'risk-off': 0.2 },
  aggressiv: { 'risk-on': 1, neutral: 0.85, 'risk-off': 0.4 }
};
export function exposureMultiplier(regime: Regime, profile: RiskProfile): number {
  const value = multipliers[profile]?.[regime];
  if (value === undefined) throw new Error('Unbekanntes Regime/Risikoprofil');
  return value;
}
