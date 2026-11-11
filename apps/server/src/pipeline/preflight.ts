import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadRegistry,versionOf,readStage,stageFile,computeCodeHash,
 computeConfigHash,type Stage} from './registry.js';

export type PreflightCheck={id:string;passed:boolean;message:string};
export type PreflightResult={
 strategyId:string;version:string;stage:Stage;
 eligible:boolean;checks:PreflightCheck[];advisories:string[];
 attemptState:'not-started'|'reserved-unresolved'|'completed'|'orphan-result';
 unresolvedIncident:InterruptedStageIncident|null;
 irreversibleIfStarted:true;performedEvaluation:false;accessedMarketData:false;
};
/** Non-consuming inspection. Never opens an archive, invokes a backtest, touches
 * holdout, reserves a stage, writes registry or synthesizes evidence. */
export function preflightStage(root:string,id:string,version:string,stage:Stage):PreflightResult {
 const {strategy,entry}=versionOf(loadRegistry(root),id,version);
 const checks:PreflightCheck[]=[];
 const add=(id:string,passed:boolean,message:string)=>checks.push({id,passed,message});
 const stageFileExists=existsSync(stageFile(root,id,version,stage));
 const consumed=entry.consumedStages.includes(stage);
 const attemptState=consumed&&!stageFileExists?'reserved-unresolved':
  consumed&&stageFileExists?'completed':
  !consumed&&stageFileExists?'orphan-result':'not-started';
 const unresolvedIncident=attemptState==='reserved-unresolved'?
  incidentFor(id,version,stage,entry.attemptReservations?.[String(stage)]?.reservedAt??null):null;
 add('candidate',!strategy.benchmark,'Benchmarks cannot advance in the pipeline');
 add('reservation_unresolved',attemptState!=='reserved-unresolved',
  'A reserved Stage with no report is permanently consumed; exact failure cause unknown');
 add('orphan_result',attemptState!=='orphan-result',
  'A Stage file without matching reservation is not a valid first run');
 add('registered_stage',entry.stage===stage&&entry.status!=='failed'&&
  !entry.consumedStages.includes(stage),
  'Requested stage must be registered and unconsumed');
 add('stage_result_absent',!stageFileExists,
  'Create-only result file must not already exist');
 let codeMatches=false;
 try{codeMatches=computeCodeHash(root,id)===entry.codeHash;}catch{/* Unknown is not a pass. */}
 add('code_hash',codeMatches,'Code hash must match the frozen registration');
 let configMatches=false;
 try{configMatches=computeConfigHash(entry.config)===entry.configHash;}catch{/* Unknown is not a pass. */}
 add('config_hash',configMatches,'Config hash must match the frozen registration');
 if(stage>1){
  let previous:ReturnType<typeof readStage>=null,integrityError:string|null=null;
  try{previous=readStage(root,id,version,(stage-1) as Stage);}
  catch(error){integrityError=String(error instanceof Error?error.message:error);}
  add('previous_stage_integrity',integrityError===null,
   integrityError??'Prior Stage must have a verified registry-anchored integrity hash');
  add('previous_gate',integrityError===null&&!!previous&&previous.status==='passed'&&previous.stage===stage-1&&
   previous.strategyId===id&&previous.version===version&&
   previous.codeHash===entry.codeHash&&previous.configHash===entry.configHash,
   'Previous stage must have passed with the identical immutable version');
 }
 const advisories=[
  'Read-only inspection, not a validation or performance gate.',
  'An actual evaluate consumes the one-time stage even if upstream evidence is absent or failed.'
 ];
 if(stage===1||stage===2)advisories.push(
  'Verify the independent #5 backtest report produces pipelineEvidence; missing DSR, PBO, cost and benchmark proofs are a legitimate failed attempt.');
 if(stage===3)advisories.push(
  'Holdout remains locked: this command must never access data from 2025 onward. An actual stage-3 attempt consumes the one-time archive permission.');
 if(stage===4)advisories.push('Requires a real frozen 90-day paper record and #12 monitoring proof, not synthetic metrics.');
 if(stage===5)advisories.push('Requires 28-day testnet, #9 reconciliation and paper-shadow evidence, not API keys in this repository.');
 if(stage===6)advisories.push('Readiness is report-only; live trading is not enabled.');
 return {strategyId:id,version,stage,
  eligible:checks.every(x=>x.passed),checks,advisories,attemptState,unresolvedIncident,
  irreversibleIfStarted:true,performedEvaluation:false,accessedMarketData:false};
}

export type InterruptedStageIncident={
 strategyId:string;version:string;stage:Stage;
 reservedAt:string|null;
 status:'reserved-unresolved';
 cause:'Stage was reserved but no durable result is present; exact cause unknown';
 irreversible:true;allowedRecovery:'Register an independently reviewed new strategy version; never replay this consumed Stage';
};
function incidentFor(strategyId:string,version:string,stage:Stage,reservedAt:string|null):InterruptedStageIncident{
 return {strategyId,version,stage,reservedAt,status:'reserved-unresolved',
  cause:'Stage was reserved but no durable result is present; exact cause unknown',
  irreversible:true,
  allowedRecovery:'Register an independently reviewed new strategy version; never replay this consumed Stage'};
}
export type InterruptedStageReport={
 status:'clear'|'unresolved';
 inspectedReservations:number;unresolved:number;
 fingerprint:string;incidents:InterruptedStageIncident[];
};
/** Pure local inspection, including stage-3 reservations. The function never
 * opens a data archive, invokes a pipeline stage or changes registry/stage files. */
export function inspectInterruptedStages(root:string):InterruptedStageReport{
 const registry=loadRegistry(root),incidents:InterruptedStageIncident[]=[];
 let inspectedReservations=0;
 for(const strategy of registry.strategies){
  for(const version of strategy.versions){
   for(const stage of version.consumedStages){
    inspectedReservations++;
    if(!existsSync(stageFile(root,strategy.id,version.version,stage)))
     incidents.push(incidentFor(strategy.id,version.version,stage,
      version.attemptReservations?.[String(stage)]?.reservedAt??null));
   }
  }
 }
 incidents.sort((a,b)=>a.strategyId.localeCompare(b.strategyId)||
  a.version.localeCompare(b.version)||a.stage-b.stage);
 const fingerprint=createHash('sha256').update(JSON.stringify({inspectedReservations,incidents})).digest('hex');
 return {status:incidents.length?'unresolved':'clear',
  inspectedReservations,unresolved:incidents.length,fingerprint,incidents};
}
