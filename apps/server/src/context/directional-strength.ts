import type {Candle} from '@paper/shared';
export const DIRECTIONAL_STRENGTH_VERSION='closed-dmi-adx14-193-v1';
const STEP=900000,COUNT=193,PERIOD=14;
/** Own fixed-window Wilder DMI/ADX definition. Descriptive only; no entry gate or probability.
 * Seed14true movements, then14DX values; intentionally explicit, not claimed Tulip seed parity. */
export function closedDirectionalStrength(pair:string,bars:readonly Candle[],asOf:number){
 const end=Math.floor(asOf/STEP)*STEP,from=end-COUNT*STEP;
 const common={version:DIRECTIONAL_STRENGTH_VERSION,period:PERIOD,sourceCandles:COUNT,closedAt:Number.isSafeInteger(end)&&end>=0?end:null,scope:'ADX describes strength; +DI/-DI describe movement balance. Bounded193closed15m window, explicit14movement/14DX seeds, no calibrated probability or trade edge.'};
 const deny=(reason:string,observedCandles=0)=>({...common,complete:false as const,reason,observedCandles,adx:null,previousAdx:null,adxChange:null,plusDI:null,minusDI:null,movementBalance:null});
 if(typeof pair!=='string'||!pair||!Number.isSafeInteger(asOf)||asOf<0||from<0||!Array.isArray(bars))return deny('closed-window-clock-unavailable');
 const rows=bars.filter(b=>b&&b.ts>=from&&b.ts<end).sort((a,b)=>a.ts-b.ts);
 if(rows.length!==COUNT||!rows.every((b,i)=>b.pair===pair&&b.interval===15&&b.ts===from+i*STEP&&[b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)&&b.low>0&&b.volume>=0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)))return deny('missing-invalid-or-conflicting-closed-window',rows.length);
 const scale=Math.max(...rows.map(b=>b.high));
 if(rows.some(b=>![b.high/scale,b.low/scale,b.close/scale].every(n=>Number.isFinite(n)&&n>0)))return deny('unrepresentable-price-scale',rows.length);
 // Compare raw movements before scaling to retain exact equal-up/down ties.
 const moves=rows.slice(1).map((b,i)=>{const prev=rows[i]!,up=b.high-prev.high,down=prev.low-b.low;return {tr:Math.max(b.high-b.low,Math.abs(b.high-prev.close),Math.abs(b.low-prev.close))/scale,plus:up>0&&up>down?up/scale:0,minus:down>0&&down>up?down/scale:0};});
 let tr=moves.slice(0,PERIOD).reduce((n,b)=>n+b.tr,0),plus=moves.slice(0,PERIOD).reduce((n,b)=>n+b.plus,0),minus=moves.slice(0,PERIOD).reduce((n,b)=>n+b.minus,0),plusDI=0,minusDI=0;const dx:number[]=[];
 for(let i=PERIOD-1;i<moves.length;i++){
  if(i>=PERIOD){const b=moves[i]!;tr=tr*(PERIOD-1)/PERIOD+b.tr;plus=plus*(PERIOD-1)/PERIOD+b.plus;minus=minus*(PERIOD-1)/PERIOD+b.minus;}
  plusDI=tr===0?0:100*plus/tr;minusDI=tr===0?0:100*minus/tr;dx.push(plusDI+minusDI===0?0:100*Math.abs(plusDI-minusDI)/(plusDI+minusDI));
 }
 let adx=dx.slice(0,PERIOD).reduce((n,v)=>n+v,0)/PERIOD,previousAdx=adx;
 for(const value of dx.slice(PERIOD)){previousAdx=adx;adx=(adx*(PERIOD-1)+value)/PERIOD;}
 const balance=plusDI+minusDI===0?0:(plusDI-minusDI)/(plusDI+minusDI);
 if(![adx,previousAdx,plusDI,minusDI,balance].every(Number.isFinite))return deny('nonfinite-directional-strength',rows.length);
 const bounded=(n:number)=>Math.min(100,Math.max(0,n));
 return {...common,closedAt:end,complete:true as const,reason:null,observedCandles:rows.length,adx:bounded(adx),previousAdx:bounded(previousAdx),adxChange:bounded(adx)-bounded(previousAdx),plusDI:bounded(plusDI),minusDI:bounded(minusDI),movementBalance:Math.min(1,Math.max(-1,balance))};
}
