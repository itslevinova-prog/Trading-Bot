import {test,expect} from 'vitest';
import Database from 'better-sqlite3';
import {FixtureCandleSource,SqliteCandleSource,type Candle} from '../src/backtest/candle-source.js';
import {ConservativeOhlcModel} from '../src/backtest/fill-models.js';
import {SimulatedBroker} from '../src/backtest/simulated-broker.js';
import {defaultRisk,runBacktest} from '../src/backtest/runner.js';
import {calculateMetrics,dailyEquity} from '../src/backtest/metrics.js';
import {normalCdf,normalInv,deflatedSharpe,probabilityOfBacktestOverfitting,quantile} from '../src/backtest/stats.js';
import {stationaryBootstrap} from '../src/backtest/bootstrap.js';
import {comparePaper} from '../src/backtest/parity.js';
import type {DecisionProvider} from '@paper/shared';
const bar=(ts:number,open=100,high=102,low=99,close=101):Candle=>({ts,open,high,low,close,volume:1});
const constraints=new Map([['BTC/EUR',{symbol:'BTC/EUR',ordermin:.001,costmin:10,lotDecimals:4}]]);
test('CandleSource uses exact closed-bar contract and keeps missing timestamps missing',async()=>{
  const source=new FixtureCandleSource([{symbol:'BTC/EUR',intervalMinutes:15,candles:[bar(0),bar(1800000)]}]);
  expect((await source.getCandles('BTC/EUR',15,0,2700000)).map(c=>c.ts)).toEqual([0,1800000]);
  await expect(source.getCandles('BTC/EUR',15,0,1800001)).rejects.toThrow(/Look-ahead/);
  const db=new Database(':memory:');
  db.exec('CREATE TABLE candles(pair TEXT,interval INTEGER,ts INTEGER,open REAL,high REAL,low REAL,close REAL,volume REAL)');
  db.prepare('INSERT INTO candles VALUES (?,?,?,?,?,?,?,?)').run('BTC/EUR',15,0,100,102,99,101,1);
  expect((await new SqliteCandleSource(db).getCandles('BTC/EUR',15,0,900000)).length).toBe(1);
  await expect(new SqliteCandleSource(db).getCandles('BTC/EUR',240,0,14400000)).rejects.toThrow(/15m and 60m/);
  db.close();
});
test('Gap-stop fills no higher than the opening gap minus costs',()=>{
  const b=new SimulatedBroker(1000,constraints,new ConservativeOhlcModel(),{...defaultRisk,feeRate:.001},0);
  expect(b.queue({type:'buy',pair:'BTC/EUR',amountEur:100,stopLossPct:.05,takeProfitPct:.10,confidence:1,reasoning:'fixture'},0)).toBe(true);
  b.onCandle('BTC/EUR',bar(0),15);
  b.onCandle('BTC/EUR',bar(900000,90,110,88,109),15);
  expect(b.trades.map(t=>t.side)).toEqual(['buy','sell']);
  const exit=b.trades[1]!;
  expect(exit.reason).toBe('stop');
  expect(exit.price).toBeLessThan(90);
});
test('Stop precedes target when both touched within the same bar',()=>{
  const b=new SimulatedBroker(1000,constraints,new ConservativeOhlcModel(),{...defaultRisk,feeRate:.001},0);
  b.queue({type:'buy',pair:'BTC/EUR',amountEur:100,stopLossPct:.05,takeProfitPct:.10,confidence:1,reasoning:'fixture'},0);
  b.onCandle('BTC/EUR',bar(0),15);
  b.onCandle('BTC/EUR',bar(900000,101,120,90,105),15);
  expect(b.trades.at(-1)?.reason).toBe('stop');
});
test('Min notional and lot constraints reject undersized order (counted)',()=>{
  const restricted=new Map([['BTC/EUR',{symbol:'BTC/EUR',ordermin:3,costmin:200,lotDecimals:2}]]);
  const b=new SimulatedBroker(1000,restricted,new ConservativeOhlcModel(),{...defaultRisk,feeRate:.001});
  b.queue({type:'buy',pair:'BTC/EUR',amountEur:100,stopLossPct:.05,confidence:1,reasoning:'small'},0);
  b.onCandle('BTC/EUR',bar(0),15);
  expect(b.trades).toHaveLength(0);expect(b.rejected).toBe(1);
});
test('Hand-computed simple return, drawdown, win-rate and annualization factors',()=>{
  const points=[{ts:0,equity:100,exposed:false},{ts:86400000,equity:90,exposed:true},{ts:2*86400000,equity:110,exposed:true}];
  const r=calculateMetrics(points,[],0,2*86400000,1);
  expect(r.metrics.netReturn).toBeCloseTo(.10,10);
  expect(r.metrics.maxDrawdown).toBeCloseTo(.10,10);
  expect(r.metrics.exposureTime).toBe(1);
  expect(r.metrics.cagr).toBeCloseTo(1.1**(365/2)-1,6);
  expect(r.returns[0]).toBeCloseTo(-.1);
  expect(r.returns[1]).toBeCloseTo(110/90-1);
  expect(r.metrics.sharpe).toBeCloseTo(((-.1+(110/90-1))/2)/(Math.sqrt(((-.1-(-.1+(110/90-1))/2)**2+((110/90-1)-(-.1+(110/90-1))/2)**2)/(2-1)))*Math.sqrt(365),6);
  expect(dailyEquity(points).map(x=>x.day)).toEqual(['1970-01-01','1970-01-02','1970-01-03']);
});
test('Numerical statistics and stationary bootstrap are deterministic',()=>{
  expect(quantile([1,3,5,7],.5)).toBe(4);
  expect(normalCdf(0)).toBeCloseTo(.5,6);
  expect(normalInv(.975)).toBeCloseTo(1.9599639845,3);
  expect(deflatedSharpe([.01,-.02,.03,.02,-.01,.04],1)).not.toBeNull();
  expect(probabilityOfBacktestOverfitting([Array.from({length:32},(_,i)=>i%2?.01:-.01),Array.from({length:32},(_,i)=>i%2?-.01:.01)])).not.toBeNull();
  const boot=stationaryBootstrap([.01,-.02,.03,.00],123,1000,10);
  expect(boot).toEqual(stationaryBootstrap([.01,-.02,.03,.00],123,1000,10));
  expect(boot!.endReturn.p10).toBeLessThanOrEqual(boot!.endReturn.p90);
});
test('Malicious CandleSource future leak aborts before provider can peek',async()=>{
  const source=new FixtureCandleSource([{symbol:'BTC/EUR',intervalMinutes:15,candles:[bar(0)]}]);
  const malicious={listSymbols:()=>source.listSymbols(),getCandles:async()=>[bar(900000)]};
  let called=false;
  const spy:DecisionProvider={decide:async()=>{called=true;throw Error('Future candle detected');}};
  await expect(runBacktest({source:malicious,strategy:'rules',fromMs:0,toMs:900000,intervalMinutes:15,provider:spy})).rejects.toThrow(/Look-ahead/);
  expect(called).toBe(false);
});
test('Fixture parity reports identical holds for same candle clock',()=>{
  const result={configuration:{intervalMinutes:15,fromMs:0,toMs:900000},decisions:[{ts:900000,symbol:'*',actions:[{type:'hold',confidence:1,reasoning:'none'}]}],trades:[],universe:['BTC/EUR']} as unknown as Awaited<ReturnType<typeof runBacktest>>;
  const parity=comparePaper(result,[{ts:900000,actions:[{type:'hold',confidence:1,reasoning:'none'}]}],[]);
  expect(parity.decisionAgreementPct).toBe(100);expect(parity.targetMet).toBe(true);
});

test('point-in-time quality gate denies unknown or future-dated backtest buys before queueing',async()=>{
 const source=new FixtureCandleSource([{symbol:'BTC/EUR',intervalMinutes:15,candles:[bar(0)]}]);
 const provider:DecisionProvider={decide:async()=>({marketView:'fixture',
  actions:[{type:'buy',pair:'BTC/EUR',amountEur:100,stopLossPct:.05,
   confidence:1,reasoning:'fixture entry'}]})};
 const quality=(asOf:number,status:'unknown'|'allowed')=>({
  check:async()=>({symbol:'BTCEUR',asOf,status,reasons:['fixture'],
   sources:[{name:'synthetic',fetchedAt:asOf,official:true}]})
 });
 const base={source,strategy:'rules' as const,fromMs:0,toMs:900000,
  intervalMinutes:15 as const,provider};
 const unknown=await runBacktest({...base,coinQuality:quality(900000,'unknown')});
 expect(unknown.trades).toHaveLength(0);
 expect(unknown.rejections.join(' ')).toContain('Coin quality unknown');
 const future=await runBacktest({...base,coinQuality:quality(900001,'allowed')});
 expect(future.trades).toHaveLength(0);
 expect(future.rejections.join(' ')).toContain('future-dated');
});
