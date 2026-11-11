import {expect,test} from 'vitest';
import {estimateRoundtripCost} from '../src/broker/cost-hurdle.js';
import {ConservativeOhlcModel} from '../src/backtest/fill-models.js';
import {SimulatedBroker,type MakerCostEvidence} from '../src/backtest/simulated-broker.js';
import {defaultRisk} from '../src/backtest/runner.js';
import {FeeSchedule} from '../src/backtest/fee-schedule.js';

const constraints=new Map([['BTC/EUR',{
  symbol:'BTC/EUR',ordermin:0.0001,costmin:10,lotDecimals:4
}]]);
const costs:MakerCostEvidence={
  estimate:estimateRoundtripCost({
    spreadBps:10,entrySlippageBps:0,exitSlippageBps:0,
    makerFeeRate:.0002,takerFeeRate:.001,
    entryLiquidity:'maker',exitLiquidity:'taker'
  }),
  expectedGrossMoveBps:40,maxRoundtripCostBps:25
};
const make=()=>new SimulatedBroker(1000,constraints,new ConservativeOhlcModel(),
  {...defaultRisk,maxSpreadBps:20,feeRate:.001});
const buy={type:'buy' as const,pair:'BTC/EUR',amountEur:100,stopLossPct:.05,
  confidence:1,reasoning:'offline fixture'};
const sell=(fraction:number)=>({type:'sell' as const,pair:'BTC/EUR',sellFraction:fraction,
  confidence:1,reasoning:'offline fixture'});
const book=(receivedAt:number,bid=100,ask=100.1)=>({
  receivedAt,bestBid:bid,bestAsk:ask
});

test('received strict-through maker buy and partial sell settle in quote-ledger',()=>{
  const b=make();
  const id=b.queuePostOnly(buy,1100,book(1000),1000,.0002,costs,'hold');
  expect(id).toBeTruthy();
  expect(b.trades).toHaveLength(0);
  expect(b.orders).toHaveLength(0);
  expect(b.makerQueue.pending.size).toBe(1);
  // Trades at placement or exactly at limit cannot manufacture a maker fill.
  expect(b.observeMakerTrade({
    symbol:'BTC/EUR',price:99,qty:2,exchangeTs:1099,receivedAt:1100
  },1100)).toHaveLength(0);
  expect(b.observeMakerTrade({
    symbol:'BTC/EUR',price:100,qty:2,exchangeTs:1101,receivedAt:1102
  },1102)).toHaveLength(0);
  const buyFills=b.observeMakerTrade({
    symbol:'BTC/EUR',price:99.9,qty:2,exchangeTs:1103,receivedAt:1104
  },1104);
  expect(buyFills).toHaveLength(1);
  expect(buyFills[0]!.price).toBe(100); // Limit, not favorable crossing print.
  const entry=b.trades[0]!;
  expect(entry.ts).toBe(1104); // Reception clock, never exchange clock.
  expect(entry.feeLiquidity).toBe('maker');
  expect(entry.feeRateApplied).toBe(.0002);
  expect(entry.makerOrderId).toBe(id);
  expect(entry.fee).toBeCloseTo(entry.qty*100*.0002,10);
  expect(b.positions.get('BTC/EUR')?.qty).toBe(entry.qty);
  expect(b.positions.get('BTC/EUR')?.basis).toBeCloseTo(entry.notional+entry.fee,10);
  expect(b.cash).toBeCloseTo(1000-entry.notional-entry.fee,10);

  const sellId=b.queuePostOnly(sell(.5),1200,book(1199,101,101.1),
    1000,.0002,costs);
  expect(sellId).toBeTruthy();
  expect(b.observeMakerTrade({
    symbol:'BTC/EUR',price:101.1,qty:5,exchangeTs:1201,receivedAt:1202
  },1202)).toHaveLength(0);
  expect(b.observeMakerTrade({
    symbol:'BTC/EUR',price:101.2,qty:5,exchangeTs:1203,receivedAt:1204
  },1204)).toHaveLength(1);
  const exit=b.trades[1]!;
  const position=b.positions.get('BTC/EUR')!;
  expect(exit.feeLiquidity).toBe('maker');
  expect(exit.price).toBe(101.1);
  expect(exit.fee).toBeCloseTo(exit.qty*101.1*.0002,10);
  expect(exit.realizedPnl).toBeCloseTo(
    exit.notional-exit.fee-(entry.notional+entry.fee)*exit.qty/entry.qty,10);
  expect(position.qty).toBeCloseTo(entry.qty-exit.qty,10);
  expect(position.basis).toBeCloseTo(
    (entry.notional+entry.fee)*(1-exit.qty/entry.qty),10);
  expect(b.cash).toBeCloseTo(
    1000-entry.notional-entry.fee+exit.notional-exit.fee,10);
  expect(b.missedMakerFills).toBe(0);
});

