import {afterEach,beforeEach,expect,test} from 'vitest';
import {eq} from 'drizzle-orm';
import {db} from '../src/db.js';
import {accounts,pairs as paperPairs,positions as paperPositions,
  trades as paperTrades,rejectedOrders} from '../src/schema.js';
import {config} from '../src/config.js';
import {PaperExecutionAdapter} from '../src/broker/PaperExecutionAdapter.js';
import {positionStopRisk,validateRisk} from '../src/broker/risk.js';
import type {MarketFeed} from '../src/market/types.js';
import {ConservativeOhlcModel} from '../src/backtest/fill-models.js';
import {FeeSchedule} from '../src/backtest/fee-schedule.js';
import {SimulatedBroker,type MakerCostEvidence,type MarketConstraints} from '../src/backtest/simulated-broker.js';
import {estimateRoundtripCost} from '../src/broker/cost-hurdle.js';
import {defaultRisk} from '../src/backtest/runner.js';

const PAIR='PAR73/EUR';
const PAPER_ID='backtest-issue-73-parity';
const STEP=900000;
const paperFeed={connected:true,books:new Map<string,any>(),tickers:new Map(),
  features:new Map(),venue:'binance'} as unknown as MarketFeed;
const candle=(ts:number,price=10.01)=>({
  ts,open:price,high:price,low:price,close:price,volume:10
});
const buy=(amountEur:number)=>({
  type:'buy' as const,pair:PAIR,amountEur,stopLossPct:.05,
  confidence:1,reasoning:'post-rounding fixture'
});
const constraints=(costmin=10,lotDecimals=1)=>new Map<string,MarketConstraints>([[
  PAIR,{symbol:PAIR,ordermin:.1,costmin,lotDecimals}
]]);
const make=(costmin=10,lotDecimals=1)=>new SimulatedBroker(
  1000,constraints(costmin,lotDecimals),
  new ConservativeOhlcModel({spreadBps:0,slippageBps:0}),
  {...defaultRisk,feeRate:config.TAKER_FEE_RATE}
);
const clear=()=>{
  db.delete(rejectedOrders).where(eq(rejectedOrders.accountId,PAPER_ID)).run();
  db.delete(paperPositions).where(eq(paperPositions.accountId,PAPER_ID)).run();
  db.delete(paperTrades).where(eq(paperTrades.accountId,PAPER_ID)).run();
  db.delete(accounts).where(eq(accounts.id,PAPER_ID)).run();
  db.delete(paperPairs).where(eq(paperPairs.symbol,PAIR)).run();
};
let priorLatency:{min:number;max:number};
beforeEach(()=>{
  priorLatency={min:config.SIMULATED_LATENCY_MS_MIN,max:config.SIMULATED_LATENCY_MS_MAX};
  config.SIMULATED_LATENCY_MS_MIN=0;config.SIMULATED_LATENCY_MS_MAX=0;
  clear();
  db.insert(accounts).values({id:PAPER_ID,name:'Backtest/Paper parity #73',
    strategy:'rules',startingBalance:1000,cash:1000,peakEquity:1000,
    status:'active',createdAt:Date.now()}).run();
  db.insert(paperPairs).values({symbol:PAIR,restName:'PAR73EUR',base:'PAR73',
    quote:'EUR',ordermin:.1,costmin:10,lotDecimals:1,pairDecimals:2,
    active:true,volume24hEur:100000,status:'online',updatedAt:Date.now()}).run();
  paperFeed.connected=true;paperFeed.books.clear();
  paperFeed.books.set(PAIR,{symbol:PAIR,valid:true,receivedAt:Date.now(),
    bids:[{price:'10',qty:'1000'}],asks:[{price:'10.01',qty:'1000'}]});
});
afterEach(()=>{
  config.SIMULATED_LATENCY_MS_MIN=priorLatency.min;
  config.SIMULATED_LATENCY_MS_MAX=priorLatency.max;
  clear();
});

test('Paper and Backtest debit identical rounded quantity, notional, and fee on the same quote fixture',async()=>{
  const paper=new PaperExecutionAdapter(paperFeed,()=>{},undefined,{isolatedLedgerFixture:true});
  const result=await paper.placeMarketOrder({
    accountId:PAPER_ID,pair:PAIR,side:'buy',amountEur:50,
    reason:'post-rounding comparison fixture',decisionId:'issue-73'
  });
  expect(result.ok,result.reason).toBe(true);
  const recorded=db.select().from(paperTrades).where(eq(paperTrades.accountId,PAPER_ID)).get()!;
  const backtest=make();
  expect(backtest.queue(buy(50),0,'rules')).toBe(true);
  backtest.onCandle(PAIR,candle(0),15);
  const fill=backtest.trades[0]!;
  expect(backtest.trades).toHaveLength(1);
  expect(fill.qty).toBe(recorded.qty);
  expect(fill.notional).toBeCloseTo(recorded.costEur,8);
  expect(fill.fee).toBeCloseTo(recorded.feeEur,8);
  expect(fill.notional+fill.fee).toBeLessThanOrEqual(50+1e-7);
  expect(backtest.cash).toBeCloseTo(1000-recorded.costEur-recorded.feeEur,8);
  const final=validateRisk({
    accountId:'backtest',pair:PAIR,side:'buy',amountEur:fill.notional+fill.fee,
    stopLossPct:.05,reason:'fixture',decisionId:'issue-73'
  },{equity:1000,cash:1000,status:'active',positions:[],
    tradesToday:0,now:0},{...defaultRisk});
  expect(final.allowed).toBe(true);
  expect(final.amountEur!).toBeGreaterThanOrEqual(fill.notional+fill.fee-1e-7);
  const risk=positionStopRisk(fill.qty,fill.price,fill.price*.95,
    config.TAKER_FEE_RATE,10)+fill.fee;
  expect(risk).toBeLessThanOrEqual((1000-fill.fee)*defaultRisk.maxPortfolioRiskPct);
});

