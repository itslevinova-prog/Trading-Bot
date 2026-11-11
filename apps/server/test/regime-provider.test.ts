import { expect, test } from 'vitest';
import { ArchiveRegimeProvider, LiveRegimeProvider } from '../src/regime/providers.js';
import { DAY_MS, transition, volatilityComponent } from '../src/regime/math.js';
import { exposureMultiplier } from '../src/regime/types.js';
import { forwardReturns, meanBootstrapCI, summarizeStates } from '../src/regime/validation.js';
import type { Candle, CandleSource, UniverseAt } from '../src/regime/types.js';

const start = Date.UTC(2020, 0, 1);
const dayAt = (index: number) => start + index * DAY_MS;
function history(direction = 1, count = 1500): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + direction * 0.045 * i + Math.sin(i * 0.13) * 2;
    return { ts: dayAt(i), open: close, high: close + 1, low: close - 1, close, volume: 100 };
  });
}
const btc = history(), eth = history(), alt = history(-1), newcomer = history();
const assets = new Map([['BTCUSDT', btc], ['ETHUSDT', eth], ['ALTUSDT', alt], ['NEWUSDT', newcomer]]);
function fixtureSource(data = assets, spy?: (symbol: string, toMs: number) => void): CandleSource {
  return {
    listSymbols: async () => [...data.keys()],
    getCandles: async (symbol, interval, fromMs, toMs) => {
      expect(interval).toBe(1440);
      spy?.(symbol, toMs);
      return (data.get(symbol) ?? []).filter(c => c.ts >= fromMs && c.ts < toMs);
    }
  };
}
const defaultUniverse: UniverseAt = async () => ['ETHUSDT', 'ALTUSDT'];
const asOf = dayAt(1_250);

test('exact multiplier table and invalid profile are fail-closed', () => {
  expect(['risk-on', 'neutral', 'risk-off'].map(r => exposureMultiplier(r as 'risk-on' | 'neutral' | 'risk-off', 'vorsichtig'))).toEqual([1, 0.5, 0]);
  expect(['risk-on', 'neutral', 'risk-off'].map(r => exposureMultiplier(r as 'risk-on' | 'neutral' | 'risk-off', 'normal'))).toEqual([1, 0.7, 0.2]);
  expect(['risk-on', 'neutral', 'risk-off'].map(r => exposureMultiplier(r as 'risk-on' | 'neutral' | 'risk-off', 'aggressiv'))).toEqual([1, 0.85, 0.4]);
  expect(() => exposureMultiplier('neutral', 'invalid' as 'normal')).toThrow();
});

test('look-ahead: no request after UTC cutoff, no later candle influences a historical asOf', async () => {
  const seen: number[] = [];
  const clean = await new ArchiveRegimeProvider({
    source: fixtureSource(assets, (_symbol, toMs) => seen.push(toMs)), universeAt: defaultUniverse
  }).getRegime(asOf + 12 * 3_600_000);
  expect(seen.every(boundary => boundary <= asOf)).toBe(true);
  const contaminated = new Map(assets);
  contaminated.set('BTCUSDT', btc.map(c => ({ ...c, close: c.ts >= asOf ? c.close * 100 : c.close,
    open: c.ts >= asOf ? c.open * 100 : c.open, high: c.ts >= asOf ? c.high * 100 : c.high,
    low: c.ts >= asOf ? c.low * 100 : c.low })));
  const evil: CandleSource = {
    listSymbols: async () => [...assets.keys()],
    getCandles: async (symbol) => contaminated.get(symbol) ?? [] // deliberately ignores requested range
  };
  const withFuture = await new ArchiveRegimeProvider({ source: evil, universeAt: defaultUniverse }).getRegime(asOf + 12 * 3_600_000);
  expect(withFuture).toEqual(clean);
  // Invalid future OHLC must not turn a past result into 'Daten unvollständig'.
  const invalidFuture = new Map(assets);
  invalidFuture.set('BTCUSDT', [...btc, { ...btc.at(-1)!, ts: dayAt(1_501), close: NaN }]);
  const malicious = new ArchiveRegimeProvider({
    source: { listSymbols: async () => [], getCandles: async symbol => invalidFuture.get(symbol) ?? [] },
    universeAt: defaultUniverse
  });
  expect(await malicious.getRegime(asOf + 12 * 3_600_000)).toEqual(clean);
});

test('point-in-time breadth changes only when the as-of universe changes', async () => {
  const first = dayAt(1_300), second = first + DAY_MS;
  const observed: number[] = [];
  const universeAt: UniverseAt = date => {
    observed.push(date);
    return date < second ? ['ETHUSDT', 'ALTUSDT'] : ['ETHUSDT', 'NEWUSDT'];
  };
  const result = await new ArchiveRegimeProvider({ source: fixtureSource(), universeAt }).getHistory(first, second);
  expect(result).toHaveLength(2);
  expect(result[0]!.components.breadth).toBe(0.5);
  expect(result[1]!.components.breadth).toBe(1);
  expect(observed.every(date => date % DAY_MS === 0 && date <= second)).toBe(true);
});

