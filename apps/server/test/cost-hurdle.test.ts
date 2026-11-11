import {test,expect} from 'vitest';
import {estimateRoundtripCost,evaluateCostAdmission} from '../src/broker/cost-hurdle.js';
import {PaperMakerQueue} from '../src/broker/paper-maker-queue.js';
import {summarizeRecorderCosts} from '../src/recorder/cost-hurdle.js';

test('cost estimate explicitly separates maker/taker fees, spread and adverse slippage', () => {
  const a={spreadBps:12,entrySlippageBps:3,exitSlippageBps:5,
    makerFeeRate:0.0002,takerFeeRate:0.001,entryLiquidity:'maker' as const,exitLiquidity:'taker' as const};
  const result=estimateRoundtripCost(a);
  expect(result.feeBps).toBeCloseTo(12);
  expect(result.spreadBps).toBeCloseTo(6);
  expect(result.slippageBps).toBe(8);
  expect(result.roundtripBps).toBeCloseTo(26);
  expect(evaluateCostAdmission({estimate:result,expectedGrossMoveBps:53,maxRoundtripCostBps:27}).allowed).toBe(true);
  expect(evaluateCostAdmission({estimate:result,expectedGrossMoveBps:52,maxRoundtripCostBps:27}).allowed).toBe(false);
  expect(evaluateCostAdmission({estimate:result,expectedGrossMoveBps:60,maxRoundtripCostBps:25}).allowed).toBe(false);
  expect(evaluateCostAdmission({estimate:result,expectedGrossMoveBps:null,maxRoundtripCostBps:27}).allowed).toBe(false);
  expect(evaluateCostAdmission({estimate:null,expectedGrossMoveBps:100,maxRoundtripCostBps:27}).allowed).toBe(false);
  expect(() => evaluateCostAdmission({estimate:result,expectedGrossMoveBps:100,maxRoundtripCostBps:27,edgeMultiple:1.5})).toThrow();
});
test('maker buy does not fill on touch, at placement, or with insufficient trade volume', () => {
  const q=new PaperMakerQueue();
  q.place({id:'buy-1',symbol:'BTC/USDT',side:'buy',qty:2,
    bestBid:100,bestAsk:101,placedAt:1000,ttlMs:500,makerFeeRate:0.0002});
  expect(q.observeTrade({symbol:'BTC/USDT',price:99,qty:2,ts:1000})).toHaveLength(0);
  expect(q.observeTrade({symbol:'BTC/USDT',price:100,qty:2,ts:1001})).toHaveLength(0);
  expect(q.observeTrade({symbol:'BTC/USDT',price:99,qty:1,ts:1002})).toHaveLength(0);
  const fills=q.observeTrade({symbol:'BTC/USDT',price:99,qty:3,ts:1003});
  expect(fills).toMatchObject([{price:100,qty:2,fee:0.04}]);
  expect(q.observeTrade({symbol:'BTC/USDT',price:98,qty:3,ts:1004})).toHaveLength(0);
  expect(q.pending.size).toBe(0);
});
test('maker sell requires strict crossing, expires and counts missed fills separately', () => {
  const q=new PaperMakerQueue();
  q.place({id:'sell-1',symbol:'BTC/USDT',side:'sell',qty:1,
    bestBid:100,bestAsk:101,placedAt:1000,ttlMs:100,makerFeeRate:0.0001});
  expect(q.observeTrade({symbol:'BTC/USDT',price:101,qty:3,ts:1001})).toHaveLength(0);
  expect(q.observeTrade({symbol:'BTC/USDT',price:102,qty:3,ts:1101})).toHaveLength(0);
  expect(q.expire(1101)).toHaveLength(1);
  expect(q.missed).toHaveLength(1);
  expect(q.fills).toHaveLength(0);
  expect(() => q.place({id:'sell-1',symbol:'BTC/USDT',side:'sell',qty:1,
    bestBid:100,bestAsk:101,placedAt:2000,ttlMs:100,makerFeeRate:0.0001})).toThrow('Duplicate');
});
test('post-only refuses crossed books and negative fees', () => {
  const q=new PaperMakerQueue(),req={id:'x',symbol:'BTC/USDT',side:'buy' as const,qty:1,
    bestBid:100,bestAsk:100,placedAt:1000,ttlMs:100,makerFeeRate:0.0001};
  expect(() => q.place(req)).toThrow();
  expect(() => q.place({...req,bestAsk:101,makerFeeRate:-1})).toThrow();
});
test('recorder depth bands cannot be converted into made-up size-specific slippage', () => {
  const s={ts:1000,symbol:'BTC/USDT',bid:100,ask:101,bidQty:5,askQty:3,
    spreadBps:99.5,depthBid10bps:5,depthAsk10bps:3,depthBid25bps:7,depthAsk25bps:4};
  const r=summarizeRecorderCosts('BTC/USDT',[s,{...s,ts:2000,spreadBps:20}]);
  expect(r.snapshotCount).toBe(2);
  expect(r.spreadBps.median).toBeCloseTo(59.75);
  expect(r.measuredMinimumEdgeBps).toBeNull();
  expect(r.slippage100).toBeNull();
  expect(r.complete).toBe(false);
  expect(summarizeRecorderCosts('BTC/USDT',[]).spreadBps.median).toBeNull();
});

test('one public trade cannot fill multiple maker orders beyond reported quantity', () => {
  const q = new PaperMakerQueue();
  for (const [id,placedAt] of [['first',1000],['second',1001]] as const)
    q.place({id,symbol:'ETH/USDT',side:'buy',qty:2,bestBid:100,bestAsk:101,
      placedAt,ttlMs:500,makerFeeRate:0.0002});
  expect(q.observeTrade({symbol:'ETH/USDT',price:99,qty:3,ts:1002}).map(f=>f.id))
    .toEqual(['first']);
  expect(q.pending.has('second')).toBe(true);
  expect(() => q.observeTrade({symbol:'ETH/USDT',price:99,qty:4,ts:1002}))
    .toThrow('Non-monotonic');
  expect(q.observeTrade({symbol:'ETH/USDT',price:99,qty:2,ts:1003}).map(f=>f.id))
    .toEqual(['second']);
});
