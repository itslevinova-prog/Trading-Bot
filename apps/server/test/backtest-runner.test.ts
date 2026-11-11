import {test,expect} from 'vitest';
import {FixtureCandleSource,type Candle} from '../src/backtest/candle-source.js';
import {runBacktest,type BacktestOptions} from '../src/backtest/runner.js';
import {runStressTests,robustnessLight} from '../src/backtest/stress.js';
import {stationaryBootstrap} from '../src/backtest/bootstrap.js';
import {benchmarks,reportHtml} from '../src/backtest/report.js';
import {comparePaper} from '../src/backtest/parity.js';
import type {DecisionProvider} from '@paper/shared';
const MIN=60000, HOUR=3600000;
function fixture(){
  const candle=(ts:number,price:number):Candle=>({ts,open:price,high:price*1.01,low:price*.99,close:price*1.001,volume:100});
  const fifteen=Array.from({length:310},(_,i)=>candle(i*15*MIN,100+i*.1));
  const hourly=Array.from({length:77},(_,i)=>candle(i*HOUR,100+i*.4));
  return new FixtureCandleSource([
    {symbol:'BTC/EUR',intervalMinutes:15,candles:fifteen},
    {symbol:'BTC/EUR',intervalMinutes:60,candles:hourly}
  ]);
}
const options=():BacktestOptions=>({source:fixture(),strategy:'hold',fromMs:0,toMs:310*15*MIN,intervalMinutes:15,
  initialCash:1000,seed:10,feeRate:.001,
  constraints:new Map([['BTC/EUR',{symbol:'BTC/EUR',ordermin:.0001,costmin:10,lotDecimals:8}]])});
test('real production BuyAndHoldProvider path places exactly one next-bar BTC entry and reports parity',async()=>{
  const result=await runBacktest(options());
  expect(result.trades).toHaveLength(1);
  expect(result.trades[0]?.side).toBe('buy');
  expect(result.trades[0]?.ts).toBe(15*MIN);
  expect(result.decisions.every(d=>d.actions.every(a=>a.type==='hold'))).toBe(true);
  expect(result.equity.length).toBeGreaterThan(200);
  expect(result.metrics.netReturn).toBeGreaterThan(0);
  const fixturePaper=result.decisions.slice(0,20).map(d=>({ts:d.ts,actions:d.actions}));
  const parity=comparePaper(result,fixturePaper,[]);
  expect(parity.status).toBe('compared');
  expect(parity.decisionAgreementPct).toBe(100);
  expect(parity.targetMet).toBe(true);
});
test('production rules provider is callable on fixtures without external network',async()=>{
  const result=await runBacktest({...options(),strategy:'rules'});
  expect(result.configuration.strategy).toBe('rules');
  expect(result.decisions.length).toBeGreaterThan(200);
  expect(result.decisions.every(d=>d.ts<=result.configuration.toMs)).toBe(true);
  expect(result.fingerprints.combined).toMatch(/^[a-f0-9]{64}$/);
});
test('spying provider sees only complete causal market candles and cannot see the next bar',async()=>{
  let observed=0;
  const spy:DecisionProvider={decide:async ctx=>{
    observed++;
    const now=Date.parse(ctx.timeUTC);
    for(const f of ctx.features)expect(f.ts+15*MIN).toBeLessThanOrEqual(now);
    const market=ctx.marketContext as {markets:Array<{candles:{m15:number[][];h1:number[][];h4:number[][];d1:number[][]}}>} ;
    for(const pair of market.markets)for(const [label,minutes] of [['m15',15],['h1',60],['h4',240],['d1',1440]] as const)
      for(const c of pair.candles[label])expect(c[0]!+minutes*MIN).toBeLessThanOrEqual(now);
    return {marketView:'Causal hold',actions:[{type:'hold',confidence:1,reasoning:'No leaks'}]};
  }};
  await runBacktest({...options(),strategy:'rules',provider:spy});
  expect(observed).toBeGreaterThan(100);
});
test('stress scenarios run seeded provider and report; static HTML has no external resources',async()=>{
  const base=options();
  const result=await runBacktest(base);
  const stress=await runStressTests(base);
  expect(stress.map(x=>x.name)).toEqual(['double-fees','double-slippage','one-bar-delay','drop-5-percent-signals']);
  const b=await benchmarks(base.source,15,base.fromMs,base.toMs,['BTC/EUR'],'EUR');
  expect(b).toHaveLength(3);
  expect(b.map(x=>x.name)).toContain('DCA 70/30 BTC/ETH (monthly, TWR)');
  expect(b.find(x=>x.name.startsWith('DCA'))!.netReturn).toBeNull();
  expect(b[0]!.netReturn).not.toBeNull();
  expect(b.find(x=>x.name.startsWith('Equal-weight'))!.netReturn).not.toBeNull();
  const report={runId:result.fingerprints.combined.slice(0,16),backtest:result,benchmarks:b,
    bootstrap:stationaryBootstrap([.01,.02,-.01],10),stress,robustness:robustnessLight(result,stress),
    parity:comparePaper(result,[],[])};
  const html=reportHtml(report);
  expect(html).toContain('<svg');
  expect(html).toContain('BTC Buy &amp; Hold');
  expect(html).not.toMatch(/<script\b|<link\b|\ssrc=/);
});
