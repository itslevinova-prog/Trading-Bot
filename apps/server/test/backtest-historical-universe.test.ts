import {afterEach,beforeEach,test,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DecisionProvider} from '@paper/shared';
import {ArchiveCandleSource} from '../src/archive/candle-source.js';
import {ArchiveUniverse} from '../src/archive/universe.js';
import {openArchive,DAY,type ArchiveDb} from '../src/archive/store.js';
import {listObjects} from '../src/archive/download.js';
import {runBacktest,type BacktestResult} from '../src/backtest/runner.js';
import {assertHistoricalUniverse} from '../src/backtest/lookahead.js';
import {robustnessLight,type StressResult} from '../src/backtest/stress.js';

const MIN=60000,STEP=15*MIN,HOUR=60*MIN;
let folder:string,db:ArchiveDb;
beforeEach(()=>{folder=mkdtempSync(join(tmpdir(),'pit-universe-'));db=openArchive(join(folder,'archive.db'));});
afterEach(()=>{db.close();rmSync(folder,{recursive:true,force:true});});

const start=Date.UTC(2022,5,1);
function insertSymbol(symbol:string,base:string,first:number,last:number):void {
 db.prepare('INSERT INTO symbols(symbol,base,quote,first_ts,last_ts) VALUES (?,?,?,?,?)')
  .run(symbol,base,'USDT',first,last);
}
function insertCandle(symbol:string,minutes:number,ts:number,volume=100):void {
 db.prepare('INSERT INTO candles(symbol,interval_min,ts,open,high,low,close,volume,quote_volume,trades) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run(symbol,minutes,ts,100,102,99,101,100,volume,1);
}
function seed():void {
 insertSymbol('OLDUSDT','OLD',start-30*DAY,start);
 insertSymbol('BTCUSDT','BTC',start-30*DAY,start+3*DAY-STEP);
 insertSymbol('NEWUSDT','NEW',start+2*DAY,start+3*DAY-STEP);
 for(let d=-30;d<=3;d++){
  const day=start+d*DAY;
  if(d<=0)insertCandle('OLDUSDT',1440,day,200);
  insertCandle('BTCUSDT',1440,day,100);
  if(d>=2)insertCandle('NEWUSDT',1440,day,99999);
 }
 for(let d=0;d<3;d++){
  const day=start+d*DAY;
  for(let q=0;q<96;q++){
   insertCandle('BTCUSDT',15,day+q*STEP);
   if(d===0)insertCandle('OLDUSDT',15,day+q*STEP);
  }
  for(let h=0;h<24;h++){
   insertCandle('BTCUSDT',60,day+h*HOUR);
   if(d===0)insertCandle('OLDUSDT',60,day+h*HOUR);
  }
 }
}
const hold:DecisionProvider={decide:async()=>({marketView:'fixture only',actions:[{type:'hold',confidence:1,reasoning:'fixture'}]})};
test('delisted coin remains in earlier rebalances, not in future ones; recent NEW coin is not backfilled',async()=>{
 seed();
 const source=new ArchiveCandleSource({databasePath:join(folder,'archive.db'),accessLogPath:join(folder,'holdout.log')});
 try {
  const historical=new ArchiveUniverse(db);
  const result=await runBacktest({source,strategy:'rules',provider:hold,fromMs:start,toMs:start+3*DAY,intervalMinutes:15,
   initialCash:1000,quoteCurrency:'USDT',venue:'binance',
   universeAt:date=>historical.universeAt(date,{quote:'USDT',topN:20}).map(s=>s.symbol)});
  const at=(date:number)=>result.universeHistory.find(x=>x.dateMs===date)?.symbols;
  expect(at(start)).toEqual(['BTCUSDT','OLDUSDT']);
  expect(at(start+DAY)).toContain('OLDUSDT');
  expect(at(start+2*DAY)).toEqual(['BTCUSDT']);
  expect(at(start+3*DAY)).toEqual(['BTCUSDT']);
  expect(result.universe).toEqual(['BTCUSDT','OLDUSDT']);
  expect(result.universe).not.toContain('NEWUSDT');
  expect(result.limitations.join(' ')).toContain('Missing delistings');
  // Mutation test of #41's survivor-only fixture against the actual runner membership.
  expect(()=>assertHistoricalUniverse(['BTCUSDT','NEWUSDT'],at(start)!))
   .toThrow(/Survivorship bias/);
 }finally{source.close();}
});
test('future-only member and missing archive symbol cannot be silently selected',async()=>{
 seed();
 const source=new ArchiveCandleSource({databasePath:join(folder,'archive.db')});
 try {
  await expect(runBacktest({source,strategy:'rules',provider:hold,fromMs:start,toMs:start+DAY,
   intervalMinutes:15,universeAt:()=>['DELISTED_UNAVAILABLE']}))
   .rejects.toThrow(/no archived candle source/);
 }finally{source.close();}
});
test('offline Binance public ZIP listing discovers delisted pairs without querying a live-symbol endpoint',async()=>{
 const xml='<ListBucketResult><Contents><Key>data/spot/monthly/klines/OLDUSDT/1d/OLDUSDT-1d-2022-05.zip</Key><Size>111</Size></Contents></ListBucketResult>';
 const fetcher=(async()=>({ok:true,text:async()=>xml})) as unknown as typeof fetch;
 const objects=await listObjects('monthly',['1d'],'2022-05','2022-05',fetcher,new Date('2026-11-06T00:00:00Z'));
 expect(objects.map(x=>x.symbol)).toEqual(['OLDUSDT']);
});

test('incomplete PBO or DSR is insufficient_evidence, never robust',async()=>{
 const result={
  metrics:{netReturn:.12,pbo:null,deflatedSharpeProbability:.99}
 } as unknown as BacktestResult;
 const stress:StressResult[]=[
  {name:'double-fees',netReturn:.03,trades:1,rejectedOrders:0},
  {name:'double-slippage',netReturn:.03,trades:1,rejectedOrders:0},
  {name:'one-bar-delay',netReturn:.03,trades:1,rejectedOrders:0},
  {name:'drop-5-percent-signals',netReturn:.03,trades:1,rejectedOrders:0}
 ];
 expect(robustnessLight(result,stress)).toBe('insufficient_evidence');
 result.metrics.pbo=.1;
 result.metrics.deflatedSharpeProbability=null;
 expect(robustnessLight(result,stress)).toBe('insufficient_evidence');
 result.metrics.deflatedSharpeProbability=.99;
 expect(robustnessLight(result,stress)).toBe('robust');
 result.metrics.pbo=.5;
 expect(robustnessLight(result,stress)).toBe('fragile');
});
