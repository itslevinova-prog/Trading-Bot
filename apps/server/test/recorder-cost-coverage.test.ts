import {expect,test} from 'vitest';
import {assessRecorderCostCoverage,COST_COVERAGE_MINIMUM,
 summarizeRecorderCosts} from '../src/recorder/cost-hurdle.js';
import {buildCostReport} from '../src/recorder/cost-report.js';
import type {BookSnapshot} from '../src/recorder/types.js';

const FROM=Date.UTC(2022,5,1),DAY=86_400_000,HOUR=3_600_000,MIN=60_000;
const snapshot=(symbol:string,ts:number):BookSnapshot=>({
 symbol,ts,bid:100,ask:100.1,bidQty:20,askQty:20,spreadBps:10,
 depthBid10bps:300,depthAsk10bps:300,depthBid25bps:400,depthAsk25bps:400
});
const sufficient=(symbol:string):BookSnapshot[]=>Array.from({length:14},(_,d)=>d)
 .flatMap(day=>[0,1,2,3].flatMap(block=>[0,1,2].map(minute=>
  snapshot(symbol,FROM+day*DAY+block*6*HOUR+minute*MIN))));
test('dense minute-sized burst does not establish days or time blocks',()=>{
 const symbol='BTC/USDT';
 const packed=Array.from({length:5000},(_,i)=>snapshot(symbol,FROM+i*10));
 const result=summarizeRecorderCosts(symbol,packed);
 expect(result.snapshotCount).toBe(5000);
 expect(result.spreadBps.median).toBe(10);
 expect(result.coverage.status).toBe('insufficient');
 expect(result.coverage.qualifyingUtcDays).toBe(0);
 expect(result.coverage.qualifyingDayBlocks).toBe(0);
 expect(result.coverage.observationSpanDays).toBe(1);
 expect(result.complete).toBe(false);
 expect(result.measuredMinimumEdgeBps).toBeNull();
});
test('versioned coverage counts independent UTC days, four clock blocks and different minutes',()=>{
 const rows=sufficient('BTC/USDT'),result=assessRecorderCostCoverage(rows);
 expect(result.requirementsVersion).toBe('recorder-cost-coverage-v1');
 expect(result.status).toBe('sufficient');
 expect(result.observedUtcDays).toBe(14);
 expect(result.qualifyingUtcDays).toBe(14);
 expect(result.observedSixHourBlocks).toBe(4);
 expect(result.qualifyingDayBlocks).toBe(56);
 expect(result.observationSpanDays).toBe(14);
 expect(result.observedFromMs).toBe(FROM);
 expect(result.observedToMs).toBe(FROM+13*DAY+18*HOUR+2*MIN);
 expect(COST_COVERAGE_MINIMUM.minDistinctMinutesPerDayBlock).toBe(3);
});
test('same-day burst repeated 14 days remains insufficient without distinct minute bins',()=>{
 const symbol='BTC/USDT';
 const rows=Array.from({length:14},(_,day)=>[0,1,2,3].flatMap(block=>
  Array.from({length:100},(_,index)=>
   snapshot(symbol,FROM+day*DAY+block*6*HOUR+(index%30)*500))));
 const checked=assessRecorderCostCoverage(rows.flat());
 expect(checked.observedUtcDays).toBe(14);
 expect(checked.observedSixHourBlocks).toBe(4);
 expect(checked.qualifyingDayBlocks).toBe(0);
 expect(checked.status).toBe('insufficient');
});
test('multiple dates in a single UTC time block do not satisfy independent session coverage',()=>{
 const rows=Array.from({length:20},(_,day)=>[0,1,2].map(minute=>
  snapshot('BTC/EUR',FROM+day*DAY+minute*MIN))).flat();
 const result=assessRecorderCostCoverage(rows);
 expect(result.qualifyingUtcDays).toBe(20);
 expect(result.qualifyingDayBlocks).toBe(20);
 expect(result.observedSixHourBlocks).toBe(1);
 expect(result.status).toBe('insufficient');
});
test('20 independently covered markets in two quotes pass distribution, not executable fills',()=>{
 const symbols=Array.from({length:10},(_,i)=>'COIN'+i)
  .flatMap(base=>[base+'/EUR',base+'/USDT']);
 const report=buildCostReport('2022-06',
  symbols.map(symbol=>summarizeRecorderCosts(symbol,sufficient(symbol))));
 expect(report.observedMarkets).toBe(20);
 expect(report.observedQuotes).toEqual(['EUR','USDT']);
 expect(report.meetsCoverageMinimum).toBe(true);
 expect(report.coverageStatus).toBe('sufficient');
 expect(report.insufficientMarkets).toEqual([]);
 expect(report.observedFromMs).toBe(FROM);
 expect(report.observedToMs).toBeGreaterThan(FROM+13*DAY);
 expect(report.executableCostEvidenceComplete).toBe(false);
 expect(report.markets.every(x=>x.measuredMinimumEdgeBps===null&&
  x.slippage50===null&&x.complete===false)).toBe(true);
});
test('one under-covered market blocks the entire otherwise diversified cost report',()=>{
 const symbols=Array.from({length:10},(_,i)=>'COIN'+i)
  .flatMap(base=>[base+'/EUR',base+'/USDT']);
 const markets=symbols.map(symbol=>summarizeRecorderCosts(symbol,sufficient(symbol)));
 markets[0]=summarizeRecorderCosts(markets[0]!.symbol,
  [snapshot(markets[0]!.symbol,FROM)]);
 const report=buildCostReport('2022-06',markets);
 expect(report.coverageStatus).toBe('insufficient');
 expect(report.insufficientMarkets).toContain(markets[0]!.symbol);
 expect(report.meetsCoverageMinimum).toBe(false);
 expect(report.limitations.join(' ')).toContain('COST_COVERAGE_INSUFFICIENT');
});
test('sample timestamp outside reported month cannot be laundered as a sufficient observation window',()=>{
 const symbols=Array.from({length:10},(_,i)=>'COIN'+i)
  .flatMap(base=>[base+'/EUR',base+'/USDT']);
 const markets=symbols.map(symbol=>summarizeRecorderCosts(symbol,sufficient(symbol)));
 const wrong=buildCostReport('2023-06',markets);
 expect(wrong.insufficientMarkets).toHaveLength(20);
 expect(wrong.coverageStatus).toBe('insufficient');
});
test('missing, malformed and duplicated observations never create false sufficient data',()=>{
 expect(assessRecorderCostCoverage([])).toMatchObject({
  status:'insufficient',observedFromMs:null,observedToMs:null,observedUtcDays:0
 });
 expect(()=>assessRecorderCostCoverage([{ts:-1}])).toThrow(/timestamp/);
 const symbol='BTC/USDT',rows=sufficient(symbol),duplicate=[...rows,...rows];
 const a=assessRecorderCostCoverage(rows),b=assessRecorderCostCoverage(duplicate);
 expect(a).toEqual(b);
});
