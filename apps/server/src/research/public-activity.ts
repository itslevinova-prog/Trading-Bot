import type {Candle} from '@paper/shared';
export const PUBLIC_ACTIVITY_VERSION='binance-public-activity96-v1';
const STEP=900000,COUNT=96;
export type PublicActivityBar={candle:Candle;quoteVolume:number;trades:number;takerBuyBaseVolume:number;takerBuyQuoteVolume:number;takerBuyBaseShare:number|null;takerBuyQuoteShare:number|null};
/** Public aggregate executions only. Separate capture time, never claimed first historical receipt. */
export function parseClosedPublicActivity(pair:string,raw:unknown,closedAt:number,capturedAt:number){
 const common={version:PUBLIC_ACTIVITY_VERSION,source:'binance-public-spot-klines',pair,closedAt:Number.isSafeInteger(closedAt)&&closedAt>=0?closedAt:null,capturedAt:Number.isSafeInteger(capturedAt)&&capturedAt>=0?capturedAt:null,expectedBars:COUNT,scope:'Exact96closed15m bars. Public aggregate taker-buy fields describe executed activity at one venue, not book liquidity or calibrated profit. Capture time is actual retrieval, not first historical availability.'};
 const deny=(reason:string)=>({...common,complete:false as const,reason,bars:[] as PublicActivityBar[]});
 if(typeof pair!=='string'||!(/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/).test(pair)||!Number.isSafeInteger(closedAt)||closedAt<COUNT*STEP||closedAt%STEP||!Number.isSafeInteger(capturedAt)||capturedAt<closedAt)return deny('invalid-source-or-capture-clock');
 if(!Array.isArray(raw)||raw.length!==COUNT)return deny('missing-or-unexpected-source-rows');
 const decimal=(value:unknown)=>{if(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value))throw Error('invalid-decimal');const n=Number(value);if(!Number.isFinite(n)||n===0&&/[1-9]/.test(value))throw Error('unrepresentable-decimal');return n;};
 try{
  const bars:PublicActivityBar[]=raw.map(row=>{
   if(!Array.isArray(row)||row.length!==12||!Number.isSafeInteger(row[0])||row[0]<0||row[0]%STEP||row[6]!==row[0]+STEP-1||!Number.isSafeInteger(row[8])||row[8]<0)throw Error('invalid-row-shape-or-clock');
   const [open,high,low,close,volume]=[1,2,3,4,5].map(i=>decimal(row[i]));
   if(low!<=0||high!<Math.max(open!,close!)||low!>Math.min(open!,close!))throw Error('invalid-price');
   const quoteVolume=decimal(row[7]),takerBuyBaseVolume=decimal(row[9]),takerBuyQuoteVolume=decimal(row[10]);
   if(takerBuyBaseVolume>volume!||takerBuyQuoteVolume>quoteVolume)throw Error('taker-volume-exceeds-total');
   return {candle:{pair,interval:15,ts:row[0],open:open!,high:high!,low:low!,close:close!,volume:volume!},quoteVolume,trades:row[8],takerBuyBaseVolume,takerBuyQuoteVolume,takerBuyBaseShare:volume!>0?takerBuyBaseVolume/volume!:null,takerBuyQuoteShare:quoteVolume>0?takerBuyQuoteVolume/quoteVolume:null};
  }).sort((a,b)=>a.candle.ts-b.candle.ts);
  if(!bars.every((b,i)=>b.candle.ts===closedAt-(COUNT-i)*STEP))return deny('missing-conflicting-or-nonclosed-window');
  return {...common,closedAt,capturedAt,complete:true as const,reason:null,bars};
 }catch{return deny('invalid-or-unrepresentable-public-row');}
}
