import {test,expect} from 'vitest';
import {CASH_YIELD_SENSITIVITIES,CASH_YIELD_WARNING,dailyCashYield,validateCashYieldApy} from '../src/backtest/cash-yield.js';
import {SimulatedBroker} from '../src/backtest/simulated-broker.js';
import {ConservativeOhlcModel} from '../src/backtest/fill-models.js';
import {defaultRisk} from '../src/backtest/runner.js';
import {advance,initialState,seriesId,DAY} from '../src/forward/engine-v2.js';
import {cashYieldMarkdown} from '../src/backtest/cash-yield-report.js';
import type {V5Report} from '../src/backtest/trend-research-v5.js';

const START=Date.UTC(2026,10,17);
const lotRules=Object.fromEntries(['BTCUSDT','ETHUSDT'].map(symbol=>[symbol,
 {stepSize:'0.00500000',minQty:'0.01000000',minNotional:'5.00000000'}]));
const candles=()=>Object.fromEntries(['BTCUSDT','ETHUSDT'].map(symbol=>[symbol,
 Array.from({length:263},(_,i)=>{
  const price=50000+i*200+Math.sin(i)*400;
  return {ts:START+(i-260)*DAY,open:price,high:price+1000,
   low:price-1000,close:price+100,volume:1e6,quoteVolume:1e8};
 })]));

test('registered yield scenarios are immutable 0/3/6%, default 0 and no position return',()=>{
 expect(CASH_YIELD_SENSITIVITIES).toEqual([0,0.03,0.06]);
 expect(validateCashYieldApy(undefined)).toBe(0);
 expect(validateCashYieldApy(0.03)).toBe(0.03);
 for(const bad of [-.01,.01,.10,NaN,Infinity])expect(()=>validateCashYieldApy(bad)).toThrow();
 expect(dailyCashYield(200,0.06)).toBeCloseTo(200*.06/365,12);
 expect(dailyCashYield(1000,0)).toBe(0);
 expect(CASH_YIELD_WARNING).toContain('Gegenparteirisiko');
});

test('broker credits only unused cash; no order, trade, fee or duplicate day',()=>{
 const broker=new SimulatedBroker(1000,new Map(),new ConservativeOhlcModel(),defaultRisk);
 const day=Date.UTC(2026,0,1);
 // The remaining capital is hypothetically invested, never interest bearing.
 broker.cash=200;
 expect(broker.creditCashYield(day,.03)).toBeCloseTo(200*.03/365);
 expect(broker.cash).toBeCloseTo(200*(1+.03/365));
 expect(broker.trades).toHaveLength(0);
 expect(broker.cashYieldDays).toBe(1);
 expect(()=>broker.creditCashYield(day,.03)).toThrow(/at most once/);
 const cash=broker.cash;
 broker.creditCashYield(day+DAY,.06);
 expect(broker.cash).toBeCloseTo(cash*(1+.06/365));
 expect(broker.cashYieldDays).toBe(2);
});

test('forward default is byte-compatible; enabled rate has separate hash and accrues only after start',()=>{
 const basic=initialState(START,'fixture',lotRules);
 const zero=initialState(START,'fixture',lotRules,0);
 const active=initialState(START,'fixture',lotRules,.03);
 expect(zero).toEqual(basic);
 expect(seriesId(zero)).toBe(seriesId(basic));
 expect(seriesId(active)).not.toBe(seriesId(basic));
 expect(active.accounts).toEqual(basic.accounts);
 const rows=candles();
 const baseline=advance(basic,rows,START+DAY,START+DAY);
 const withYield=advance(active,rows,START+DAY,START+DAY);
 expect(withYield.accounts.strategy.positions).toEqual(baseline.accounts.strategy.positions);
 expect(withYield.accounts.hold).toEqual(baseline.accounts.hold);
 expect(withYield.accounts.dca).toEqual(baseline.accounts.dca);
 expect(withYield.fills).toEqual(baseline.fills);
 expect(withYield.accounts.strategy.cash-baseline.accounts.strategy.cash)
  .toBeCloseTo(baseline.accounts.strategy.cash*.03/365,9);
 expect(advance(withYield,rows,START+DAY,START+2*DAY)).toEqual(withYield);
 expect(withYield.points.map(p=>p.day)).toEqual([START]);
 expect(()=>advance(active,rows,START+2*DAY,START+DAY)).toThrow();
 expect(basic.cashYieldApy).toBeUndefined();
});

test('forward missing data accrues nothing instead of fabricating a daily yield',()=>{
 const data=candles();
 data.BTCUSDT=data.BTCUSDT!.filter(c=>c.ts!==START);
 const active=initialState(START,'fixture',lotRules,.06);
 const result=advance(active,data,START+DAY,START+DAY);
 expect(result.accounts.strategy.cash).toBe(active.accounts.strategy.cash);
 expect(result.points[0]!.strategy).toBeNull();
});

test('v5 sensitivity report shows each profile side-by-side and forbids unsealed rows',()=>{
 const tier=(apy:0|0.03|0.06)=>[null,'vorsichtig','normal','aggressiv'].map(profile=>({
  researchVariant:'v5',paperApproved:false,pipelineEligible:false,
  backtest:{metrics:{netReturn:.1,cagr:.04,maxDrawdown:.2,tradeCount:3},
   trades:[],...(apy?{cashYield:{apy,total:12,days:365,historicalRateKnown:false}}:{})},
  profile:profile?{name:profile}:null
 })) as unknown as V5Report[];
 const groups=[tier(0),tier(.03),tier(.06)];
 const report=cashYieldMarkdown(groups);
 expect(report).toContain(CASH_YIELD_WARNING);
 expect(report).toContain('6.00 %');
 expect(report).toContain('3.00 %');
 expect(report).toContain('0.00 %');
 expect(report.match(/\| Basis \|/g)).toHaveLength(3);
 expect(()=>cashYieldMarkdown(groups.slice(0,2))).toThrow();
});
