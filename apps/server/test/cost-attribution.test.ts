import {expect,test} from 'vitest';
import {attributeSimulatedCosts} from '../src/cost/attribution.js';
import type {SimulatedPosition,SimulatedTrade} from '../src/backtest/simulated-broker.js';

const JAN=Date.UTC(2022,0,12);
const FEB=Date.UTC(2022,1,12);
const fill=(overrides:Partial<SimulatedTrade>={}):SimulatedTrade=>({
  ts:JAN,decisionTs:JAN,symbol:'BTC/EUR',side:'buy',
  qty:2,price:100,notional:200,fee:.2,realizedPnl:null,
  spreadCost:.2,slippageCost:.1,reason:'offline fixture',
  feeLiquidity:'taker',feeSource:'synthetic-assumption',
  ...overrides
});
const position=(symbol:string,qty:number,basis:number):SimulatedPosition=>({
  symbol,qty,basis,entryPrice:100,stop:null,target:null,openedAt:JAN
});
function multiMarket() {
  const trades:SimulatedTrade[]=[
    fill(),
    fill({symbol:'ETH/EUR',qty:5,price:20,notional:100,fee:.1,
      spreadCost:.5,slippageCost:.2}),
    fill({side:'sell',ts:FEB,decisionTs:FEB,qty:1,price:110,
      notional:110,fee:.11,realizedPnl:9.79,
      spreadCost:.1,slippageCost:.05,feeLiquidity:'maker'})
  ];
  return {
    startingCash:1000,
    cash:809.59,
    trades,
    positions:new Map<string,SimulatedPosition>([
      ['BTC/EUR',position('BTC/EUR',1,100.1)],
      ['ETH/EUR',position('ETH/EUR',5,100.1)]
    ]),
    marks:new Map([['BTC/EUR',105],['ETH/EUR',18]])
  };
}

test('two-market waterfall reconciles partial realized PnL plus marked unrealized PnL to actual cash equity',()=>{
  const result=attributeSimulatedCosts(multiMarket());
  expect(result.reconciled).toBe(true);
  expect(result.markets.map(m=>m.symbol)).toEqual(['BTC/EUR','ETH/EUR']);
  const [btc,eth]=result.markets;
  expect(btc!.realizedNetPnl).toBeCloseTo(9.79,10);
  expect(btc!.unrealizedNetPnl).toBeCloseTo(4.9,10);
  expect(btc!.netPnl).toBeCloseTo(14.69,10);
  expect(eth!.realizedNetPnl).toBe(0);
  expect(eth!.unrealizedNetPnl).toBeCloseTo(-10.1,10);
  expect(result.totals.realizedNetPnl).toBeCloseTo(9.79,10);
  expect(result.totals.unrealizedNetPnl).toBeCloseTo(-5.2,10);
  expect(result.totals.netPnl).toBeCloseTo(4.59,10);
  expect(result.cashEquityNetPnl).toBeCloseTo(4.59,10);
  expect(result.totals.feeQuoteEquivalent).toBeCloseTo(.41,10);
  expect(result.totals.modeledSpread).toBeCloseTo(.8,10);
  expect(result.totals.modeledSlippage).toBeCloseTo(.35,10);
  expect(result.totals.modeledGrossPnl).toBeCloseTo(6.15,10);
});

test('symbol/month/liquidity costs aggregate separately without claiming a monthly strategy return',()=>{
  const result=attributeSimulatedCosts(multiMarket());
  expect(result.executions).toHaveLength(3);
  expect(result.executions.map(x=>[
    x.symbol,x.utcMonth,x.liquidity,x.fillCount
  ])).toEqual([
    ['BTC/EUR','2022-01','taker',1],
    ['BTC/EUR','2022-02','maker',1],
    ['ETH/EUR','2022-01','taker',1]
  ]);
  expect(result.executions.reduce((sum,x)=>sum+x.feeQuoteEquivalent,0))
    .toBeCloseTo(result.totals.feeQuoteEquivalent,10);
  expect(result.executions.reduce((sum,x)=>sum+x.modeledSpread+x.modeledSlippage,0))
    .toBeCloseTo(result.totals.modeledSpread+result.totals.modeledSlippage,10);
  expect(result.provenance).toBe('simulated-fill-fields-not-exchange-measurements');
  expect(result.limitations.join(' ')).toContain('never measured');
});

test('base-asset buy fees are quote-valued at known fill price, without a second cash deduction',()=>{
  const result=attributeSimulatedCosts({
    startingCash:1000,cash:800,
    trades:[fill({
      qty:1.998,notional:200,grossQty:2,feeBaseQty:.002,feeAsset:'base',
      fee:.2,feeRounding:'round-up-base-8dp',spreadCost:0,slippageCost:0
    })],
    positions:new Map([['BTC/EUR',position('BTC/EUR',1.998,200)]]),
    marks:new Map([['BTC/EUR',100]])
  });
  expect(result.totals.netPnl).toBeCloseTo(-.2,10);
  expect(result.totals.feeQuoteEquivalent).toBeCloseTo(.2,10);
  expect(result.totals.modeledGrossPnl).toBeCloseTo(0,10);
});

test('missing mark, inconsistent base fee, and failed total reconciliation are not presented as successes',()=>{
  const input=multiMarket();
  expect(()=>attributeSimulatedCosts({...input,cash:input.cash+1}))
    .toThrow(/does not reconcile/);
  expect(()=>attributeSimulatedCosts({...input,marks:new Map([['BTC/EUR',105]])}))
    .toThrow(/Missing or invalid open-position mark/);
  const base=fill({
    qty:1.998,grossQty:2,feeBaseQty:.002,feeAsset:'base',fee:.19
  });
  expect(()=>attributeSimulatedCosts({
    startingCash:1000,cash:800,trades:[base],
    positions:new Map([['BTC/EUR',position('BTC/EUR',1.998,200)]]),
    marks:new Map([['BTC/EUR',100]])
  })).toThrow(/Inconsistent base fee quote valuation/);
});

test('no fills is a neutral zero waterfall only if starting and ending cash reconcile',()=>{
  const empty={
    startingCash:1000,cash:1000,trades:[],
    positions:new Map<string,SimulatedPosition>(),
    marks:new Map<string,number>()
  };
  const result=attributeSimulatedCosts(empty);
  expect(result.totals.netPnl).toBe(0);
  expect(result.markets).toEqual([]);
  expect(result.executions).toEqual([]);
  expect(()=>attributeSimulatedCosts({...empty,cash:999}))
    .toThrow(/does not reconcile/);
});
