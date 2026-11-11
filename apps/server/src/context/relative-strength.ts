import type {Candle} from '@paper/shared';
export const RELATIVE_STRENGTH_VERSION='closed-relative-strength-v1';
const STEP=900000,EDGES=16;
export type RelativeStrengthEvidence={version:string;horizonMinutes:240;complete:boolean;assetReturnPct:number|null;btcReturnPct:number|null;relativeReturnPct:number|null;reason:string|null;startClosedAt?:number;closedAt?:number;observedReturns?:number};
/** Strict same-clock relative price performance; NOT a calibrated forecast or beta-adjusted alpha. */
export function closedRelativeStrength(pair:string,bars:Candle[],btc:Candle[],now:number):RelativeStrengthEvidence{
 const base:RelativeStrengthEvidence={version:RELATIVE_STRENGTH_VERSION,horizonMinutes:240,complete:false,assetReturnPct:null,btcReturnPct:null,relativeReturnPct:null,reason:null},deny=(reason:string)=>({...base,reason});
 if(!Number.isSafeInteger(now)||now<0||!/^([A-Z0-9]+)\/([A-Z0-9]+)$/.test(pair))return deny('invalid-relative-source-clock-or-pair');
 const end=Math.floor(now/STEP)*STEP,start=end-(EDGES+1)*STEP,btcPair='BTC/'+pair.split('/')[1];if(start<0)return deny('insufficient-relative-clock-history');
 const window=(rows:Candle[])=>rows.filter(c=>c.ts>=start&&c.ts<end).sort((a,b)=>a.ts-b.ts),a=window(bars),b=window(btc);
 if(a.length!==EDGES+1||b.length!==EDGES+1)return deny('complete-aligned-relative-windows-unavailable');
 const valid=(rows:Candle[],symbol:string)=>rows.every((c,i)=>c.pair===symbol&&c.interval===15&&Number.isSafeInteger(c.ts)&&c.ts===start+i*STEP&&[c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low>0&&c.volume>=0&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close));
 if(!valid(a,pair)||!valid(b,btcPair))return deny('relative-window-scope-or-ohlc-invalid');
 const asset=a.at(-1)!.close/a[0]!.close,bitcoin=b.at(-1)!.close/b[0]!.close,assetReturnPct=(asset-1)*100,btcReturnPct=(bitcoin-1)*100,relativeReturnPct=(asset/bitcoin-1)*100;
 if(![assetReturnPct,btcReturnPct,relativeReturnPct].every(Number.isFinite)||asset<=0||bitcoin<=0)return deny('relative-return-nonfinite');
 return {...base,complete:true,startClosedAt:start+STEP,closedAt:end,observedReturns:EDGES,assetReturnPct,btcReturnPct,relativeReturnPct,reason:null};
}
