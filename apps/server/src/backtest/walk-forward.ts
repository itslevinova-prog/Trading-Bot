import {createHash} from 'node:crypto';
import {runBacktest,type BacktestOptions,type BacktestResult} from './runner.js';
import {
 buildPurgedDevelopmentFolds,DEVELOPMENT_FROM,DEVELOPMENT_TO,
 type OutcomeLabel,type DevelopmentFoldReport
} from './splits.js';

const DAY=86_400_000;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const WALK_FORWARD_VERSION='development-walk-forward-v1' as const;
export type WalkForwardSchedule={
 /** Frozen before any replays; does not use observed strategy returns. */
 trainDays:number;testDays:number;stepDays:number;embargoDays:number;
};
export const DEFAULT_WALK_FORWARD_SCHEDULE:Readonly<WalkForwardSchedule>=Object.freeze({
 trainDays:180,testDays:90,stepDays:90,embargoDays:3
});
export type WalkForwardFold={
 index:number;trainFromMs:number;trainToMs:number;testFromMs:number;testToMs:number;
 trainLabelIds:string[];testLabelIds:string[];
 purgedLabels:number;embargoedLabels:number;unresolvedTestLabels:number;
 splitFingerprint:string;
};
export type WalkForwardPlan={
 version:typeof WALK_FORWARD_VERSION;
 schedule:WalkForwardSchedule;
 fromMs:number;toMs:number;
 dataSplitId:string;
 splitFingerprint:string;
 folds:WalkForwardFold[];
 purge:DevelopmentFoldReport;
};
export type WalkForwardDiagnostic={
 index:number;status:'available'|'unavailable';
 testFromMs:number;testToMs:number;
 candidateNetReturn:number|null;btcNetReturn:number|null;
 netExcess:number|null;
 candidateTrades:number|null;benchmarkTrades:number|null;
 candidateRejections:number|null;
 costs:{fees:number;spread:number;slippage:number;total:number}|null;
 coverage:{status:string;fingerprint:string|null;closedBars:number}|null;
 inputHash:string|null;
 frozenConfigurationHash:string;
 trainLabelIds:string[];testLabelIds:string[];
 excludedLabels:number;
 reason:string|null;
};
export type WalkForwardReport={
 version:typeof WALK_FORWARD_VERSION;
 status:'complete'|'insufficient_evidence';
 splitFingerprint:string;
 dataSplitId:string;
 frozenConfigurationHash:string;
 providerId:string;
 schedule:WalkForwardSchedule;
 folds:WalkForwardDiagnostic[];
 note:string;
};

