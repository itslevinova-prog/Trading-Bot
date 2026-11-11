import {afterEach,beforeEach,expect,test} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beginResearchVariant,finishResearchVariant,auditResearchVariants} from '../src/pipeline/variants-audit.js';
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
const from=Date.UTC(2022,0,1),to=Date.UTC(2023,0,1);
let root:string;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'variants-audit-'));});
afterEach(()=>{rmSync(root,{recursive:true,force:true});});
const begin=(configHash=a,candidate='alpha',codeHash=a,dataHash=a)=> {
 const run=beginResearchVariant(root,{
  hypothesisId:'H-007',candidate,codeHash,configHash,fromMs:from,toMs:to
 },from);
 return {run,dataHash};
};
test('second parameter choice counts; identical deterministic replay does not count',()=>{
 const one=begin(a,'alpha'),first=finishResearchVariant(root,one.run,one.dataHash,from+1);
 expect(first).toBe('new-variant');
 expect(auditResearchVariants(root,'H-007',1,0)).toEqual(expect.objectContaining({
  complete:true,uniqueVariants:1,replays:0,unfinished:0
 }));
 const second=begin(a,'different-label');
 expect(finishResearchVariant(root,second.run,second.dataHash,from+10)).toBe('deterministic-replay');
 const third=begin(b,'changed-settings');
 expect(finishResearchVariant(root,third.run,third.dataHash,from+20)).toBe('new-variant');
 expect(auditResearchVariants(root,'H-007',2,0)).toEqual(expect.objectContaining({
  complete:true,uniqueVariants:2,replays:1,unfinished:0
 }));
 expect(auditResearchVariants(root,'H-007',1,0).complete).toBe(false);
});
test('distinct data and code hashes count independently and all rows are chained',()=>{
 for(const [configHash,codeHash,dataHash] of [[a,a,a],[a,a,b],[a,b,a]] as const){
  const run=beginResearchVariant(root,{hypothesisId:'H-007',
   candidate:'replay-lab',codeHash,configHash,fromMs:from,toMs:to},from);
  expect(finishResearchVariant(root,run,dataHash,from+1)).toBe('new-variant');
 }
 const path=join(root,'data/research/variant-attempts.jsonl');
 const rows=readFileSync(path,'utf8').trim().split('\n').map(v=>JSON.parse(v) as {
  prevHash:string|null;hash:string;kind:string
 });
 expect(rows).toHaveLength(6);
 expect(rows.map(x=>x.kind)).toEqual(['begin','finish','begin','finish','begin','finish']);
 for(let i=0;i<rows.length;i++)expect(rows[i]!.prevHash).toBe(rows[i-1]?.hash??null);
 expect(auditResearchVariants(root,'H-007',3,0).complete).toBe(true);
});
test('crashed and unaccounted research attempts fail closed',()=>{
 beginResearchVariant(root,{hypothesisId:'H-007',candidate:'pending',
  codeHash:a,configHash:a,fromMs:from,toMs:to},from);
 expect(auditResearchVariants(root,'H-007',1,0)).toEqual(expect.objectContaining({
  complete:false,uniqueVariants:0,unfinished:1
 }));
 expect(auditResearchVariants(root,'H-007',0,0).complete).toBe(false);
});
test('preexisting historical baseline is not reconstructed from counts without evidence',()=>{
 expect(auditResearchVariants(root,'H-007',0,null)).toEqual(expect.objectContaining({
  complete:false,reason:'Historical variant baseline is unknown'
 }));
 const one=begin();
 finishResearchVariant(root,one.run,c);
 expect(auditResearchVariants(root,'H-007',1,5)).toEqual(expect.objectContaining({
  complete:false,baselineVariants:5,uniqueVariants:1
 }));
});
test('corrupted or truncated journal cannot be evaluated or silently repaired',()=>{
 const one=begin(),path=join(root,'data/research/variant-attempts.jsonl');
 finishResearchVariant(root,one.run,a);
 const original=readFileSync(path,'utf8');
 const tampered=original.replace('"candidate":"alpha"','"candidate":"other"');
 writeFileSync(path,tampered);
 expect(()=>auditResearchVariants(root,'H-007',1,0)).toThrow(/hash-chain/);
 writeFileSync(path,original.slice(0,-1));
 expect(()=>auditResearchVariants(root,'H-007',1,0)).toThrow(/Truncated/);
});
test('rejects validation/holdout, invalid identifiers and duplicate finish',()=>{
 expect(()=>beginResearchVariant(root,{hypothesisId:'H-007',candidate:'alpha',
  codeHash:a,configHash:a,fromMs:Date.UTC(2024,0,1),toMs:Date.UTC(2024,0,2)}))
  .toThrow(/2020–2023/);
 expect(()=>beginResearchVariant(root,{hypothesisId:'H-007',candidate:'alpha',
  codeHash:a,configHash:a,fromMs:Date.UTC(2025,0,1),toMs:Date.UTC(2025,0,2)}))
  .toThrow(/2020–2023/);
 expect(()=>beginResearchVariant(root,{hypothesisId:'H-007',candidate:'bad candidate',
  codeHash:a,configHash:a,fromMs:from,toMs:to})).toThrow();
 const one=begin();
 finishResearchVariant(root,one.run,b);
 expect(()=>finishResearchVariant(root,one.run,b)).toThrow(/already completed/);
});
