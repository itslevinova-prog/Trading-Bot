import {afterEach,expect,test} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FixtureCandleSource,type Candle,type IntervalMinutes} from '../src/backtest/candle-source.js';
import {runBacktest,ResearchCoverageBlocked,type BacktestOptions} from '../src/backtest/runner.js';
import {assessResearchCoverage} from '../src/archive/report.js';
import {reportHtml,writeCoverageFailureReport} from '../src/backtest/report.js';
import {benchmarks} from '../src/backtest/report.js';
import {stationaryBootstrap} from '../src/backtest/bootstrap.js';
import {comparePaper} from '../src/backtest/parity.js';

const DAY=86_400_000,HOUR=3_600_000,STEP=15*60_000;
const FROM=Date.UTC(2022,0,11),TO=FROM+2*DAY,BEGIN=FROM-5*DAY;
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

function candles(minutes:IntervalMinutes,absent:readonly number[]=[]):Candle[]{
 const step=minutes*60_000,holes=new Set(absent),result:Candle[]=[];
 for(let ts=BEGIN;ts<TO;ts+=step)if(!holes.has(ts))
  result.push({ts,open:100,high:102,low:99,close:101,volume:100,quoteVolume:10100});
 return result;
}
function source(missing15:readonly number[]=[],missingHour:readonly number[]=[],extra=false):FixtureCandleSource{
 const entries=[
  {symbol:'BTC/EUR',intervalMinutes:15 as const,candles:candles(15,missing15)},
  {symbol:'BTC/EUR',intervalMinutes:60 as const,candles:candles(60,missingHour)}
 ];
 if(extra)entries.push(
  {symbol:'ETH/EUR',intervalMinutes:15 as const,candles:candles(15,[FROM+DAY+STEP])},
  {symbol:'ETH/EUR',intervalMinutes:60 as const,candles:candles(60)}
 );
 return new FixtureCandleSource(entries);
}
function opts(src:FixtureCandleSource,strict=true,extra=false):BacktestOptions{
 return {
  source:src,strategy:'hold',fromMs:FROM,toMs:TO,intervalMinutes:15,
  initialCash:1000,feeRate:.001,seed:17,quoteCurrency:'EUR',
  universeAt:date=>extra&&date>=FROM+DAY?['BTC/EUR','ETH/EUR']:['BTC/EUR'],
  enforceResearchCoverage:strict
 };
}
test('complete offline history passes without changing fills, decisions or performance',async()=>{
 const src=source(),strict=await runBacktest(opts(src));
 const legacy=await runBacktest(opts(src,false));
 expect(strict.coverage?.status).toBe('passed');
 expect(strict.coverage?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
 expect(strict.coverage?.rows).toEqual(expect.arrayContaining([
  expect.objectContaining({symbol:'BTC/EUR',intervalMin:15,month:'2022-01',missing:0,
   warmupExpected:100,warmupObserved:100})
 ]));
 expect(strict.trades).toEqual(legacy.trades);
 expect(strict.decisions).toEqual(legacy.decisions);
 expect(strict.metrics).toEqual(legacy.metrics);
 const rendered=reportHtml({
  runId:strict.fingerprints.combined.slice(0,16),backtest:strict,
  benchmarks:await benchmarks(src,15,FROM,TO,['BTC/EUR'],'EUR'),
  bootstrap:stationaryBootstrap([0,0],17),stress:[],robustness:'insufficient_evidence',
  parity:comparePaper(strict,[],[])
 });
 expect(rendered).toContain(strict.coverage!.fingerprint);
 expect(rendered).toContain('Historische Datenabdeckung');
});
test('one isolated intramonth 15-minute gap blocks and records immutable-fingerprint evidence',async()=>{
 const root=mkdtempSync(join(tmpdir(),'research-coverage-'));roots.push(root);
 let blocked:ResearchCoverageBlocked|null=null;
 try{await runBacktest(opts(source([FROM+5*STEP])));}
 catch(error){if(error instanceof ResearchCoverageBlocked)blocked=error;else throw error;}
 expect(blocked).not.toBeNull();
 const report=blocked!.coverage;
 expect(report.status).toBe('blocked');
 expect(report.rows.find(r=>r.intervalMin===15)?.missingOpens).toContain(FROM+5*STEP);
 const path=writeCoverageFailureReport(root,report);
 const saved=JSON.parse(readFileSync(path,'utf8')) as {status:string;coverageFingerprint:string;coverage:{status:string}};
 expect(saved.status).toBe('blocked');
 expect(saved.coverage.status).toBe('blocked');
 expect(saved.coverageFingerprint).toBe(report.fingerprint);
 const repaired=await runBacktest(opts(source()));
 expect(repaired.coverage?.fingerprint).not.toBe(report.fingerprint);
});
test('missing warm-up hour blocks even though the trading month has no gaps',async()=>{
 await expect(runBacktest(opts(source([],[FROM-HOUR])))).rejects.toBeInstanceOf(ResearchCoverageBlocked);
 try{await runBacktest(opts(source([],[FROM-HOUR])));}
 catch(error){
  if(!(error instanceof ResearchCoverageBlocked))throw error;
  const hour=error.coverage.rows.find(r=>r.intervalMin===60);
  expect(hour?.missing).toBe(0);
  expect(hour?.warmupObserved).toBe(99);
  expect(hour?.firstTradableCloseMs).toBeNull();
 }
});
test('newly eligible historical symbol cannot conceal its missing bar',async()=>{
 try{await runBacktest(opts(source([],[],true),true,true));}
 catch(error){
  if(!(error instanceof ResearchCoverageBlocked))throw error;
  expect(error.coverage.rows.find(row=>row.symbol==='ETH/EUR'&&row.intervalMin===15)?.missing).toBe(1);
  return;
 }
 throw Error('Historical coverage gap did not block');
});
test('matrix refuses missing historical dates, empty evidence and development access beyond 2023',()=>{
 const date=FROM;
 expect(()=>assessResearchCoverage({fromMs:date,toMs:date+DAY,
  universeHistory:[{dateMs:date,symbols:['BTC/EUR']}],series:[]})).toThrow(/Incomplete historical membership/);
 const report=assessResearchCoverage({fromMs:date,toMs:date+DAY,
  universeHistory:[{dateMs:date,symbols:[]},{dateMs:date+DAY,symbols:[]}],series:[]});
 expect(report.status).toBe('blocked');
 expect(report.reason).toMatch(/No eligible/);
 expect(()=>assessResearchCoverage({fromMs:Date.UTC(2023,11,31),toMs:Date.UTC(2024,0,2),
  universeHistory:[],series:[]})).toThrow(/before 2024/);
});
