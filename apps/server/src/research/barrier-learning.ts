import {calendarClockWeights} from './calendar-clock-weights.js';
import {barrierTargetHash,type BarrierTarget,type BarrierOutcome} from './first-barrier-outcome.js';
import {fitRidge,ridgeForecast,diagnosticCostFactors,type RidgeModel,type LearningObservation} from './local-learning.js';
import {digest} from '../provenance/build.js';import {canonicalJson} from './dataset.js';
const STEP=900000;
export type BarrierLearningObservation={pair:string;decisionAt:number;entryAt:number;labelEnd:number;x:number[];targetHash:string;outcome:BarrierOutcome};
export type BarrierRidge={version:'barrier-net-ridge-v1';featureSchema:'closed-bounded750-vector8-v1';target:BarrierTarget;knownLabels:number;ambiguousLabels:number;ridge:RidgeModel;trainingWeighting?:{method:'calendar-clock-weights-v1';halfLifeDays:number;clockCount:number;weightHash:string};hash:string};
const near=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-10*Math.max(1e-12,Math.abs(a),Math.abs(b));
/** Explicit costed fixed-barrier target, never gross fixed-horizon or variable-policy PnL. */
export function fitBarrierRidge(rows:BarrierLearningObservation[],target:BarrierTarget,trainedAt:number,lambda=10,minRows=200,halfLifeDays?:number):BarrierRidge{
 const expected=barrierTargetHash(target),exit=diagnosticCostFactors(target.costs).exit;
 if(!Array.isArray(rows)||!Number.isSafeInteger(trainedAt)||trainedAt<0)throw Error('Invalid barrier training scope');
 const seen=new Set<string>(),known:LearningObservation[]=[];let ambiguous=0;
 for(const r of rows){
  const o=r?.outcome;
  if(!r||typeof r.pair!=='string'||!r.pair||!Array.isArray(r.x)||r.x.length!==8||!Array.from(r.x).every(Number.isFinite)||![r.decisionAt,r.entryAt,r.labelEnd].every(n=>Number.isSafeInteger(n)&&n>=0)||r.decisionAt%(48*STEP)||r.entryAt!==r.decisionAt+STEP||r.labelEnd!==r.entryAt+target.horizonBars*STEP||r.labelEnd>=trainedAt||r.targetHash!==expected||!o||o.version!=='first-barrier-outcome-v1'||o.targetHash!==expected||o.entryAt!==r.entryAt||o.availableAt!==r.labelEnd||!Number.isSafeInteger(o.eventBarTs)||o.eventBarTs%STEP||o.eventBarTs<r.entryAt||o.eventBarTs>=r.labelEnd)throw Error('Invalid, mixed or unavailable barrier label');
  const key=r.pair+':'+r.decisionAt;if(seen.has(key))throw Error('Duplicate barrier training row');seen.add(key);
  if(![o.entryFill,o.entryBasis,o.stopPrice,o.targetPrice].every(n=>Number.isFinite(n)&&n>0)||!near(o.entryBasis,o.entryFill*(1+target.costs.feeRate))||!near(o.stopPrice,o.entryBasis*(1-target.stopLossPct))||!near(o.targetPrice,o.entryFill*(1+target.takeProfitPct)))throw Error('Inconsistent barrier geometry');
  if(o.outcome==='ambiguous'){
   if(o.execution!=='unknown-path'||o.exitReference!==null||o.netReturn!==null)throw Error('Fabricated ambiguous payoff');ambiguous++;continue;
  }
  const p=o.exitReference;
  if(p===null||!Number.isFinite(p)||p<=0||o.netReturn===null||!near(o.netReturn,p*exit/o.entryBasis-1))throw Error('Inconsistent costed barrier payoff');
  const stop=o.outcome==='stop'&&(o.execution==='barrier'&&near(p,o.stopPrice)||o.execution==='gap-open'&&p<=o.stopPrice);
  const take=o.outcome==='target'&&o.execution==='barrier'&&near(p,o.targetPrice);
  const timeout=o.outcome==='timeout'&&o.execution==='horizon-close'&&o.eventBarTs===r.labelEnd-STEP&&p>o.stopPrice&&p<o.targetPrice;
  if(!stop&&!take&&!timeout)throw Error('Inconsistent barrier event');
  // fitRidge consumes x/y/clocks only. Prices retain their actual distinct definitions:
  // fee-inclusive paid basis and raw assumed exit reference; y is already net of costs.
  known.push({pair:r.pair,decisionAt:r.decisionAt,entryAt:r.entryAt,labelEnd:r.labelEnd,x:[...r.x],y:o.netReturn,entryPrice:o.entryBasis,exitPrice:p});
 }
 const weighting=halfLifeDays===undefined?undefined:calendarClockWeights(known,trainedAt,halfLifeDays);
 const ridge=fitRidge(known,trainedAt,lambda,minRows,weighting?.weights),facts={version:'barrier-net-ridge-v1' as const,featureSchema:'closed-bounded750-vector8-v1' as const,target:structuredClone(target),knownLabels:known.length,ambiguousLabels:ambiguous,ridge,...(weighting?{trainingWeighting:{method:weighting.version,halfLifeDays:weighting.halfLifeDays,clockCount:weighting.clockCount,weightHash:weighting.hash}}:{})};
 return {...facts,hash:digest(canonicalJson(facts))};
}
/** Offline net-return estimate, NOT a calibrated win probability or an enabled trading model. */
export function forecastBarrierNet(m:BarrierRidge,x:number[],asOf:number,expected:BarrierTarget):number|null{
 try{if(!m||m.version!=='barrier-net-ridge-v1'||m.featureSchema!=='closed-bounded750-vector8-v1'||barrierTargetHash(m.target)!==barrierTargetHash(expected)||!Number.isSafeInteger(m.knownLabels)||m.knownLabels!==m.ridge.rows||!Number.isSafeInteger(m.ambiguousLabels)||m.ambiguousLabels<0)return null;const {hash,...facts}=m;if(digest(canonicalJson(facts))!==hash)return null;return ridgeForecast(m.ridge,x,asOf);}catch{return null;}
}
