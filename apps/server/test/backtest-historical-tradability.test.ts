import {expect,test} from 'vitest';
import {FixtureCandleSource,type Candle} from '../src/backtest/candle-source.js';
import {runBacktest,type BacktestOptions} from '../src/backtest/runner.js';
import {reportHtml} from '../src/backtest/report.js';
import {historicalTradabilityAt,summarizeHistoricalTradability,
 type HistoricalTradabilityObservation} from '../src/coin-quality/archive-contract.js';
import {comparePaper} from '../src/backtest/parity.js';
const DAY=86_400_000,HOUR=3_600_000,STEP=15*60_000,FROM=Date.UTC(2022,0,11),TO=FROM+2*DAY;
const observed=(status:'tradable'|'restricted',effectiveAt:number,observedAt:number,official=true):HistoricalTradabilityObservation=>({
 symbol:'BTC/EUR',status,effectiveAt,observedAt,
 source:{name:'exchange-event-fixture',fetchedAt:observedAt,official}
});
test('late monitoring restriction is unknown before publication, never backdated',()=>{
 const later=observed('restricted',FROM,FROM+DAY);
 expect(historicalTradabilityAt('BTC/EUR',FROM+HOUR,[later])).toEqual({
  status:'unknown',knownAt:null,source:null,effectiveAt:null
 });
 expect(historicalTradabilityAt('BTC/EUR',FROM+DAY+HOUR,[later])).toEqual({
  status:'evidenced-restricted',knownAt:FROM+DAY,source:'exchange-event-fixture',effectiveAt:FROM
 });
 expect(historicalTradabilityAt('BTC/EUR',FROM+DAY+HOUR,[observed('tradable',FROM,FROM+2*DAY)]).status)
  .toBe('unknown');
});
test('unofficial, absent and stale data are unknown, not historical approval',()=>{
 expect(historicalTradabilityAt('BTC/EUR',FROM+HOUR,[]).status).toBe('unknown');
 expect(historicalTradabilityAt('BTC/EUR',FROM+HOUR,[observed('tradable',FROM,FROM,false)]).status).toBe('unknown');
 expect(historicalTradabilityAt('BTC/EUR',FROM+2*DAY,[observed('tradable',FROM,FROM)]).status).toBe('unknown');
});
test('unknown market-days and trades are counted separately from evidenced violations',()=>{
 const result=summarizeHistoricalTradability({
  fromMs:FROM,toMs:FROM+3*DAY,
  universeHistory:[0,1,2,3].map(i=>({dateMs:FROM+i*DAY,symbols:['BTC/EUR']})),
  trades:[0,1,2].map(i=>({ts:FROM+i*DAY+HOUR,symbol:'BTC/EUR'})),
  observations:[observed('tradable',FROM,FROM),observed('restricted',FROM,FROM+2*DAY)]
 });
 expect(result.totalMarketDays).toBe(3);
 expect(result.unknownMarketDays).toBe(1);
 expect(result.evidencedTradableMarketDays).toBe(1);
 expect(result.restrictedMarketDays).toBe(1);
 expect(result.totalTrades).toBe(3);
 expect(result.unknownTrades).toBe(1);
 expect(result.restrictedTrades).toBe(1);
 expect(result.evidencedTradableTrades).toBe(1);
 expect(result.evidenceSources[0]?.fetchedAt).toBe(FROM);
});
test('static comparison runs do not falsely claim market-day coverage',()=>{
 const result=summarizeHistoricalTradability({
  fromMs:FROM,toMs:TO,universeHistory:[],
  trades:[{ts:FROM,symbol:'BTC/EUR'}]
 });
 expect(result.membershipMode).toBe('static-unverified');
 expect(result.unknownMarketDays).toBeNull();
 expect(result.unknownTrades).toBe(1);
});
function fixture():FixtureCandleSource{
 const candle=(ts:number):Candle=>({ts,open:100,high:102,low:99,close:101,volume:10});
 const intervals=[15,60] as const;
 return new FixtureCandleSource(intervals.map(minutes=>({
  symbol:'BTC/EUR',intervalMinutes:minutes,candles:Array.from(
   {length:(TO-FROM)/(minutes*60_000)},(_,i)=>candle(FROM+i*minutes*60_000))
 })));
}
test('report-only historical labels never alter trade decisions or use future tags',async()=>{
 const options:BacktestOptions={
  source:fixture(),strategy:'hold',fromMs:FROM,toMs:TO,intervalMinutes:15,
  quoteCurrency:'EUR',initialCash:1000,universeAt:()=>['BTC/EUR']
 };
 const baseline=await runBacktest(options);
 const annotated=await runBacktest({...options,historicalTradabilityEvidence:[
  observed('restricted',FROM,FROM),observed('restricted',FROM,TO+DAY)
 ]});
 expect(annotated.trades).toEqual(baseline.trades);
 expect(annotated.decisions).toEqual(baseline.decisions);
 expect(annotated.metrics).toEqual(baseline.metrics);
 expect(annotated.historicalTradability.restrictedMarketDays).toBe(1);
 expect(annotated.historicalTradability.unknownMarketDays).toBe(1);
 expect(annotated.historicalTradability.evidenceSources).toHaveLength(1);
 expect(annotated.fingerprints.data).not.toBe(baseline.fingerprints.data);
 const html=reportHtml({
  runId:annotated.fingerprints.combined.slice(0,16),backtest:annotated,
  benchmarks:[],bootstrap:null,stress:[],robustness:'insufficient_evidence',
  parity:comparePaper(annotated,[],[])
 });
 expect(html).toContain('Unbekannte Markt-Tage');
 expect(html).toContain('Unbekannte Trades');
 expect(html).toContain('exchange-event-fixture');
 expect(html).toContain('2022-01-11');
 expect(html).not.toContain('2022-01-14');
});