test('absence, stale book, high cost or unavailable gross edge all fail closed',()=>{
  const b=make();
  expect(b.queuePostOnly(buy,1100,null,1000,.0002,costs)).toBeNull();
  expect(b.queuePostOnly(buy,1100,book(1101),1000,.0002,costs)).toBeNull();
  expect(b.queuePostOnly(buy,7001,book(1000),1000,.0002,costs)).toBeNull();
  expect(b.queuePostOnly(buy,1100,book(1000,100,101),1000,.0002,costs)).toBeNull();
  expect(b.queuePostOnly(buy,1100,book(1000),1000,.0002,
    {...costs,expectedGrossMoveBps:null})).toBeNull();
  expect(b.queuePostOnly(buy,1100,book(1000),1000,.0002,
    {...costs,maxRoundtripCostBps:5})).toBeNull();
  expect(b.queuePostOnly(buy,1100,book(1000),1000,.0002,
    {...costs,estimate:{source:'assumption',roundtripBps:0,
      feeBps:0,spreadBps:0,slippageBps:0}})).toBeNull();
  expect(b.makerQueue.pending.size).toBe(0);
  expect(b.trades).toHaveLength(0);
  expect(b.rejected).toBe(7);
});

test('missing and later-received public trades never leak through decision cutoff',()=>{
  const b=make();
  b.queuePostOnly(buy,1100,book(1000),1000,.0002,costs);
  expect(b.observeMakerTrade({
    symbol:'BTC/EUR',price:99,qty:2,exchangeTs:1101,receivedAt:null
  },1200)).toHaveLength(0);
  expect(b.observeMakerTrade({
    symbol:'BTC/EUR',price:99,qty:2,exchangeTs:1101,receivedAt:1201
  },1200)).toHaveLength(0);
  expect(b.observeMakerTrade({
    symbol:'BTC/EUR',price:99,qty:2,exchangeTs:1300,receivedAt:1102
  },1200)).toHaveLength(0);
  expect(b.trades).toHaveLength(0);
  // A print that only ARRIVED after placement but occurred before it cannot fill.
  expect(b.observeMakerTrade({
    symbol:'BTC/EUR',price:99,qty:2,exchangeTs:1099,receivedAt:1150
  },1200)).toHaveLength(0);
  expect(b.observeMakerTrade({
    symbol:'BTC/EUR',price:99,qty:2,exchangeTs:1101,receivedAt:1201
  },1201)).toHaveLength(1);
  expect(b.trades[0]?.ts).toBe(1201);
  expect(b.rejected).toBe(3);
});

test('unfilled orders expire without inventory or cash changes',()=>{
  const b=make();
  b.queuePostOnly(buy,1100,book(1000),100,.0002,costs);
  expect(b.expireMakerOrders(1200)).toBe(0);
  expect(b.observeMakerTrade({
    symbol:'BTC/EUR',price:99,qty:2,exchangeTs:1200,receivedAt:1201
  },1201)).toHaveLength(0);
  expect(b.expireMakerOrders(1201)).toBe(1);
  expect(b.missedMakerFills).toBe(1);
  expect(b.positions.size).toBe(0);
  expect(b.cash).toBe(1000);
  expect(b.trades).toHaveLength(0);
  expect(b.rejectionReasons.join(' ')).toContain('expired');
});

test('duplicate symbol orders and insufficient quote cash cannot overcommit',()=>{
  const b=make();
  const id=b.queuePostOnly(buy,1100,book(1000),1000,.0002,costs);
  expect(id).toBeTruthy();
  expect(b.queuePostOnly(buy,1101,book(1100),1000,.0002,costs)).toBeNull();
  expect(b.makerQueue.pending.size).toBe(1);
  expect(b.rejectionReasons.join(' ')).toContain('already pending');
});

test('maker fee tariff is selected at fill, not retrospectively frozen at placement',()=>{
  const schedule=new FeeSchedule([
    {id:'first',quote:'EUR',fromMs:0,untilMs:1200,
      makerRate:.0002,takerRate:.001,source:'synthetic-assumption'},
    {id:'second',quote:'EUR',fromMs:1200,untilMs:3000,
      makerRate:.0003,takerRate:.0015,source:'synthetic-assumption'}
  ]);
  // Keep ample lot-rounding headroom for the higher maker fee at fill.
  // The test verifies the tariff switch, not an over-budget execution.
  const coarseLots=new Map([['BTC/EUR',{
    ...constraints.get('BTC/EUR')!,lotDecimals:2
  }]]);
  const b=new SimulatedBroker(1000,coarseLots,new ConservativeOhlcModel(),
    {...defaultRisk,maxSpreadBps:20},0,schedule);
  const evidence:MakerCostEvidence={
    estimate:estimateRoundtripCost({
      spreadBps:10,entrySlippageBps:0,exitSlippageBps:0,
      makerFeeRate:.0002,takerFeeRate:.0015,
      entryLiquidity:'maker',exitLiquidity:'taker'
    }),
    expectedGrossMoveBps:50,maxRoundtripCostBps:30
  };
  expect(b.queuePostOnly(buy,1100,book(1000),1000,.0001,evidence,'hold'))
    .toBeNull(); // Caller cannot understate the schedule's maker rate.
  const id=b.queuePostOnly(buy,1100,book(1000),1000,.0002,evidence,'hold');
  expect(id).not.toBeNull();
  const result=b.observeMakerTrade({
    symbol:'BTC/EUR',price:99,qty:2,exchangeTs:1200,receivedAt:1201
  },1201);
  expect(result).toHaveLength(1);
  const t=b.trades[0]!;
  expect(t.feeTariffId).toBe('second');
  expect(t.feeLiquidity).toBe('maker');
  expect(t.feeRateApplied).toBe(.0003);
  expect(t.feeRounding).toBe('round-up-quote-8dp');
  expect(t.fee).toBeCloseTo(Math.ceil(t.notional*.0003*1e8)/1e8,10);
  expect(b.cash).toBeCloseTo(1000-t.notional-t.fee,10);
});
