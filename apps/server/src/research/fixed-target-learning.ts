import type {Candle} from '@paper/shared';
import {feature} from '../market/indicators.js';import {aggregate} from '../context/market-context.js';import {vector} from '../memory/math.js';import {canonicalJson} from './dataset.js';import {digest} from '../provenance/build.js';
import {fitRidge,ridgeForecast,type LearningObservation,type RidgeModel} from './local-learning.js';
const STEP=900000,clock=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
export const FIXED_FEATURE_FIELDS=Object.freeze(['rsi14/100','ema20/ema50-percent','price/hourlyEMA50-percent','change1h-percent','change4h-percent','change24h-percent','atr-percent','volume-ratio'] as const);
export type FixedTargetContract={version:'fixed-target-contract-v1';dataScope:string;featureSchema:'closed-bounded750-vector8-v1';featureFields:readonly string[];horizonBars:16|32;strideBars:48;entryLagBars:1;target:'gross-close-over-delayed-open-minus1';units:'return-fraction';hash:string};
export function fixedTargetContract(dataScope:string,horizonBars:16|32=32):FixedTargetContract{
 if(typeof dataScope!=='string'||!/^[a-f0-9]{64}$/.test(dataScope)||![16,32].includes(horizonBars))throw Error('Invalid fixed target contract');
 const facts={version:'fixed-target-contract-v1' as const,dataScope,featureSchema:'closed-bounded750-vector8-v1' as const,featureFields:[...FIXED_FEATURE_FIELDS],horizonBars,strideBars:48 as const,entryLagBars:1 as const,target:'gross-close-over-delayed-open-minus1' as const,units:'return-fraction' as const};return {...facts,hash:digest(canonicalJson(facts))};
}
function validContract(c:FixedTargetContract){return !!c&&canonicalJson(c)===canonicalJson(fixedTargetContract(c.dataScope,c.horizonBars));}
export type FixedTargetObservation=LearningObservation & {targetHash:string};
/** Modelled historical availability only, no observed first-receipt or policy-PnL label. */
export function fixedTargetObservations(pair:string,bars:Candle[],from:number,to:number,c:FixedTargetContract):FixedTargetObservation[]{
 if(!validContract(c)||!clock(from)||!clock(to)||to<=from)throw Error('Invalid fixed target observation scope');
 const rows=[...bars].sort((a,b)=>a.ts-b.ts);
 if(rows.some((b,i)=>b.pair!==pair||b.interval!==15||!clock(b.ts)||b.ts%STEP||i>0&&b.ts===rows[i-1]!.ts||![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.low<=0||b.volume<0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)))throw Error('Invalid fixed target candle');
 const hourly=aggregate(rows,60,Infinity),byTime=new Map(rows.map(b=>[b.ts,b])),result:FixedTargetObservation[]=[];let cursor=0,hourCursor=0;
 for(const b of rows){const decisionAt=b.ts+STEP;if(decisionAt<from||decisionAt>=to||decisionAt%(c.strideBars*STEP))continue;const entryAt=decisionAt+STEP,labelEnd=entryAt+c.horizonBars*STEP;if(labelEnd>to)continue;
  while(cursor<rows.length&&rows[cursor]!.ts+STEP<=decisionAt)cursor++;while(hourCursor<hourly.length&&hourly[hourCursor]!.ts+3600000<=decisionAt)hourCursor++;
  const entry=byTime.get(entryAt),exit=byTime.get(labelEnd-STEP);if(!entry||!exit||Array.from({length:c.horizonBars},(_,i)=>entryAt+i*STEP).some(ts=>!byTime.has(ts)))continue;
  const f=feature(pair,rows.slice(Math.max(0,cursor-750),cursor),hourly.slice(Math.max(0,hourCursor-750),hourCursor),{bid:b.close,ask:b.close},decisionAt);if(!f)continue;
  const x=vector(f),y=exit.close/entry.open-1;if(x.length!==8||!x.every(Number.isFinite)||!Number.isFinite(y))continue;result.push({pair,decisionAt,entryAt,labelEnd,x,y,entryPrice:entry.open,exitPrice:exit.close,targetHash:c.hash});
 }return result;
}
export type FixedTargetRidge={version:'fixed-target-ridge-v1';contract:FixedTargetContract;ridge:RidgeModel;hash:string};
export function fitFixedTargetRidge(rows:FixedTargetObservation[],c:FixedTargetContract,trainedAt:number,lambda=10,minRows=200):FixedTargetRidge{
 if(!validContract(c)||rows.some(r=>r.targetHash!==c.hash||r.decisionAt%(c.strideBars*STEP)||r.entryAt!==r.decisionAt+STEP||r.labelEnd!==r.entryAt+c.horizonBars*STEP||![r.entryPrice,r.exitPrice].every(p=>Number.isFinite(p)&&p>0)||r.y!==r.exitPrice/r.entryPrice-1))throw Error('Mixed or inconsistent fixed target training rows');
 const ridge=fitRidge(rows,trainedAt,lambda,minRows),facts={version:'fixed-target-ridge-v1' as const,contract:structuredClone(c),ridge};return {...facts,hash:digest(canonicalJson(facts))};
}
/** Contract mismatch is abstention, never silent target conversion or automatic deployment. */
export function forecastFixedTarget(m:FixedTargetRidge,x:number[],asOf:number,expected:FixedTargetContract):number|null{
 try{if(!validContract(expected)||!m||m.version!=='fixed-target-ridge-v1'||!validContract(m.contract)||m.contract.hash!==expected.hash)return null;const {hash,...facts}=m;if(digest(canonicalJson(facts))!==hash)return null;return ridgeForecast(m.ridge,x,asOf);}catch{return null;}
}
