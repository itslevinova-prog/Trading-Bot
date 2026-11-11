import {expect,test} from 'vitest';
import {estimateRoundtripCost} from '../src/broker/cost-hurdle.js';
import {SimulatedBroker,type MakerCostEvidence} from '../src/backtest/simulated-broker.js';
import {ConservativeOhlcModel} from '../src/backtest/fill-models.js';
import {defaultRisk} from '../src/backtest/runner.js';

const STEP=900000;
const pairs=new Map([['BTC/EUR',{
  symbol:'BTC/EUR',ordermin:0.0001,costmin:10,lotDecimals:4
}]]);
const buy=(amountEur:number)=>({
  type:'buy' as const,pair:'BTC/EUR',amountEur,stopLossPct:.05,
  confidence:1,reasoning:'prior closed-volume fixture'
});
const bar=(ts:number,quoteVolume?:number,price=100)=>({
  ts,open:price,high:price,low:price,close:price,volume:10,
  ...(quoteVolume===undefined?{}:{quoteVolume})
});
const make=(fraction=.1)=>new SimulatedBroker(1000,pairs,
  new ConservativeOhlcModel({spreadBps:0,slippageBps:0}),
  {...defaultRisk,feeRate:.001},0,undefined,'quote',
  {maxQuoteVolumeFraction:fraction}
);

test('initial entry has no previously closed volume, even when the current bar is huge',()=>{
  const b=make();
  expect(b.queue(buy(50),0,'hold')).toBe(true);
  b.onCandle('BTC/EUR',bar(0,1_000_000),15);
  expect(b.positions.size).toBe(0);
  expect(b.trades).toHaveLength(0);
  expect(b.rejectionReasons.at(-1)).toMatch(/missing or stale previously closed/);
});

test('small completed bar caps large order but admits nearby smaller order',()=>{
  const large=make(),small=make();
  for(const b of [large,small])b.onCandle('BTC/EUR',bar(0,200),15);
  large.queue(buy(50),STEP,'hold');
  small.queue(buy(15),STEP,'hold');
  // A massive current bar MUST NOT retroactively grant an earlier fill.
  large.onCandle('BTC/EUR',bar(STEP,1_000_000),15);
  small.onCandle('BTC/EUR',bar(STEP,1_000_000),15);
  expect(large.trades).toHaveLength(0);
  expect(large.rejectionReasons.at(-1)).toContain('quote-volume cap');
  expect(small.trades).toHaveLength(1);
  expect(small.trades[0]!.notional).toBeLessThanOrEqual(20);
  expect(small.trades[0]!.feeLiquidity).toBe('taker');
  // That bar only becomes eligible AFTER it is closed.
  large.queue(buy(50),2*STEP,'hold');
  large.onCandle('BTC/EUR',bar(2*STEP,1),15);
  expect(large.trades).toHaveLength(1);
});

test('missing, zero or gapped quote-volume evidence blocks new inventory',()=>{
  for(const first of [undefined,0]){
    const b=make();
    b.onCandle('BTC/EUR',bar(0,first),15);
    b.queue(buy(50),STEP,'hold');
    b.onCandle('BTC/EUR',bar(STEP,100_000),15);
    expect(b.positions.size).toBe(0);
    expect(b.rejectionReasons.at(-1)).toContain('missing or stale');
  }
  const gapped=make();
  gapped.onCandle('BTC/EUR',bar(0,100_000),15);
  gapped.queue(buy(50),2*STEP,'hold');
  gapped.onCandle('BTC/EUR',bar(2*STEP,100_000),15);
  expect(gapped.trades).toHaveLength(0);
  expect(gapped.rejectionReasons.at(-1)).toContain('missing or stale');
});

test('hypothetical post-only maker placement is blocked by the same prior capacity evidence',()=>{
  const b=make();
  b.onCandle('BTC/EUR',bar(0,100),15);
  const costs:MakerCostEvidence={
    estimate:estimateRoundtripCost({
      spreadBps:10,entrySlippageBps:0,exitSlippageBps:0,
      makerFeeRate:.0002,takerFeeRate:.001,
      entryLiquidity:'maker',exitLiquidity:'taker'
    }),
    expectedGrossMoveBps:50,maxRoundtripCostBps:30
  };
  const book={receivedAt:STEP-1,bestBid:100,bestAsk:100.1};
  expect(b.queuePostOnly(buy(50),STEP,book,1000,.0002,costs,'hold'))
    .toBeNull();
  expect(b.rejectionReasons.at(-1)).toContain('quote-volume cap');
  expect(b.makerQueue.pending.size).toBe(0);
  const allowed=make(.2);
  allowed.onCandle('BTC/EUR',bar(0,100),15);
  expect(allowed.queuePostOnly(buy(15),STEP,book,1000,.0002,costs,'hold'))
    .not.toBeNull();
  expect(allowed.makerQueue.pending.size).toBe(1);
});

test('protective stop exits remain possible when entry capacity is unknown',()=>{
  const b=make();
  b.onCandle('BTC/EUR',bar(0,10_000),15);
  b.queue(buy(50),STEP,'hold');
  b.onCandle('BTC/EUR',bar(STEP,0),15);
  const position=b.positions.get('BTC/EUR')!;
  expect(position).toBeDefined();
  b.positions.set('BTC/EUR',{...position,stop:95});
  b.onCandle('BTC/EUR',bar(2*STEP,undefined,90),15);
  expect(b.trades.map(t=>t.side)).toEqual(['buy','sell']);
  expect(b.trades[1]?.reason).toBe('stop');
  expect(b.positions.size).toBe(0);
});

test('unsafe participation thresholds are rejected rather than silently disabled',()=>{
  expect(()=>make(0)).toThrow(/Invalid quote-volume/);
  expect(()=>make(1.01)).toThrow(/Invalid quote-volume/);
  expect(()=>make(NaN)).toThrow(/Invalid quote-volume/);
});
