import {expect,test} from 'vitest';
import {
 pairedBlockComparison,consecutiveDailyReturns,PAIRED_COMPARISON_VERSION,
 type ObservedDailyReturn
} from '../src/backtest/paired-comparison.js';
import {reportHtml,type BacktestReport} from '../src/backtest/report.js';

const FROM=Date.UTC(2022,0,3),DAY=86_400_000;
const day=(i:number)=>new Date(FROM+i*DAY).toISOString().slice(0,10);
const rows=(n:number,fn:(i:number)=>number):ObservedDailyReturn[]=>
 Array.from({length:n},(_,i)=>({day:day(i),netReturn:fn(i)}));

test('identical paired return histories yield an exact zero difference band',()=>{
 const path=rows(40,i=>i%4===0?-.08:i%3===0?.03:.005);
 const out=pairedBlockComparison(path,path,{seed:42,paths:200,blockLength:7});
 expect(out.status).toBe('available');
 expect(out.pairedDays).toBe(40);
 expect(out.unmatchedDays).toBe(0);
 expect(out.observedExcess).toBe(0);
 expect(out.differenceBand).toEqual({p10:0,p50:0,p90:0});
 expect(out.probabilityPositive).toBe(0);
 expect(out.sharedInputHash).toMatch(/^[a-f0-9]{64}$/);
 expect(out).toEqual(pairedBlockComparison(path,path,{seed:42,paths:200,blockLength:7}));
});
test('paired bootstrap keeps same market shock index and retains positive/negative comparison direction',()=>{
 const reference=rows(30,i=>i%5===0?-.03:.005);
 const better=reference.map(d=>({...d,netReturn:d.netReturn+.01}));
 const worse=reference.map(d=>({...d,netReturn:d.netReturn-.01}));
 const positive=pairedBlockComparison(better,reference,{seed:7,paths:200,blockLength:5});
 const negative=pairedBlockComparison(worse,reference,{seed:7,paths:200,blockLength:5});
 expect(positive.status).toBe('available');
 expect(positive.observedExcess!).toBeGreaterThan(0);
 expect(positive.differenceBand!.p10).toBeGreaterThan(0);
 expect(positive.probabilityPositive).toBe(1);
 expect(negative.observedExcess!).toBeLessThan(0);
 expect(negative.differenceBand!.p90).toBeLessThan(0);
 expect(negative.probabilityPositive).toBe(0);
});
test('a missing benchmark date is never forward-filled; counts and gaps stay observable',()=>{
 const a=rows(30,i=>i%2===0?.01:-.008);
 const b=a.filter(x=>x.day!==day(12)).map(x=>({...x,netReturn:x.netReturn-.002}));
 const out=pairedBlockComparison(a,b,{paths:100,blockLength:3});
 expect(out.status).toBe('available');
 expect(out.pairedDays).toBe(29);
 expect(out.unmatchedDays).toBe(1);
 expect(out.missingStrategyDays).toBe(0);
 expect(out.missingBenchmarkDays).toBe(1);
 expect(out.gapsBetweenPairedDays).toBe(1);
 expect(out.firstPairedDay).toBe(day(0));
 expect(out.lastPairedDay).toBe(day(29));
 expect(out.reason).toContain('nicht aufgefüllt');
});
test('nonoverlapping or too-short histories return n/a rather than confidence claims',()=>{
 const short=pairedBlockComparison(rows(6,()=>.01),rows(6,()=>.005));
 expect(short.status).toBe('unavailable');
 expect(short.differenceBand).toBeNull();
 expect(short.probabilityPositive).toBeNull();
 const nonOverlap=pairedBlockComparison(rows(20,()=>.01),
  Array.from({length:20},(_,i)=>({day:day(20+i),netReturn:.002})));
 expect(nonOverlap.pairedDays).toBe(0);
 expect(nonOverlap.unmatchedDays).toBe(40);
 expect(nonOverlap.observedExcess).toBeNull();
 const future=pairedBlockComparison([{day:'2025-01-01',netReturn:.01}],rows(21,()=>.01));
 expect(future.status).toBe('unavailable');
 expect(future.sharedInputHash).toBeNull();
 const duplicate=pairedBlockComparison([rows(21,()=>.01)[0]!,rows(21,()=>.01)[0]!],rows(21,()=>.01));
 expect(duplicate.status).toBe('unavailable');
});
test('daily equity conversions require contiguous observed UTC days, no synthetic gap return',()=>{
 const input=[
  {ts:FROM+DAY-1,equity:100},
  {ts:FROM+3*DAY-1,equity:1000},
  {ts:FROM+4*DAY-1,equity:900},
  {ts:FROM+5*DAY-1,equity:810}
 ];
 const result=consecutiveDailyReturns(input);
 expect(result.map(x=>x.day)).toEqual([day(3),day(4)]);
 expect(result[0]!.netReturn).toBeCloseTo(-.1,12);
 expect(result[1]!.netReturn).toBeCloseTo(-.1,12);
 expect(result.every(x=>x.netReturn<0)).toBe(true);
});
test('report shows paired uncertainty, shared fingerprint and explicit unmatched days without changing stage gates',()=>{
 const compared=pairedBlockComparison(rows(30,()=>.02),rows(30,()=>.005),{paths:100});
 const report={
  runId:'a'.repeat(16),backtest:{
   configuration:{strategy:'rules',fromMs:FROM,toMs:FROM+30*DAY,fillModel:'conservative-ohlc',
    spreadBps:10,slippageBps:8,feeRate:.001},
   metrics:{},coverage:null,equity:[],daily:[],limitations:[],
   historicalTradability:{unknownMarketDays:null,totalMarketDays:null,restrictedMarketDays:null,
    evidencedTradableMarketDays:null,unknownTrades:0,totalTrades:0,restrictedTrades:0,
    evidencedTradableTrades:0,evidenceSources:[]},
   fingerprints:{data:'b'.repeat(64),configuration:'c'.repeat(64),codeBuild:null}
  },benchmarks:[],bootstrap:null,stress:[],robustness:'insufficient_evidence',
  parity:{},pairedComparison:compared
 } as unknown as BacktestReport;
 const html=reportHtml(report);
 expect(html).toContain(PAIRED_COMPARISON_VERSION);
 expect(html).toContain(compared.sharedInputHash!);
 expect(html).toContain('Gepaarter Block-Bootstrap');
 expect(html).toContain('Ohne Vergleich');
 expect(html).toContain('P10');
 expect(html).toContain('n/a – keine Entwicklungs-Fold-Diagnose');
 expect(JSON.stringify(report)).toContain('pairedComparison');
});
