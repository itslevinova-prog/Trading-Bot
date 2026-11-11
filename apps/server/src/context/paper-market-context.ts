import {closedSeries,marketContext,type ContextInput} from './market-context.js';
import {CONTEXT_STEP_MS} from './window-metrics.js';

const HOUR_MS=3600000;

/** Paper breadth describes one closed clock and records coverage for each metric. */
export function paperMarketContext(inputs:ContextInput[],venue:string,quote:string,now=Date.now()){
 const context=marketContext(inputs,venue,quote,now);
 const {fromInclusive,toExclusive,expectedCandles}=context.metricWindows.last24h;
 const anchorAt=fromInclusive-CONTEXT_STEP_MS;
 const latestHourClose=Math.floor(toExclusive/HOUR_MS)*HOUR_MS;
 const pairCounts=new Map<string,number>();
 for(const {pair} of inputs)pairCounts.set(pair,(pairCounts.get(pair)??0)+1);

 let ready=0, hourlyTrendKnown=0, aboveHourlyTrend=0;
 const returns24h:number[]=[];
 for(const [i,input] of inputs.entries()){
  const {pair,feature}=input;
  const [base,quotedCurrency,...extra]=pair.split('/');
  if(!base||quotedCurrency!==quote||extra.length||pairCounts.get(pair)!==1)continue;

  const market=context.markets[i]!;
  const lastBar=market.candles.m15.at(-1);
  if(feature&&lastBar&&feature.pair===pair&&feature.ts===toExclusive-CONTEXT_STEP_MS&&
     lastBar[0]===feature.ts&&lastBar[4]===feature.price){
   ready++;
   const trend=market.regime.hourlyTrend;
   if(trend.complete&&trend.closedAt===latestHourClose&&trend.currentEma50!==undefined){
    hourlyTrendKnown++;
    if(feature.price>trend.currentEma50)aboveHourlyTrend++;
   }
  }

  // Validate the full window with its predecessor. Extra or duplicated rows
  // cannot replace a missing close or silently win by input order.
  const source=input.candles.filter(c=>c.pair===pair&&c.interval===15&&c.ts>=anchorAt&&c.ts<toExclusive);
  if(source.length!==expectedCandles+1)continue;
  const bars=closedSeries(source,15,now);
  if(bars.length!==source.length||!bars.every((c,j)=>c.ts===anchorAt+j*CONTEXT_STEP_MS))continue;
  const change=(bars.at(-1)!.close/bars[0]!.close-1)*100;
  if(Number.isFinite(change))returns24h.push(change);
 }
 returns24h.sort((a,b)=>a-b);
 const middle=Math.floor(returns24h.length/2);
 let medianChange24h:number|null=null;
 if(returns24h.length){
  medianChange24h=returns24h.length%2?returns24h[middle]!:returns24h[middle-1]!/2+returns24h[middle]!/2;
 }
 const tracked=inputs.length,return24hKnown=returns24h.length;
 return {...context,breadth:{
  version:'aligned-market-breadth-v1',
  closedAt:toExclusive,
  tracked,
  ready,
  hourlyTrendKnown,
  aboveHourlyTrend,
  return24hKnown,
  positive24h:returns24h.filter(change=>change>0).length,
  medianChange24h,
  complete:tracked>0&&ready===tracked&&hourlyTrendKnown===tracked&&return24hKnown===tracked,
 }};
}
