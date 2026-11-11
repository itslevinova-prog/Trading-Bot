import {expect,test} from 'vitest';
import {FixtureCandleSource,type Candle,type CandleSource} from '../src/backtest/candle-source.js';
import type {DecisionProvider} from '@paper/shared';
import type {BacktestOptions} from '../src/backtest/runner.js';
import {planDevelopmentWalkForward,runDevelopmentWalkForward,WALK_FORWARD_VERSION,
 type WalkForwardSchedule} from '../src/backtest/walk-forward.js';
import {reportHtml,type BacktestReport} from '../src/backtest/report.js';
import type {OutcomeLabel} from '../src/backtest/splits.js';

const DAY=86_400_000,HOUR=3_600_000,FROM=Date.UTC(2022,0,3),TO=FROM+7*DAY;
const schedule:WalkForwardSchedule={trainDays:2,testDays:2,stepDays:2,embargoDays:1};
const labels:OutcomeLabel[]=Array.from({length:7},(_,i)=>({
 id:'day-'+i,labelStartMs:FROM+i*DAY,labelEndMs:FROM+(i+1)*DAY
}));
function closePrice(ts:number){
 const d=(ts-FROM)/DAY;
 return d<3?100:d<5?100+(d-3)*10:120-(d-5)*20;
}
function fixture(dropLastDay=false):FixtureCandleSource{
 const candle=(ts:number):Candle=>{
  const price=closePrice(ts);
  return {ts,open:price,close:price,low:price*.995,high:price*1.005,volume:100};
 };
 const n=dropLastDay?6:7;
 return new FixtureCandleSource([
  {symbol:'BTC/EUR',intervalMinutes:15,
   candles:Array.from({length:n*96},(_,i)=>candle(FROM+i*15*60_000))},
  {symbol:'BTC/EUR',intervalMinutes:60,
   candles:Array.from({length:n*24},(_,i)=>candle(FROM+i*HOUR))}
 ]);
}
const provider:DecisionProvider={decide:async ctx=>({
 marketView:'Frozen offline buy fixture',
 actions:ctx.positions.length?[{type:'hold',confidence:1,reasoning:'position held'}]:
  [{type:'buy',pair:'BTC/EUR',amountEur:200,stopLossPct:.05,
   confidence:1,reasoning:'fixed non-tuned entry'}]
})};
function options(source:CandleSource=fixture()):BacktestOptions{
 return {source,strategy:'rules',provider,fromMs:FROM,toMs:TO,
  intervalMinutes:60,quoteCurrency:'EUR',initialCash:1000,
  feeRate:.001,spreadBps:10,slippageBps:8,seed:7,
  constraints:new Map([['BTC/EUR',{symbol:'BTC/EUR',ordermin:.0001,costmin:10,lotDecimals:8}]])
 };
}
test('frozen rolling windows are disjoint and training ends before embargo and evaluation',()=>{
 const p=planDevelopmentWalkForward(FROM,TO,labels,schedule);
 expect(p.version).toBe(WALK_FORWARD_VERSION);
 expect(p.folds).toHaveLength(2);
 expect(p.folds.map(f=>[f.trainFromMs,f.trainToMs,f.testFromMs,f.testToMs])).toEqual([
  [FROM,FROM+2*DAY,FROM+3*DAY,FROM+5*DAY],
  [FROM+2*DAY,FROM+4*DAY,FROM+5*DAY,FROM+7*DAY]
 ]);
 expect(p.folds[0]!.testToMs).toBe(p.folds[1]!.testFromMs);
 expect(p.folds[0]!.trainLabelIds).toEqual(['day-0','day-1']);
 expect(p.folds[0]!.testLabelIds).toEqual(['day-3','day-4']);
 expect(p.folds[1]!.trainLabelIds).toEqual(['day-2','day-3']);
 expect(p.folds[1]!.testLabelIds).toEqual(['day-5','day-6']);
 expect(p.purge.folds[0]!.embargoIndices.length).toBeGreaterThan(0);
 expect(p.splitFingerprint).toMatch(/^[a-f0-9]{64}$/);
 expect(p).toEqual(planDevelopmentWalkForward(FROM,TO,labels,schedule));
});
test('purged overlapping outcomes are excluded from the train labels and never read as test truth',()=>{
 const crossing:OutcomeLabel={id:'cross',labelStartMs:FROM+2*DAY,
  labelEndMs:FROM+4*DAY};
 const p=planDevelopmentWalkForward(FROM,TO,[...labels,crossing],schedule);
 expect(p.folds[0]!.trainLabelIds).not.toContain('cross');
 expect(p.purge.folds[0]!.purgedIndices.map(i=>p.purge.orderedLabelIds[i])).toContain('cross');
 // The same outcome is eligible for the later fold only after it has closed before embargo.
 expect(p.folds[1]!.trainLabelIds).toContain('cross');
});
test('only the development UTC period is accepted, before any CandleSource access',async()=>{
 let accessed=0;
 const blocked:CandleSource={
  listSymbols:async()=>{accessed++;return ['BTC/EUR'];},
  getCandles:async()=>{accessed++;return [];}
 };
 await expect(runDevelopmentWalkForward({options:{...options(blocked),
  fromMs:Date.UTC(2025,0,1),toMs:Date.UTC(2025,1,1)},labels,providerId:'frozen-v1',schedule}))
  .rejects.toThrow(/2020-2023/);
 expect(accessed).toBe(0);
 expect(()=>planDevelopmentWalkForward(FROM,TO,labels,{...schedule,stepDays:1}))
  .toThrow(/precommitted/);
 expect(()=>planDevelopmentWalkForward(FROM,Date.UTC(2024,0,2),labels,schedule))
  .toThrow(/2020-2023/);
});
test('one unchanging provider/configuration exposes strong and weak folds without optimising them',async()=>{
 const result=await runDevelopmentWalkForward({
  options:options(),labels,schedule,providerId:'frozen-rules-v1'
 });
 expect(result.version).toBe(WALK_FORWARD_VERSION);
 expect(result.status).toBe('complete');
 expect(result.folds).toHaveLength(2);
 expect(result.folds.every(f=>f.status==='available')).toBe(true);
 expect(result.folds.every(f=>f.frozenConfigurationHash===result.frozenConfigurationHash)).toBe(true);
 expect(result.folds.every(f=>f.inputHash?.match(/^[a-f0-9]{64}$/))).toBe(true);
 expect(result.folds[0]!.candidateNetReturn!).toBeGreaterThan(0);
 expect(result.folds[1]!.candidateNetReturn!).toBeLessThan(0);
 expect(result.folds.every(f=>f.netExcess===f.candidateNetReturn!-f.btcNetReturn!)).toBe(true);
 expect(result.folds.every(f=>f.costs!.total>0&&f.candidateTrades!>0)).toBe(true);
 expect(result.folds.every(f=>f.coverage?.status==='not_verified')).toBe(true);
 expect(result.note).toContain('keine Gate-Lockerung');
 expect(result).toEqual(await runDevelopmentWalkForward({
  options:options(),labels,schedule,providerId:'frozen-rules-v1'
 }));
});
test('a single missing later fold becomes n/a and does not hide earlier fold results',async()=>{
 const r=await runDevelopmentWalkForward({
  options:options(fixture(true)),labels,schedule,providerId:'frozen-rules-v1'
 });
 expect(r.status).toBe('insufficient_evidence');
 expect(r.folds).toHaveLength(2);
 expect(r.folds[0]?.status).toBe('available');
 expect(r.folds[1]?.status).toBe('unavailable');
 expect(r.folds[1]?.netExcess).toBeNull();
});
test('HTML report retains fold boundaries, hashes, coverage and explicitly negative outcomes',async()=>{
 const result=await runDevelopmentWalkForward({
  options:options(),labels,schedule,providerId:'frozen-rules-v1'
 });
 const stub={
  runId:'a'.repeat(16),backtest:{
   configuration:{strategy:'rules',fromMs:FROM,toMs:TO,fillModel:'conservative-ohlc',
    spreadBps:10,slippageBps:8,feeRate:.001},
   metrics:{},coverage:null,equity:[],daily:[],limitations:[],
   historicalTradability:{unknownMarketDays:null,totalMarketDays:null,restrictedMarketDays:null,
    evidencedTradableMarketDays:null,unknownTrades:0,totalTrades:0,restrictedTrades:0,
    evidencedTradableTrades:0,evidenceSources:[]},
   fingerprints:{data:'b'.repeat(64),configuration:'c'.repeat(64),codeBuild:null}
  },benchmarks:[],bootstrap:null,stress:[],robustness:'insufficient_evidence',
  parity:{},walkForward:result
 } as unknown as BacktestReport;
 const html=reportHtml(stub);
 expect(html).toContain(WALK_FORWARD_VERSION);
 expect(html).toContain(result.splitFingerprint);
 expect(html).toContain(result.frozenConfigurationHash);
 expect(html).toContain('Netto-Überschuss');
 expect(html).toContain('Coverage');
 expect(html).toContain('frozen-rules-v1');
 expect(JSON.stringify(stub)).toContain('"walkForward"');
});
