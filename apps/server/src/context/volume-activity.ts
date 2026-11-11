import type {Candle} from '@paper/shared';
export const VOLUME_ACTIVITY_VERSION='closed-volume-activity21-v1';
const STEP=900000,REFERENCE=20,COUNT=21;
/** Same-pair, same-unit closed-bar activity; not order flow, liquidity or a trade gate. */
export function closedVolumeActivity(pair:string,bars:readonly Candle[],asOf:number){
 const end=Math.floor(asOf/STEP)*STEP,from=end-COUNT*STEP;
 const common={version:VOLUME_ACTIVITY_VERSION,closedAt:Number.isSafeInteger(end)&&end>=0?end:null,sourceCandles:COUNT,referenceCandles:REFERENCE,scope:'Last closed15m volume divided by mean of PREVIOUS20closed15m volumes. Same-pair stable units required. No order-flow, depth, turnover, seasonality adjustment or probability inferred.'};
 const unknown=(reason:string,observedCandles=0)=>({...common,complete:false as const,ratioAvailable:false,reason,observedCandles,relativeVolume:null,currentZero:null,referencePositiveBars:null,referenceZeroBars:null});
 if(typeof pair!=='string'||!pair||!Number.isSafeInteger(asOf)||asOf<0||from<0||!Array.isArray(bars))return unknown('closed-window-clock-unavailable');
 const rows=bars.filter(b=>b&&b.ts>=from&&b.ts<end).sort((a,b)=>a.ts-b.ts);
 if(rows.length!==COUNT||!rows.every((b,i)=>b.ts===from+i*STEP&&b.pair===pair&&b.interval===15&&[b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)&&b.low>0&&b.volume>=0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)))return unknown('missing-invalid-or-conflicting-closed-window',rows.length);
 const reference=rows.slice(0,REFERENCE),current=rows[REFERENCE]!.volume,positive=reference.filter(b=>b.volume>0).length;
 const known={...common,closedAt:end,complete:true as const,observedCandles:COUNT,currentZero:current===0,referencePositiveBars:positive,referenceZeroBars:REFERENCE-positive};
 if(!positive)return {...known,ratioAvailable:false,reason:'zero-reference-volume',relativeVolume:null};
 // Reference scaling avoids summing finite raw volumes into Infinity. No current volume in denominator.
 const scale=Math.max(...reference.map(b=>b.volume)),mean=reference.reduce((sum,b)=>sum+b.volume/scale,0)/REFERENCE;
 let ratio=(current/scale)/mean;
 // Recover a representable subnormal result when the first division alone underflows.
 if(current>0&&ratio===0)ratio=current/(scale*mean);
 if(!Number.isFinite(ratio)||current>0&&ratio===0)return {...known,ratioAvailable:false,reason:'unrepresentable-relative-volume',relativeVolume:null};
 return {...known,ratioAvailable:true,reason:null,relativeVolume:ratio};
}
