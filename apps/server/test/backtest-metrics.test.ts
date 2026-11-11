import {test,expect} from 'vitest';
import {calculateMetrics,dailyEquity} from '../src/backtest/metrics.js';
import {deflatedSharpe,mean,variance,deviation,normalCdf,normalInv,probabilityOfBacktestOverfitting,maxDrawdown} from '../src/backtest/stats.js';
import {stationaryBootstrap} from '../src/backtest/bootstrap.js';
import {robustnessLight} from '../src/backtest/stress.js';
import type {BacktestResult} from '../src/backtest/runner.js';
import type {SimulatedTrade} from '../src/backtest/simulated-broker.js';
const DAY=86400000;
const points=(equities:number[],exposure=false)=>equities.map((equity,i)=>({ts:i*DAY,equity,exposed:exposure&&i>0}));
const trade=(side:'buy'|'sell',realizedPnl:number|null,notional=100,fee=1):SimulatedTrade=>
  ({ts:DAY,decisionTs:0,symbol:'BTC/EUR',side,qty:1,price:100,notional,fee,realizedPnl,spreadCost:.5,slippageCost:.8,reason:'fixture'});
test('hand-computed arithmetic mean, variance, deviation and peak-to-trough drawdown',()=>{
  expect(mean([1,2,3])).toBe(2);
  expect(variance([1,2,3])).toBeCloseTo(2/3);
  expect(variance([1,2,3],true)).toBe(1);
  expect(deviation([1,2,3],true)).toBe(1);
  expect(maxDrawdown([100,120,90,105])).toBeCloseTo(.25);
});
test('hand-computed net return, CAGR, Volatility, Sharpe and Sortino use 365-day crypto convention',()=>{
  const p=points([100,110,110,121]);
  const {metrics:m,returns}=calculateMetrics(p,[],0,3*DAY);
  expect(returns[0]).toBeCloseTo(.1,10);
  expect(returns[1]).toBeCloseTo(0,10);
  expect(returns[2]).toBeCloseTo(.1,10);
  expect(m.netReturn).toBeCloseTo(.21);
  expect(m.cagr).toBeCloseTo(1.21**(365/3)-1,5);
  expect(m.volatility).toBeCloseTo(Math.sqrt(.01/3)*Math.sqrt(365),5);
  expect(m.sharpe).toBeCloseTo((.2/3)/(Math.sqrt(.01/3))*Math.sqrt(365),5);
  expect(m.sortino).toBeNull();
});
test('hand-computed downside deviation and Sortino when a daily return is negative',()=>{
  const p=points([100,110,99,108.9]); // +10%, -10%, +10%
  const {metrics:m}=calculateMetrics(p,[],0,3*DAY);
  const downside=Math.sqrt((.1**2)/3);
  expect(m.sortino).toBeCloseTo((.1/3)/downside*Math.sqrt(365),5);
  expect(m.maxDrawdown).toBeCloseTo(.1);
});
test('hand-computed longest drawdown, Calmar, monthly loss and mark-to-market exposure',()=>{
  const p=points([100,120,110,108,115,125],true);
  const {metrics:m}=calculateMetrics(p,[],0,5*DAY);
  expect(m.longestDrawdownDays).toBe(3);
  expect(m.calmar).toBeCloseTo((1.25**(365/5)-1)/.1,5);
  expect(m.worstMonth).toBeCloseTo(.25);
  expect(m.exposureTime).toBe(1);
  expect(dailyEquity(p).length).toBe(6);
});
test('hand-computed win rate, payoff ratio, turnover, cost share and annualized trades',()=>{
  const p=points([100,120,130]);
  const trades=[trade('buy',null),trade('sell',20),trade('buy',null),trade('sell',-10)];
  const {metrics:m}=calculateMetrics(p,trades,0,2*DAY,1,undefined,2);
  expect(m.winRate).toBeCloseTo(.5);
  expect(m.payoffRatio).toBeCloseTo(2);
  expect(m.turnover).toBeCloseTo(400/((100+120+130)/3));
  const costs=trades.length*(1+.5+.8);
  expect(m.costShare).toBeCloseTo(costs/(30+costs));
  expect(m.tradesPerYear).toBeCloseTo(4/2*365);
  expect(m.rejectedOrders).toBe(2);
});
test('Gaussian DSR is one-sided significance for one trial; adjustment does not increase probability',()=>{
  const ret=Array.from({length:128},(_,i)=>.001+(i%8-3)*.002);
  const one=deflatedSharpe(ret,1),many=deflatedSharpe(ret,100);
  expect(one).not.toBeNull();
  expect(many).not.toBeNull();
  expect(one!).toBeGreaterThanOrEqual(many!);
  expect(normalCdf(normalInv(.95))).toBeCloseTo(.95,5);
});
test('CSCV PBO is null for single strategy or fewer than sixteen observations',()=>{
  expect(probabilityOfBacktestOverfitting([Array.from({length:32},()=>.01)])).toBeNull();
  expect(probabilityOfBacktestOverfitting([[.01],[.02]])).toBeNull();
  expect(probabilityOfBacktestOverfitting([Array.from({length:32},()=>.01),Array.from({length:32},()=>.02)])).not.toBeNull();
});
test('stationary bootstrap constant return has hand-derived ending and zero drawdown',()=>{
  const returns=Array(10).fill(.01);
  const bands=stationaryBootstrap(returns,42,1000,10)!;
  expect(bands.endReturn.p10).toBeCloseTo(1.01**10-1,10);
  expect(bands.endReturn.p50).toBeCloseTo(1.01**10-1,10);
  expect(bands.endReturn.p90).toBeCloseTo(1.01**10-1,10);
  expect(bands.maxDrawdown.p90).toBe(0);
});
test('traffic-light thresholds handle positive base, DSR and PBO exactly',()=>{
  const dummy=(net:number,dsr:number|null,pbo:number|null)=>({metrics:{netReturn:net,deflatedSharpeProbability:dsr,pbo}} as BacktestResult);
  const allPositive=['double-fees','double-slippage','one-bar-delay','drop-5-percent-signals'].map(name=>({name,netReturn:.01,trades:1,rejectedOrders:0})) as Parameters<typeof robustnessLight>[1];
  expect(robustnessLight(dummy(.1,.96,.1),allPositive)).toBe('robust');
  expect(robustnessLight(dummy(.1,.94,.1),allPositive)).toBe('questionable');
  expect(robustnessLight(dummy(.1,.96,.3),allPositive)).toBe('questionable');
  expect(robustnessLight(dummy(.1,.99,.5),allPositive)).toBe('fragile');
  expect(robustnessLight(dummy(0,.99,null),allPositive)).toBe('insufficient_evidence');
});
