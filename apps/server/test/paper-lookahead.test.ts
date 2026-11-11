import { expect, test } from 'vitest';
import type { Candle, DecisionContext } from '@paper/shared';
import { feature } from '../src/market/indicators.js';
import { aggregate, marketContext } from '../src/context/market-context.js';
import { paperMockDecision } from '../src/strategy/paper-intelligence.js';

// Synthetic causality fixture only: neither historical depth nor trading performance.
const start = Date.UTC(2026, 8, 1), step = 900000;
const rows: Candle[] = Array.from({length: 2400}, (_, i) => {
  const close = 100 + i * .01 + Math.sin(i / 9) * .4;
  return {pair: 'ETH/EUR', interval: 15, ts: start + i * step,
    open: close - .02, high: close + .2, low: close - .2, close, volume: 10 + i % 7};
});
const end = start + rows.length * step;
const hours = aggregate(rows, 60, end);

function evaluate(candles: Candle[], hourly: Candle[], now: number) {
  // Keep the same explicitly synthetic contemporaneous quote in both experiments.
  const last = rows.filter(c => c.ts + step <= now).at(-1)!;
  const bid = last.close, ask = bid * 1.0001;
  const ticker = {bid, ask};
  const f = feature('ETH/EUR', candles, hourly, ticker, now);
  expect(f).toBeDefined();
  const context = marketContext([{pair: 'ETH/EUR', candles, hourly, feature: f,
    book: {symbol: 'ETH/EUR', valid: true, receivedAt: now,
      bids: [{price: String(bid), qty: '100'}], asks: [{price: String(ask), qty: '100'}]} as any}], 'fixture', 'EUR', now);
  const input: DecisionContext = {timeUTC: new Date(now).toISOString(), timeZurich: 'fixture',
    execution: {mode: 'paper'}, account: {cash: 1000, equity: 1000}, positions: [],
    features: [f!], recentTrades: [], memory: [], lessons: [],
    limits: {TAKER_FEE_RATE: .001, MAX_ENTRY_SLIPPAGE_BPS: 15, MAX_ENTRY_SPREAD_BPS: 10,
      MAX_POSITION_PCT: .15, MAX_OPEN_POSITIONS: 2, MIN_ORDER_EUR: 10},
    tradingPolicy: {mode: 'safe', stopLossPct: .05}, marketContext: context};
  return {feature: f, context, decision: paperMockDecision(input)};
}

for (const offset of [225, 400, 701, 1400]) {
  test(`features, regime and mock evidence ignore all unfinished/future bars at cut ${offset}`, () => {
    const now = start + offset * step + 450000;
    const clipped = evaluate(rows.filter(c => c.ts + step <= now),
      hours.filter(c => c.ts + 3600000 <= now), now);
    expect(evaluate(rows, hours, now)).toEqual(clipped);
    const poison = (bars: Candle[], interval: number) => bars.map(c => c.ts + interval <= now ? c :
      {...c, open: 1e8, high: 2e8, low: 1, close: 1.5e8, volume: 1e12});
    // Valid but extreme future OHLCV changes must not reach any present feature/evidence.
    expect(evaluate(poison(rows, step), poison(hours, 3600000), now)).toEqual(clipped);
  });
}
