import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {digest} from '../provenance/build.js';
import {evaluateGates,type Evidence} from './gates.js';
import {buildPurgedDevelopmentFolds,verifyPurgedFoldSelections,
 type OutcomeLabel,type DevelopmentTestWindow,type SubmittedFoldSelection} from '../backtest/splits.js';
import {stageNumber,loadRegistry,versionOf,readStage,startEvaluation,finishEvaluation,rootPath,auditRegisteredVariants,stageFile,type Stage,type StageResult} from './registry.js';

function reports(root:string):string[] {
 const directory=rootPath(root,'data/backtests');
 if(!existsSync(directory))return [];
 return readdirSync(directory,{withFileTypes:true}).filter(d=>d.isDirectory()).flatMap(d=>{
  const file=join(directory,d.name,'report.json');
  return existsSync(file)?[file]:[];
 });
}
/** Stage 1 accepts only reproducible *recorded* fold membership for every
 * variant. A retrospective assertion without actual selected indices fails. */
export function adaptPurgedDevelopmentEvidence(root:string,evidence:Evidence):Evidence {
 if(evidence.stage!==1)throw Error('Purged development fold adapter is Stage 1 only');
 const splitBytes=readFileSync(rootPath(root,'docs/data-splits-v1.json'));
 const split=JSON.parse(splitBytes.toString('utf8')) as {
  version?:number;immutable?:boolean;development?:{start?:string;end?:string};
  validation?:{start?:string};holdout?:{start?:string};
 };
 if(split.version!==1||split.immutable!==true||
    split.development?.start!=='2020-01-01'||split.development?.end!=='2023-12-31'||
    split.validation?.start!=='2024-01-01'||split.holdout?.start!=='2025-01-01')
  throw Error('Changed or invalid immutable data-splits-v1 boundary');
 const metrics=evidence.metrics;
 const labels=metrics.developmentLabelWindows;
 const windows=metrics.developmentTestWindows;
 const embargoDays=metrics.developmentEmbargoDays;
 const byVariant=metrics.developmentFoldSelectionsByVariant;
 if(!Array.isArray(labels)||!labels.every(x=>x&&typeof x==='object'&&
     typeof x.id==='string'&&Number.isSafeInteger(x.labelStartMs)&&Number.isSafeInteger(x.labelEndMs))||
    !Array.isArray(windows)||!windows.every(x=>x&&typeof x==='object'&&
     Number.isSafeInteger(x.fromMs)&&Number.isSafeInteger(x.toMs))||
    typeof embargoDays!=='number'||!Number.isSafeInteger(embargoDays)||
    !Array.isArray(byVariant)||!byVariant.length||
    !byVariant.every(x=>x&&typeof x==='object'&&typeof x.variantId==='string'&&
     x.variantId.length>0&&Array.isArray(x.folds)))
  throw Error('Missing recorded label windows, fixed embargo or per-variant fold selections');
 const report=buildPurgedDevelopmentFolds(
  labels as OutcomeLabel[],windows as DevelopmentTestWindow[],embargoDays);
 if(!Number.isSafeInteger(metrics.variantsTested)||byVariant.length!==metrics.variantsTested||
    new Set(byVariant.map(x=>x.variantId)).size!==byVariant.length)
  throw Error('Variant counts do not match audited development folds');
 for(const variant of byVariant)
  verifyPurgedFoldSelections(report,variant.folds as SubmittedFoldSelection[]);
 const summary=report.folds.map(fold=>({
  foldIndex:fold.foldIndex,testFromMs:fold.testFromMs,testToMs:fold.testToMs,
  train:fold.trainIndices.length,test:fold.testIndices.length,
  purged:fold.purgedIndices.length,embargoed:fold.embargoIndices.length,
  unresolved:fold.unresolvedTestIndices.length,fingerprint:fold.fingerprint
 }));
 return {...evidence,metrics:{...metrics,purgedFoldAudit:{
   dataSplitId:report.dataSplitId,embargoMs:report.embargoMs,
   excludedCount:report.excludedCount,foldFingerprint:report.foldFingerprint,
   foldSummaries:summary}},
  dataHashes:{...evidence.dataHashes,purgedFolds:report.foldFingerprint,
   immutableDataSplit:digest(splitBytes)}};
}
function backtestEvidence(root:string,strategy:string,stage:1|2,variantsTested:number,hypothesisId:string,version:string):{evidence:Evidence|null;error:string|null;hash:string|null} {
 const pkg=JSON.parse(readFileSync(rootPath(root,'package.json'),'utf8')) as {scripts?:Record<string,string>};
 if(!pkg.scripts?.backtest)return {evidence:null,error:'Issue #5: pnpm backtest command is not installed; no backtest was executed',hash:null};
 const before=new Set(reports(root));
 const from=stage===1?'2020-01-01':'2024-01-01',to=stage===1?'2024-01-01':'2025-01-01';
 const result=spawnSync('pnpm',['backtest','--strategy',strategy,'--from',from,'--to',to,'--interval','15','--fill-model','conservative-ohlc','--trials',String(variantsTested),
  ...(stage===1?['--hypothesis',hypothesisId,'--candidate',strategy+'-'+version]:[])],{
  cwd:root,encoding:'utf8',timeout:15*60*1000,maxBuffer:1024*1024,env:{...process.env,LIVE_ENABLED:'false',AI_ALLOW_REMOTE:'false',LIVE_ACK:''}
 });
 if(result.error||result.status!==0)return {evidence:null,error:'Backtest invocation failed: '+String(result.error?.message??result.stderr?.slice(0,500)??result.status),hash:null};
 const next=reports(root).filter(f=>!before.has(f));
 if(next.length!==1)return {evidence:null,error:'Backtest did not create exactly one new data/backtests/*/report.json; cannot select a report',hash:null};
 const raw=readFileSync(next[0]!);
 const doc=JSON.parse(raw.toString('utf8')) as {pipelineEvidence?:unknown};
 if(!doc.pipelineEvidence)return {evidence:null,error:'Issue #5 report has no agreed pipelineEvidence adapter; refusing to infer missing DSR/PBO/benchmarks',hash:digest(raw)};
 assertEvidence(doc.pipelineEvidence);
 const adapted=stage===1?
  adaptPurgedDevelopmentEvidence(root,doc.pipelineEvidence):doc.pipelineEvidence;
 return {evidence:adapted,error:null,hash:digest(raw)};
}
function assertEvidence(value:unknown):asserts value is Evidence {
 if(!value||typeof value!=='object')throw Error('Malformed pipeline evidence');
 const e=value as Partial<Evidence>;
 if(typeof e.stage!=='number'||typeof e.strategyId!=='string'||typeof e.version!=='string'||
  typeof e.codeHash!=='string'||typeof e.configHash!=='string'||
  typeof e.periodFrom!=='string'||typeof e.periodToExclusive!=='string'||typeof e.source!=='string'||
  !e.metrics||typeof e.metrics!=='object'||Array.isArray(e.metrics)||
  !e.dataHashes||typeof e.dataHashes!=='object'||Array.isArray(e.dataHashes))throw Error('Malformed pipeline evidence');
}
function loadEvidence(root:string,path:string):{evidence:Evidence;hash:string} {
 const full=rootPath(root,path);
 if(!path.startsWith('data/')||!path.endsWith('.json'))throw Error('Evidence must be a local JSON file under data/ (not a network URL)');
 const raw=readFileSync(full);
 const parsed:unknown=JSON.parse(raw.toString('utf8'));
 assertEvidence(parsed);
 return {evidence:parsed,hash:digest(raw)};
}
export function evaluateStage(root:string,id:string,version:string,stage:Stage,options?:{
 evidencePath?:string; evidenceForTest?:Evidence|null; holdoutGuardForTest?:boolean; now?:number
}):StageResult {
 // Fixture injection is exclusively for offline tests; never a production bypass of #5 or #3.
 if(options&&('evidenceForTest' in options||'holdoutGuardForTest' in options)&&process.env.VITEST!=='true')
  throw Error('Test-only pipeline evidence injection is forbidden outside Vitest');
 // The production holdout must use the actual #3 guard, not a caller-provided boolean.
 // Only Vitest fixture injection may exercise the pure gate before #3 is merged.
 if(stage===3&&process.env.VITEST==='true'&&options&&'evidenceForTest' in options&&options.holdoutGuardForTest!==true)
  throw Error('Test-only stage 3 requires explicit holdout guard fixture');
 // Production Stage 3 uses only the guarded archive runner, never arbitrary supplied JSON.
 if(stage===3&&options?.evidencePath)throw Error('Stage 3 must run the one-time archived holdout directly; --evidence is forbidden');
 if((stage===1||stage===2)&&options?.evidencePath)throw Error('Stages 1/2 must invoke #5 backtest directly; --evidence cannot bypass it');
 const {entry,strategy}=startEvaluation(root,id,version,stage);
 let evidence:Evidence|null=null,hash:string|null=null,error:string|null=null;
 let auditVerified=false;
 try {
  if(options&&'evidenceForTest' in options){evidence=options.evidenceForTest??null;}
  else if(stage===3){
   const startedAt=Date.now();
   const auditPath=rootPath(root,'data/archive/holdout-access.jsonl');
   const previousLog=existsSync(auditPath)?readFileSync(auditPath,'utf8'):'';
   const command=spawnSync('pnpm',['--filter','@paper/server','exec','tsx','src/pipeline/holdout.ts',
    '--strategy',id,'--version',version],{cwd:root,encoding:'utf8',timeout:25*60*1000,
    maxBuffer:1024*1024,env:{...process.env,LIVE_ENABLED:'false',AI_ALLOW_REMOTE:'false',LIVE_ACK:''}});
   if(command.error||command.status!==0)throw Error('Archived holdout run failed; attempt is consumed: '+
    String(command.error?.message??command.stderr?.slice(0,500)??command.status));
   const nextLog=readFileSync(auditPath,'utf8');
   if(!nextLog.startsWith(previousLog))throw Error('Holdout audit log was rewritten');
   const added=nextLog.slice(previousLog.length).split('\n').filter(Boolean);
   auditVerified=added.some(line=>{
    try{const record=JSON.parse(line) as {at?:string;kind?:string;reason?:string};
     return record.kind==='holdout-allowed'&&record.reason==='pipeline stage 3'&&
      Date.parse(record.at??'')>=startedAt-1000;
    }catch{return false;}
   });
   if(!auditVerified)throw Error('Actual #3 holdout guard access was not recorded');
   const loaded=loadEvidence(root,`data/pipeline-holdout/${id}/${version}/evidence.json`);
   evidence=loaded.evidence;hash=loaded.hash;
   if(evidence.source!=='local:archive-holdout-guard')throw Error('Unexpected holdout evidence source');
  }
  else if(options?.evidencePath){const loaded=loadEvidence(root,options.evidencePath);evidence=loaded.evidence;hash=loaded.hash;}
  else if(stage===1||stage===2){const loaded=backtestEvidence(root,id,stage,entry.variantsTested,strategy.hypothesisId,version);evidence=loaded.evidence;hash=loaded.hash;error=loaded.error;}
  else if(stage===6){evidence={
   stage,strategyId:id,version,codeHash:entry.codeHash,configHash:entry.configHash,
   periodFrom:'2025-01-01',periodToExclusive:'2025-01-02',
   dataHashes:{previousResult:digest(JSON.stringify(readStage(root,id,version,5)))},
   metrics:{reportOnly:true,assessment:'erfüllt alle Kriterien',realMoneyUnlocked:false},source:'local:pipeline-readiness-report'
  };}
  else error='No required local paper/testnet evidence supplied with --evidence';
 }catch(e){error=String(e instanceof Error?e.message:e);}
 const hypothesis= strategy.benchmark?null:importHypothesis(root,strategy.hypothesisId);
 const previous=readStage(root,id,version,1);
 const held=readStage(root,id,version,3);
 const gates=evaluateGates({stage,entry,hypothesisVerified:!!hypothesis,previous:previous?.metrics??null,
  previousStage3:held?.status==='passed'?{passedAt:held.evaluatedAt}:null,
  holdoutGuardVerified:auditVerified||options?.holdoutGuardForTest===true},evidence);
 const checks=[...gates.checks];
 // Genuine Stage-1 model selection requires an independent trial ledger.
 // Vitest's explicitly injected fixture evidence remains isolated from production.
 if(stage===1&&!(process.env.VITEST==='true'&&options&&'evidenceForTest' in options)){
  try{
   const audit=auditRegisteredVariants(root,id,version);
   checks.push({id:'research_variant_audit',passed:audit.complete,
    actual:{uniqueVariants:audit.uniqueVariants,replays:audit.replays,
     unfinished:audit.unfinished,baselineVariants:audit.baselineVariants,
     registered:entry.variantsTested,fingerprint:audit.fingerprint,reason:audit.reason},
    expected:'append-only documented, complete variantsTested with no unknown historical baseline or unfinished runs'});
  }catch(error){
   checks.push({id:'research_variant_audit',passed:false,
    actual:String(error instanceof Error?error.message:error),
    expected:'valid complete immutable variant journal'});
  }
 }
 if(evidence)checks.push({id:'evidence_identity',passed:evidence.strategyId===id&&evidence.version===version,
   actual:evidence.strategyId+'/'+evidence.version,expected:id+'/'+version});
 if(error)checks.push({id:'source_error',passed:false,actual:error,expected:'complete local evidence from upstream issue'});
 const reasons=checks.filter(c=>!c.passed).map(c=>c.id+': expected '+c.expected);
 const result:StageResult={formatVersion:1,strategyId:id,version,stage,
  status:reasons.length?'failed':'passed',evaluatedAt:new Date(options?.now??Date.now()).toISOString(),
  codeHash:entry.codeHash,configHash:entry.configHash,variantsTested:entry.variantsTested,
  metrics:evidence?.metrics??{},dataHashes:evidence?.dataHashes??{},checks,reasons,
  evidenceHash:hash,source:evidence?.source??'local:missing-upstream-evidence'};
 return finishEvaluation(root,result);
}
import {loadHypothesis as importHypothesis} from './registry.js';
export function statusTable(root:string,now=Date.now()):string {
 const registry=loadRegistry(root);
 const lines=['Strategie | Version | Stufe | Status | Nächster Schritt','--- | --- | --- | --- | ---'];
 for(const strategy of registry.strategies)for(const version of strategy.versions){
  const stage=version.stage,status=version.status;
  let next=status==='failed'?'Keine Wiederholung; neue Version ab Stufe 1 registrieren':
   strategy.benchmark?'Benchmark, nicht in der Pipeline':
   stage===1?'Entwicklung 2020–2023 prüfen':
   stage===2?'Validierung 2024 einmalig prüfen':
   stage===3?'Holdout einmalig über #3-Sperre prüfen':
   stage===4?'Paper: 90 Tage, Version einfrieren und #12 überwachen':
   stage===5?'Testnet: 28 Tage, #9 Reconciliation prüfen':
   status==='passed'?'Nur Readiness-Bericht; keine Echtgeld-Freigabe':'Readiness-Bericht erstellen';
  if(stage===4&&status!=='failed'){
   const started=readStage(root,strategy.id,version.version,3)?.evaluatedAt;
   if(started){const days=Math.max(0,Math.floor((now-Date.parse(started))/86400000));next=`Paper: frühestens ${Math.min(days,90)} von 90 Tagen seit Holdout; tatsächlicher Paper-Start ist separat nachzuweisen`;}
  }
  const unresolved=version.consumedStages.includes(stage)&&
   !existsSync(stageFile(root,strategy.id,version.version,stage));
  if(unresolved){
   const reservedAt=version.attemptReservations?.[String(stage)]?.reservedAt??'Zeitpunkt unbekannt (Legacy)';
   next='UNGEKLÄRT: Stage '+stage+' seit '+reservedAt+
    ' reserviert, ohne Ergebnis; genaue Ursache unbekannt. Niemals erneut ausführen, neue Version separat registrieren';
  }
  lines.push([strategy.id,version.version,String(stage),
   unresolved?'reserved-unresolved':status,next].join(' | '));
 }
 return lines.join('\n');
}
