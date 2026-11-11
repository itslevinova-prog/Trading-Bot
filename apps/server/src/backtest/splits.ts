import {createHash} from 'node:crypto';

const DAY=86_400_000;
export const DEVELOPMENT_SPLIT_ID='data-splits-v1' as const;
export const DEVELOPMENT_FROM=Date.UTC(2020,0,1);
export const DEVELOPMENT_TO=Date.UTC(2024,0,1);

export type OutcomeLabel={
  id:string;
  /** UTC moment at which the predictor can observe the start of the outcome. */
  labelStartMs:number;
  /** Exclusive UTC end of the outcome; may span multiple calendar days. */
  labelEndMs:number;
};
export type DevelopmentTestWindow={fromMs:number;toMs:number};
export type DevelopmentFold={
  dataSplitId:typeof DEVELOPMENT_SPLIT_ID;
  foldIndex:number;
  testFromMs:number;testToMs:number;
  embargoMs:number;
  /** Indices in canonical [start,end,id]-sorted label array, stable across strategies. */
  trainIndices:number[];testIndices:number[];
  purgedIndices:number[];embargoIndices:number[];
  futureIndices:number[];unresolvedTestIndices:number[];
  fingerprint:string;
};
export type DevelopmentFoldReport={
  dataSplitId:typeof DEVELOPMENT_SPLIT_ID;
  developmentFromMs:number;developmentToMs:number;
  embargoMs:number;
  orderedLabelIds:string[];
  foldFingerprint:string;
  folds:DevelopmentFold[];
  excludedCount:number;
};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validateLabels(labels:readonly OutcomeLabel[]):OutcomeLabel[]{
 if(!Array.isArray(labels)||!labels.length)throw Error('Purged folds require recorded label windows');
 const seen=new Set<string>();
 const sorted=[...labels].sort((a,b)=>a.labelStartMs-b.labelStartMs||a.labelEndMs-b.labelEndMs||a.id.localeCompare(b.id));
 for(const label of sorted){
  if(typeof label.id!=='string'||!/^[a-zA-Z0-9_.:-]{1,100}$/.test(label.id)||seen.has(label.id)||
     !Number.isSafeInteger(label.labelStartMs)||!Number.isSafeInteger(label.labelEndMs)||
     label.labelStartMs<DEVELOPMENT_FROM||label.labelEndMs>DEVELOPMENT_TO||
     label.labelEndMs<=label.labelStartMs)
    throw Error('Duplicate, unbounded or malformed development label');
  seen.add(label.id);
 }
 return sorted;
}
/** Strict forward-only purging: training can only use labels that have already
 * finished before the test starts, minus the fixed one-sided embargo. No
 * labels after the test period are ever used to build a training fold. */
export function buildPurgedDevelopmentFolds(
 labels:readonly OutcomeLabel[],windows:readonly DevelopmentTestWindow[],embargoDays:number
):DevelopmentFoldReport{
 if(!Number.isSafeInteger(embargoDays)||embargoDays<0||embargoDays>30)
  throw Error('Embargo must be a fixed integer number of UTC days in [0,30]');
 if(!Array.isArray(windows)||!windows.length)throw Error('Missing forward test windows');
 const embargoMs=embargoDays*DAY,ordered=validateLabels(labels);
 const folds:DevelopmentFold[]=[];
 let previousEnd=DEVELOPMENT_FROM;
 for(const [foldIndex,window] of windows.entries()){
  const {fromMs,toMs}=window;
  if(!Number.isSafeInteger(fromMs)||!Number.isSafeInteger(toMs)||
     fromMs%DAY!==0||toMs%DAY!==0||fromMs<DEVELOPMENT_FROM||
     toMs>DEVELOPMENT_TO||fromMs>=toMs||fromMs<previousEnd)
   throw Error('Test folds must be disjoint chronological UTC windows in development 2020-2023');
  previousEnd=toMs;
  const fold:DevelopmentFold={
   dataSplitId:DEVELOPMENT_SPLIT_ID,foldIndex,testFromMs:fromMs,testToMs:toMs,embargoMs,
   trainIndices:[],testIndices:[],purgedIndices:[],embargoIndices:[],
   futureIndices:[],unresolvedTestIndices:[],fingerprint:''
  };
  ordered.forEach((label,index)=>{
   if(label.labelStartMs>=toMs){
    fold.futureIndices.push(index);
   }else if(label.labelStartMs>=fromMs){
    if(label.labelEndMs<=toMs)fold.testIndices.push(index);
    else fold.unresolvedTestIndices.push(index);
   }else if(label.labelEndMs>fromMs){
    fold.purgedIndices.push(index);
   }else if(label.labelEndMs>fromMs-embargoMs){
    fold.embargoIndices.push(index);
   }else fold.trainIndices.push(index);
  });
  fold.fingerprint=digest({
   dataSplitId:DEVELOPMENT_SPLIT_ID,foldIndex,fromMs,toMs,embargoMs,
   orderedLabelIds:ordered.map(x=>x.id),
   train:fold.trainIndices,test:fold.testIndices,
   purged:fold.purgedIndices,embargoed:fold.embargoIndices,
   unresolved:fold.unresolvedTestIndices,future:fold.futureIndices
  });
  folds.push(fold);
 }
 return {
  dataSplitId:DEVELOPMENT_SPLIT_ID,developmentFromMs:DEVELOPMENT_FROM,
  developmentToMs:DEVELOPMENT_TO,embargoMs,
  orderedLabelIds:ordered.map(x=>x.id),
  foldFingerprint:digest({dataSplitId:DEVELOPMENT_SPLIT_ID,ordered,folds}),
  folds,excludedCount:folds.reduce((count,fold)=>
   count+fold.purgedIndices.length+fold.embargoIndices.length+fold.unresolvedTestIndices.length,0)
 };
}
export type SubmittedFoldSelection={
  foldIndex:number;
  trainIndices:readonly number[];
  testIndices:readonly number[];
};
/** Evidence must carry the *actual* indices used for every variant. The
 * verifier never accepts a post-hoc summary claiming the folds were purged. */
export function verifyPurgedFoldSelections(
 report:DevelopmentFoldReport,selections:readonly SubmittedFoldSelection[]
):void{
 if(!Array.isArray(selections)||selections.length!==report.folds.length)
  throw Error('All forward folds need recorded train/test selections');
 for(let i=0;i<report.folds.length;i++){
  const expected=report.folds[i]!,actual=selections[i]!;
  if(actual.foldIndex!==expected.foldIndex||
     !Array.isArray(actual.trainIndices)||!Array.isArray(actual.testIndices)||
     JSON.stringify(actual.trainIndices)!==JSON.stringify(expected.trainIndices)||
     JSON.stringify(actual.testIndices)!==JSON.stringify(expected.testIndices))
   throw Error('Unpurged or altered train/test indices at development fold '+i);
 }
}
