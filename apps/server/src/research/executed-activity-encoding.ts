import type {DecisionContext} from '@paper/shared';
import {packContext} from '../ai/prompt.js';
import {encodeResearchDigests,expandResearchDigests} from './executed-digest-encoding.js';
type ObjectValue=Record<string,any>;
const object=(x:unknown):x is ObjectValue=>!!x&&typeof x==='object'&&!Array.isArray(x);
const KEY='executedActivityEncoding',FORMAT='market-frame-runs-v1';
/** Decode atomically on a caller-owned JSON snapshot. Count follows marketContext.markets order. */
export function expandExecutedActivity(value:unknown){
 if(!object(value)||!Object.hasOwn(value,KEY))return;
 const e=value[KEY],markets=value.marketContext?.markets;
 if(!object(e)||e.format!==FORMAT||Object.keys(e).some(k=>!['format','runs'].includes(k))||!Array.isArray(e.runs)||!Array.isArray(markets)||Array.from(markets).some(m=>!object(m)||Object.hasOwn(m,'executedActivity')))throw Error('Invalid executed activity encoding');
 const decoded:{present:boolean;value?:unknown}[]=[];
 for(const r of e.runs){
  if(!object(r)||!Number.isSafeInteger(r.count)||r.count<1||r.count>markets.length-decoded.length||typeof r.present!=='boolean'||r.present!==Object.hasOwn(r,'value')||Object.keys(r).some(k=>!['count','present','value'].includes(k)))throw Error('Invalid executed activity run');
  for(let n=0;n<r.count;n++)decoded.push(r.present?{present:true,value:structuredClone(r.value)}:{present:false});
 }
 if(decoded.length!==markets.length)throw Error('Incomplete executed activity runs');
 decoded.forEach((r,i)=>{if(r.present)markets[i].executedActivity=r.value;});delete value[KEY];
}
/** Read-only JSON transport compaction. Keeps all fields and missing/null/zero distinctions. */
export function encodeExecutedActivity(context:DecisionContext):DecisionContext{
 const copy=JSON.parse(JSON.stringify(context));expandExecutedActivity(copy);const markets=copy.marketContext?.markets;if(!Array.isArray(markets)||!markets.length||markets.some(m=>!object(m)))return copy;
 const before=JSON.stringify(copy).length,runs:{count:number;present:boolean;value?:unknown}[]=[];let lastIdentity:string|undefined;
 for(const m of markets){const present=Object.hasOwn(m,'executedActivity'),value=m.executedActivity,identity=JSON.stringify([present,value]);if(identity===lastIdentity)runs[runs.length-1]!.count++;else{runs.push(present?{count:1,present:true,value}:{count:1,present:false});lastIdentity=identity;}delete m.executedActivity;}
 copy[KEY]={format:FORMAT,runs};if(JSON.stringify(copy).length>=before){expandExecutedActivity(copy);return copy;}return copy;
}
/** Opt-in research transport only; the active serializer and its budget are untouched. */
export function decodeExecutedActivityResearch(value:unknown):DecisionContext{const copy=JSON.parse(JSON.stringify(value));expandResearchDigests(copy);expandExecutedActivity(copy);return copy;}
export function packExecutedActivityResearch(context:DecisionContext,maxChars:number){const restored=decodeExecutedActivityResearch(context),hasActivity=Array.isArray((restored.marketContext as any)?.markets)&&(restored.marketContext as any).markets.some((m:any)=>object(m)&&Object.hasOwn(m,'executedActivity'));return packContext(hasActivity?encodeResearchDigests(encodeExecutedActivity(restored)):restored,maxChars);}
