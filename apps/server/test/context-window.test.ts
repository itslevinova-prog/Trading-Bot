import {expect,test} from 'vitest';
import type {Candle,OrderBook} from '@paper/shared';
import {aggregate,marketContext} from '../src/context/market-context.js';
import {feature} from '../src/market/indicators.js';
import {paperMarketContext} from '../src/context/paper-market-context.js';
const step=900000,start=Date.UTC(2026,0,1),now=start+300*step;
const rows:Candle[]=Array.from({length:300},(_,i)=>({pair:'BTC/EUR',interval:15,ts:start+i*step,open:100+i,high:102+i,low:99+i,close:101+i,volume:10}));
const make=(data:Candle[],at=now,pair='BTC/EUR',book?:OrderBook)=>marketContext([{pair,candles:data,hourly:[],book}],'binance','EUR',at);
test('calendar windows have UTC bounds and all return anchors rather than a last-N label',()=>{const result=make(rows,now+step/2),m=result.markets[0]!;expect(result.version).toBe(2);expect(result.metricWindows.last24h).toEqual({fromInclusive:now-86400000,toExclusive:now,expectedCandles:96,expectedReturns:96});expect(m.quality.last24hBars).toBe(96);expect(m.quality.last24hComplete).toBe(true);expect(m.regime.realizedVolatilitySamples).toBe(96);expect(m.regime.realizedVolatility15mPct).toBeGreaterThan(0);expect(m.regime.correlationBTC48h).toMatchObject({samples:192,complete:true});expect(m.regime.correlationBTC48h.value).toBeCloseTo(1,12);});
test('a recent gap is never backfilled by an older candle to invent 24h levels or VWAP',()=>{const missing=rows.filter((_,i)=>i!==250),m=make(missing).markets[0]!;expect(m.quality.last24hBars).toBe(95);expect(m.quality.last24hComplete).toBe(false);expect(m.regime.supportLast24h).toBeNull();expect(m.regime.resistanceLast24h).toBeNull();expect(m.regime.barApproxVwapLast24h).toBeNull();expect(m.regime.realizedVolatility15mPct).toBeNull();expect(m.regime.realizedVolatilitySamples).toBe(94);expect(m.regime.correlationBTC48h.value).toBeNull();});
test('a long trailing gap produces no current-window metric even with abundant older history',()=>{const m=make(rows,now+3*86400000).markets[0]!;expect(m.quality.last24hBars).toBe(0);expect(m.quality.stale).toBe(true);expect(m.regime.correlationBTC48h).toEqual({value:null,samples:0,complete:false});expect(m.regime.supportLast24h).toBeNull();expect(m.regime.realizedVolatilitySamples).toBe(0);});
test('old extremes and zero-width anchors do not enter the exact 24h support/resistance window',()=>{const modified=rows.map((c,i)=>i===203?{...c,high:1e9,low:1}:c),m=make(modified).markets[0]!;expect(m.regime.supportLast24h).toBe(303);expect(m.regime.resistanceLast24h).toBe(401);const expected=rows.slice(-96).reduce((sum,c)=>sum+(c.high+c.low+c.close)/3,0)/96;expect(m.regime.barApproxVwapLast24h).toBeCloseTo(expected,10);});
test('missing pre-window close keeps levels known but leaves 24h return volatility unknown',()=>{const m=make(rows.filter((_,i)=>i!==203)).markets[0]!;expect(m.quality.last24hComplete).toBe(true);expect(m.regime.supportLast24h).not.toBeNull();expect(m.regime.realizedVolatilitySamples).toBe(95);expect(m.regime.realizedVolatility15mPct).toBeNull();});
test('missing BTC anchors invalidate only the matching 48h correlation window',()=>{const other=rows.map(c=>({...c,pair:'ETH/EUR',close:c.close*1.001,high:c.high*1.002})),result=marketContext([{pair:'BTC/EUR',candles:rows.filter((_,i)=>i!==150),hourly:[]},{pair:'ETH/EUR',candles:other,hourly:[]}],'binance','EUR',now),m=result.markets[1]!;expect(m.quality.last24hComplete).toBe(true);expect(m.regime.realizedVolatilitySamples).toBe(96);expect(m.regime.correlationBTC48h).toEqual({value:null,samples:190,complete:false});});
test('flat complete prices have real zero volatility and undefined rather than zero correlation',()=>{const flat=rows.map(c=>({...c,open:100,high:100,low:100,close:100})),m=make(flat).markets[0]!;expect(m.regime.realizedVolatility15mPct).toBe(0);expect(m.regime.correlationBTC48h).toEqual({value:null,samples:192,complete:true});});
test('zero volume has no observed volume weighted price',()=>{const m=make(rows.map(c=>({...c,volume:0}))).markets[0]!;expect(m.quality.last24hComplete).toBe(true);expect(m.regime.barApproxVwapLast24h).toBeNull();expect(m.regime.supportLast24h).toBe(303);});
test('overflowing accumulated volume produces null instead of Infinity or synthetic VWAP',()=>{const m=make(rows.map(c=>({...c,volume:Number.MAX_VALUE}))).markets[0]!;expect(m.regime.barApproxVwapLast24h).toBeNull();expect(m.quality.last24hComplete).toBe(true);});
test('current and future extremes cannot alter closed-period metrics',()=>{const base=make(rows),extra=rows.at(-1)!;const withFuture=make([...rows,{...extra,ts:now,high:1e15},{...extra,ts:now+step,high:1e16}],now+step-1);expect(withFuture.markets[0]!.regime).toEqual(base.markets[0]!.regime);expect(withFuture.markets[0]!.quality.closedBars).toBe(300);});
test('off-grid, wrong-pair and impossible input rows cannot replace a valid context candle',()=>{const base=make(rows),sample=rows[250]!,result=make([...rows,{...sample,ts:sample.ts+1,high:1e15},{...sample,pair:'ETH/EUR',high:1e15},{...sample,close:-1}]);expect(result.markets[0]!.regime).toEqual(base.markets[0]!.regime);expect(result.markets[0]!.quality.closedBars).toBe(300);});
test('an absent BTC reference stays unknown rather than a fabricated neutral correlation',()=>{const result=make(rows.map(c=>({...c,pair:'ETH/EUR'})),now,'ETH/EUR');expect(result.markets[0]!.regime.correlationBTC48h).toEqual({value:null,samples:0,complete:false});});
test('future and foreign books are never usable context merely because age is less than five seconds',()=>{const book:OrderBook={symbol:'BTC/EUR',valid:true,receivedAt:now+1,bids:[{price:'100',qty:'1'}],asks:[{price:'101',qty:'1'}]};expect(make(rows,now,'BTC/EUR',book).markets[0]!.quality.bookUsable).toBe(false);expect(make(rows,now,'BTC/EUR',{...book,receivedAt:now-1000,symbol:'ETH/EUR'}).markets[0]!.quality.bookUsable).toBe(false);expect(make(rows,now,'BTC/EUR',{...book,receivedAt:now-1000}).markets[0]!.quality.bookUsable).toBe(true);});
test('invalid observation clocks refuse rather than create NaN window metadata',()=>{expect(()=>make(rows,NaN)).toThrow('observation time');expect(()=>make(rows,Infinity)).toThrow('observation time');});

