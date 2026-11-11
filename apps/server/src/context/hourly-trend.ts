import type {Candle,FeatureSnapshot} from '@paper/shared';
export const HOURLY_TREND_VERSION='closed-hourly-ema-direction-v1';
const HOUR=3600000,STEP=900000,clock=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0,positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
/** EMA values AND endpoint come from feature()'s same full hourly history; do not reseed from short context tails. */
export type HourlyTrendEvidence={version:string;complete:boolean;direction:'unknown'|'rising'|'falling'|'flat';slopePct:number|null;reason:string|null;closedAt?:number;currentEma50?:number;previousEma50?:number};
export function closedHourlyTrend(pair:string,hourly:Candle[],f:FeatureSnapshot|undefined,asOf:number):HourlyTrendEvidence{
 const base:HourlyTrendEvidence={version:HOURLY_TREND_VERSION,complete:false,slopePct:null,direction:'unknown',reason:null},deny=(reason:string):HourlyTrendEvidence=>({...base,reason});
 if(!clock(asOf)||!f||f.pair!==pair||!clock(f.ts)||f.ts%STEP||f.ts+STEP>asOf||asOf-f.ts-STEP>1200000)return deny('closed-feature-clock-unavailable');
 const end=f.ema50_60mClosedAt,prev=f.prevEma50_60m,current=f.ema50_60m;
 if(!clock(end)||end%HOUR||end<HOUR*2||end>f.ts+STEP||asOf-end>4500000||!positive(prev)||!positive(current))return deny('matching-hourly-ema-origin-unavailable');
 const rows=hourly.filter(c=>c.ts>=end-2*HOUR&&c.ts<end);if(rows.length!==2)return deny('hourly-predecessor-window-unavailable');rows.sort((a,b)=>a.ts-b.ts);
 if(!rows.every((c,i)=>c.pair===pair&&c.interval===60&&c.ts===end-2*HOUR+i*HOUR&&[c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low>0&&c.volume>=0&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close)))return deny('hourly-predecessor-window-invalid');
 const expected=rows[1]!.close*(2/51)+prev*(49/51),scale=Math.max(current,prev,expected),tolerance=1e-12*scale;
 if(!Number.isFinite(expected)||Math.abs(expected-current)>tolerance)return deny('hourly-ema-source-mismatch');
 const delta=current-prev,slopePct=(current/prev-1)*100;if(!Number.isFinite(slopePct))return deny('hourly-direction-nonfinite');
 return {...base,complete:true,closedAt:end,currentEma50:current,previousEma50:prev,slopePct,direction:Math.abs(delta)<=tolerance?'flat':delta>0?'rising':'falling',reason:null};
}
