import {digest} from '../provenance/build.js';import {canonicalJson} from './dataset.js';
export type ClockWeightRow={pair:string;decisionAt:number;labelEnd:number};
/** Outcome-blind calendar decay with equal total mass per shared clock before decay. */
export function calendarClockWeights(rows:readonly ClockWeightRow[],trainedAt:number,halfLifeDays:number){
 const time=(n:number)=>Number.isSafeInteger(n)&&n>=0;
 if(!Array.isArray(rows)||!rows.length||!time(trainedAt)||!Number.isFinite(halfLifeDays)||halfLifeDays<=0)throw Error('Invalid calendar weighting scope');
 const groups=new Map<number,{labelEnd:number;rows:number}>(),seen=new Set<string>();
 for(const r of rows){if(!r||typeof r.pair!=='string'||!r.pair||!time(r.decisionAt)||!time(r.labelEnd)||r.labelEnd<=r.decisionAt||r.labelEnd>=trainedAt)throw Error('Unavailable calendar weighting row');const key=JSON.stringify([r.pair,r.decisionAt]);if(seen.has(key))throw Error('Duplicate calendar weighting row');seen.add(key);const g=groups.get(r.decisionAt);if(g){g.rows++;g.labelEnd=Math.max(g.labelEnd,r.labelEnd);}else groups.set(r.decisionAt,{labelEnd:r.labelEnd,rows:1});}
 const clocks=[...groups].sort(([a],[b])=>a-b).map(([decisionAt,g])=>({...g,decisionAt,decay:2**(-(trainedAt-g.labelEnd)/(86400000*halfLifeDays))}));
 if(clocks.some(g=>!Number.isFinite(g.decay)||g.decay<=0))throw Error('Unrepresentable calendar weights');
 const total=clocks.reduce((n,g)=>n+g.decay,0),normalizer=rows.length/total,byClock=new Map(clocks.map(g=>[g.decisionAt,g]));
 const weights=rows.map(r=>{const g=byClock.get(r.decisionAt)!;return normalizer*g.decay/g.rows;});
 if(!Number.isFinite(normalizer)||weights.some(w=>!Number.isFinite(w)||w<=0))throw Error('Unrepresentable calendar weights');
 const facts={version:'calendar-clock-weights-v1' as const,trainedAt,halfLifeDays,rows:rows.length,clockCount:clocks.length,clocks,weights,normalization:'mean-row-weight-one' as const};return {...facts,hash:digest(canonicalJson(facts))};
}
