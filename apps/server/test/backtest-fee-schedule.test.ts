import {test, expect} from 'vitest';
import {FeeSchedule, type FeeTariff} from '../src/backtest/fee-schedule.js';
import {SimulatedBroker} from '../src/backtest/simulated-broker.js';
import {ConservativeOhlcModel} from '../src/backtest/fill-models.js';
import {defaultRisk} from '../src/backtest/runner.js';
import type {Candle} from '../src/backtest/candle-source.js';

const tariff = (id: string, fromMs: number, untilMs: number, takerRate: number): FeeTariff => ({
  id, quote: 'EUR', fromMs, untilMs, makerRate: takerRate / 2, takerRate,
  source: 'synthetic-assumption'
});
const candle = (ts: number): Candle => ({ts, open: 100, high: 101, low: 99, close: 100, volume: 20});
const pairs = new Map([['BTC/EUR', {symbol: 'BTC/EUR', ordermin: 0.001, costmin: 10, lotDecimals: 4}]]);

test('fee periods are half-open, fixed by quote and fee path, with explicit tariff IDs', () => {
  const schedule = new FeeSchedule([tariff('t0', 0, 900000, .001), tariff('t1', 900000, 1800000, .003)]);
  expect(schedule.select('BTC/EUR', 899999, 'taker')).toMatchObject({tariffId: 't0', rate: .001});
  expect(schedule.select('BTC/EUR', 900000, 'taker')).toMatchObject({tariffId: 't1', rate: .003});
  expect(schedule.select('BTC/EUR', 900000, 'maker').rate).toBeCloseTo(.0015);
  expect(schedule.charge('BTC/EUR', 0, 'taker', 100.001).fee).toBeCloseTo(.100001);
  expect(schedule.charge('BTC/EUR', 0, 'taker', 0.00000011).fee).toBe(.00000001);
  expect(() => schedule.select('BTC/EUR', 1800000, 'taker')).toThrow(/Unknown fee assumption/);
  expect(() => schedule.select('ETH/USDT', 0, 'taker')).toThrow(/Unknown fee assumption/);
});

test('time-versioned taker fees are applied to a broker buy and later partial sell', () => {
  const schedule = new FeeSchedule([tariff('old', 0, 900000, .001), tariff('new', 900000, 2000000, .003)]);
  const broker = new SimulatedBroker(1000, pairs, new ConservativeOhlcModel({spreadBps: 0, slippageBps: 0}),
    {...defaultRisk, maxSpreadBps: 30}, 0, schedule);
  expect(broker.queue({type: 'buy', pair: 'BTC/EUR', amountEur: 200, stopLossPct: .05,
    confidence: 1, reasoning: 'fixture'}, 0)).toBe(true);
  broker.onCandle('BTC/EUR', candle(0), 15);
  const buy = broker.trades[0]!;
  expect(buy.feeTariffId).toBe('old');
  expect(buy.feeLiquidity).toBe('taker');
  expect(buy.feeRounding).toBe('round-up-quote-8dp');
  expect(buy.feeSource).toBe('synthetic-assumption');
  expect(buy.fee).toBeCloseTo(buy.notional * .001);
  const bought = broker.positions.get('BTC/EUR')!;
  expect(broker.queue({type: 'sell', pair: 'BTC/EUR', sellFraction: .5,
    confidence: 1, reasoning: 'fixture partial exit'}, 900000)).toBe(true);
  broker.onCandle('BTC/EUR', candle(900000), 15);
  const sell = broker.trades[1]!;
  const remaining = broker.positions.get('BTC/EUR')!;
  expect(sell.feeTariffId).toBe('new');
  expect(sell.fee).toBeCloseTo(sell.notional * .003);
  expect(sell.realizedPnl).toBeCloseTo(sell.notional - sell.fee -
    bought.basis * sell.qty / bought.qty, 8);
  expect(remaining.qty).toBeCloseTo(bought.qty - sell.qty, 10);
  expect(remaining.basis).toBeCloseTo(bought.basis * remaining.qty / bought.qty, 8);
  expect(broker.cash).toBeCloseTo(1000 - buy.notional - buy.fee + sell.notional - sell.fee, 8);
});

test('unknown fee period fails closed before a broker fill and does not invent a rate', () => {
  const b = new SimulatedBroker(1000, pairs, new ConservativeOhlcModel(),
    defaultRisk, 0, new FeeSchedule([tariff('later', 900000, 1800000, .001)]));
  b.queue({type: 'buy', pair: 'BTC/EUR', amountEur: 100, stopLossPct: .05,
    confidence: 1, reasoning: 'fixture'}, 0);
  expect(() => b.onCandle('BTC/EUR', candle(0), 15)).toThrow(/Unknown fee assumption/);
  expect(b.cash).toBe(1000);
  expect(b.trades).toHaveLength(0);
});

test('stress does not retroactively choose a different maker or taker path', () => {
  const schedule = new FeeSchedule([tariff('test', 0, 1000000, .001)]);
  const stressed = schedule.withStress(2);
  expect(stressed.select('BTC/EUR', 100, 'maker').rate).toBeCloseTo(.001);
  expect(stressed.select('BTC/EUR', 100, 'taker').rate).toBeCloseTo(.002);
  expect(schedule.select('BTC/EUR', 100, 'taker').rate).toBeCloseTo(.001);
  expect(stressed.tariffs).toEqual(schedule.tariffs);
  expect(Object.isFrozen(stressed.tariffs)).toBe(true);
  expect(Object.isFrozen(stressed.tariffs[0])).toBe(true);
});

test('overlaps, unsupported source or unbounded stress are rejected', () => {
  expect(() => new FeeSchedule([tariff('a', 0, 100, .001), tariff('b', 99, 200, .001)])).toThrow(/Overlapping/);
  expect(() => new FeeSchedule([tariff('a', 0, 100, .001), tariff('a', 100, 200, .001)])).toThrow(/duplicate/);
  expect(() => new FeeSchedule([{...tariff('a', 0, 100, .001), takerRate: -1}])).toThrow(/Invalid/);
  expect(() => new FeeSchedule([tariff('a', 0, 100, .001)], .5)).toThrow(/stress/);
});
