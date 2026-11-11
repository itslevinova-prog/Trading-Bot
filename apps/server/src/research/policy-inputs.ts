import type {DecisionContext,FeatureSnapshot} from '@paper/shared';
import {digest} from '../provenance/build.js';import {canonicalJson} from './dataset.js';
import {eligiblePolicyLabels,type PolicyLabel} from './policy-labels.js';
export const POLICY_INPUT_VERSION='policy-entry-inputs-v1';
export const POLICY_INPUT_FIELDS=['rsi14','emaGapPct','hourlyGapPct','change1h','change4h','change24h','atrPct','volumeRatio','spreadBps','feeBps','slippageCapBps','assumedSlippageBps','directionalEfficiency','priorSupportDistancePct','priorResistanceDistancePct','btcCorrelation48h','upsideBreakout','downsideBreakout','upsideRejection','downsideRejection','twoSidedSweep'] as const;
export type PolicyInputFields=Record<typeof POLICY_INPUT_FIELDS[number],number|null>;
export type PolicyEntryCapture={version:typeof POLICY_INPUT_VERSION;scopeId:string;pair:string;entryBarTs:number;decisionAt:number;featureClosedAt:number;features:PolicyInputFields;inputHash:string;source:'retrospective-synthetic-replay-recapture'};
export type PolicyInputRow={capture:PolicyEntryCapture;label:PolicyLabel};
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const time=(v:number)=>Number.isSafeInteger(v)&&v>=0;
function validFeatures(f:PolicyInputFields){
 if(POLICY_INPUT_FIELDS.slice(0,12).some(k=>!finite(f[k]))||Object.values(f).some(v=>v!==null&&!finite(v)))return false;
 if(f.rsi14!<0||f.rsi14!>100||f.atrPct!<=0||f.volumeRatio!<0||[f.spreadBps,f.feeBps,f.slippageCapBps,f.assumedSlippageBps].some(v=>v!<0))return false;
 if(f.directionalEfficiency!==null&&(f.directionalEfficiency<0||f.directionalEfficiency>1)||f.btcCorrelation48h!==null&&Math.abs(f.btcCorrelation48h)>1)return false;
 return ['upsideBreakout','downsideBreakout','upsideRejection','downsideRejection','twoSidedSweep'].every(k=>f[k as keyof PolicyInputFields]===null||f[k as keyof PolicyInputFields]===0||f[k as keyof PolicyInputFields]===1);
}
const captureHash=(c:Omit<PolicyEntryCapture,'inputHash'>)=>digest(canonicalJson(c));
export function capturePolicyEntry(context:DecisionContext,pair:string,scopeId:string):PolicyEntryCapture{
 const at=Date.parse(context.timeUTC),execution=context.execution,markets=object(context.marketContext)&&Array.isArray(context.marketContext.markets)?context.marketContext.markets:[],matches=context.features.filter(f=>f.pair===pair),frames=markets.filter(m=>m?.pair===pair),f=matches[0],m=frames[0];
 if(!/^[a-f0-9]{64}$/.test(scopeId)||!time(at)||at<5000||(at-5000)%900000||!object(execution)||execution.mode!=='paper'||!object(execution.simulation)||execution.simulation.kind!=='ohlc-next-open-synthetic-book-v1'||execution.simulation.historicalOrderBookObserved!==false)throw Error('Explicit synthetic replay capture required');
 if(matches.length!==1||frames.length!==1||!f||!object(m)||m.asOf!==at||!object(m.quality)||m.quality.lastClosedAt!==f.ts+900000||!object(m.feature)||Object.keys(f).some(k=>m.feature[k]!==f[k as keyof FeatureSnapshot])||!time(f.ts)||f.ts+900000>at-5000||Object.entries(f).some(([k,v])=>k!=='pair'&&!finite(v))||[f.price,f.ema20,f.ema50,f.ema50_60m].some(v=>v<=0))throw Error('Noncausal or unmatched entry feature');
 const bid=Number(m.microstructure?.bids?.[0]?.price),ask=Number(m.microstructure?.asks?.[0]?.price),fee=context.limits.TAKER_FEE_RATE,slip=context.limits.MAX_ENTRY_SLIPPAGE_BPS,assumed=execution.simulation.slippageBps;
 if(!finite(bid)||!finite(ask)||bid<=0||ask<bid||!finite(fee)||fee<0||!finite(slip)||slip<0||!finite(assumed)||assumed<0)throw Error('Unknown entry cost inputs');
 const s=m.regime?.structure,complete=object(s)&&s.version==='closed-structure-v1'&&s.complete===true&&s.signalClosedAt===f.ts+900000,corr=m.regime?.correlationBTC48h;
 const flag=(k:string)=>complete&&typeof s[k]==='boolean'?Number(s[k]):null;
 const features:PolicyInputFields={rsi14:f.rsi14,emaGapPct:(f.ema20/f.ema50-1)*100,hourlyGapPct:(f.price/f.ema50_60m-1)*100,change1h:f.change1h,change4h:f.change4h,change24h:f.change24h,atrPct:f.atrPct,volumeRatio:f.volumeRatio,spreadBps:(ask/bid-1)*10000,feeBps:fee*10000,slippageCapBps:slip,assumedSlippageBps:assumed,
 directionalEfficiency:complete&&finite(s.directionalEfficiency)?s.directionalEfficiency:null,priorSupportDistancePct:complete&&finite(s.priorSupport)&&s.priorSupport>0?(f.price/s.priorSupport-1)*100:null,priorResistanceDistancePct:complete&&finite(s.priorResistance)&&s.priorResistance>0?(s.priorResistance/f.price-1)*100:null,btcCorrelation48h:object(corr)&&corr.complete===true&&finite(corr.value)?corr.value:null,upsideBreakout:flag('upsideBreakout'),downsideBreakout:flag('downsideBreakout'),upsideRejection:flag('upsideRejection'),downsideRejection:flag('downsideRejection'),twoSidedSweep:flag('twoSidedSweep')};
 if(!validFeatures(features))throw Error('Invalid policy input values');
 const facts:Omit<PolicyEntryCapture,'inputHash'>={version:POLICY_INPUT_VERSION,scopeId,pair,entryBarTs:at-5000,decisionAt:at,featureClosedAt:f.ts+900000,features,source:'retrospective-synthetic-replay-recapture' as const};return {...facts,inputHash:captureHash(facts)};
}
function validateCapture(c:PolicyEntryCapture){
 if(c.version!==POLICY_INPUT_VERSION||c.source!=='retrospective-synthetic-replay-recapture'||!/^[a-f0-9]{64}$/.test(c.scopeId)||!time(c.entryBarTs)||c.entryBarTs%900000||c.decisionAt!==c.entryBarTs+5000||!time(c.featureClosedAt)||c.featureClosedAt>c.entryBarTs||!object(c.features)||Object.keys(c.features).sort().join(',')!==[...POLICY_INPUT_FIELDS].sort().join(',')||!validFeatures(c.features))throw Error('Invalid policy entry input');
 const {inputHash,...facts}=c;if(captureHash(facts)!==inputHash)throw Error('Policy input hash mismatch');
}
export function joinPolicyInputs(labels:PolicyLabel[],captures:PolicyEntryCapture[],scopeId:string):PolicyInputRow[]{
 const map=new Map<string,PolicyEntryCapture>();for(const c of captures){if(c.scopeId!==scopeId)continue;validateCapture(c);const key=c.entryBarTs+':'+c.pair,old=map.get(key);if(old&&old.inputHash!==c.inputHash)throw Error('Conflicting entry captures');map.set(key,c);}
 return labels.filter(l=>l.scopeId===scopeId).map(label=>{const capture=map.get(label.entryBarTs+':'+label.pair);if(!capture||capture.featureClosedAt!==label.entryFeatureClosedAt)throw Error('Executed label has no matching causal entry capture');return {capture:structuredClone(capture),label:structuredClone(label)};});
}
export function eligiblePolicyInputs(rows:PolicyInputRow[],lookup:{mode:'historical-simulation';scopeId:string;asOf:number}){
 const labels=eligiblePolicyLabels(rows.map(r=>r.label),lookup),eligible=new Map(labels.map(l=>[l.id,l])),unique=new Map<string,PolicyInputRow>();
 for(const row of rows){const label=eligible.get(row.label.id);if(!label)continue;validateCapture(row.capture);if(row.capture.scopeId!==label.scopeId||row.capture.pair!==label.pair||row.capture.entryBarTs!==label.entryBarTs||row.capture.featureClosedAt!==label.entryFeatureClosedAt)throw Error('Input/target scope or clock mismatch');const old=unique.get(label.id);if(old&&old.capture.inputHash!==row.capture.inputHash)throw Error('Conflicting input for one outcome');unique.set(label.id,{capture:structuredClone(row.capture),label});}
 return labels.map(label=>{const row=unique.get(label.id)!;return {id:label.id,scopeId:label.scopeId,decisionAt:row.capture.decisionAt,x:POLICY_INPUT_FIELDS.map(k=>row.capture.features[k]),yNetReturnPct:label.netReturnPct!,modeledAvailableAt:label.modeledAvailableAt!,inputHash:row.capture.inputHash};});
}
