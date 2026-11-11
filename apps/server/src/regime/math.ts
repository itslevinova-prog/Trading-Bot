import { ema } from '../market/indicators.js';
import type { Candle, RegimeState } from './types.js';

export const DAY_MS = 86_400_000;
export const utcDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
export const incomplete = (asOf: number, cause: string): RegimeState => ({
  asOf, regime: 'neutral', score: 0.5,
  components: { trend: 0.5, volatility: 0.5, breadth: 0.5 },
  reasons: ['Daten unvollständig: ' + cause]
});

/** Reject inconsistent source data; never manufacture a missing daily bar. */
export function validCandles(rows: Candle[]): boolean {
  let last = -1;
  for (const c of rows) {
    if (!Number.isSafeInteger(c.ts) || c.ts < 0 || c.ts % DAY_MS !== 0 ||
      c.ts <= last || ![c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) ||
      c.low <= 0 || c.volume < 0 || c.low > Math.min(c.open, c.close) ||
      c.high < Math.max(c.open, c.close)) return false;
    last = c.ts;
  }
  return true;
}
export function closedThrough(rows: Candle[], day: number): Candle[] {
  return rows.filter(c => c.ts + DAY_MS <= day);
}
export function contiguousTail(rows: Candle[], length: number): Candle[] | undefined {
  const tail = rows.slice(-length);
  if (tail.length !== length ||
    tail.some((c, index) => index > 0 && c.ts !== tail[index - 1]!.ts + DAY_MS)) return undefined;
  return tail;
}
/** Longest gap-free run of the most recent candles, capped at `max`; undefined if shorter than `min`. */
export function recentContiguous(rows: Candle[], min: number, max: number): Candle[] | undefined {
  const tail = rows.slice(-max);
  let start = tail.length - 1;
  while (start > 0 && tail[start]!.ts === tail[start - 1]!.ts + DAY_MS) start--;
  const run = tail.slice(Math.max(start, 0));
  return run.length >= min ? run : undefined;
}
export function trendComponent(rows: Candle[]): { value: number; reasons: string[] } | undefined {
  const tail = contiguousTail(rows, 200);
  if (!tail) return undefined;
  const closes = tail.map(c => c.close);
  const e200 = ema(closes, 200).at(-1);
  const e50 = ema(closes, 50);
  const prior = e50[e50.length - 21], latest = e50.at(-1);
  if (e200 === undefined || prior === undefined || latest === undefined) return undefined;
  const above = closes.at(-1)! > e200, rising = latest > prior;
  return {
    value: (Number(above) + Number(rising)) / 2,
    reasons: [above ? 'BTC über EMA(200)' : 'BTC unter/auf EMA(200)',
      rising ? 'EMA(50) steigt über 20 Tage' : 'EMA(50) steigt nicht über 20 Tage']
  };
}
function annualVol(window: Candle[]): number {
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) returns.push(Math.log(window[i]!.close / window[i - 1]!.close));
  const mean = returns.reduce((s, n) => s + n, 0) / returns.length;
  return Math.sqrt(returns.reduce((s, n) => s + (n - mean) ** 2, 0) / returns.length) * Math.sqrt(365);
}
/** Rolling 3-year empirical percentile, NEVER a global/full-sample fit. */
export function volatilityComponent(rows: Candle[], day: number): { value: number; percentile: number } | undefined {
  const samples: number[] = [];
  for (let i = 30; i < rows.length; i++) {
    const current = rows[i]!;
    if (current.ts + DAY_MS > day || current.ts < day - 1_095 * DAY_MS) continue;
    const window = rows.slice(i - 30, i + 1);
    if (!contiguousTail(window, 31)) continue;
    const v = annualVol(window);
    if (Number.isFinite(v)) samples.push(v);
  }
  if (samples.length < 90) return undefined;
  const latest = rows.at(-1)!;
  if (latest.ts + DAY_MS !== day) return undefined;
  const recent = contiguousTail(rows, 31);
  if (!recent) return undefined;
  const currentVol = annualVol(recent);
  const less = samples.filter(x => x < currentVol).length;
  const equal = samples.filter(x => x === currentVol).length;
  const percentile = (less + 0.5 * equal) / samples.length;
  return { value: percentile <= 1 / 3 ? 1 : percentile <= 2 / 3 ? 0.5 : 0, percentile };
}
export function breadthComponent(coins: Candle[][]): { value: number; fraction: number } | undefined {
  if (!coins.length) return undefined;
  let above = 0;
  for (const rows of coins) {
    const tail = recentContiguous(rows, 50, 200);
    if (!tail) return undefined;
    const close = tail.at(-1)!.close, e50 = ema(tail.map((c: Candle) => c.close), 50).at(-1);
    if (e50 === undefined) return undefined;
    if (close > e50) above++;
  }
  const fraction = above / coins.length;
  return { value: fraction < 0.4 ? 0 : fraction < 0.6 ? 0.5 : 1, fraction };
}

export type Transition = { regime: RegimeState['regime']; daysInState: number };
/** Adjacent-state-only hysteresis with three-day minimum dwell. */
export function transition(previous: Transition, score: number, missing: boolean): Transition {
  if (missing) return { regime: 'neutral', daysInState: 1 }; // full data must recover before normal transitions
  if (previous.daysInState < 3) return { ...previous, daysInState: previous.daysInState + 1 };
  let next = previous.regime;
  if (next === 'risk-off' && score > 0.45) next = 'neutral';
  else if (next === 'risk-on' && score < 0.60) next = 'neutral';
  else if (next === 'neutral' && score < 0.35) next = 'risk-off';
  else if (next === 'neutral' && score > 0.70) next = 'risk-on';
  return { regime: next, daysInState: next === previous.regime ? previous.daysInState + 1 : 1 };
}
