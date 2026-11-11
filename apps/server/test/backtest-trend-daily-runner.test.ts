import {expect,test} from 'vitest';
import {buildClosedTrendV1Context} from '../src/backtest/trend-daily-context.js';
import {planTrendVolTargetV1,TrendVolTargetV1Provider} from '../src/strategy/trend-vol-target-v1.js';
import {runBacktest} from '../src/backtest/runner.js';
import {FixtureCandleSource,type Candle} from '../src/backtest/candle-source.js';
import type {MarketConstraints,SimulatedPosition} from '../src/backtest/simulated-broker.js';

const DAY=86_400_000,AS_OF=Date.UTC(2022,10,15);
const candles=(base:number):Candle[]=>Array.from({length:240},(_,i)=>{
 const ts=AS_OF-(240-i)*DAY;
 const close=base+0.25*i+Math.sin(i/7)*2;
 return {ts,open:close-.4,high:close+1,low:close-1,close,volume:1000};
});
const constraints=(symbol:string):MarketConstraints=>({
 symbol,ordermin:.0001,costmin:1,lotDecimals:6
});
const markets=()=>[
 {pair:'BTCUSDT',daily:candles(180),constraints:constraints('BTCUSDT'),quality:'allowed' as const},
 {pair:'ETHUSDT',daily:candles(85),constraints:constraints('ETHUSDT'),quality:'allowed' as const}
];
const context=(extra:Partial<Parameters<typeof buildClosedTrendV1Context>[0]>={})=>
 buildClosedTrendV1Context({asOf:AS_OF,quote:'USDT',equity:10_000,cash:10_000,
  markets:markets(),positions:[],feeRate:.001,spreadBps:10,slippageBps:8,...extra});
test('daily trend adapter gives provider only fully closed candles, regardless of future input',async()=>{
 const reference=context();
 const future:Candle={ts:AS_OF,open:999,high:1000,low:998,close:999,volume:100};
 const withFuture=context({markets:markets().map(m=>({...m,daily:[...m.daily,future]}))});
 expect(withFuture.markets).toEqual(reference.markets);
 expect(withFuture.markets.every(m=>m.daily.every(c=>c.ts+DAY<=AS_OF))).toBe(true);
 expect(reference.markets[0]?.assumedRoundtripBps).toBe(46);
 expect(planTrendVolTargetV1(withFuture)).toEqual(planTrendVolTargetV1(reference));
 const planned=planTrendVolTargetV1(reference);
 // The fixed cost gate may reject entries; this is still a genuine causal plan.
 expect(planned.status).toBe('ready');
 expect(planned.actions.length).toBeGreaterThan(0);
 const provider=new TrendVolTargetV1Provider();
 const result=await provider.decide({
  timeUTC:new Date(AS_OF).toISOString(),
  execution:{trendV1:reference}
 } as unknown as Parameters<TrendVolTargetV1Provider['decide']>[0]);
 expect(result.marketView).toContain('trend-vol-target-v1');
});
test('missing historical lot filters can never turn into a permitted synthetic buy',()=>{
 const withoutLots=context({markets:markets().map(m=>({...m,constraints:null}))});
 expect(withoutLots.markets.every(m=>m.lot.minQty===0)).toBe(true);
 const planned=planTrendVolTargetV1(withoutLots);
 expect(planned.actions.every(a=>a.type!=='buy')).toBe(true);
});
test('trailing watermark derives only from observed completed daily closes since real entry',()=>{
 const source=markets();
 const entry=source[0]!.daily[220]!.ts;
 const position:SimulatedPosition={
  symbol:'BTCUSDT',qty:1,basis:100,entryPrice:100,openedAt:entry,
  stop:95,target:null
 };
 const got=context({markets:source,positions:[position],cash:9000});
 const observed=source[0]!.daily.filter(c=>c.ts+DAY>=entry&&c.ts+DAY<=AS_OF);
 expect(got.positions[0]?.highestCloseSinceEntry).toBe(Math.max(...observed.map(c=>c.close)));
 expect(got.positions[0]?.qty).toBe(1);
});
test('non-UTC midnights, invalid costs and development spill are denied before data access',async()=>{
 expect(()=>context({asOf:AS_OF+60_000})).toThrow(/fully closed UTC/);
 expect(()=>context({feeRate:-1})).toThrow(/nonnegative/);
 const source=new FixtureCandleSource([]);
 await expect(runBacktest({
  source,strategy:'trend-vol-target',fromMs:Date.UTC(2024,0,1),
  toMs:Date.UTC(2024,0,3),intervalMinutes:1440
 })).rejects.toThrow(/Trend v1 requires sealed daily development/);
 await expect(runBacktest({
  source,strategy:'trend-vol-target',fromMs:Date.UTC(2022,0,1),
  toMs:Date.UTC(2022,0,3),intervalMinutes:240
 })).rejects.toThrow(/Trend v1 requires sealed daily development/);
});
