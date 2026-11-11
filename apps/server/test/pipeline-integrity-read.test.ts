import {expect,test} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {register,readStage,stageFile,loadRegistry} from '../src/pipeline/registry.js';
import {preflightStage} from '../src/pipeline/preflight.js';
import {evaluateStage} from '../src/pipeline/evaluate.js';
import {inspectPipelineStageIntegrity} from '../src/pipeline/integrity-cli.js';
import type {Evidence} from '../src/pipeline/gates.js';
const hash='a'.repeat(64);
function fixture(testCase:(root:string)=>void){
 const root=mkdtempSync(join(tmpdir(),'pipeline-integrity-'));
 try{
  mkdirSync(join(root,'apps/server/src/strategy'),{recursive:true});
  mkdirSync(join(root,'docs/research'),{recursive:true});
  writeFileSync(join(root,'apps/server/src/strategy/providers.ts'),'export const provider=1');
  writeFileSync(join(root,'apps/server/src/strategy/quality.ts'),'export const quality=1');
  writeFileSync(join(root,'docs/research/hypotheses.json'),JSON.stringify([{
   id:'H-007',status:'open',variantsTested:0,economicRationale:'Fixture',
   successThreshold:'Fixture',killCriterion:'Fixture'
  }]));
  testCase(root);
 }finally{rmSync(root,{recursive:true,force:true});}
}
function registered(root:string){
 const entry=register(root,{id:'rules',version:'v1',hypothesisId:'H-007',description:'Fixture'});
 const proof:Evidence={stage:1,strategyId:'rules',version:'v1',
  codeHash:entry.codeHash,configHash:entry.configHash,
  periodFrom:'2020-01-01',periodToExclusive:'2024-01-01',
  dataHashes:{development:hash},source:'local:fixture',metrics:{
   trafficLight:'green',lookaheadPassed:true,lookaheadEvidenceHash:hash,
   sharpe:2,btcSharpe:1,dcaSharpe:1.2,calmar:2,btcCalmar:1.1,dcaCalmar:1.5,
   dsrProbability:.95,pbo:.19,variantsTested:entry.variantsTested,
   trades:100,exposureYears:0,grossEdge:20,roundtripCost:10,bootstrapP10:-5,bootstrapP90:10
  }};
 const result=evaluateStage(root,'rules','v1',1,{evidenceForTest:proof});
 expect(result.status).toBe('passed');
 const file=stageFile(root,'rules','v1',1);
 return {file,result};
}
test('valid newly sealed Stage report has independent registry anchor and remains read-only',()=>fixture(root=>{
 const {file,result}=registered(root);
 expect(result.integrityHash).toMatch(/^[a-f0-9]{64}$/);
 const original=readFileSync(file,'utf8'),registryBefore=readFileSync(join(root,'docs/strategies/registry.json'),'utf8');
 const loaded=readStage(root,'rules','v1',1);
 expect(loaded).toEqual(result);
 expect(loadRegistry(root).strategies[0]?.versions[0]?.stageReportHashes?.['1']).toBe(result.integrityHash);
 expect(preflightStage(root,'rules','v1',2).eligible).toBe(true);
 const inspection=inspectPipelineStageIntegrity(root);
 expect(inspection).toEqual(expect.objectContaining({status:'passed',inspected:1,verified:1,blocked:0}));
 expect(readFileSync(file,'utf8')).toBe(original);
 expect(readFileSync(join(root,'docs/strategies/registry.json'),'utf8')).toBe(registryBefore);
}));
for(const mutation of [
 ['status-change',(r:Record<string,any>)=>{r.status='failed';}],
 ['changed-checks',(r:Record<string,any>)=>{r.checks[0].passed=false;}],
 ['changed-code-hash',(r:Record<string,any>)=>{r.codeHash='f'.repeat(64);}],
 ['changed-evidence-hash',(r:Record<string,any>)=>{r.evidenceHash='f'.repeat(64);}],
 ['changed-integrity-hash',(r:Record<string,any>)=>{r.integrityHash='b'.repeat(64);}],
 ['forged-metric',(r:Record<string,any>)=>{r.metrics.sharpe=9999;}],
 ['missing-check',(r:Record<string,any>)=>{r.checks.pop();}],
 ['missing-stage-identity',(r:Record<string,any>)=>{delete r.stage;}]
] as const){
 test('Stage read blocks tampering: '+mutation[0],()=>fixture(root=>{
  const {file}=registered(root);
  const changed=JSON.parse(readFileSync(file,'utf8')) as Record<string,any>;
  mutation[1](changed);
  writeFileSync(file,JSON.stringify(changed)+'\n');
  const original=readFileSync(file,'utf8');
  expect(()=>readStage(root,'rules','v1',1)).toThrow(/integrity alarm/);
  const scan=inspectPipelineStageIntegrity(root);
  expect(scan.blocked).toBe(1);
  expect(scan.findings[0]?.status).toBe('blocked');
  expect(preflightStage(root,'rules','v1',2).eligible).toBe(false);
  expect(readFileSync(file,'utf8')).toBe(original);
 }));
}
test('invalid JSON and unsealed legacy Stage reports are blocked; no Stage 3 invoked',()=>fixture(root=>{
 const {file}=registered(root);
 writeFileSync(file,'{invalid');
 expect(()=>readStage(root,'rules','v1',1)).toThrow(/corrupt JSON/);
 expect(inspectPipelineStageIntegrity(root).status).toBe('blocked');
 const legacy=JSON.parse(readFileSync(join(root,'docs/strategies/registry.json'),'utf8')) as
  {strategies:Array<{versions:Array<{stageReportHashes?:Record<string,string>}>}>};
 delete legacy.strategies[0]!.versions[0]!.stageReportHashes;
 writeFileSync(join(root,'docs/strategies/registry.json'),JSON.stringify(legacy));
 expect(inspectPipelineStageIntegrity(root).status).toBe('blocked');
}));
test('reservation without a result is alarmed rather than rerun or overwritten',()=>fixture(root=>{
 const entry=register(root,{id:'rules',version:'v1',hypothesisId:'H-007',description:'Fixture'});
 const file=join(root,'docs/strategies/registry.json');
 const registry=loadRegistry(root);
 registry.strategies[0]!.versions[0]!.consumedStages=[1];
 writeFileSync(file,JSON.stringify(registry));
 const scan=inspectPipelineStageIntegrity(root);
 expect(scan.blocked).toBe(1);
 expect(scan.findings[0]?.reason).toContain('Reserved Stage has no immutable result');
 expect(scan.inspected).toBe(1);
 expect(preflightStage(root,'rules','v1',2).eligible).toBe(false);
 expect(entry.consumedStages).toEqual([]);
}));
