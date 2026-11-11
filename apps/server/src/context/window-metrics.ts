import type {Candle} from '@paper/shared';
export const CONTEXT_STEP_MS=900000;
const endAt=(now:number)=>Math.floor(now/CONTEXT_STEP_MS)*CONTEXT_STEP_MS;
export function metricWindows(now:number){
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid context observation time');const end=endAt(now);
 return {timezone:'UTC',last24h:{fromInclusive:end-86400000,toExclusive:end,expectedCandles:96,expectedReturns:96},correlation48h:{closeFromInclusive:end-172800000,closeToInclusive:end,expectedReturns:192}};
}
/** Inputs are validated, aligned, closed candles for exactly one pair. Missing edges stay missing. */
export function windowMetrics(bars:Candle[],btc:Candle[],now:number){
 const windows=metricWindows(now),end=windows.last24h.toExclusive,from=windows.last24h.fromInclusive;
 const recent=bars.filter(c=>c.ts>=from&&c.ts<end),complete=recent.length===96&&recent.every((c,i)=>c.ts===from+i*CONTEXT_STEP_MS);
 const byTime=new Map(bars.map(c=>[c.ts,c])),btcByTime=new Map(btc.map(c=>[c.ts,c]));
 const returns:number[]=[];for(let ts=from;ts<end;ts+=CONTEXT_STEP_MS){const c=byTime.get(ts),p=byTime.get(ts-CONTEXT_STEP_MS);if(c&&p)returns.push(Math.log(c.close)-Math.log(p.close));}
 const mean=returns.reduce((sum,x)=>sum+x,0)/Math.max(1,returns.length),volatility=returns.length===96?Math.sqrt(returns.reduce((sum,x)=>sum+(x-mean)**2,0)/95)*100:null;
 const volume=recent.reduce((sum,c)=>sum+c.volume,0),weighted=recent.reduce((sum,c)=>sum+(c.high/3+c.low/3+c.close/3)*c.volume,0),vwap=weighted/volume;
 const x:number[]=[],y:number[]=[];for(let ts=end-172800000;ts<end;ts+=CONTEXT_STEP_MS){const a=byTime.get(ts),ap=byTime.get(ts-CONTEXT_STEP_MS),b=btcByTime.get(ts),bp=btcByTime.get(ts-CONTEXT_STEP_MS);if(a&&ap&&b&&bp){x.push(Math.log(a.close)-Math.log(ap.close));y.push(Math.log(b.close)-Math.log(bp.close));}}
 const mx=x.reduce((sum,v)=>sum+v,0)/Math.max(1,x.length),my=y.reduce((sum,v)=>sum+v,0)/Math.max(1,y.length),cov=x.reduce((sum,v,i)=>sum+(v-mx)*(y[i]!-my),0),sx=x.reduce((sum,v)=>sum+(v-mx)**2,0),sy=y.reduce((sum,v)=>sum+(v-my)**2,0),rho=sx*sy>0?cov/Math.sqrt(sx*sy):NaN;
 return {last24hBars:recent.length,last24hComplete:complete,realizedVolatility15mPct:volatility,realizedVolatilitySamples:returns.length,barApproxVwapLast24h:complete&&volume>0&&Number.isFinite(volume)&&Number.isFinite(vwap)?vwap:null,supportLast24h:complete?Math.min(...recent.map(c=>c.low)):null,resistanceLast24h:complete?Math.max(...recent.map(c=>c.high)):null,correlationBTC48h:{value:x.length===192&&Number.isFinite(rho)?Math.max(-1,Math.min(1,rho)):null,samples:x.length,complete:x.length===192}};
}
