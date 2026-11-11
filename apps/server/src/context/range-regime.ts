import {createHash} from 'node:crypto';
import type {Candle} from '@paper/shared';
import {atr} from '../market/indicators.js';
import {closedMarketStructure} from './market-structure.js';
import {CONTEXT_STEP_MS} from './window-metrics.js';
export const RANGE_REGIME_VERSION='closed-range-regime-v1';
/** Fixed research definitions, not fitted thresholds or a stationarity/forecast test.
 * Four alternating boundary transitions require two observed traversals in each direction.
 * Only the preceding 20 CLOSED candles define the range; the signal cannot move it. */
export function closedRangeRegime(bars:Candle[],pair:string,now:number){
 const structure=closedMarketStructure(bars,pair,now),end=structure.signalClosedAt;
 const unknown={version:RANGE_REGIME_VERSION,complete:false,signalClosedAt:end,regime:'unknown',strategyFamily:'no-trade',priorEfficiency:null as number|null,priorAtr:null as number|null,boundaryTransitions:0,priorSupport:null as number|null,priorResistance:null as number|null,lowerZone:null as number|null,upperZone:null as number|null,signalClose:null as number|null,sourceHash:null as string|null,reasons:['missing-invalid-or-conflicting-closed-window']};
 if(!structure.complete)return unknown;
 const rows=bars.filter(c=>c.pair===pair&&c.interval===15&&c.ts>=end-21*CONTEXT_STEP_MS&&c.ts<end).sort((a,b)=>a.ts-b.ts),prior=rows.slice(0,-1),signal=rows.at(-1)!,previous=prior.at(-1)!;
 const support=structure.priorSupport!,resistance=structure.priorResistance!,width=resistance-support,lower=support+width/4,upper=resistance-width/4,scale=Math.max(...prior.map(c=>c.close)),closes=prior.map(c=>c.close/scale);
 const path=closes.slice(1).reduce((sum,c,i)=>sum+Math.abs(c-closes[i]!),0),net=closes.at(-1)!-closes[0]!,efficiency=path===0?0:Math.min(1,Math.abs(net)/path);
 let lastSide=0,transitions=0;
 for(const c of prior){const side=c.close<=lower?-1:c.close>=upper?1:0;if(side&&side!==lastSide){if(lastSide)transitions++;lastSide=side;}}
 // Close-based visits deliberately ignore isolated wick touches and adjacent candles in one zone.
 const balanced=width>0&&efficiency<=.2&&transitions>=4;
 let regime=balanced?'repeated-range':efficiency>.2?(net>0?'directional-up':'directional-down'):'unconfirmed-or-flat';
 let strategyFamily='no-trade';const reasons:string[]=[];
 if(structure.twoSidedSweep)reasons.push('signal-swept-both-boundaries');
 else if(structure.downsideBreakout)reasons.push('closed-below-prior-support');
 else if(structure.upsideBreakout){strategyFamily='breakout-research';reasons.push('closed-above-prior-resistance');}
 else if(balanced){
  if(signal.low<support&&signal.close>support&&signal.close<=lower&&signal.close>signal.open&&signal.close>previous.close){strategyFamily='range-reversion-research';reasons.push('repeated-prior-traversals-and-closed-lower-boundary-reclaim');}
  else reasons.push('range-without-confirmed-lower-boundary-reclaim');
 }else if(regime==='directional-up'&&signal.close>previous.close&&!structure.upsideRejection){strategyFamily='trend-continuation-research';reasons.push('observed-upward-path-not-a-forecast');}
 else reasons.push(regime==='directional-down'?'downward-path-is-not-a-long-reversion-setup':'insufficient-repeated-range-evidence');
 const priorAtr=atr(prior);
 if(!Number.isFinite(priorAtr)||priorAtr<=0){strategyFamily='no-trade';reasons.push('prior-volatility-unknown-or-zero');}
 return {...unknown,complete:true,regime,strategyFamily,priorEfficiency:efficiency,priorAtr:Number.isFinite(priorAtr)&&priorAtr>0?priorAtr:null,boundaryTransitions:transitions,priorSupport:support,priorResistance:resistance,lowerZone:lower,upperZone:upper,signalClose:signal.close,sourceHash:createHash('sha256').update(JSON.stringify({version:RANGE_REGIME_VERSION,pair,signalClosedAt:end,rows:rows.map(c=>[c.ts,c.open,c.high,c.low,c.close,c.volume])})).digest('hex'),reasons};
}
