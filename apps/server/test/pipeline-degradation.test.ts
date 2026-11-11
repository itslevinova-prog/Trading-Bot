import {expect,test} from 'vitest';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 compareOosDegradation,DEGRADATION_REPORT_VERSION,readOosDegradation
} from '../src/pipeline/degradation-report.js';
import type {StageResult} from '../src/pipeline/registry.js';
const HASH_A='a'.repeat(64),HASH_B='b'.repeat(64);
const result=(stage:1|2,status:'passed'|'failed',metrics:Record<string,unknown>):StageResult=>({
 formatVersion:1,strategyId:'rules',version:'v1',stage,status,
 evaluatedAt:stage===1?'2023-12-31T23:59:59.000Z':'2024-12-31T23:59:59.000Z',
 codeHash:HASH_A,configHash:HASH_B,variantsTested:3,metrics,
 dataHashes:{fixtures:'c'.repeat(64)},checks:[],reasons:[],
 evidenceHash:'d'.repeat(64),source:'local:fixture'
});
test('negative once-only Stage 2 cannot be masked by a profitable Stage 1',()=>{
 const development=result(1,'passed',{
  netReturnPct:10,btcNetReturnPct:8,dcaNetReturnPct:7,
  maxDrawdownPct:12,totalCostsQuote:2,turnoverQuote:100,
  trades:20,coveragePct:98,coverageDays:1300
 });
 const validation=result(2,'failed',{
  netReturnPct:-7,btcNetReturnPct:-4,dcaNetReturnPct:-3,
  maxDrawdownPct:30,totalCostsQuote:5,turnoverQuote:100,
  trades:5,coveragePct:84,coverageDays:350
 });
 const report=compareOosDegradation(development,validation,'rules','v1');
 expect(report.version).toBe(DEGRADATION_REPORT_VERSION);
 expect(report.status).toBe('available');
 expect(report.assessment).toBe('warning');
 expect(report.development?.netReturnPct).toBe(10);
 expect(report.validation?.netReturnPct).toBe(-7);
 expect(report.validation?.gateStatus).toBe('failed');
 expect(report.delta?.netReturnPctPoints).toBe(-17);
 expect(report.development?.btcExcessPctPoints).toBe(2);
 expect(report.validation?.btcExcessPctPoints).toBe(-3);
 expect(report.delta?.btcExcessPctPoints).toBe(-5);
 expect(report.delta?.maxDrawdownPctPoints).toBe(18);
 expect(report.development?.costPerTurnoverRate).toBe(.02);
 expect(report.validation?.costPerTurnoverRate).toBe(.05);
 expect(report.delta?.trades).toBe(-15);
 expect(report.reasons).toContain('Stage 2 ist gescheitert und bleibt gescheitert');
 expect(JSON.stringify(report)).toContain('2024-12-31');
});
test('missing validation is n/a, never a fabricated Stage-2 result',()=>{
 const report=compareOosDegradation(result(1,'passed',{netReturnPct:4}),null,'rules','v1');
 expect(report.status).toBe('insufficient_evidence');
 expect(report.assessment).toBe('insufficient_evidence');
 expect(report.validation).toBeNull();
 expect(report.delta).toBeNull();
 expect(report.reasons.join(' ')).toContain('fehlt');
});
test('missing costs, benchmark, coverage and counts remain null, not optimistic zero',()=>{
 const report=compareOosDegradation(
  result(1,'passed',{netReturnPct:5,turnoverQuote:300}),
  result(2,'passed',{netReturnPct:1,costPerTurnoverRate:-.1}),
  'rules','v1');
 expect(report.status).toBe('available');
 expect(report.assessment).toBe('warning');
 expect(report.delta?.netReturnPctPoints).toBe(-4);
 expect(report.validation?.btcExcessPctPoints).toBeNull();
 expect(report.validation?.costPerTurnoverRate).toBeNull();
 expect(report.development?.costPerTurnoverRate).toBeNull();
 expect(report.validation?.coveragePct).toBeNull();
 expect(report.delta?.trades).toBeNull();
 expect(report.reasons.join(' ')).toContain('nicht vollständig');
});
test('mismatched code/config/strategy, failed Stage 1 and invalid chronology fail closed',()=>{
 const a=result(1,'passed',{netReturnPct:10}),b=result(2,'passed',{netReturnPct:20});
 const deviations=[
  {...b,codeHash:'e'.repeat(64)},
  {...b,configHash:'f'.repeat(64)},
  {...b,strategyId:'hold'},
  {...b,version:'v2'},
  {...b,evaluatedAt:'2023-01-01T00:00:00.000Z'}
 ];
 for(const invalid of deviations){
  const got=compareOosDegradation(a,invalid,'rules','v1');
  expect(got.status).toBe('insufficient_evidence');
  expect(got.delta).toBeNull();
 }
 expect(compareOosDegradation({...a,status:'failed'},b,'rules','v1').status)
  .toBe('insufficient_evidence');
});
test('read-only helper never evaluates Stage 2 or creates local files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'oos-degradation-'));
 try{
  const before=readdirSync(dir);
  const report=readOosDegradation(dir,'rules','v1');
  expect(report.status).toBe('insufficient_evidence');
  expect(report.development).toBeNull();
  expect(readdirSync(dir)).toEqual(before);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
