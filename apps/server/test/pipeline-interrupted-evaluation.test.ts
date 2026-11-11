import {expect,test} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {register,loadRegistry,startEvaluation,stageFile} from '../src/pipeline/registry.js';
import {preflightStage,inspectInterruptedStages} from '../src/pipeline/preflight.js';
import {evaluateStage,statusTable} from '../src/pipeline/evaluate.js';
import type {Evidence} from '../src/pipeline/gates.js';
const hash='a'.repeat(64);
function fixture(run:(root:string)=>void){
 const root=mkdtempSync(join(tmpdir(),'stage-crash-'));
 try{
  mkdirSync(join(root,'apps/server/src/strategy'),{recursive:true});
  mkdirSync(join(root,'docs/research'),{recursive:true});
  writeFileSync(join(root,'apps/server/src/strategy/providers.ts'),'export const rule=1');
  writeFileSync(join(root,'apps/server/src/strategy/quality.ts'),'export const quality=1');
  writeFileSync(join(root,'docs/research/hypotheses.json'),JSON.stringify([{
   id:'H-007',status:'open',variantsTested:0,
   economicRationale:'Fixture',successThreshold:'Fixture',killCriterion:'Fixture'
  }]));
  run(root);
 }finally{rmSync(root,{recursive:true,force:true});}
}
const registration=(root:string)=>register(root,{id:'rules',version:'v1',hypothesisId:'H-007',description:'Fixture'});
function evidence(stage:1|2,entry:{codeHash:string;configHash:string;variantsTested:number}):Evidence{
 return {stage,strategyId:'rules',version:'v1',codeHash:entry.codeHash,configHash:entry.configHash,
  periodFrom:stage===1?'2020-01-01':'2024-01-01',
  periodToExclusive:stage===1?'2024-01-01':'2025-01-01',
  dataHashes:{candles:hash},source:'local:fixture',
  metrics:stage===1?{
   trafficLight:'green',lookaheadPassed:true,lookaheadEvidenceHash:hash,
   sharpe:2,btcSharpe:1,dcaSharpe:1.2,calmar:2,btcCalmar:1.1,dcaCalmar:1.5,
   dsrProbability:.96,pbo:.1,variantsTested:entry.variantsTested,trades:100,exposureYears:0,
   grossEdge:20,roundtripCost:10,bootstrapP10:-5,bootstrapP90:10
  }:{netReturnPct:-5,stressNetReturnsPct:[0,1]}};
}
test('crash after durable reservation is red, unresolved and cannot be retried',()=>fixture(root=>{
 registration(root);
 const before=preflightStage(root,'rules','v1',1);
 expect(before.attemptState).toBe('not-started');
 expect(before.eligible).toBe(true);
 startEvaluation(root,'rules','v1',1);
 const registryFile=join(root,'docs/strategies/registry.json');
 const fileBefore=readFileSync(registryFile,'utf8');
 const after=preflightStage(root,'rules','v1',1);
 expect(after).toMatchObject({
  attemptState:'reserved-unresolved',eligible:false,performedEvaluation:false,
  accessedMarketData:false,unresolvedIncident:{status:'reserved-unresolved',irreversible:true}
 });
 expect(after.checks.find(x=>x.id==='reservation_unresolved')?.passed).toBe(false);
 expect(after.unresolvedIncident?.reservedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
 const incidents=inspectInterruptedStages(root);
 expect(incidents).toMatchObject({
  status:'unresolved',inspectedReservations:1,unresolved:1
 });
 expect(incidents.incidents[0]?.cause).toContain('exact cause unknown');
 expect(incidents.fingerprint).toMatch(/^[a-f0-9]{64}$/);
 expect(statusTable(root)).toContain('reserved-unresolved');
 expect(statusTable(root)).toContain('UNGEKLÄRT');
 expect(()=>startEvaluation(root,'rules','v1',1)).toThrow(/consumed|eligible/);
 expect(readFileSync(registryFile,'utf8')).toBe(fileBefore);
 expect(existsSync(stageFile(root,'rules','v1',1))).toBe(false);
}));
test('offline simulated Stage 3 crash is consumed without accessing holdout',()=>fixture(root=>{
 const entry=registration(root);
 expect(evaluateStage(root,'rules','v1',1,{evidenceForTest:evidence(1,entry)}).status).toBe('passed');
 expect(evaluateStage(root,'rules','v1',2,{evidenceForTest:evidence(2,entry)}).status).toBe('passed');
 const stage3=preflightStage(root,'rules','v1',3);
 expect(stage3.attemptState).toBe('not-started');
 expect(stage3.eligible).toBe(true);
 startEvaluation(root,'rules','v1',3);
 const incident=preflightStage(root,'rules','v1',3);
 expect(incident.attemptState).toBe('reserved-unresolved');
 expect(incident.accessedMarketData).toBe(false);
 expect(incident.eligible).toBe(false);
 expect(incident.unresolvedIncident?.stage).toBe(3);
 expect(inspectInterruptedStages(root).incidents.map(x=>x.stage)).toEqual([3]);
 expect(()=>startEvaluation(root,'rules','v1',3)).toThrow(/consumed/);
}));
test('only a distinct newly registered version can start; old attempt remains unresolved',()=>fixture(root=>{
 registration(root);startEvaluation(root,'rules','v1',1);
 expect(()=>register(root,{id:'rules',version:'v2',hypothesisId:'H-007',description:'Fixture'}))
  .toThrow(/Identical code/);
 const next=register(root,{id:'rules',version:'v2',hypothesisId:'H-007',
  description:'New independent version',config:{parameter:2}});
 expect(next.consumedStages).toEqual([]);
 expect(preflightStage(root,'rules','v2',1).attemptState).toBe('not-started');
 expect(preflightStage(root,'rules','v1',1).attemptState).toBe('reserved-unresolved');
 expect(inspectInterruptedStages(root).unresolved).toBe(1);
}));
test('legacy reserved Stage without timestamp is not silently re-opened',()=>fixture(root=>{
 registration(root);
 const path=join(root,'docs/strategies/registry.json');
 const registry=loadRegistry(root),version=registry.strategies[0]!.versions[0]!;
 version.consumedStages=[1];delete version.attemptReservations;
 writeFileSync(path,JSON.stringify(registry));
 const check=preflightStage(root,'rules','v1',1);
 expect(check.attemptState).toBe('reserved-unresolved');
 expect(check.unresolvedIncident?.reservedAt).toBeNull();
 expect(inspectInterruptedStages(root).incidents[0]?.reservedAt).toBeNull();
 expect(()=>startEvaluation(root,'rules','v1',1)).toThrow(/consumed/);
}));
