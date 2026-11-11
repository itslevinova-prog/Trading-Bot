import {tickerAges} from '../market/ticker-state.js';
import {closedHourlyTrend} from './hourly-trend.js';
import {closedMarketStructure} from './market-structure.js';
import {longHorizonRows,longHorizonWindows} from './long-horizons.js';
import type {Candle,FeatureSnapshot,MarketTicker,OrderBook} from '@paper/shared';
import {windowMetrics,metricWindows} from './window-metrics.js';

export type ContextInput={pair:string;historyRepair?:unknown;candles:Candle[];hourly:Candle[];ticker?:MarketTicker;book?:OrderBook;feature?:FeatureSnapshot;coverage?:{closedBars:number;firstAt:number|null;lastAt:number|null}};
export function closedSeries(rows:Candle[],interval:number,now:number){
 return [...new Map(rows.filter(c=>c.interval===interval&&c.ts+interval*60000<=now&&[c.open,c.high,c.low,c.close,c.volume,c.ts].every(Number.isFinite)&&c.low>0&&c.volume>=0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)).map(c=>[c.ts,c])).values()].sort((a,b)=>a.ts-b.ts);
}
export function aggregate(rows:Candle[],minutes:number,now:number):Candle[]{
 const groups=new Map<number,Candle[]>();for(const c of closedSeries(rows,15,now)){const ts=Math.floor(c.ts/(minutes*60000))*minutes*60000;const g=groups.get(ts)??[];g.push(c);groups.set(ts,g);}
 return [...groups.entries()].flatMap(([ts,g])=>g.length===minutes/15&&g.every((c,i)=>c.ts===ts+i*900000)&&ts+minutes*60000<=now?[{pair:g[0]!.pair,interval:minutes,ts,open:g[0]!.open,high:Math.max(...g.map(c=>c.high)),low:Math.min(...g.map(c=>c.low)),close:g.at(-1)!.close,volume:g.reduce((s,c)=>s+c.volume,0)}]:[]);
}
const compact=(rows:Candle[])=>rows.map(c=>[c.ts,c.open,c.high,c.low,c.close,c.volume]);
const contextSeries=(rows:Candle[],interval:number,now:number,pair:string)=>closedSeries(rows.filter(c=>c.pair===pair&&Number.isSafeInteger(c.ts)&&c.ts>=0&&c.ts%(interval*60000)===0),interval,now);
export function marketContext(inputs:ContextInput[],venue:string,quote:string,now=Date.now()){
 const btcRaw=inputs.find(i=>i.pair===`BTC/${quote}`)?.candles??[];const windows=metricWindows(now),btc=contextSeries(inputs.find(i=>i.pair===`BTC/${quote}`)?.candles??[],15,now,`BTC/${quote}`);
 const markets=inputs.map(input=>{
  const bars=contextSeries(input.candles,15,now,input.pair),hour=contextSeries(input.hourly,60,now,input.pair),last=bars.at(-1),b=input.book,t=input.ticker;
  const metrics=windowMetrics(bars,btc,now),bookAgeMs=b&&Number.isFinite(b.receivedAt)?now-b.receivedAt:null;
  const bidDepth=b?.bids.reduce((s,l)=>s+Number(l.price)*Number(l.qty),0)??0,askDepth=b?.asks.reduce((s,l)=>s+Number(l.price)*Number(l.qty),0)??0;
  const total=input.coverage?.closedBars??bars.length,firstAt=input.coverage?.firstAt??bars[0]?.ts??null,lastAt=input.coverage?.lastAt??last?.ts??null;
  const expected=total>1&&firstAt!==null&&lastAt!==null?(lastAt-firstAt)/900000+1:total;
  return {pair:input.pair,historyRepair:input.historyRepair??null,source:`${venue}:spot`,asOf:now,ticker:t??null,feature:input.feature??null,
   quality:{closedBars:total,detailedBars:bars.length,firstAt,lastClosedAt:last?last.ts+900000:null,stale:!last||now-last.ts-900000>20*60000,tickerAgeMs:tickerAges(t,now).tickerAgeMs,bookAgeMs,bookUsable:!!b?.valid&&b.symbol===input.pair&&bookAgeMs!==null&&bookAgeMs>=0&&bookAgeMs<=5000,last24hBars:metrics.last24hBars,last24hComplete:metrics.last24hComplete,gapPct:expected?Math.max(0,(expected-total)/expected*100):100},
   microstructure:{bidDepthQuote:bidDepth,askDepthQuote:askDepth,imbalance:bidDepth+askDepth>0?(bidDepth-askDepth)/(bidDepth+askDepth):null,levels:b?Math.min(b.bids.length,b.asks.length):0,bids:b?.bids.slice(0,10)??[],asks:b?.asks.slice(0,10)??[],scope:'aggregated visible levels, no historical depth or queue position'},
   regime:{hourlyTrend:closedHourlyTrend(input.pair,input.hourly,input.feature,now),structure:closedMarketStructure(bars,input.pair,now),horizonRows:longHorizonRows(input.pair,quote,input.candles,btcRaw,now),trend:input.feature?(input.feature.price>input.feature.ema50_60m?'above_hourly_ema50':'below_hourly_ema50'):'unknown',realizedVolatility15mPct:metrics.realizedVolatility15mPct,realizedVolatilitySamples:metrics.realizedVolatilitySamples,barApproxVwapLast24h:metrics.barApproxVwapLast24h,supportLast24h:metrics.supportLast24h,resistanceLast24h:metrics.resistanceLast24h,correlationBTC48h:metrics.correlationBTC48h},
   candles:{columns:['openTimeUTCms','open','high','low','close','baseVolume'],m15:compact(bars.slice(-24)),h1:compact(hour.slice(-24)),h4:compact(aggregate(bars,240,now).slice(-18)),d1:compact(aggregate(bars,1440,now).slice(-14))}};
 });
 const features=inputs.flatMap(i=>i.feature?[i.feature]:[]);
 return {version:2,longHorizonWindows:longHorizonWindows(now),asOf:now,venue,quoteCurrency:quote,metricWindows:windows,metricDefinitions:'24h/48h windows end at the latest closed UTC 15m boundary. Missing candles/return edges are not replaced by older data; incomplete metrics stay null. Volatility/correlation use close-to-close log returns. barApproxVwapLast24h weights OHLC typical price by bar volume, not observed trade-level VWAP.',unitConvention:'Legacy fields amountEur/costEur/volume24hEur are amounts in quoteCurrency; no FX conversion.',breadth:{tracked:inputs.length,ready:features.length,aboveHourlyTrend:features.filter(f=>f.price>f.ema50_60m).length,positive24h:features.filter(f=>f.change24h>0).length,medianChange24h:features.length?[...features].sort((a,b)=>a.change24h-b.change24h)[Math.floor(features.length/2)]!.change24h:null},markets,missingSources:['No paid news, on-chain analytics, macro calendar or social sentiment is assumed. Missing values are unknown, never neutral signals.'],caveats:['Current active universe has survivorship bias.','Correlations are descriptive and unstable.','Model confidence is not a calibrated profit probability.','Visible depth can disappear. Stops cannot guarantee maximum loss.']};
}
