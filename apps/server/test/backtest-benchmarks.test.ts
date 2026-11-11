import {expect,test} from 'vitest';
import {FixtureCandleSource,type Candle} from '../src/backtest/candle-source.js';
import {simulateHistoricalTop10,type HistoricalTop10Options} from '../src/backtest/historical-top10.js';
import {benchmarks,reportHtml,type BacktestReport} from '../src/backtest/report.js';
import type {MarketConstraints} from '../src/backtest/simulated-broker.js';

const DAY=86_400_000;
const JAN=Date.UTC(2022,0,1);
const FEB=Date.UTC(2022,1,1);
const FROM=FEB-DAY,TO=FEB+DAY;
function candle(ts:number,open:number,close:number):Candle {
 return {ts,open,close,high:Math.max(open,close),low:Math.min(open,close),volume:100,quoteVolume:1000};
}
function source(dropOldFeb=false,dropNewFeb=false):FixtureCandleSource {
 return new FixtureCandleSource([
  {symbol:'OLDUSDT',intervalMinutes:1440,candles:[
   candle(FROM,10,12),...(dropOldFeb?[]:[candle(FEB,12,12)])]},
  {symbol:'NEWUSDT',intervalMinutes:1440,candles:[
   candle(FROM,20,20),...(dropNewFeb?[]:[candle(FEB,20,22)])]}
 ]);
}
const constraints=new Map<string,MarketConstraints>([
 ['OLDUSDT',{symbol:'OLDUSDT',ordermin:0,costmin:1,lotDecimals:0}],
 ['NEWUSDT',{symbol:'NEWUSDT',ordermin:0,costmin:1,lotDecimals:0}]
]);
const universe=(monthMs:number)=>monthMs===JAN?['OLDUSDT']:monthMs===FEB?['NEWUSDT']:[];
const options=(s=source()):HistoricalTop10Options=>({
 source:s,fromMs:FROM,toMs:TO,universeAt:universe,
 fillModel:'conservative-ohlc',initialCash:100,feeRate:.01,spreadBps:0,
 slippageBps:0,minOrderEur:1,constraints
});
test('causal month membership and exact hand-calculated selling/buying fees',async()=>{
 const result=await simulateHistoricalTop10(options());
 expect(result.universeHistory).toEqual([
  {monthMs:JAN,symbols:['OLDUSDT']},{monthMs:FEB,symbols:['NEWUSDT']}
 ]);
 expect(result.trades.map(t=>[t.symbol,t.side,t.qty,t.ts])).toEqual([
  ['OLDUSDT','buy',9,FROM],['OLDUSDT','sell',9,FEB],['NEWUSDT','buy',5,FEB]
 ]);
 // January: 100-9*10*1.01=9.10 cash; 9*12+9.10=117.10.
 // February: sell 9*12 net 106.92; cash 116.02; buy 5*20*1.01=101.
 // End: 15.02 cash + 5*22=125.02. No free close-to-close fills.
 expect(result.equity).toHaveLength(2);
 expect(result.equity[0]?.equity).toBeCloseTo(117.1,10);
 expect(result.equity[1]?.equity).toBeCloseTo(125.02,10);
 expect(result.netReturn).toBeCloseTo(.2502,10);
 expect(result.feesPaid).toBeCloseTo(2.98,10);
 expect(result.coverageDays).toBe(2);
 expect(result.fingerprints.universe).toMatch(/^[a-f0-9]{64}$/);
 expect(result.fingerprints.costs).toMatch(/^[a-f0-9]{64}$/);
 expect(result.fingerprints.data).toMatch(/^[a-f0-9]{64}$/);
});
test('later listed market is never bought during the previous month despite existing test candles',async()=>{
 const result=await simulateHistoricalTop10(options());
 expect(result.trades.filter(x=>x.symbol==='NEWUSDT').map(x=>x.ts)).toEqual([FEB]);
 expect(result.universeHistory[0]?.symbols).not.toContain('NEWUSDT');
});
test('missing historic liquidation bar or new market entry fails closed with n/a',async()=>{
 const missingSell=await simulateHistoricalTop10(options(source(true,false)));
 expect(missingSell.netReturn).toBeNull();
 expect(missingSell.note).toContain('Missing daily candle');
 expect(missingSell.trades).toEqual([]);
 const missingBuy=await simulateHistoricalTop10(options(source(false,true)));
 expect(missingBuy.netReturn).toBeNull();
 expect(missingBuy.equity).toEqual([]);
});
test('unknown monthly membership is n/a, never a present-day survivor union',async()=>{
 const o=options();
 o.universeAt=month=>month===JAN?['OLDUSDT']:[];
 const result=await simulateHistoricalTop10(o);
 expect(result.netReturn).toBeNull();
 expect(result.note).toContain('membership');
 expect(result.fingerprints.universe).toMatch(/^[a-f0-9]{64}$/);
});
test('minimum executable order and lot rules prevent invented fills',async()=>{
 const blocked=await simulateHistoricalTop10({...options(),minOrderEur:100});
 expect(blocked.netReturn).toBeNull();
 expect(blocked.note).toContain('minimum');
 const impossible=await simulateHistoricalTop10({...options(),constraints:new Map([
  ['OLDUSDT',{symbol:'OLDUSDT',ordermin:100,costmin:1,lotDecimals:0}],
  ['NEWUSDT',{symbol:'NEWUSDT',ordermin:100,costmin:1,lotDecimals:0}]
 ])});
 expect(impossible.netReturn).toBeNull();
});
test('adverse fill costs do not improve the same deterministic benchmark',async()=>{
 const base=await simulateHistoricalTop10(options());
 const stressed=await simulateHistoricalTop10({...options(),spreadBps:20,slippageBps:10});
 expect(stressed.netReturn).not.toBeNull();
 expect(stressed.netReturn!).toBeLessThan(base.netReturn!);
 expect(stressed.fingerprints.costs).not.toBe(base.fingerprints.costs);
});
test('development split is checked before any universe or candle source access',async()=>{
 let calls=0;
 const o:HistoricalTop10Options={...options(),fromMs:Date.UTC(2025,0,1),
  toMs:Date.UTC(2025,0,3),universeAt:()=>{calls++;return ['OLDUSDT'];}};
 await expect(simulateHistoricalTop10(o)).rejects.toThrow(/2020-2023/);
 expect(calls).toBe(0);
 const maker=await simulateHistoricalTop10({...options(),fillModel:'maker-queue'});
 expect(maker.netReturn).toBeNull();
 expect(maker.note).toContain('Maker');
});
test('backtest report JSON object and HTML retain PIT monthly weights and source hashes',async()=>{
 const s=source();
 const found=await benchmarks(s,15,FROM,TO,['OLDUSDT','NEWUSDT'],'USDT',true,{
  universeAt:universe,fillModel:'conservative-ohlc',initialCash:100,feeRate:.01,
  spreadBps:0,slippageBps:0,minOrderEur:1,constraints
 });
 const pit=found.find(x=>x.name.includes('historical Top 10'));
 expect(pit?.netReturn).toBeCloseTo(.2502,10);
 expect(pit?.trades).toHaveLength(3);
 expect(JSON.stringify(found)).toContain(pit!.fingerprints!.universe);
 const doc={
  runId:'a'.repeat(16),
  backtest:{
   configuration:{strategy:'rules',fromMs:FROM,toMs:TO,fillModel:'conservative-ohlc',
    spreadBps:0,slippageBps:0,feeRate:.01},
   metrics:{},coverage:null,
   historicalTradability:{unknownMarketDays:null,totalMarketDays:null,
    restrictedMarketDays:null,evidencedTradableMarketDays:null,
    unknownTrades:0,totalTrades:0,restrictedTrades:0,evidencedTradableTrades:0,
    evidenceSources:[]},
   equity:[],daily:[],limitations:[],
   fingerprints:{data:'b'.repeat(64),configuration:'c'.repeat(64),codeBuild:null}
  },benchmarks:found,bootstrap:null,stress:[],robustness:'insufficient_evidence',parity:{}
 } as unknown as BacktestReport;
 const html=reportHtml(doc);
 expect(html).toContain(pit!.fingerprints!.universe);
 expect(html).toContain(pit!.fingerprints!.costs);
 expect(html).toContain('Trades: 3');
});
