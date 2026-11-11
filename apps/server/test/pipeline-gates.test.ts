import {runRegisteredHoldout} from '../src/pipeline/holdout.js';
import {test,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {register,loadRegistry,computeCodeHash,computeConfigHash,readStage,stageFile,startEvaluation} from '../src/pipeline/registry.js';
import {evaluateGates,type Evidence} from '../src/pipeline/gates.js';
import {evaluateStage,statusTable} from '../src/pipeline/evaluate.js';
import {preflightStage} from '../src/pipeline/preflight.js';
import {requirePaperAdmission,requireAccountPaperAdmission} from '../src/pipeline/paper.js';

const hash='a'.repeat(64);
function fixture(fn:(root:string)=>void) {
 const root=mkdtempSync(join(tmpdir(),'pipeline-'));
 try {
  mkdirSync(join(root,'apps/server/src/strategy'),{recursive:true});
  mkdirSync(join(root,'docs/research'),{recursive:true});
  writeFileSync(join(root,'apps/server/src/strategy/providers.ts'),'export const rule = 1;');
  writeFileSync(join(root,'apps/server/src/strategy/quality.ts'),'export const quality = 1;');
  writeFileSync(join(root,'package.json'),JSON.stringify({scripts:{}}));
  writeFileSync(join(root,'docs/research/hypotheses.json'),JSON.stringify([{id:'H-001',variantsTested:5,
   economicRationale:'Momentum persists',successThreshold:'positive net return after costs',killCriterion:'negative net edge',status:'open'}]));
  fn(root);
 }finally{rmSync(root,{recursive:true});}
}
function evidence(stage:1|2|3|4|5|6,entry:{codeHash:string;configHash:string;variantsTested:number},metrics:Record<string,unknown>):Evidence {
 const periods:Record<number,[string,string]>={1:['2020-01-01','2024-01-01'],2:['2024-01-01','2025-01-01'],
  3:['2025-01-01','2026-01-01'],4:['2027-01-01','2027-04-02'],5:['2027-05-01','2027-05-29'],6:['2027-06-01','2027-06-02']};
 return {stage,strategyId:'rules',version:'v1',codeHash:entry.codeHash,configHash:entry.configHash,
  periodFrom:periods[stage]![0],periodToExclusive:periods[stage]![1],dataHashes:{candles:hash},metrics,source:'local:test-fixture'};
}
const healthy=(variantsTested:number)=>({trafficLight:'green',lookaheadPassed:true,lookaheadEvidenceHash:hash,sharpe:2,btcSharpe:1,dcaSharpe:1.2,calmar:2,btcCalmar:1.1,dcaCalmar:1.5,
 dsrProbability:.95,pbo:.1999,variantsTested,trades:100,exposureYears:0,grossEdge:20,roundtripCost:10,bootstrapP10:-5,bootstrapP90:10});
test('all stage 1 boundaries are strict; missing metrics never default to passing',()=>fixture(root=>{
 const entry=register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 const ctx={stage:1 as const,entry,hypothesisVerified:true,previous:null,previousStage3:null,holdoutGuardVerified:false};
 const metrics=healthy(entry.variantsTested);
 expect(evaluateGates(ctx,evidence(1,entry,metrics)).reasons).toEqual([]);
 for(const patch of [{lookaheadPassed:false},{lookaheadEvidenceHash:undefined},{pbo:.2},{dsrProbability:.94999},{trades:99,exposureYears:2.99},{grossEdge:19.999},{trafficLight:'yellow'},
  {btcSharpe:2,btcCalmar:2},{variantsTested:5},{roundtripCost:0},{bootstrapP10:undefined}]){
  expect(evaluateGates(ctx,evidence(1,entry,{...metrics,...patch})).reasons.length).toBeGreaterThan(0);
 }
 expect(evaluateGates(ctx,null).reasons.length).toBeGreaterThan(0);
}));
test('validation and holdout P10 boundary, stress and guard are enforced',()=>fixture(root=>{
 const entry=register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 const prior={bootstrapP10:-5,bootstrapP90:10};
 const context={entry,hypothesisVerified:true,previous:prior,previousStage3:null,holdoutGuardVerified:true};
 expect(evaluateGates({...context,stage:2},evidence(2,entry,{netReturnPct:-5,stressNetReturnsPct:[0,1]})).reasons).toEqual([]);
 expect(evaluateGates({...context,stage:2},evidence(2,entry,{netReturnPct:-5.001,stressNetReturnsPct:[-1]})).reasons.length).toBeGreaterThan(0);
 expect(evaluateGates({...context,stage:3},evidence(3,entry,{netReturnPct:-5})).reasons).toEqual([]);
 expect(evaluateGates({...context,stage:3,holdoutGuardVerified:false},evidence(3,entry,{netReturnPct:-5})).reasons).toContain('holdout_guard: expected actual #3 holdout guard used, reason "pipeline stage 3" recorded');
}));
test('paper, testnet and ready are strict and read upstream readiness evidence',()=>fixture(root=>{
 const entry=register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 const ctx={entry,hypothesisVerified:true,previous:{bootstrapP10:-5,bootstrapP90:10},previousStage3:{passedAt:'2026-01-01T00:00:00Z'},holdoutGuardVerified:true};
 const p={days:90,paperCodeHash:entry.codeHash,neverRed:true,monitoringEvidenceHash:hash,netReturnPct:-5};
 expect(evaluateGates({...ctx,stage:4},evidence(4,entry,p)).reasons).toEqual([]);
 expect(evaluateGates({...ctx,stage:4},evidence(4,entry,{...p,days:89})).reasons.length).toBeGreaterThan(0);
 expect(evaluateGates({...ctx,stage:4},{...evidence(4,entry,p),periodToExclusive:'2027-02-01'}).checks.find(c=>c.id==='paper_observed_window')?.passed).toBe(false);
 const t={days:28,reconciliationErrors:0,reconciliationEvidenceHash:hash,fillDeviationBps:10,fillToleranceBps:10,readinessPassed:true,readinessEvidenceHash:hash};
 expect(evaluateGates({...ctx,stage:5},evidence(5,entry,t)).reasons).toEqual([]);
 expect(evaluateGates({...ctx,stage:5},evidence(5,entry,{...t,fillDeviationBps:10.01})).reasons.length).toBeGreaterThan(0);
 expect(evaluateGates({...ctx,stage:5},{...evidence(5,entry,t),periodToExclusive:'2027-05-20'}).checks.find(c=>c.id==='testnet_observed_window')?.passed).toBe(false);
 expect(evaluateGates({...ctx,stage:5},{...evidence(5,entry,t),periodFrom:'2027-02-30'}).checks.find(c=>c.id==='time_window')?.passed).toBe(false);
 expect(evaluateGates({...ctx,stage:6},evidence(6,entry,{reportOnly:true})).reasons).toEqual([]);
 expect(evaluateGates({...ctx,stage:6},evidence(6,entry,{reportOnly:false})).reasons.length).toBeGreaterThan(0);
}));
test('register increments hypothesis trial count and refuses duplicate versions',()=>fixture(root=>{
 const first=register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 expect(first.variantsTested).toBe(6);
 expect(()=>register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'})).toThrow();
 const second=register(root,{id:'rules',version:'v2',hypothesisId:'H-001',description:'Rules',config:{risk:0.01}});
 expect(second.variantsTested).toBe(7);
 expect(loadRegistry(root).hypotheses['H-001']?.variantsTested).toBe(7);
 expect(second.stage).toBe(1);
 expect(()=>register(root,{id:'rules',version:'v3',hypothesisId:'H-001',description:'Rules',config:{risk:0.01}})).toThrow(/Identical code/);
}));
test('code edits need a new registration before evaluation',()=>fixture(root=>{
 register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 writeFileSync(join(root,'apps/server/src/strategy/providers.ts'),'export const rule = 2;');
 expect(()=>evaluateStage(root,'rules','v1',1,{evidenceForTest:null})).toThrow(/register a new version/);
 expect(!existsSync(stageFile(root,'rules','v1',1))).toBe(true);
}));
test('failed report is honest, create-only, and cannot be rerun',()=>fixture(root=>{
 const entry=register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 const result=evaluateStage(root,'rules','v1',1,{evidenceForTest:evidence(1,entry,{...healthy(entry.variantsTested),pbo:.2})});
 expect(result.status).toBe('failed');
 expect(result.reasons.some(s=>s.startsWith('pbo:'))).toBe(true);
 const path=stageFile(root,'rules','v1',1),bytes=readFileSync(path,'utf8');
 expect(()=>evaluateStage(root,'rules','v1',1,{evidenceForTest:evidence(1,entry,healthy(entry.variantsTested))})).toThrow();
 expect(readFileSync(path,'utf8')).toBe(bytes);
 expect(statusTable(root)).toContain('neue Version');
}));
test('passed development advances and validation is consumed even on failure',()=>fixture(root=>{
 const entry=register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 expect(evaluateStage(root,'rules','v1',1,{evidenceForTest:evidence(1,entry,healthy(entry.variantsTested))}).status).toBe('passed');
 const fail=evaluateStage(root,'rules','v1',2,{evidenceForTest:evidence(2,entry,{netReturnPct:-6,stressNetReturnsPct:[0]})});
 expect(fail.status).toBe('failed');
 expect(loadRegistry(root).strategies[0]!.versions[0]!.consumedStages).toEqual([1,2]);
 expect(()=>evaluateStage(root,'rules','v1',2,{evidenceForTest:evidence(2,entry,{netReturnPct:5,stressNetReturnsPct:[1]})})).toThrow();
 expect(readStage(root,'rules','v1',2)?.status).toBe('failed');
}));
test('holdout cannot be read or consumed without upstream guarded access',()=>fixture(root=>{
 const entry=register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 evaluateStage(root,'rules','v1',1,{evidenceForTest:evidence(1,entry,healthy(entry.variantsTested))});
 evaluateStage(root,'rules','v1',2,{evidenceForTest:evidence(2,entry,{netReturnPct:0,stressNetReturnsPct:[0]})});
 expect(()=>evaluateStage(root,'rules','v1',3,{evidenceForTest:evidence(3,entry,{netReturnPct:0})})).toThrow(/holdout guard/);
 expect(loadRegistry(root).strategies[0]!.versions[0]!.consumedStages).toEqual([1,2]);
 expect(()=>requirePaperAdmission(root,'rules','v1')).toThrow(/passed stage 3/);
 const res=evaluateStage(root,'rules','v1',3,{holdoutGuardForTest:true,evidenceForTest:evidence(3,entry,{netReturnPct:0})});
 expect(res.status).toBe('passed');
 expect(requirePaperAdmission(root,'rules','v1').kind).toBe('pipeline');
 expect(()=>evaluateStage(root,'rules','v1',3,{holdoutGuardForTest:true,evidenceForTest:evidence(3,entry,{netReturnPct:0})})).toThrow();
}));
test('the buy-and-hold comparison is visibly excluded from advancement',()=>fixture(root=>{
 const entry=register(root,{id:'hold',version:'v1',hypothesisId:'BENCHMARK-BTC',description:'Benchmark',benchmark:true});
 expect(entry.stage).toBe(1);
 expect(statusTable(root)).toContain('Benchmark, nicht in der Pipeline');
 expect(requirePaperAdmission(root,'hold','v1').kind).toBe('benchmark');
 expect(()=>evaluateStage(root,'hold','v1',1,{evidenceForTest:null})).toThrow(/Benchmark/);
}));

test('a crashed attempt reservation cannot be repeated or laundered into a new report',()=>fixture(root=>{
 register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 startEvaluation(root,'rules','v1',1);
 expect(readStage(root,'rules','v1',1)).toBeNull();
 expect(loadRegistry(root).strategies[0]!.versions[0]!.consumedStages).toEqual([1]);
 expect(()=>startEvaluation(root,'rules','v1',1)).toThrow(/consumed/);
}));

test('an unavailable backtest is recorded as failed, never as synthetic profitability',()=>fixture(root=>{
 const entry=register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 const result=evaluateStage(root,'rules','v1',1);
 expect(result.status).toBe('failed');
 expect(result.metrics).toEqual({});
 expect(result.dataHashes).toEqual({});
 expect(result.reasons.some(s=>s.includes('source_error'))).toBe(true);
 expect(result.checks.some(c=>String(c.actual).includes('no backtest was executed'))).toBe(true);
 expect(()=>evaluateStage(root,'rules','v1',1)).toThrow();
}));

test('test-only evidence cannot be injected by production callers',()=>fixture(root=>{
 const entry=register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 const original=process.env.VITEST;
 try {
  process.env.VITEST='false';
  expect(()=>evaluateStage(root,'rules','v1',1,{evidenceForTest:evidence(1,entry,healthy(entry.variantsTested))}))
   .toThrow(/forbidden outside Vitest/);
  expect(loadRegistry(root).strategies[0]!.versions[0]!.consumedStages).toEqual([]);
 } finally {
  if(original===undefined)delete process.env.VITEST;
  else process.env.VITEST=original;
 }
}));

test('new strategy registrations fail closed for missing or rejected hypotheses',()=>fixture(root=>{
 const location=join(root,'docs/research/hypotheses.json');
 const base=JSON.parse(readFileSync(location,'utf8')) as Array<Record<string,unknown>>;
 writeFileSync(location,JSON.stringify(base.map(h=>({...h,status:'rejected'}))));
 expect(()=>register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'})).toThrow(/invalid or rejected/);
 expect(()=>register(root,{id:'rules',version:'v1',hypothesisId:'H-999',description:'Rules'})).toThrow(/invalid or rejected/);
 expect(loadRegistry(root).strategies).toEqual([]);
}));

test('paper runtime fails closed without a passed version and permits explicit hold benchmark',()=>fixture(root=>{
 register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 expect(()=>requireAccountPaperAdmission(root,{id:'rules',strategy:'rules'},{})).toThrow(/No registered pipeline version/);
 expect(()=>requireAccountPaperAdmission(root,{id:'rules',strategy:'rules'},{PAPER_RULES_PIPELINE_VERSION:'v1'})).toThrow(/passed stage 3/);
 expect(()=>requireAccountPaperAdmission(root,{id:'ai',strategy:'ai'},{})).toThrow(/No registered pipeline version/);
 expect(()=>requireAccountPaperAdmission(root,{id:'other',strategy:'hold'},{})).toThrow(/No registered pipeline version/);
 expect(()=>requireAccountPaperAdmission(root,{id:'hold',strategy:'hold'},{})).toThrow(/not explicitly registered/);
 register(root,{id:'hold',version:'v1',hypothesisId:'H-001',description:'Hold benchmark',benchmark:true});
 expect(requireAccountPaperAdmission(root,{id:'hold',strategy:'hold'},{}).kind).toBe('benchmark');
 expect(()=>requireAccountPaperAdmission(root,{id:'dca',strategy:'dca'},{})).toThrow(/not explicitly registered/);
 const benchmarkRegistry=loadRegistry(root);
 benchmarkRegistry.strategies.push({id:'dca',hypothesisId:'BENCHMARK-DCA',description:'Paper DCA',benchmark:true,versions:[]});
 writeFileSync(join(root,'docs/strategies/registry.json'),JSON.stringify(benchmarkRegistry));
 expect(requireAccountPaperAdmission(root,{id:'dca',strategy:'dca'},{}).kind).toBe('benchmark');
 const entry=loadRegistry(root).strategies.find(s=>s.id==='rules')!.versions[0]!;
 evaluateStage(root,'rules','v1',1,{evidenceForTest:evidence(1,entry,healthy(entry.variantsTested))});
 evaluateStage(root,'rules','v1',2,{evidenceForTest:evidence(2,entry,{netReturnPct:0,stressNetReturnsPct:[0]})});
 evaluateStage(root,'rules','v1',3,{evidenceForTest:evidence(3,entry,{netReturnPct:0}),holdoutGuardForTest:true});
 expect(requireAccountPaperAdmission(root,{id:'rules',strategy:'rules'},{PAPER_RULES_PIPELINE_VERSION:'v1'}).kind).toBe('pipeline');
 writeFileSync(join(root,'apps/server/src/strategy/providers.ts'),'export const rule = 5;');
 expect(()=>requireAccountPaperAdmission(root,{id:'rules',strategy:'rules'},{PAPER_RULES_PIPELINE_VERSION:'v1'})).toThrow(/code hash changed/);
}));

test('holdout runner refuses unreserved attempts without reading real archive',async()=>{
 let outcome:Promise<unknown>|undefined;
 fixture(root=>{
  register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
  expect(()=>evaluateStage(root,'rules','v1',3,{evidencePath:'data/forged.json'}))
   .toThrow(/one-time archived holdout/);
  outcome=runRegisteredHoldout(root,'rules','v1');
 });
 await expect(outcome).rejects.toThrow(/Stage 3 must be reserved/);
});


test('pipeline preflight never reserves attempts, reads holdout or writes reports',()=>fixture(root=>{
 const entry=register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 const before=readFileSync(join(root,'docs/strategies/registry.json'),'utf8');
 const first=preflightStage(root,'rules','v1',1);
 expect(first).toMatchObject({eligible:true,irreversibleIfStarted:true,
  performedEvaluation:false,accessedMarketData:false});
 expect(readFileSync(join(root,'docs/strategies/registry.json'),'utf8')).toBe(before);
 expect(readStage(root,'rules','v1',1)).toBeNull();
 const blocked=preflightStage(root,'rules','v1',3);
 expect(blocked.eligible).toBe(false);
 expect(blocked.checks.find(c=>c.id==='previous_gate')?.passed).toBe(false);
 expect(readFileSync(join(root,'docs/strategies/registry.json'),'utf8')).toBe(before);
 expect(entry.consumedStages).toEqual([]);
}));
test('pipeline preflight never misidentifies modified code or consumed attempts as eligible',()=>fixture(root=>{
 register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 writeFileSync(join(root,'apps/server/src/strategy/providers.ts'),'export const changed = 999');
 const changed=preflightStage(root,'rules','v1',1);
 expect(changed.eligible).toBe(false);
 expect(changed.checks.find(c=>c.id==='code_hash')?.passed).toBe(false);
 // The failed inspection itself must not consume the attempt.
 expect(loadRegistry(root).strategies[0]!.versions[0]!.consumedStages).toEqual([]);
}));

test('pipeline preflight blocks unsealed legacy Stage result without replay',()=>fixture(root=>{
 const entry=register(root,{id:'rules',version:'v1',hypothesisId:'H-001',description:'Rules'});
 const first=preflightStage(root,'rules','v1',1);
 expect(first.eligible).toBe(true);
 const registry=loadRegistry(root);
 registry.strategies[0]!.versions[0]!.stage=2;
 registry.strategies[0]!.versions[0]!.status='passed';
 registry.strategies[0]!.versions[0]!.consumedStages=[1];
 writeFileSync(join(root,'docs/strategies/registry.json'),JSON.stringify(registry));
 mkdirSync(dirname(stageFile(root,'rules','v1',1)),{recursive:true});
 writeFileSync(stageFile(root,'rules','v1',1),JSON.stringify({
  status:'passed',stage:1,strategyId:'rules',version:'v1',
  codeHash:entry.codeHash,configHash:entry.configHash
 }));
 const suspect=preflightStage(root,'rules','v1',2);
 expect(suspect.eligible).toBe(false);
 expect(suspect.checks.find(x=>x.id==='previous_stage_integrity')?.passed).toBe(false);
 expect(preflightStage(root,'rules','v1',1).eligible).toBe(false);
}));
