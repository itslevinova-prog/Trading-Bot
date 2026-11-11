import {test,expect} from 'vitest';
import {FixtureCandleSource} from '../src/backtest/candle-source.js';
import {moneyWeightedIrr,simulateDca,type DcaSettings} from '../src/dca/simulator.js';
const DAY=86_400_000,anchor=Date.UTC(2020,0,1);
const start=anchor+250*DAY,end=anchor+330*DAY;
function fixture(change?:{day:number;close:number}) {
 const series=['BTCUSDT','ETHUSDT'].map(symbol=>({
  symbol,intervalMinutes:1440 as const,candles:Array.from({length:350},(_,i)=>({
   ts:anchor+i*DAY,open:100,high:Math.max(100,change?.day===i?change.close:100),
   low:Math.min(100,change?.day===i?change.close:100),
   close:change?.day===i?change.close:100,volume:10,quoteVolume:1000
  }))
 }));
 return new FixtureCandleSource(series);
}
const settings:DcaSettings={fromMs:start,toMs:end,amount:100,interval:'monthly',variant:'classic',
 allocation:{BTCUSDT:0.7,ETHUSDT:0.3},feeRate:0,spreadBps:0,slippageBps:0,minNotional:0};

test('classic DCA deposits are not confused with profits; fees and minimums included',async()=>{
 const result=await simulateDca(fixture(),settings);
 expect(result.deposits.length).toBeGreaterThanOrEqual(2);
 expect(result.contributed).toBe(result.deposits.length*100);
 expect(result.tradeCount).toBe(result.deposits.length*2);
 expect(result.netWorth).toBeCloseTo(result.contributed,5);
 expect(result.twr).toBeCloseTo(0,8);
 expect(result.irr).toBeCloseTo(0,6);
 expect(result.totalFees).toBe(0);
 const costed=await simulateDca(fixture(),{...settings,feeRate:.001,spreadBps:10,slippageBps:5});
 expect(costed.twr).toBeLessThan(0);
 expect(costed.netWorth).toBeLessThan(costed.contributed);
 expect(costed.totalFees).toBeGreaterThan(0);
});

test('trend decisions at the open only know the 200 previous completed daily bars',async()=>{
 const base=await simulateDca(fixture(),{...settings,variant:'trend-double'});
 const modified=await simulateDca(fixture({day:250,close:200}),{...settings,variant:'trend-double'});
 expect(base.trades.filter(t=>t.ts===start)).toEqual(modified.trades.filter(t=>t.ts===start));
 expect(base.daily[0]!.equity).not.toBe(modified.daily[0]!.equity);
 const parked=await simulateDca(fixture(),{...settings,variant:'trend-park'});
 expect(parked.trades.length).toBe(0);
 expect(parked.contributed).toBeGreaterThan(0);
 expect(parked.netWorth).toBeCloseTo(parked.contributed,4);
});

test('reject incomplete data and access beyond development split',async()=>{
 await expect(simulateDca(fixture(),{...settings,toMs:Date.UTC(2025,0,1)})).rejects.toThrow(/development-only/);
 const incomplete=new FixtureCandleSource([{symbol:'BTCUSDT',intervalMinutes:1440,candles:[]}]);
 await expect(simulateDca(incomplete,settings)).rejects.toThrow(/Missing completed 1d candle/);
});

test('money-weighted annual IRR is an actual cash-flow root',()=>{
 const result=moneyWeightedIrr([{ts:Date.UTC(2020,0,1),amount:100}],Date.UTC(2021,0,1),110);
 expect(result).not.toBeNull();
 expect(result!).toBeGreaterThan(.09);
 expect(result!).toBeLessThan(.11);
 expect(moneyWeightedIrr([],end,100)).toBeNull();
});