test('Paper and Backtest reject the same lot-rounded minimum-notional failure',async()=>{
  db.update(paperPairs).set({costmin:49.99,lotDecimals:0})
    .where(eq(paperPairs.symbol,PAIR)).run();
  const paper=new PaperExecutionAdapter(paperFeed,()=>{},undefined,{isolatedLedgerFixture:true});
  const result=await paper.placeMarketOrder({
    accountId:PAPER_ID,pair:PAIR,side:'buy',amountEur:50,
    reason:'min notional comparison',decisionId:'issue-73-low-lot'
  });
  expect(result.ok).toBe(false);
  expect(result.reason).toContain('Mindestgrösse');
  const backtest=make(49.99,0);
  expect(backtest.queue(buy(50),0,'rules')).toBe(true);
  backtest.onCandle(PAIR,candle(0),15);
  expect(backtest.trades).toHaveLength(0);
  expect(backtest.rejectionReasons.join(' ')).toContain('Minimum order');
  expect(backtest.cash).toBe(1000);
  expect(backtest.positions.size).toBe(0);
});

test('post-latency cash and position cap are rechecked against the actual rounded debit',()=>{
  const broker=make();
  expect(broker.queue(buy(300),0,'rules')).toBe(true);
  // A later account mutation must not inherit the original risk approval.
  broker.cash=900;
  broker.onCandle(PAIR,candle(STEP,10.01),15);
  expect(broker.trades).toHaveLength(0);
  expect(broker.cash).toBe(900);
  expect(broker.positions.size).toBe(0);
  expect(broker.rejectionReasons.join(' ')).toContain('Post-rounding risk limits');
});

test('non-executable rounded stop cannot masquerade as a small stop-loss risk',()=>{
  const broker=make(105,2);
  expect(broker.queue(buy(110),0,'rules')).toBe(true);
  broker.onCandle(PAIR,candle(0,10),15);
  expect(broker.trades).toHaveLength(0);
  expect(broker.positions.size).toBe(0);
  expect(broker.cash).toBe(1000);
  expect(broker.rejectionReasons.join(' ')).toContain('aggregate stop-risk');
});

test('maker fee increase at fill cannot debit more than its original rounded order budget',()=>{
  const schedule=new FeeSchedule([
    {id:'before',quote:'EUR',fromMs:0,untilMs:1200,
      makerRate:.0002,takerRate:.001,source:'synthetic-assumption'},
    {id:'after',quote:'EUR',fromMs:1200,untilMs:2000,
      makerRate:.004,takerRate:.005,source:'synthetic-assumption'}
  ]);
  const broker=new SimulatedBroker(1000,constraints(10,4),
    new ConservativeOhlcModel(),{...defaultRisk,feeRate:.001},0,schedule);
  const costs:MakerCostEvidence={
    estimate:estimateRoundtripCost({
      spreadBps:10,entrySlippageBps:0,exitSlippageBps:0,
      makerFeeRate:.0002,takerFeeRate:.005,
      entryLiquidity:'maker',exitLiquidity:'taker'
    }),
    expectedGrossMoveBps:250,maxRoundtripCostBps:100
  };
  const id=broker.queuePostOnly(buy(100),1100,
    {receivedAt:1099,bestBid:100,bestAsk:100.1},1000,.0002,costs,'hold');
  expect(id).not.toBeNull();
  broker.observeMakerTrade({
    symbol:PAIR,price:99.9,qty:10,exchangeTs:1200,receivedAt:1201
  },1201);
  expect(broker.trades).toHaveLength(0);
  expect(broker.positions.size).toBe(0);
  expect(broker.cash).toBe(1000);
  expect(broker.rejectionReasons.join(' ')).toContain('exceeds approved order budget');
});

test('a protective full sell remains executable even when new buys would fail the drawdown guard',()=>{
  const broker=make();
  expect(broker.queue(buy(100),0,'hold')).toBe(true);
  broker.onCandle(PAIR,candle(0),15);
  expect(broker.positions.size).toBe(1);
  broker.peak=10000;
  expect(broker.queue({type:'sell',pair:PAIR,sellFraction:1,
    confidence:1,reasoning:'protective exit'},STEP,'rules')).toBe(true);
  broker.onCandle(PAIR,candle(STEP,9.50),15);
  expect(broker.trades.map(t=>t.side)).toEqual(['buy','sell']);
  expect(broker.positions.size).toBe(0);
  expect(broker.rejectionReasons.join(' ')).not.toContain('Post-fill drawdown');
});
