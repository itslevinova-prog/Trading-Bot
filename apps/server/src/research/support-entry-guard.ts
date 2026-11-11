import type {FeatureSupport,SupportQuery} from './feature-support.js';import {featureSupportDistances} from './feature-support.js';import {digest} from '../provenance/build.js';import {canonicalJson} from './dataset.js';
/** ONE fixed empirical training-only rule. Percentile is not confidence or a loss probability. */
export function empiricalSupportCutoff(model:FeatureSupport){
 const unknown=(reason:string)=>({version:'training-support-entry-v1',ready:false as const,reason,supportHash:model?.hash??null,quantile:.95,nearestDistanceCutoff:null,referenceRatioCutoff:null});
 try{const {hash,...facts}=model;if(digest(canonicalJson(facts))!==hash||model.rows<200||model.rows>2000||model.referenceNearest.length!==model.rows||model.clocks<2||model.referenceNearest.some(v=>!Number.isFinite(v)||v<0))return unknown('invalid-or-insufficient-support');
  if(!Number.isFinite(model.referenceMean)||model.referenceMean<=0)return unknown('zero-or-invalid-reference-geometry');
  const sorted=[...model.referenceNearest].sort((a,b)=>a-b),cutoff=sorted[Math.ceil(.95*sorted.length)-1]!,ratio=cutoff/model.referenceMean;if(!Number.isFinite(ratio))return unknown('unrepresentable-cutoff');
  return {version:'training-support-entry-v1',ready:true as const,reason:null,supportHash:hash,quantile:.95,nearestDistanceCutoff:cutoff,referenceRatioCutoff:ratio};
 }catch{return unknown('invalid-or-insufficient-support');}
}
/** Entry-opportunity forecasts only: never route protective/discretionary sell actions through this guard. */
export function supportGuardedForecasts(model:FeatureSupport,queries:readonly SupportQuery[],forecasts:readonly (number|null)[]){
 if(!Array.isArray(queries)||!Array.isArray(forecasts)||queries.length!==forecasts.length||Array.from(forecasts).some(v=>v!==null&&!Number.isFinite(v)))throw Error('Invalid support forecast alignment');
 const calibration=empiricalSupportCutoff(model),diagnostics=featureSupportDistances(model,queries);
 const results=diagnostics.map((d,i)=>{const original=forecasts[i]!,reason=original===null?'original-forecast-unavailable':!calibration.ready?'support-calibration-unavailable':!d.complete?d.reason:d.referenceRatio!>calibration.referenceRatioCutoff!?'outside-training-support':null;return {pair:queries[i]!.pair,decisionAt:queries[i]!.decisionAt,originalForecast:original,forecast:reason===null?original:null,retained:reason===null,reason,diagnostic:d};});
 return {calibration,results};
}
