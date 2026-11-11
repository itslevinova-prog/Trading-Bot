import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import {isAbsolute,relative,resolve} from 'node:path';

export type FileDigest={path:string;sha256:string};
export type BuildManifest={formatVersion:1;builtAt:string;buildId:string;sourceDigest:string;runtimeDigest:string;sources:FileDigest[];runtimeFiles:FileDigest[]};
export type BuildVerification={verified:boolean;buildId:string|null;builtAt:string|null;sourceFiles:number;runtimeFiles:number;reasons:string[]};
export const digest=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex');
const canonical=(files:FileDigest[])=>JSON.stringify([...files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0));
function below(root:string,name:string){const file=resolve(root,name),rel=relative(root,file);if(isAbsolute(name)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\'))throw Error('Path outside project');return file;}
function walk(root:string,name:string,accept:(name:string)=>boolean):string[]{
 const file=below(root,name);if(!existsSync(file))return [];
 if(lstatSync(file).isSymbolicLink())throw Error('Build input symlinks are not supported');
 if(lstatSync(file).isFile())return accept(name)?[name.replaceAll('\\','/')]:[];
 return readdirSync(file).sort().flatMap(child=>walk(root,`${name}/${child}`,accept));
}
function inputs(root:string){
 const sourcePaths=['apps/server/src','packages/shared/src','prompts'].flatMap(name=>walk(root,name,n=>/\.(ts|tsx|json|md)$/.test(n)));
 for(const name of ['package.json','pnpm-lock.yaml','tsconfig.base.json','apps/server/package.json','apps/server/tsconfig.json','packages/shared/package.json','packages/shared/tsconfig.json','scripts/write-build-manifest.mjs'])if(existsSync(below(root,name)))sourcePaths.push(name);
 const runtimePaths=['apps/server/dist','packages/shared/dist'].flatMap(name=>walk(root,name,n=>n.endsWith('.js')));
 const hashed=(paths:string[])=>[...new Set(paths)].sort().map(path=>({path,sha256:digest(readFileSync(below(root,path)))}));
 return {sources:hashed(sourcePaths),runtimeFiles:hashed(runtimePaths)};
}
export function createBuildManifest(root:string,now=Date.now()):BuildManifest{
 const files=inputs(root);if(!files.sources.length||!files.runtimeFiles.length)throw Error('Source and compiled runtime are required');
 const sourceDigest=digest(canonical(files.sources)),runtimeDigest=digest(canonical(files.runtimeFiles));
 return {formatVersion:1,builtAt:new Date(now).toISOString(),buildId:digest(`1:${sourceDigest}:${runtimeDigest}`),sourceDigest,runtimeDigest,...files};
}
export function writeBuildManifest(root:string,now=Date.now()){
 const manifest=createBuildManifest(root,now),file=below(root,'apps/server/dist/build-manifest.json');
 const archive=below(root,`data/build-archives/${manifest.buildId}`);mkdirSync(archive,{recursive:true});
 for(const entry of [...manifest.sources,...manifest.runtimeFiles]){
  const bytes=readFileSync(below(root,entry.path));if(digest(bytes)!==entry.sha256)throw Error('Build changed during archival');
  const destination=below(archive,entry.path);mkdirSync(resolve(destination,'..'),{recursive:true});
  if(existsSync(destination)){if(digest(readFileSync(destination))!==entry.sha256)throw Error('Archived artifact changed');}
  else writeFileSync(destination,bytes,{flag:'wx'});
 }
 const archivedManifest=resolve(archive,'manifest.json');if(!existsSync(archivedManifest))writeFileSync(archivedManifest,JSON.stringify(manifest,null,2),{flag:'wx'});
 writeFileSync(file+'.tmp',JSON.stringify(manifest,null,2));renameSync(file+'.tmp',file);return manifest;
}
function validFiles(value:unknown):value is FileDigest[]{return Array.isArray(value)&&value.length>0&&value.every(x=>x&&typeof x.path==='string'&&!x.path.includes('\\')&&!x.path.split('/').includes('..')&&!isAbsolute(x.path)&&typeof x.sha256==='string'&&/^[0-9a-f]{64}$/.test(x.sha256))&&new Set(value.map(x=>x.path)).size===value.length;}
export function verifyBuildManifest(root:string,manifest:unknown):BuildVerification{
 const fail=(reason:string):BuildVerification=>({verified:false,buildId:null,builtAt:null,sourceFiles:0,runtimeFiles:0,reasons:[reason]});
 try{
  const m=manifest as BuildManifest;
  if(!m||m.formatVersion!==1||!validFiles(m.sources)||!validFiles(m.runtimeFiles)||!Number.isFinite(Date.parse(m.builtAt)))return fail('Malformed build manifest');
  const sourceDigest=digest(canonical(m.sources)),runtimeDigest=digest(canonical(m.runtimeFiles));
  if(m.sourceDigest!==sourceDigest||m.runtimeDigest!==runtimeDigest||m.buildId!==digest(`1:${sourceDigest}:${runtimeDigest}`))return fail('Manifest fingerprint mismatch');
  const current=inputs(root),reasons:string[]=[];
  if(canonical(current.sources)!==canonical(m.sources))reasons.push('Source inputs differ from the compiled build');
  if(canonical(current.runtimeFiles)!==canonical(m.runtimeFiles))reasons.push('Compiled runtime differs from the recorded build');
  return {verified:reasons.length===0,buildId:m.buildId,builtAt:m.builtAt,sourceFiles:m.sources.length,runtimeFiles:m.runtimeFiles.length,reasons};
 }catch{return fail('Build files unavailable or invalid');}
}
export function inspectBuild(root:string):BuildVerification{
 try{return verifyBuildManifest(root,JSON.parse(readFileSync(below(root,'apps/server/dist/build-manifest.json'),'utf8')));}catch{return {verified:false,buildId:null,builtAt:null,sourceFiles:0,runtimeFiles:0,reasons:['Build manifest unavailable; rebuild before collecting versioned evidence']};}
}
const tradingKeys=['PAPER_TEST_MODE','PAPER_MOCK_POLICY','PAPER_FIXED_PAIRS','PAPER_EXPERIMENT_MODE','EXCHANGE','QUOTE_CURRENCY','STARTING_BALANCE_EUR','TOP_N_PAIRS','DECISION_INTERVAL_MINUTES','TAKER_FEE_RATE','SIMULATED_LATENCY_MS_MIN','SIMULATED_LATENCY_MS_MAX','MAX_BOOK_AGE_MS','MAX_ENTRY_SPREAD_BPS','MAX_ENTRY_SLIPPAGE_BPS','MAX_POSITION_PCT','MAX_TOTAL_RISK_PCT','MAX_OPEN_POSITIONS','MIN_ORDER_EUR','DEFAULT_STOP_LOSS_PCT','DEFAULT_TAKE_PROFIT_PCT','MAX_TRADES_PER_DAY','COIN_COOLDOWN_MINUTES','MAX_DRAWDOWN_PCT','HISTORY_DAYS','AI_MODEL_MODE','AI_EXPECTED_MODEL_FINGERPRINT','AI_CONTEXT_TOKENS','AI_PROVIDER','AI_ENABLED','AI_MODEL','AI_ALLOW_REMOTE','AI_MAX_CONTEXT_CHARS','AI_MAX_OUTPUT_TOKENS','CONTEXT_EXTERNAL_ENABLED'] as const;
export function sanitisedTradingConfig(raw:Record<string,unknown>){
 const result:Record<string,string|number|boolean>={};for(const key of tradingKeys){const value=raw[key];if(typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))result[key]=value;}return result;
}
export function createRuntimeProvenance(build:BuildVerification,raw:Record<string,unknown>,now=Date.now()){
 const tradingConfig=sanitisedTradingConfig(raw),configurationFingerprint=digest(JSON.stringify(tradingConfig)),databaseFingerprint=typeof raw.DATABASE_PATH==='string'?digest(raw.DATABASE_PATH):null;
 const modelEndpointFingerprint=typeof raw.AI_BASE_URL==='string'?digest(raw.AI_BASE_URL):null;
 const runtime={node:process.versions.node,platform:process.platform,arch:process.arch};
 return {runId:randomUUID(),startedAt:new Date(now).toISOString(),verified:build.verified,build,tradingConfig,configurationFingerprint,databaseFingerprint,modelEndpointFingerprint,modelArtifactVerified:false,runtime,strategyVersion:digest(JSON.stringify({buildId:build.buildId,configurationFingerprint,databaseFingerprint,modelEndpointFingerprint,runtime})),scope:'Build/configuration identity only; not a profitability or independent-forward claim'};
}
export type RuntimeProvenance=ReturnType<typeof createRuntimeProvenance>;
export function recordDeployment(root:string,identity:RuntimeProvenance){
 if(!/^[0-9a-f-]{36}$/.test(identity.runId))throw Error('Invalid deployment identifier');
 const folder=below(root,'data/deployments');mkdirSync(folder,{recursive:true});writeFileSync(resolve(folder,identity.runId+'.json'),JSON.stringify(identity,null,2),{flag:'wx'});
}

export type UniverseMarket={symbol:string;ordermin:number;costmin:number;lotDecimals:number;pairDecimals:number};
export function universeFingerprint(markets:UniverseMarket[]){
 if(!markets.length||new Set(markets.map(m=>m.symbol)).size!==markets.length||markets.some(m=>!m.symbol||![m.ordermin,m.costmin,m.lotDecimals,m.pairDecimals].every(n=>Number.isFinite(n)&&n>=0)))throw Error('Invalid market universe');
 return digest(JSON.stringify(markets.map(m=>({symbol:m.symbol,ordermin:m.ordermin,costmin:m.costmin,lotDecimals:m.lotDecimals,pairDecimals:m.pairDecimals})).sort((a,b)=>a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0)));
}
export function evaluationFingerprint(strategyVersion:string,universeHash:string){return digest(`${strategyVersion}:${universeHash}`);}
