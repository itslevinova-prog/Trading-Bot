import {digest} from '../provenance/build.js';
import {canonicalJson} from './dataset.js';
import {eligiblePolicyInputs, POLICY_INPUT_FIELDS, type PolicyInputRow} from './policy-inputs.js';

export type HistoricalLookup={mode:'historical-simulation';scopeId:string;asOf:number};
type Eligible=ReturnType<typeof eligiblePolicyInputs>[number];
type Column={count:number;mean:number|null;std:number|null};
export type PolicyPreprocessor={version:'policy-preprocessor-v1';scopeId:string;asOf:number;trainStart:number;rows:number;featureFields:string[];trainingIds:string[];trainingInputHashes:string[];columns:Column[];classes:Record<'profit'|'loss'|'break-even',number>;classWeights:Record<'profit'|'loss'|'break-even',number|null>;hash:string};
const clock=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const signClass=(n:number)=>n>0?'profit':n<0?'loss':'break-even';
const hashFacts=(model:Omit<PolicyPreprocessor,'hash'>)=>digest(canonicalJson(model));

/** Offline research only. Every fitted statistic depends exclusively on matured training rows. */
export function fitPolicyPreprocessor(rows:PolicyInputRow[],lookup:HistoricalLookup,trainStart:number):PolicyPreprocessor{
 if(!clock(trainStart)||trainStart>lookup.asOf)throw Error('Invalid training window');
 const train=eligiblePolicyInputs(rows,lookup).filter(r=>r.decisionAt>=trainStart);
 if(!train.length)throw Error('No mature training outcomes');
 const columns=POLICY_INPUT_FIELDS.map((_,j):Column=>{
  let count=0,mean=0,m2=0;
  for(const row of train){const value=row.x[j];if(value===null||value===undefined)continue;count++;const delta=value-mean;mean+=delta/count;m2+=delta*(value-mean);}
  const std=count?Math.sqrt(Math.max(0,m2/count)):null;
  if(!Number.isFinite(mean)||std!==null&&!Number.isFinite(std))throw Error('Unstable training statistics');
  return {count,mean:count?mean:null,std};
 });
 const classes={profit:0,loss:0,'break-even':0};for(const r of train)classes[signClass(r.yNetReturnPct)]++;
 const present=Object.values(classes).filter(n=>n>0).length;
 const weight=(n:number)=>n?train.length/(present*n):null;
 const facts:Omit<PolicyPreprocessor,'hash'>={version:'policy-preprocessor-v1',scopeId:lookup.scopeId,asOf:lookup.asOf,trainStart,rows:train.length,featureFields:[...POLICY_INPUT_FIELDS],trainingIds:train.map(r=>r.id),trainingInputHashes:train.map(r=>r.inputHash),columns,classes,classWeights:{profit:weight(classes.profit),loss:weight(classes.loss),'break-even':weight(classes['break-even'])}};
 return {...facts,hash:hashFacts(facts)};
}

/** Unknown-at-fit columns and newly varying constants remain unsupported, never fabricated as evidence. */
export function transformPolicyVector(model:PolicyPreprocessor,row:Pick<Eligible,'scopeId'|'x'>){
 const {hash,...facts}=model;
 if(hash!==hashFacts(facts)||model.version!=='policy-preprocessor-v1'||model.scopeId!==row.scopeId||model.featureFields.join(',')!==POLICY_INPUT_FIELDS.join(',')||model.columns.length!==POLICY_INPUT_FIELDS.length||row.x.length!==POLICY_INPUT_FIELDS.length)throw Error('Preprocessor scope/schema/hash mismatch');
 const missing:boolean[]=[],unsupported:boolean[]=[];
 const values=row.x.map((v,j)=>{
  if(v!==null&&!Number.isFinite(v))throw Error('Invalid learning vector');
  const c=model.columns[j]!;missing.push(v===null);
  const noSupport=c.count===0||c.std===0&&v!==null&&v!==c.mean;unsupported.push(noSupport);
  if(noSupport)return null;
  const scaled=v===null||c.std===0?0:(v-c.mean!)/c.std!;
  if(!Number.isFinite(scaled))throw Error('Unstable transformed input');return scaled;
 });
 return {values,missing,unsupported};
}

/** Shared time boundaries across all pairs; purge by each trade's outcome availability, not a row-count gap. */
export function policyLearningFold(rows:PolicyInputRow[],options:{mode:'historical-simulation';scopeId:string;trainStart:number;validationStart:number;testStart:number;testEnd:number;embargoMs:number}){
 const {mode,scopeId,trainStart,validationStart,testStart,testEnd,embargoMs}=options;
 if(mode!=='historical-simulation'||![trainStart,validationStart,testStart,testEnd,embargoMs].every(clock)||!(trainStart<validationStart&&validationStart<testStart&&testStart<testEnd)||validationStart-embargoMs-1<trainStart||testStart-embargoMs-1<validationStart)throw Error('Invalid chronological fold');
 const trainAsOf=validationStart-embargoMs-1,validationAsOf=testStart-embargoMs-1,testAsOf=testEnd-1;
 const model=fitPolicyPreprocessor(rows,{mode,scopeId,asOf:trainAsOf},trainStart);
 const select=(asOf:number,from:number,to:number)=>eligiblePolicyInputs(rows,{mode,scopeId,asOf}).filter(r=>r.decisionAt>=from&&r.decisionAt<to).map(row=>({...row,transformed:transformPolicyVector(model,row)}));
 return {version:'policy-learning-fold-v1' as const,options:{...options},trainAsOf,validationAsOf,testAsOf,preprocessor:model,train:select(trainAsOf,trainStart,validationStart),validation:select(validationAsOf,validationStart,testStart),test:select(testAsOf,testStart,testEnd),modelTrained:false as const,independentSamples:null};
}