function checkSchedule(s:WalkForwardSchedule){
 if(![s.trainDays,s.testDays,s.stepDays,s.embargoDays].every(Number.isSafeInteger)||
    s.trainDays<1||s.testDays<1||s.stepDays<s.testDays||s.embargoDays<0||
    s.trainDays>730||s.testDays>365||s.stepDays>365||s.embargoDays>30)
  throw Error('Invalid precommitted rolling train/test/step/embargo days');
}
function checkRange(fromMs:number,toMs:number){
 if(!Number.isSafeInteger(fromMs)||!Number.isSafeInteger(toMs)||
    fromMs<DEVELOPMENT_FROM||toMs>DEVELOPMENT_TO||fromMs>=toMs||
    fromMs%DAY!==0||toMs%DAY!==0)
  throw Error('Walk-forward restricted to whole UTC days of development 2020-2023');
}
/** Generate disjoint evaluation windows with one-sided purge and embargo evidence. */
export function planDevelopmentWalkForward(
 fromMs:number,toMs:number,labels:readonly OutcomeLabel[],
 schedule:WalkForwardSchedule=DEFAULT_WALK_FORWARD_SCHEDULE
):WalkForwardPlan {
 // Fail closed before reading any archive or triggering a strategy provider.
 checkRange(fromMs,toMs);checkSchedule(schedule);
 const windows:Array<{fromMs:number;toMs:number}>=[];
 const start=fromMs+(schedule.trainDays+schedule.embargoDays)*DAY;
 for(let testFrom=start;testFrom+schedule.testDays*DAY<=toMs;testFrom+=schedule.stepDays*DAY)
  windows.push({fromMs:testFrom,toMs:testFrom+schedule.testDays*DAY});
 if(!windows.length)throw Error('Insufficient development observations for precommitted walk-forward windows');
 const purge=buildPurgedDevelopmentFolds(labels,windows,schedule.embargoDays);
 const byId=new Map(labels.map(label=>[label.id,label]));
 const folds=purge.folds.map((fold,index):WalkForwardFold=>{
  const trainFromMs=fold.testFromMs-(schedule.trainDays+schedule.embargoDays)*DAY;
  const trainToMs=fold.testFromMs-schedule.embargoDays*DAY;
  const trainLabelIds=fold.trainIndices.map(i=>purge.orderedLabelIds[i]!)
   .filter(id=>{
    const label=byId.get(id)!;
    return label.labelStartMs>=trainFromMs&&label.labelEndMs<=trainToMs;
   });
  return {
   index,trainFromMs,trainToMs,testFromMs:fold.testFromMs,testToMs:fold.testToMs,
   trainLabelIds,testLabelIds:fold.testIndices.map(i=>purge.orderedLabelIds[i]!),
   purgedLabels:fold.purgedIndices.length,embargoedLabels:fold.embargoIndices.length,
   unresolvedTestLabels:fold.unresolvedTestIndices.length,
   splitFingerprint:fold.fingerprint
  };
 });
 const splitFingerprint=hash({version:WALK_FORWARD_VERSION,fromMs,toMs,schedule,
  purged:purge.foldFingerprint,folds});
 return {version:WALK_FORWARD_VERSION,schedule:{...schedule},fromMs,toMs,
  dataSplitId:purge.dataSplitId,splitFingerprint,folds,purge};
}
function fillCosts(result:BacktestResult){
 const fees=result.trades.reduce((sum,t)=>sum+t.fee,0);
 const spread=result.trades.reduce((sum,t)=>sum+t.spreadCost,0);
 const slippage=result.trades.reduce((sum,t)=>sum+t.slippageCost,0);
 if(![fees,spread,slippage].every(x=>Number.isFinite(x)&&x>=0))throw Error('Invalid recorded fill costs');
 return {fees,spread,slippage,total:fees+spread+slippage};
}
/**
 * Pure diagnostic runner: a single unchanged provider/configuration is replayed
 * per test fold. Train labels are eligibility evidence only, never fitted here.
 * The BTC hold reference uses the same market clock and cost assumptions.
 */
