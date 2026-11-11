import {digest} from '../provenance/build.js';import {canonicalJson} from './dataset.js';
export type SupportRow={pair:string;decisionAt:number;labelEnd:number;x:number[]};
export type SupportQuery={pair:string;decisionAt:number;x:number[]|null};
const VERSION='clock-excluded-feature-support-v1',DAY=86400000;
const finiteVector=(x:unknown,n:number):x is number[]=>Array.isArray(x)&&x.length===n&&Array.from(x).every(Number.isFinite);
/** Own diagnostic geometry, not a forecast, probability or entry filter. No payoff input. */
export function fitFeatureSupport(rows:readonly SupportRow[],trainedAt:number,dimensions:8|9,minRows=200){
 if(!Array.isArray(rows)||!Number.isSafeInteger(trainedAt)||trainedAt<0||![8,9].includes(dimensions)||!Number.isSafeInteger(minRows)||minRows<2||rows.length<minRows||rows.length>2000)throw Error('Invalid support scope');
 const training:readonly SupportRow[]=rows;
 const sorted=training.map(r=>({pair:r?.pair,decisionAt:r?.decisionAt,labelEnd:r?.labelEnd,x:r?.x?[...r.x]:[]})).sort((a,b)=>a.decisionAt-b.decisionAt||String(a.pair).localeCompare(String(b.pair)));
 const seen=new Set<string>();for(const r of sorted){if(typeof r.pair!=='string'||!r.pair||!finiteVector(r.x,dimensions)||![r.decisionAt,r.labelEnd].every(n=>Number.isSafeInteger(n)&&n>=0)||r.labelEnd<=r.decisionAt||r.labelEnd>=trainedAt)throw Error('Unavailable support training row');const key=JSON.stringify([r.pair,r.decisionAt]);if(seen.has(key))throw Error('Duplicate support row');seen.add(key);}
 const clocks=new Set(sorted.map(r=>r.decisionAt)).size;if(clocks<2)throw Error('Support needs distinct training clocks');
 const means=Array.from({length:dimensions},(_,j)=>sorted.reduce((s,r)=>s+r.x[j]!/sorted.length,0)),stds=means.map((m,j)=>Math.sqrt(sorted.reduce((s,r)=>s+(r.x[j]!-m)**2/sorted.length,0))||1);
 if(![...means,...stds].every(Number.isFinite)||stds.some(v=>v<=0))throw Error('Unrepresentable support scale');
 const points=sorted.map(r=>({pair:r.pair,decisionAt:r.decisionAt,z:r.x.map((v,j)=>(v-means[j]!)/stds[j]!)}));if(points.some(r=>!finiteVector(r.z,dimensions)))throw Error('Unrepresentable support coordinates');
 const referenceNearest=points.map((r,i)=>{let best=Infinity;for(let j=0;j<points.length;j++){const q=points[j]!;if(q.decisionAt===r.decisionAt)continue;const d=Math.hypot(...r.z.map((v,k)=>v-q.z[k]!));if(d<best)best=d;}return best;});
 if(!referenceNearest.every(Number.isFinite))throw Error('Unrepresentable support geometry');
 const referenceMean=referenceNearest.reduce((s,d)=>s+d/referenceNearest.length,0),facts={version:VERSION,dimensions,trainedAt,lastLabelEnd:Math.max(...sorted.map(r=>r.labelEnd)),rows:points.length,clocks,means,stds,points,referenceNearest,referenceMean};
 return {...facts,hash:digest(canonicalJson(facts))};
}
export type FeatureSupport=ReturnType<typeof fitFeatureSupport>;
/** Batch validates the sealed snapshot once. Query clocks and source absence remain authoritative. */
export function featureSupportDistances(model:FeatureSupport,queries:readonly SupportQuery[]){
 if(!Array.isArray(queries))throw Error('Invalid support queries');
 const unknown=(reason:string)=>({complete:false as const,reason,nearestDistance:null,referenceRatio:null,nearestPair:null,nearestDecisionAt:null,marginalZ6Pass:null});
 try{const {hash,...facts}=model;if(digest(canonicalJson(facts))!==hash||model.version!==VERSION||![8,9].includes(model.dimensions)||!Number.isSafeInteger(model.rows)||model.rows<2||model.rows>2000||model.points.length!==model.rows||model.referenceNearest.length!==model.rows||!finiteVector(model.means,model.dimensions)||!finiteVector(model.stds,model.dimensions)||model.stds.some(v=>v<=0)||model.referenceNearest.some(d=>!Number.isFinite(d)||d<0)||!Number.isFinite(model.referenceMean)||model.referenceMean<0||![model.trainedAt,model.lastLabelEnd].every(n=>Number.isSafeInteger(n)&&n>=0)||model.lastLabelEnd>=model.trainedAt||model.points.some(r=>typeof r.pair!=='string'||!r.pair||!Number.isSafeInteger(r.decisionAt)||r.decisionAt<0||r.decisionAt>=model.trainedAt||!finiteVector(r.z,model.dimensions)))throw Error('Invalid support snapshot');}
 catch{return queries.map(()=>unknown('invalid-support-snapshot'));}
 const queryRows:readonly SupportQuery[]=queries;
 return queryRows.map(q=>{
  if(!q||typeof q.pair!=='string'||!q.pair||!Number.isSafeInteger(q.decisionAt)||q.decisionAt<model.trainedAt||q.decisionAt-model.trainedAt>10*DAY||q.decisionAt-model.lastLabelEnd>10*DAY)return unknown('invalid-or-stale-query-clock');
  if(q.x===null)return unknown('source-features-unavailable');if(!finiteVector(q.x,model.dimensions))return unknown('invalid-query-vector');
  const z=q.x.map((v,j)=>(v-model.means[j]!)/model.stds[j]!);if(!z.every(Number.isFinite))return unknown('unrepresentable-query-vector');
  if(model.referenceMean===0)return unknown('zero-clock-excluded-reference-distance');
  let best=Infinity,nearest:FeatureSupport['points'][number]|undefined;for(const p of model.points){const d=Math.hypot(...z.map((v,j)=>v-p.z[j]!));if(d<best){best=d;nearest=p;}}
  const ratio=best/model.referenceMean;if(!nearest||![best,ratio].every(Number.isFinite))return unknown('unrepresentable-query-distance');
  return {complete:true as const,reason:null,nearestDistance:best,referenceRatio:ratio,nearestPair:nearest.pair,nearestDecisionAt:nearest.decisionAt,marginalZ6Pass:z.every(v=>Math.abs(v)<=6)};
 });
}
