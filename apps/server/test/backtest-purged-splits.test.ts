import {expect,test} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPurgedDevelopmentFolds,verifyPurgedFoldSelections,type OutcomeLabel,
 type DevelopmentFoldReport} from '../src/backtest/splits.js';
import {adaptPurgedDevelopmentEvidence} from '../src/pipeline/evaluate.js';
import type {Evidence} from '../src/pipeline/gates.js';
const DAY=86_400_000;
const utc=(date:string)=>Date.parse(date+'T00:00:00Z');
const from=utc('2022-01-10'),to=utc('2022-01-12');
const labels:OutcomeLabel[]=[
 {id:'a',labelStartMs:utc('2022-01-01'),labelEndMs:utc('2022-01-05')},
 {id:'b',labelStartMs:utc('2022-01-04'),labelEndMs:utc('2022-01-08')},
 {id:'c',labelStartMs:utc('2022-01-07'),labelEndMs:utc('2022-01-09')},
 {id:'d',labelStartMs:utc('2022-01-07'),labelEndMs:utc('2022-01-11')},
 {id:'e',labelStartMs:utc('2022-01-10'),labelEndMs:utc('2022-01-11')},
 {id:'f',labelStartMs:utc('2022-01-11'),labelEndMs:utc('2022-01-13')},
 {id:'g',labelStartMs:utc('2022-01-12'),labelEndMs:utc('2022-01-14')}
];
const windows=[{fromMs:from,toMs:to},{fromMs:utc('2022-01-16'),toMs:utc('2022-01-18')}];
const report=()=>buildPurgedDevelopmentFolds(labels,windows,2);
test('overlapping training outcomes purged, one-sided embargo excludes prior outcomes',()=>{
 const fold=report().folds[0]!;
 expect(fold.trainIndices).toEqual([0,1]);
 expect(fold.embargoIndices).toEqual([2]);
 expect(fold.purgedIndices).toEqual([3]);
 expect(fold.testIndices).toEqual([4]);
 expect(fold.unresolvedTestIndices).toEqual([5]);
 expect(fold.futureIndices).toEqual([6]);
 expect(fold.dataSplitId).toBe('data-splits-v1');
 expect(fold.embargoMs).toBe(2*DAY);
 for(const index of fold.trainIndices)
  expect(labels[index]!.labelEndMs).toBeLessThanOrEqual(from-2*DAY);
});
test('boundary exactly at embargo cutoff is legal, overlap at test boundary is excluded',()=>{
 const f=report().folds[0]!;
 expect(f.trainIndices).toContain(1);
 expect(f.purgedIndices).toContain(3);
 const zero=buildPurgedDevelopmentFolds(labels,[windows[0]!],0).folds[0]!;
 expect(zero.trainIndices).toContain(2);
 expect(zero.trainIndices).not.toContain(3);
});
test('canonical fold indices, fingerprints and training membership are insensitive to input ordering',()=>{
 const a=report(),b=buildPurgedDevelopmentFolds([...labels].reverse(),windows,2);
 expect(a).toEqual(b);
 expect(a.folds[1]?.foldIndex).toBe(1);
 expect(a.folds[1]?.trainIndices).toEqual([0,1,2,3,4,5,6]);
 expect(a.foldFingerprint).toMatch(/^[a-f0-9]{64}$/);
 const different=buildPurgedDevelopmentFolds(labels,windows,3);
 expect(different.foldFingerprint).not.toBe(a.foldFingerprint);
});
test('fail closed on overlapping folds, invalid outcomes and forbidden 2024/holdout windows',()=>{
 expect(()=>buildPurgedDevelopmentFolds(labels,[windows[0]!,{fromMs:from+DAY,toMs:to+DAY}],2))
  .toThrow(/disjoint chronological/);
 expect(()=>buildPurgedDevelopmentFolds(labels,[{fromMs:utc('2024-01-01'),toMs:utc('2024-01-02')}],2))
  .toThrow(/development/);
 expect(()=>buildPurgedDevelopmentFolds([...labels,{id:'h',labelStartMs:utc('2023-12-31'),labelEndMs:utc('2024-01-02')}],windows,2))
  .toThrow(/unbounded/);
 expect(()=>buildPurgedDevelopmentFolds(labels.map(x=>({...x,id:'duplicate'})),windows,2)).toThrow(/Duplicate/);
 expect(()=>buildPurgedDevelopmentFolds(labels,windows,-1)).toThrow(/Embargo/);
});
test('actual variant train/test selections must equal pure fold contract',()=>{
 const result=report(),selection=result.folds.map(f=>({
  foldIndex:f.foldIndex,trainIndices:[...f.trainIndices],testIndices:[...f.testIndices]
 }));
 verifyPurgedFoldSelections(result,selection);
 expect(()=>verifyPurgedFoldSelections(result,selection.map((s,i)=>i? s:{
  ...s,trainIndices:[...s.trainIndices,...result.folds[0]!.purgedIndices]
 }))).toThrow(/Unpurged/);
 expect(()=>verifyPurgedFoldSelections(result,selection.slice(0,1))).toThrow(/all forward folds/i);
});
function fixture<T>(run:(root:string)=>T):T{
 const root=mkdtempSync(join(tmpdir(),'development-split-'));
 try{
  mkdirSync(join(root,'docs'),{recursive:true});
  writeFileSync(join(root,'docs/data-splits-v1.json'),JSON.stringify({
   version:1,immutable:true,development:{start:'2020-01-01',end:'2023-12-31'},
   validation:{start:'2024-01-01'},holdout:{start:'2025-01-01'}
  }));
  return run(root);
 }finally{rmSync(root,{recursive:true,force:true});}
}
function evidence(base:DevelopmentFoldReport):Evidence{
 const selection=base.folds.map(x=>({
  foldIndex:x.foldIndex,trainIndices:[...x.trainIndices],testIndices:[...x.testIndices]
 }));
 return {
  stage:1,strategyId:'rules',version:'v1',codeHash:'a'.repeat(64),
  configHash:'b'.repeat(64),periodFrom:'2020-01-01',periodToExclusive:'2024-01-01',
  source:'local:fixture',dataHashes:{candles:'c'.repeat(64)},
  metrics:{
   variantsTested:2,developmentLabelWindows:labels,developmentTestWindows:windows,
   developmentEmbargoDays:2,
   developmentFoldSelectionsByVariant:[
    {variantId:'rules-a',folds:selection},{variantId:'rules-b',folds:selection}
   ]
  }
 };
}
test('Stage 1 adapter verifies every variant, unchanged split id and source hashes',()=>fixture(root=>{
 const original=evidence(report());
 const enriched=adaptPurgedDevelopmentEvidence(root,original);
 expect(enriched.metrics.purgedFoldAudit).toEqual(expect.objectContaining({
  dataSplitId:'data-splits-v1',embargoMs:2*DAY,foldFingerprint:report().foldFingerprint
 }));
 expect(enriched.dataHashes.immutableDataSplit).toMatch(/^[a-f0-9]{64}$/);
 expect(enriched.dataHashes.purgedFolds).toBe(report().foldFingerprint);
 expect(original.dataHashes.immutableDataSplit).toBeUndefined();
 const altered=evidence(report()),variants=altered.metrics.developmentFoldSelectionsByVariant as
  Array<{variantId:string;folds:Array<{foldIndex:number;trainIndices:number[];testIndices:number[]}>}>;
 variants[1]!.folds[0]!.trainIndices.push(3);
 expect(()=>adaptPurgedDevelopmentEvidence(root,altered)).toThrow(/Unpurged/);
}));
test('Stage 1 rejects missing actual audit and changed protected time split',()=>fixture(root=>{
 const missing=evidence(report());delete missing.metrics.developmentLabelWindows;
 expect(()=>adaptPurgedDevelopmentEvidence(root,missing)).toThrow(/Missing recorded/);
 writeFileSync(join(root,'docs/data-splits-v1.json'),JSON.stringify({
  version:1,immutable:true,development:{start:'2020-01-01',end:'2024-12-31'},
  validation:{start:'2024-01-01'},holdout:{start:'2025-01-01'}
 }));
 expect(()=>adaptPurgedDevelopmentEvidence(root,evidence(report()))).toThrow(/Changed or invalid/);
}));
