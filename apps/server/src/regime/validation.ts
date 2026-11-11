import { DAY_MS, validCandles } from './math.js';
import type { CandleSource, Regime, RegimeState, UniverseAt } from './types.js';

type StateCount = { days: number; runs: number; meanRunDays: number };
export function summarizeStates(states: RegimeState[]) {
  const counts: Record<Regime, StateCount> = {
    'risk-on': { days: 0, runs: 0, meanRunDays: 0 },
    neutral: { days: 0, runs: 0, meanRunDays: 0 },
    'risk-off': { days: 0, runs: 0, meanRunDays: 0 }
  };
  let last: Regime | undefined, switches = 0, complete = 0, run = 0;
  const durations: Record<Regime, number[]> = { 'risk-on': [], neutral: [], 'risk-off': [] };
  for (const s of states) {
    if (s.reasons.some(r => r.startsWith('Daten unvollständig'))) {
      if (last !== undefined) durations[last].push(run);
      last = undefined; run = 0;
      continue;
    }
    complete++;
    counts[s.regime].days++;
    if (s.regime !== last) {
      if (last !== undefined) { durations[last].push(run); switches++; }
      counts[s.regime].runs++;
      run = 0;
    }
    run++;
    last = s.regime;
  }
  if (last) durations[last].push(run);
  for (const regime of Object.keys(counts) as Regime[]) {
    const values = durations[regime];
    counts[regime].meanRunDays = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }
  return {
    counts, missingDays: states.length - complete, switches,
    switchesPerYear: complete ? switches * 365 / complete : null
  };
}

/** Deterministic 30-day moving-block bootstrap; no optimization, no model selection. */
export function meanBootstrapCI(values: number[], seed = 19, samples = 1_000): { mean: number; lower: number; upper: number; n: number } | null {
  if (!values.length || values.some(v => !Number.isFinite(v))) return null;
  let randomState = seed >>> 0;
  const rand = () => { randomState = (1664525 * randomState + 1013904223) >>> 0; return randomState / 2 ** 32; };
  const n = values.length;
  const draws: number[] = [];
  for (let attempt = 0; attempt < samples; attempt++) {
    const indices: number[] = [];
    while (indices.length < n) {
      const start = Math.floor(rand() * n);
      for (let offset = 0; offset < Math.min(30, n - indices.length); offset++) indices.push((start + offset) % n);
    }
    draws.push(indices.reduce((sum, index) => sum + values[index]!, 0) / n);
  }
  draws.sort((a, b) => a - b);
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / n,
    lower: draws[Math.floor(0.025 * samples)]!,
    upper: draws[Math.floor(0.975 * samples)]!,
    n
  };
}

/**
 * Descriptive 30-day FORWARD outcomes only, using PIT top-10 selected at signal
 * time. Future bars are accessed solely for outcomes (never for signal creation).
 * All 31 daily bars must be present; windows crossing endExclusive are omitted.
 */
export async function forwardReturns(states: RegimeState[], source: CandleSource, universeAt: UniverseAt, endExclusive: number) {
  const collected: Record<Regime, { btc: number[]; top10: number[] }> = {
    'risk-on': { btc: [], top10: [] }, neutral: { btc: [], top10: [] }, 'risk-off': { btc: [], top10: [] }
  };
  const validStates = states.filter(s => !s.reasons.some(r => r.startsWith('Daten unvollständig')) &&
    s.asOf + 30 * DAY_MS <= endExclusive);
  const symbolsForDay = await Promise.all(validStates.map(async state => {
    try {
      const symbols = await universeAt(state.asOf, { quote: 'USDT', topN: 10 });
      return symbols.length === 10 && new Set(symbols).size === 10 ? symbols : [];
    } catch { return []; }
  }));
  const symbols = new Set([ 'BTCUSDT', ...symbolsForDay.flat() ]);
  const min = validStates.length ? Math.min(...validStates.map(s => s.asOf)) - DAY_MS : 0;
  const cache = new Map<string, Map<number, number>>();
  await Promise.all([...symbols].map(async symbol => {
    try {
      const rows = await source.getCandles(symbol, 1440, min, endExclusive - 1);
      if (!validCandles(rows)) return;
      cache.set(symbol, new Map(rows.map(r => [r.ts, r.close])));
    } catch { /* unavailable outcomes are omitted, not assigned 0 */ }
  }));
  const returns = (symbol: string, day: number): number | undefined => {
    const closes = cache.get(symbol);
    if (!closes) return undefined;
    const values: number[] = [];
    for (let offset = -1; offset < 30; offset++) {
      const close = closes.get(day + offset * DAY_MS);
      if (close === undefined) return undefined;
      values.push(close);
    }
    return values[30]! / values[0]! - 1;
  };
  for (let i = 0; i < validStates.length; i++) {
    const state = validStates[i]!, btc = returns('BTCUSDT', state.asOf);
    if (btc !== undefined) collected[state.regime].btc.push(btc);
    const universe = symbolsForDay[i]!;
    if (universe.length !== 10) continue;
    const values = universe.map(symbol => returns(symbol, state.asOf));
    if (values.some(v => v === undefined)) continue;
    collected[state.regime].top10.push((values as number[]).reduce((total: number, v: number) => total + v, 0) / 10);
  }
  return Object.fromEntries((Object.keys(collected) as Regime[]).map(key => [key, {
    btc: meanBootstrapCI(collected[key].btc),
    top10: meanBootstrapCI(collected[key].top10)
  }])) as Record<Regime, { btc: ReturnType<typeof meanBootstrapCI>; top10: ReturnType<typeof meanBootstrapCI> }>;
}