function breadthInput(candles:Candle[]){
 const pair=candles[0]!.pair;
 const hourly=aggregate(candles,60,now);
 const snapshot=feature(pair,candles,hourly,{bid:100,ask:100},now);
 expect(snapshot).toBeDefined();
 return {pair,candles,hourly,feature:snapshot!};
}

test('breadth uses aligned closed returns and a true median, independent of cached feature returns',()=>{
 const rising=breadthInput(rows);
 const falling=breadthInput(rows.map((c,i)=>({...c,pair:'ETH/EUR',open:500-i,high:502-i,low:498-i,close:500-i})));
 rising.feature.change24h=-99;
 falling.feature.change24h=99;
 const result=paperMarketContext([rising,falling],'binance','EUR',now+step-1).breadth;
 const up=(400/304-1)*100,down=(201/297-1)*100;
 expect(result).toMatchObject({closedAt:now,tracked:2,ready:2,hourlyTrendKnown:2,aboveHourlyTrend:1,return24hKnown:2,positive24h:1,complete:true});
 expect(result.medianChange24h).toBeCloseTo((up+down)/2,12);
});

test('a missing return anchor and stale feature cannot count as bullish breadth',()=>{
 const input=breadthInput(rows);
 input.feature.ts-=step;
 input.candles=rows.filter((_,i)=>i!==203);
 const baseline=marketContext([input],'binance','EUR',now).breadth;
 expect(baseline).toMatchObject({ready:1,aboveHourlyTrend:1,positive24h:1});
 const result=paperMarketContext([input],'binance','EUR',now).breadth;
 expect(result).toMatchObject({tracked:1,ready:0,hourlyTrendKnown:0,aboveHourlyTrend:0,return24hKnown:0,positive24h:0,medianChange24h:null,complete:false});
});

test('duplicate pair rows and other quotes cannot amplify the market summary',()=>{
 const input=breadthInput(rows);
 const foreign=breadthInput(rows.map(c=>({...c,pair:'BTC/USD'})));
 const result=paperMarketContext([input,input,foreign],'binance','EUR',now).breadth;
 expect(result).toMatchObject({tracked:3,ready:0,hourlyTrendKnown:0,return24hKnown:0,medianChange24h:null,complete:false});
});
