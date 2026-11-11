import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,realpathSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {inspectBuild} from '../apps/server/dist/provenance/build.js';
import {validatePaperExperiment} from '../apps/server/dist/research/paper-experiment.js';
import {verifyDependencies,hash,files,inside} from './candidate-files.mjs';
export function mockExperimentSelection(series='v1'){
 assert.ok(['v1','v2','v3'].includes(series),'Unknown experiment series');
 return {kind:'mock-forward-'+series,pointerPath:series==='v1'?'data/mock-experiment-current.json':'data/mock-experiment-'+series+'-current.json',protocolPath:'docs/mock-forward-protocol-'+series+'.json',proofPath:series==='v1'?'docs/mock-experiment-latest.json':'docs/mock-experiment-'+series+'-latest.json'};
}
export function serializeMockEnvironment(environment,project=process.cwd()){
 const text=Object.entries(environment).map(([key,value])=>{assert.match(key,/^[A-Z_]+$/);const raw=String(value);assert.ok(!/[\r\n']/.test(raw),'Unsafe environment literal');return key+"='"+raw+"'";}).join('\n')+'\n';
 const parse=createRequire(join(project,'apps/server/package.json'))('dotenv').parse,decoded=parse(text);assert.deepEqual(decoded,Object.fromEntries(Object.entries(environment).map(([k,v])=>[k,String(v)])),'Environment must roundtrip exactly');return text;
}
export function inspectMockExperiment(project=process.cwd(),series='v1'){
 const selection=mockExperimentSelection(series);
 const pointer=JSON.parse(readFileSync(join(project,selection.pointerPath),'utf8')),root=inside(join(project,'data/paper-experiments'),pointer.root),manifest=join(root,'mock-experiment-manifest.json'),record=JSON.parse(readFileSync(manifest,'utf8'));
 assert.equal(hash(readFileSync(manifest)),pointer.manifestHash);assert.equal(record.root,root);assert.equal(record.id,pointer.id);assert.equal(record.kind,selection.kind);assert.equal(record.port,3200);assert.equal(record.buildId,pointer.buildId);
 const canonical=realpathSync(root);for(const p of ['apps/server/src','apps/server/dist','packages/shared/src','packages/shared/dist','apps/web/dist','.env'])inside(canonical,realpathSync(join(root,p)));
 const build=inspectBuild(root);assert.equal(build.verified,true);assert.equal(build.buildId,record.buildId);verifyDependencies(root,record.dependencies);assert.deepEqual(files(join(root,'apps/web/dist')),record.webFiles);
 for(const f of [...record.evidence,...record.toolFiles])assert.equal(hash(readFileSync(inside(root,join(root,f.path)))),f.sha256);
 assert.equal(hash(readFileSync(join(root,'.env'))),record.environmentHash);assert.equal(hash(readFileSync(join(root,record.seed.initialArchivePath))),record.seed.initialFileHash);assert.equal(record.seed.accountHistoryCopied,false);
 const require=createRequire(join(root,'apps/server/package.json')),environment=require('dotenv').parse(readFileSync(join(root,'.env')));
 for(const [key,value]of Object.entries({PAPER_EXPERIMENT_MODE:'mock',AI_PROVIDER:'mock',AI_ENABLED:'false',AI_ALLOW_REMOTE:'false',LIVE_ENABLED:'false',AI_API_KEY:'',ANTHROPIC_API_KEY:'',DATABASE_PATH:'./data/mock-experiment.db',PORT:'3200',STARTING_BALANCE_EUR:'1000'}))assert.equal(environment[key],value);
 if(series==='v3'){const protocol=JSON.parse(readFileSync(join(root,selection.protocolPath),'utf8'));assert.equal(environment.PAPER_MOCK_POLICY,protocol.mockPolicy);assert.equal(environment.PAPER_FIXED_PAIRS,JSON.stringify([...protocol.fixedPairs].sort()));assert.equal(Number(environment.TOP_N_PAIRS),protocol.fixedPairs.length);assert.equal(record.buildId,protocol.sourceBuildId);}
 const Database=require('better-sqlite3'),seed=new Database(join(root,record.seed.initialArchivePath),{readonly:true,fileMustExist:true});try{assert.deepEqual(seed.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name),['candles','database_identity','pairs']);assert.equal(seed.prepare('SELECT count(*) n FROM candles WHERE ts+interval*60000>?').get(record.seed.capturedAt).n,0);}finally{seed.close();}
 assert.ok(require.resolve('@paper/shared').startsWith(join(root,'packages/shared')));return {root,record,environment,pointer,selection};
}
export async function verifyMockExperiment(project=process.cwd(),series='v1'){
 const selection=mockExperimentSelection(series);const {root,record}=inspectMockExperiment(project,series),base='http://127.0.0.1:'+record.port,get=async path=>{const r=await fetch(base+path,{signal:AbortSignal.timeout(10000),redirect:'error'});assert.equal(r.status,200);return r.json();};
 const [status,p,health,comparison]=await Promise.all(['/api/status','/api/provenance','/api/health','/api/paper-experiment'].map(get));
 assert.equal(status.paperOnly,true);assert.equal(status.config.PAPER_EXPERIMENT_MODE,'mock');assert.equal(status.config.AI_PROVIDER,'mock');assert.equal(status.config.AI_ENABLED,false);assert.equal(status.config.AI_ALLOW_REMOTE,false);assert.equal(p.verified,true);assert.equal(p.build.buildId,record.buildId);assert.equal(p.databaseFingerprint,hash('./data/mock-experiment.db'));assert.ok(comparison.experimentId,'Baseline not registered yet');
 assert.ok(['collecting','awaiting_benchmark_fill','awaiting_post_fill_marks','observation_gap'].includes(comparison.status),'Invalid experiment comparison: '+comparison.status);
 const require=createRequire(join(root,'apps/server/package.json')),Database=require('better-sqlite3'),sql=new Database(join(root,'data/mock-experiment.db'),{readonly:true,fileMustExist:true});let contract,epochs,holdFills,runs;
 try{sql.exec('BEGIN');const saved=sql.prepare('SELECT id,contract_json FROM paper_experiments').all();assert.equal(saved.length,1);assert.equal(saved[0].id,comparison.experimentId);contract=validatePaperExperiment(JSON.parse(saved[0].contract_json));assert.equal(contract.buildId,record.buildId);assert.equal(contract.baseStrategyVersion,p.strategyVersion);assert.equal(contract.startingBalance,1000);assert.equal(contract.aiSettings.mode,'safe');assert.equal(contract.aiSettings.stopLossPct,.05);
  epochs=sql.prepare('SELECT account_id,started_at,baseline_equity,evaluation_version FROM forward_epochs ORDER BY account_id').all();assert.equal(epochs.length,3);for(const e of epochs){assert.equal(e.started_at,contract.registeredAt);assert.equal(e.baseline_equity,1000);assert.equal(e.evaluation_version,contract.legs.find(l=>l.accountId===e.account_id).evaluationVersion);}
  const baseline=sql.prepare('SELECT account_id,observed_at,observed_cash,position_count FROM paper_experiment_samples WHERE experiment_id=? AND captured_at=? ORDER BY account_id').all(comparison.experimentId,contract.registeredAt);assert.equal(baseline.length,3);assert.ok(baseline.every(b=>b.observed_at===contract.registeredAt&&b.observed_cash===1000&&b.position_count===0));
  runs=sql.prepare('SELECT run_id,first_seen FROM paper_experiment_runs').all();assert.ok(runs.some(r=>r.run_id===p.runId));holdFills=sql.prepare("SELECT t.id,t.ts,t.cost_eur,t.fee_eur,t.qty,p.verified,p.evaluation_version FROM trades t LEFT JOIN trade_provenance p ON p.trade_id=t.id WHERE t.account_id='hold'").all();assert.ok(holdFills.length<=1);for(const f of holdFills){assert.equal(f.verified,1);assert.equal(f.evaluation_version,contract.legs.find(l=>l.accountId==='hold').evaluationVersion);}
  const accounts=sql.prepare('SELECT id,starting_balance FROM accounts ORDER BY id').all();assert.deepEqual(accounts.map(a=>a.id),['ai','hold','rules']);assert.ok(accounts.every(a=>a.starting_balance===1000));sql.exec('ROLLBACK');
 }finally{sql.close();}
 const savedFile=join(root,'data/process.json');if(existsSync(savedFile)){const saved=JSON.parse(readFileSync(savedFile,'utf8'));if(saved.runId)assert.equal(saved.runId,p.runId);}
 const result={verifiedAt:new Date().toISOString(),verifierHash:hash(readFileSync(new URL(import.meta.url))),experimentId:record.id,registeredExperimentId:comparison.experimentId,buildId:record.buildId,runId:p.runId,dependencyPackages:record.dependencies.length,sourceTreeIndependent:true,accountHistoryCopied:false,profile:'mock-paper-only',realAiEnabled:false,remoteAiEnabled:false,connected:health.connected,markets:health.pairs,readyFeatures:health.readyFeatures,registeredAt:contract.registeredAt,epochs,holdFills,registeredRuns:runs.length,comparison,profitabilityEstablished:false,privateExchangeCalls:0,realOrders:0,paidCalls:0};
 writeFileSync(join(root,'data/verification-latest.json'),JSON.stringify(result,null,2));writeFileSync(join(project,selection.proofPath),JSON.stringify(result,null,2));return result;
}
