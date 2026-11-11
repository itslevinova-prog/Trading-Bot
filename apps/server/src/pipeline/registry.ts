import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync,readdirSync,lstatSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {digest} from '../provenance/build.js';
import {auditResearchVariants,type VariantAudit} from './variants-audit.js';

export type Stage = 1|2|3|4|5|6;
export type PipelineStatus = 'registered'|'passed'|'failed';
export type PipelineVersion = {version:string;configHash:string;codeHash:string;createdAt:string;stage:Stage;status:PipelineStatus;variantsTested:number;config:Record<string,unknown>;consumedStages:Stage[];stageReportHashes?:Record<string,string>;
 /** Durable reservation remains even if the process crashes before writing a report. */
 attemptReservations?:Record<string,{reservedAt:string;codeHash:string;configHash:string}>};
export type StrategyRecord = {id:string;hypothesisId:string;description:string;benchmark:boolean;versions:PipelineVersion[]};
export type HypothesisCount = {variantsTested:number;baselineVerified:boolean};
export type Registry = {formatVersion:1;hypotheses:Record<string,HypothesisCount>;strategies:StrategyRecord[]};
export type StageCheck = {id:string;passed:boolean;actual:unknown;expected:string};
export type StageResult = {formatVersion:1;strategyId:string;version:string;stage:Stage;status:'passed'|'failed';evaluatedAt:string;codeHash:string;configHash:string;variantsTested:number;metrics:Record<string,unknown>;dataHashes:Record<string,string>;checks:StageCheck[];reasons:string[];evidenceHash:string|null;source:string;integrityHash?:string};
const ID=/^[a-z][a-z0-9-]{0,63}$/;
const VERSION=/^v[1-9][0-9]*$/;
export function stageNumber(value:string):Stage {
 const stage=Number(value);
 if(!Number.isInteger(stage)||stage<1||stage>6)throw Error('Stage must be 1..6');
 return stage as Stage;
}
export function validateId(id:string,version?:string) {
 if(!ID.test(id)||id.includes('..')||(version!==undefined&&!VERSION.test(version)))throw Error('Invalid strategy/version identifier');
}
export function rootPath(root:string,path:string):string {
 const dest=resolve(root,path),rel=relative(root,dest);
 if(isAbsolute(path)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\'))throw Error('Path outside repository');
 return dest;
}
const registryPath='docs/strategies/registry.json';
export function emptyRegistry():Registry{return {formatVersion:1,hypotheses:{},strategies:[]};}
export function loadRegistry(root:string):Registry {
 const path=rootPath(root,registryPath);
 if(!existsSync(path))return emptyRegistry();
 const value=JSON.parse(readFileSync(path,'utf8')) as Registry;
 if(value.formatVersion!==1||!Array.isArray(value.strategies)||!value.hypotheses||typeof value.hypotheses!=='object')throw Error('Invalid registry');
 return value;
}
function saveRegistry(root:string,registry:Registry) {
 const path=rootPath(root,registryPath);mkdirSync(dirname(path),{recursive:true});
 const tmp=path+'.'+process.pid+'.tmp';
 try{writeFileSync(tmp,JSON.stringify(registry,null,2)+'\n',{flag:'wx'});renameSync(tmp,path);}
 finally{if(existsSync(tmp))unlinkSync(tmp);}
}
export function locked<T>(root:string,fn:()=>T):T {
 const path=rootPath(root,'docs/strategies/.pipeline.lock');mkdirSync(dirname(path),{recursive:true});
 const fd=openSync(path,'wx');
 try{return fn();}finally{closeSync(fd);unlinkSync(path);}
}
const strategyFiles:Record<string,string[]>={
 rules:['apps/server/src/strategy/providers.ts','apps/server/src/strategy/quality.ts'],
 hold:['apps/server/src/strategy/providers.ts'],
 // The independent trend provider is registered separately from the legacy rules.
 'trend-vol-target':['apps/server/src/strategy/trend-vol-target-v1.ts']
};
function walkSources(root:string,path:string):string[] {
 const full=rootPath(root,path);
 if(!existsSync(full))throw Error('Strategy source missing: '+path);
 const stat=lstatSync(full);
 if(stat.isSymbolicLink())throw Error('Symlink in strategy source: '+path);
 if(stat.isDirectory())return readdirSync(full).sort().flatMap(name=>walkSources(root,path+'/'+name));
 return /\.(ts|tsx|json)$/.test(path)?[path]:[];
}
export function computeCodeHash(root:string,id:string):string {
 validateId(id);
 const sources=strategyFiles[id]??['apps/server/src/strategy/'+id+'.ts'];
 // Freeze all existing executable context, fill, risk, backtest and archive sources.
 // Changes to pipeline/reporting code alone do not invalidate the strategy hash.
 const dependencies=['apps/server/src/strategy','apps/server/src/context','apps/server/src/market',
  'apps/server/src/broker','apps/server/src/backtest','apps/server/src/archive',
  'apps/server/src/config.ts','packages/shared/src'];
 const files=[...sources,...dependencies.filter(name=>existsSync(rootPath(root,name)))].flatMap(name=>walkSources(root,name));
 if(!files.length)throw Error('No source files for strategy '+id);
 const hashes=[...new Set(files)].sort().map(path=>{
  const bytes=readFileSync(rootPath(root,path));
  // Git blob identity over actual bytes, followed by SHA-256 over the canonical manifest.
  const blobSha=createHash('sha1').update('blob '+bytes.length).update(Buffer.from([0])).update(bytes).digest('hex');
  return {path,blobSha};
 });
 return digest(JSON.stringify(hashes));
}
export function computeConfigHash(config:Record<string,unknown>):string {
 const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)])):value;
 return digest(JSON.stringify(canonical(config)));
}
export function loadHypothesis(root:string,id:string):{id:string;variantsTested:number;economicRationale:string;successThreshold:string;killCriterion:string}|null {
 const path=rootPath(root,'docs/research/hypotheses.json');
 if(!existsSync(path))return null;
 const raw=JSON.parse(readFileSync(path,'utf8')) as unknown;
 const entries=Array.isArray(raw)?raw:(raw&&typeof raw==='object'&&'hypotheses' in raw?(raw as {hypotheses:unknown}).hypotheses:[]);
 if(!Array.isArray(entries))return null;
 const h=entries.find((entry:unknown)=>!!entry&&typeof entry==='object'&&(entry as {id?:unknown}).id===id) as Record<string,unknown>|undefined;
 return h&&Number.isSafeInteger(h.variantsTested)&&Number(h.variantsTested)>=0&&
  h.status!=='rejected'&&typeof h.economicRationale==='string'&&h.economicRationale.trim()&&typeof h.successThreshold==='string'&&h.successThreshold.trim()&&typeof h.killCriterion==='string'&&h.killCriterion.trim()?
  {id,variantsTested:h.variantsTested as number,economicRationale:h.economicRationale,successThreshold:h.successThreshold,killCriterion:h.killCriterion}:null;
}
export function register(root:string,input:{id:string;version:string;hypothesisId:string;description:string;benchmark?:boolean;config?:Record<string,unknown>},now=Date.now()):PipelineVersion {
 validateId(input.id,input.version);
 if(!input.hypothesisId||!input.description?.trim())throw Error('Hypothesis and description required');
 if(input.id==='hold'&&!input.benchmark)throw Error('Buy & Hold must be marked benchmark');
 const config=input.config??{},codeHash=computeCodeHash(root,input.id),configHash=computeConfigHash(config);
 return locked(root,()=>{
  const registry=loadRegistry(root);
  let strategy=registry.strategies.find(s=>s.id===input.id);
  if(strategy&&(strategy.hypothesisId!==input.hypothesisId||strategy.benchmark!==!!input.benchmark))throw Error('Strategy identity/hypothesis changed; create a distinct strategy ID');
  if(strategy?.versions.some(v=>v.version===input.version))throw Error('Version already exists; a code or parameter change needs a new version');
  if(strategy?.versions.some(v=>v.codeHash===codeHash&&v.configHash===configHash))throw Error('Identical code/config cannot be re-registered to bypass a failed or one-shot gate');
  const hypothesis=loadHypothesis(root,input.hypothesisId);
  if(!input.benchmark&&!hypothesis)
   throw Error('Hypothesis is missing, invalid or rejected in #6; registration is not permitted');
  let count=registry.hypotheses[input.hypothesisId];
  if(!count){count={variantsTested:hypothesis?.variantsTested??0,baselineVerified:!!hypothesis};registry.hypotheses[input.hypothesisId]=count;}
  // The #6 baseline is historical, not an invitation to reset the count.
  if(hypothesis) {count.variantsTested=Math.max(count.variantsTested,hypothesis.variantsTested);count.baselineVerified=true;}
  count.variantsTested++;
  const entry:PipelineVersion={version:input.version,configHash,codeHash,createdAt:new Date(now).toISOString(),stage:1,status:'registered',variantsTested:count.variantsTested,config,consumedStages:[],stageReportHashes:{},attemptReservations:{}};
  if(!strategy){strategy={id:input.id,hypothesisId:input.hypothesisId,description:input.description,benchmark:!!input.benchmark,versions:[]};registry.strategies.push(strategy);}
  strategy.versions.push(entry);
  saveRegistry(root,registry);
  return entry;
 });
}
export function versionOf(registry:Registry,id:string,version:string):{strategy:StrategyRecord;entry:PipelineVersion} {
 const strategy=registry.strategies.find(s=>s.id===id),entry=strategy?.versions.find(v=>v.version===version);
 if(!strategy||!entry)throw Error('Unknown registered strategy/version');
 return {strategy,entry};
}
export function stageFile(root:string,id:string,version:string,stage:Stage):string {
 validateId(id,version);return rootPath(root,`docs/strategies/${id}/${version}/stage-${stage}.json`);
}
export function readStage(root:string,id:string,version:string,stage:Stage):StageResult|null {
 const file=stageFile(root,id,version,stage);
 if(!existsSync(file))return null;
 // Read-only integrity gate: never attempt to rewrite an old or manipulated file.
 let value:unknown;
 try{value=JSON.parse(readFileSync(file,'utf8'));}catch{throw Error('Stage integrity alarm: corrupt JSON');}
 if(!value||typeof value!=='object'||Array.isArray(value))
  throw Error('Stage integrity alarm: invalid stage result');
 const report=value as StageResult;
 const invalid=(message:string):never=>{throw Error('Stage integrity alarm: '+message);};
 if(report.formatVersion!==1||report.strategyId!==id||report.version!==version||
    report.stage!==stage||!['passed','failed'].includes(report.status)||
    typeof report.evaluatedAt!=='string'||!Number.isFinite(Date.parse(report.evaluatedAt))||
    !Number.isSafeInteger(report.variantsTested)||report.variantsTested<0||
    typeof report.codeHash!=='string'||! /^[a-f0-9]{64}$/.test(report.codeHash)||
    typeof report.configHash!=='string'||! /^[a-f0-9]{64}$/.test(report.configHash)||
    !Array.isArray(report.checks)||report.checks.length===0||
    !Array.isArray(report.reasons)||report.reasons.some(x=>typeof x!=='string')||
    !report.metrics||typeof report.metrics!=='object'||Array.isArray(report.metrics)||
    !report.dataHashes||typeof report.dataHashes!=='object'||Array.isArray(report.dataHashes)||
    Object.values(report.dataHashes).some(x=>typeof x!=='string'||! /^[a-f0-9]{64}$/.test(x))||
    typeof report.source!=='string'||!report.source.startsWith('local:')||
    report.evidenceHash!==null&&(typeof report.evidenceHash!=='string'||! /^[a-f0-9]{64}$/.test(report.evidenceHash)))
  invalid('invalid schema, identity or evidence hash');
 if(report.checks.some(x=>!x||typeof x.id!=='string'||!x.id||
      typeof x.passed!=='boolean'||typeof x.expected!=='string')||
    new Set(report.checks.map(x=>x.id)).size!==report.checks.length)
  invalid('corrupt checks');
 const allPassed=report.checks.every(x=>x.passed);
 if((report.status==='passed')!==allPassed||
    JSON.stringify(report.reasons)!==JSON.stringify(report.checks.filter(x=>!x.passed).map(x=>x.id+': expected '+x.expected)))
  invalid('status and checks disagree');
 const {entry}=versionOf(loadRegistry(root),id,version);
 if(entry.codeHash!==report.codeHash||entry.configHash!==report.configHash||
    entry.variantsTested!==report.variantsTested||!entry.consumedStages.includes(stage))
  invalid('stage identity does not match immutable registry registration');
 const anchored=entry.stageReportHashes?.[String(stage)];
 if(!anchored||typeof report.integrityHash!=='string')
  invalid('legacy stage result lacks independently anchored integrity; fail closed');
 const {integrityHash,...body}=report;
 if(digest(JSON.stringify(body))!==integrityHash||anchored!==integrityHash)
  invalid('stage report content differs from registry integrity anchor');
 return report;
}
export function startEvaluation(root:string,id:string,version:string,stage:Stage) {
 return locked(root,()=>{
  const registry=loadRegistry(root),{strategy,entry}=versionOf(registry,id,version);
  if(strategy.benchmark)throw Error('Benchmark is not a pipeline candidate');
  if(stage!==entry.stage||entry.status==='failed'||entry.consumedStages.includes(stage)||existsSync(stageFile(root,id,version,stage)))throw Error('Stage already consumed or not eligible');
  if(stage>1){
   const previous=readStage(root,id,version,(stage-1) as Stage);
   if(!previous||previous.status!=='passed'||previous.codeHash!==entry.codeHash||previous.configHash!==entry.configHash||
    previous.stage!==stage-1||previous.strategyId!==id||previous.version!==version)throw Error('Previous gate has not passed with matching version identity');
  }
  if(computeCodeHash(root,id)!==entry.codeHash||computeConfigHash(entry.config)!==entry.configHash)throw Error('Code/config changed: register a new version');
  // Durable attempt reservation before touching validation/holdout data. Never cleared on failure.
  entry.consumedStages.push(stage);
  entry.attemptReservations??={};
  if(entry.attemptReservations[String(stage)])throw Error('Stage reservation already exists; never reset attempts');
  entry.attemptReservations[String(stage)]={
    reservedAt:new Date().toISOString(),codeHash:entry.codeHash,configHash:entry.configHash
  };
  saveRegistry(root,registry);
  return {entry:structuredClone(entry),strategy:structuredClone(strategy)};
 });
}
export function finishEvaluation(root:string,result:StageResult):StageResult {
 return locked(root,()=>{
  const registry=loadRegistry(root),{entry}=versionOf(registry,result.strategyId,result.version);
  if(!entry.consumedStages.includes(result.stage)||entry.stage!==result.stage||entry.status==='failed')throw Error('Stage not reserved or no longer eligible');
  if(entry.codeHash!==result.codeHash||entry.configHash!==result.configHash||entry.variantsTested!==result.variantsTested)throw Error('Result provenance mismatch');
  const allPassed=result.checks.length>0&&result.checks.every(c=>c.passed);
  if((result.status==='passed')!==allPassed)throw Error('Result status disagrees with gate checks');
  if(computeCodeHash(root,result.strategyId)!==entry.codeHash){
   const check={id:'code_changed_during_run',passed:false,actual:null,expected:'matching frozen code fingerprint'};
   result={...result,status:'failed',checks:[...result.checks,check],reasons:[...result.reasons,check.id+': expected '+check.expected]};
  }
  const path=stageFile(root,result.strategyId,result.version,result.stage);
  mkdirSync(dirname(path),{recursive:true});
  const {integrityHash:_discard,...unsealed}=result;
  const sealed:StageResult={...unsealed,integrityHash:digest(JSON.stringify(unsealed))};
  writeFileSync(path,JSON.stringify(sealed,null,2)+'\n',{flag:'wx'});
  entry.stageReportHashes??={};
  if(entry.stageReportHashes[String(result.stage)])throw Error('Duplicate stage integrity anchor');
  entry.stageReportHashes[String(result.stage)]=sealed.integrityHash!;
  entry.status=result.status;
  if(result.status==='passed'&&result.stage<6)entry.stage=(result.stage+1) as Stage;
  saveRegistry(root,registry);
  return sealed;
 });
}

/** Read-only reconciliation. Existing hypothesis counters do NOT establish
 * that historical trials were actually journalled. */
export function auditRegisteredVariants(root:string,id:string,version:string):VariantAudit {
 const {strategy,entry}=versionOf(loadRegistry(root),id,version);
 const baseline=loadHypothesis(root,strategy.hypothesisId)?.variantsTested??null;
 return auditResearchVariants(root,strategy.hypothesisId,entry.variantsTested,baseline);
}