export async function runDevelopmentWalkForward(input:{
 options:BacktestOptions;labels:readonly OutcomeLabel[];
 schedule?:WalkForwardSchedule;providerId:string;
}):Promise<WalkForwardReport>{
 const {options,labels,providerId}=input;
 const plan=planDevelopmentWalkForward(options.fromMs,options.toMs,labels,input.schedule);
 if(typeof providerId!=='string'||!/^[a-zA-Z0-9_.:-]{4,100}$/.test(providerId))
  throw Error('A stable preregistered provider ID is required before running walk-forward');
 const frozenConfigurationHash=hash({
  providerId,strategy:options.strategy,intervalMinutes:options.intervalMinutes,
  feeRate:options.feeRate??.001,spreadBps:options.spreadBps??10,
  slippageBps:options.slippageBps??8,fillModel:options.fillModel??'conservative-ohlc',
  quoteCurrency:options.quoteCurrency??'EUR',seed:options.seed??1,
  trials:options.trials??1,riskLimits:options.riskLimits??null,
  buildId:options.buildId??null,coverageRequired:options.enforceResearchCoverage??false,
  universeMode:options.universeAt?'point-in-time':'static'
 });
 const diagnostic:WalkForwardDiagnostic[]=[];
 for(const fold of plan.folds){
  const basic={index:fold.index,testFromMs:fold.testFromMs,testToMs:fold.testToMs,
   frozenConfigurationHash,trainLabelIds:fold.trainLabelIds,testLabelIds:fold.testLabelIds,
   excludedLabels:fold.purgedLabels+fold.embargoedLabels+fold.unresolvedTestLabels};
  const unavailable=(reason:string):WalkForwardDiagnostic=>({
   ...basic,status:'unavailable',candidateNetReturn:null,btcNetReturn:null,
   netExcess:null,candidateTrades:null,benchmarkTrades:null,candidateRejections:null,
   costs:null,coverage:null,inputHash:null,reason
  });
  if(!fold.trainLabelIds.length||!fold.testLabelIds.length||fold.unresolvedTestLabels)
  {
   diagnostic.push(unavailable('n/a: Train-/Test-Labels fehlen oder Test-Outcome reicht über den Fold hinaus'));
   continue;
  }
  try{
   const period={fromMs:fold.testFromMs,toMs:fold.testToMs};
   const strategy=await runBacktest({...options,...period});
   const btc=await runBacktest({...options,...period,strategy:'hold',provider:undefined});
   if(strategy.fingerprints.data!==btc.fingerprints.data)
    throw Error('Candidate and BTC benchmark input fingerprints differ');
   // An incomplete last day or interrupted event clock is not full fold coverage.
   const step=options.intervalMinutes*60_000;
   const expectedBars=(fold.testToMs-fold.testFromMs)/step;
   const completeTestClock=(run:BacktestResult)=>{
    // The runner can legitimately include a warm-up candle closing at the
    // evaluation boundary; evaluate only closes strictly inside the test fold.
    const observed=run.equity.slice(1).filter(point=>
      point.ts>fold.testFromMs&&point.ts<=fold.testToMs);
    return observed.length===expectedBars &&
      observed.every((point,index)=>point.ts===fold.testFromMs+(index+1)*step);
   };
   if(!Number.isSafeInteger(expectedBars)||expectedBars<1||
      !completeTestClock(strategy)||!completeTestClock(btc))
    throw Error('Incomplete closed-bar clock across the requested test fold');
   if(!btc.trades.some(trade=>trade.side==='buy'&&
      (trade.symbol==='BTC/'+(options.quoteCurrency??'EUR')||
       trade.symbol==='BTC'+(options.quoteCurrency??'EUR'))))
    throw Error('BTC benchmark was not executable on this fold');
   if(![strategy.metrics.netReturn,btc.metrics.netReturn].every(Number.isFinite))
    throw Error('Non-finite fold net return');
   diagnostic.push({...basic,status:'available',
    candidateNetReturn:strategy.metrics.netReturn,
    btcNetReturn:btc.metrics.netReturn,
    netExcess:strategy.metrics.netReturn-btc.metrics.netReturn,
    candidateTrades:strategy.trades.length,benchmarkTrades:btc.trades.length,
    candidateRejections:strategy.rejections.length,costs:fillCosts(strategy),
    coverage:{status:strategy.coverage?.status??'not_verified',
     fingerprint:strategy.coverage?.fingerprint??null,closedBars:strategy.equity.length-1},
    inputHash:strategy.fingerprints.data,reason:null});
  }catch(error){
   diagnostic.push(unavailable('n/a: Fold-Replay fehlgeschlagen: '+(error instanceof Error?error.message:String(error))));
  }
 }
 return {version:WALK_FORWARD_VERSION,
  status:diagnostic.length===plan.folds.length&&diagnostic.every(f=>f.status==='available')?
   'complete':'insufficient_evidence',
  splitFingerprint:plan.splitFingerprint,dataSplitId:plan.dataSplitId,
  frozenConfigurationHash,providerId,schedule:{...plan.schedule},folds:diagnostic,
  note:'Nur Diagnose; negative Folds und fehlende Coverage bleiben sichtbar. Kein Tuning auf Testfalten, keine Gate-Lockerung oder 2024/2025+ Ausführung.'};
}
