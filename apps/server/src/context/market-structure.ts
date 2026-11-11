import type {Candle} from '@paper/shared';
import {CONTEXT_STEP_MS,metricWindows} from './window-metrics.js';
export const STRUCTURE_VERSION='closed-structure-v1';
/** Own causal range/path calculation. The signal candle is excluded from its prior range.
 * Describes observed structure, never a calibrated forecast or independent sample. */
export function closedMarketStructure(bars:Candle[],pair:string,now:number){
 const end=metricWindows(now).last24h.toExclusive,from=end-21*CONTEXT_STEP_MS;
 const window=bars.filter(c=>c.pair===pair&&c.interval===15&&c.ts>=from&&c.ts<end).sort((a,b)=>a.ts-b.ts);
 const valid=window.length===21&&window.every((c,i)=>c.ts===from+i*CONTEXT_STEP_MS&&[c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low>0&&c.volume>=0&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close));
 const common={version:STRUCTURE_VERSION,signalClosedAt:end,priorCandles:20,observedCandles:window.length};
 if(!valid)return {...common,complete:false,reason:'missing-invalid-or-conflicting-closed-window',directionalEfficiency:null,priorSupport:null,priorResistance:null,upsideBreakout:null,downsideBreakout:null,upsideRejection:null,downsideRejection:null,twoSidedSweep:null};
 const signal=window.at(-1)!,prior=window.slice(0,-1),support=Math.min(...prior.map(c=>c.low)),resistance=Math.max(...prior.map(c=>c.high));
 // Scaling keeps finite positive extreme prices from overflowing the path sum.
 const scale=Math.max(...window.map(c=>c.close)),closes=window.map(c=>c.close/scale);
 const path=closes.slice(1).reduce((s,c,i)=>s+Math.abs(c-closes[i]!),0),net=Math.abs(closes.at(-1)!-closes[0]!);
 const efficiency=path===0?0:Math.max(0,Math.min(1,net/path));
 return {...common,complete:true,reason:null,directionalEfficiency:efficiency,priorSupport:support,priorResistance:resistance,
 upsideBreakout:signal.close>resistance,downsideBreakout:signal.close<support,
 upsideRejection:signal.high>resistance&&signal.close<=resistance,
 downsideRejection:signal.low<support&&signal.close>=support,
 twoSidedSweep:signal.high>resistance&&signal.low<support};
}