test('daily components are independent of the report starting date', async () => {
  const provider = new ArchiveRegimeProvider({ source: fixtureSource(), universeAt: defaultUniverse });
  const alone = await provider.getRegime(dayAt(1_250));
  const history = await provider.getHistory(dayAt(1_245), dayAt(1_250));
  expect(history.at(-1)!.components).toEqual(alone.components);
  expect(history.at(-1)!.score).toBe(alone.score);
});

test('missing BTC, missing PIT coins and incomplete last day always return neutral with reason', async () => {
  const noBtc = new ArchiveRegimeProvider({
    source: fixtureSource(new Map([['ETHUSDT', eth]])), universeAt: defaultUniverse
  });
  expect(await noBtc.getRegime(asOf)).toMatchObject({ regime: 'neutral', reasons: [expect.stringContaining('Daten unvollständig')] });
  const noUniverse = new ArchiveRegimeProvider({ source: fixtureSource(), universeAt: async () => [] });
  expect(await noUniverse.getRegime(asOf)).toMatchObject({ regime: 'neutral', reasons: [expect.stringContaining('Daten unvollständig')] });
  const lastMissing = new Map(assets);
  lastMissing.set('ALTUSDT', alt.filter(c => c.ts !== asOf - DAY_MS));
  const gap = new ArchiveRegimeProvider({ source: fixtureSource(lastMissing), universeAt: defaultUniverse });
  expect(await gap.getRegime(asOf)).toMatchObject({ regime: 'neutral', reasons: [expect.stringContaining('Daten unvollständig')] });
});

test('hysteresis: 3-day minimum, no direct red-to-green, gap never stays risk-on', () => {
  let state = transition({ regime: 'neutral', daysInState: 3 }, 0.3, false);
  expect(state).toEqual({ regime: 'risk-off', daysInState: 1 });
  state = transition(state, 1, false);
  expect(state.regime).toBe('risk-off');
  state = transition(state, 1, false);
  expect(state.regime).toBe('risk-off');
  state = transition(state, 0.46, false);
  expect(state).toEqual({ regime: 'neutral', daysInState: 1 });
  state = transition(state, 0.34, false);
  expect(state.regime).toBe('neutral');
  state = transition(state, 0.38, false);
  state = transition(state, 0.33, false);
  expect(state.regime).toBe('risk-off');
  expect(transition({ regime: 'risk-on', daysInState: 1 }, 0.9, true)).toEqual({ regime: 'neutral', daysInState: 1 });
});

test('percentile only uses past windows and needs 90 valid samples', () => {
  expect(volatilityComponent(btc.slice(0, 50), dayAt(50))).toBeUndefined();
  const partial = volatilityComponent(btc.slice(0, 400), dayAt(400));
  expect(partial?.percentile).toBeGreaterThanOrEqual(0);
  expect(partial?.percentile).toBeLessThanOrEqual(1);
  const flat = Array.from({ length: 200 }, (_, i) => ({ ts: dayAt(i), open: 100, high: 101, low: 99, close: 100, volume: 1 }));
  expect(volatilityComponent(flat, dayAt(200))?.percentile).toBe(0.5);
  const poisoned = btc.map(c => c.ts >= dayAt(400) ? { ...c, close: c.close * 9 } : c);
  expect(volatilityComponent(poisoned.filter(c => c.ts < dayAt(400)), dayAt(400))).toEqual(partial);
});

test('live provider fills missing daily bars using injected public-only fetcher; network-free', async () => {
  const calls: string[] = [];
  const source: CandleSource = { listSymbols: async () => [], getCandles: async () => [] };
  const live = new LiveRegimeProvider({
    source, universeAt: defaultUniverse,
    fetchDaily: async (symbol, fromMs, toMs) => {
      calls.push(symbol);
      return (assets.get(symbol) ?? []).filter(c => c.ts >= fromMs && c.ts < toMs);
    }
  });
  const state = await live.getRegime(asOf);
  expect(state.reasons.every(r => !r.startsWith('Daten unvollständig'))).toBe(true);
  expect(new Set(calls)).toEqual(new Set(['BTCUSDT', 'ETHUSDT', 'ALTUSDT']));
});

test('bootstrap deterministic and summary explicitly excludes incomplete days', () => {
  const a = meanBootstrapCI([0.1, -0.2, 0.3, 0.05]);
  expect(a).toEqual(meanBootstrapCI([0.1, -0.2, 0.3, 0.05]));
  expect(a!.n).toBe(4);
  expect(meanBootstrapCI([])).toBeNull();
  const states = [
    { asOf: 1, regime: 'neutral' as const, score: 0.5, components: { trend: 0.5, volatility: 0.5, breadth: 0.5 }, reasons: ['Daten unvollständig'] },
    { asOf: 2, regime: 'risk-off' as const, score: 0, components: { trend: 0, volatility: 0, breadth: 0 }, reasons: [] }
  ];
  expect(summarizeStates(states)).toMatchObject({ missingDays: 1, switches: 0, counts: { 'risk-off': { days: 1 } } });
});

test('forward-return samples remain empty rather than invent future PnL', async () => {
  const state = { asOf, regime: 'risk-off' as const, score: 0, components: { trend: 0, volatility: 0, breadth: 0 }, reasons: [] };
  const outcome = await forwardReturns([state], fixtureSource(), async () => ['ETHUSDT'], asOf + 10 * DAY_MS);
  expect(outcome['risk-off'].btc).toBeNull();
  expect(outcome['risk-off'].top10).toBeNull();
});
