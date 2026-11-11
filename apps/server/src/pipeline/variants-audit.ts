import {createHash} from 'node:crypto';
import {appendFileSync,closeSync,existsSync,mkdirSync,openSync,readFileSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

const HASH=/^[a-f0-9]{64}$/;
const HYPOTHESIS=/^H-[0-9]{3}$/;
const CANDIDATE=/^[a-zA-Z0-9._-]{1,100}$/;
const FROM=Date.UTC(2020,0,1),TO=Date.UTC(2024,0,1);
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type VariantBegin={
 kind:'begin';at:string;hypothesisId:string;candidate:string;codeHash:string;
 configHash:string;fromMs:number;toMs:number;prevHash:string|null;hash:string;
};
export type VariantFinish={
 kind:'finish';at:string;runId:string;dataHash:string;
 outcome:'new-variant'|'deterministic-replay';replayOf:string|null;
 prevHash:string|null;hash:string;
};
export type VariantEvent=VariantBegin|VariantFinish;
export type VariantAudit={
 hypothesisId:string;uniqueVariants:number;replays:number;unfinished:number;
 baselineVariants:number|null;complete:boolean;expectedRegistryCount:number;
 reason:string|null;fingerprint:string|null;
};
const fileFor=(root:string)=>resolve(root,'data/research/variant-attempts.jsonl');
function withLock<T>(root:string,callback:()=>T):T{
 const path=fileFor(root),lock=path+'.lock';
 mkdirSync(dirname(path),{recursive:true});
 const fd=openSync(lock,'wx');
 try{return callback();}finally{closeSync(fd);unlinkSync(lock);}
}
function validatedEvents(root:string):VariantEvent[]{
 const file=fileFor(root);
 if(!existsSync(file))return [];
 const raw=readFileSync(file,'utf8'),rows:VariantEvent[]=[];
 if(raw&&!raw.endsWith('\n'))throw Error('Truncated research variant journal');
 for(const line of raw.split('\n').filter(Boolean)){
  const row=JSON.parse(line) as VariantEvent,prev=rows.at(-1)?.hash??null;
  if(!row||typeof row!=='object'||row.prevHash!==prev||
     typeof row.at!=='string'||!Number.isFinite(Date.parse(row.at))||
     typeof row.hash!=='string'||!HASH.test(row.hash))
   throw Error('Corrupt research variant journal row');
  const {hash,...fields}=row;
  if(digest(fields)!==hash)throw Error('Research variant journal hash-chain mismatch');
  if(row.kind==='begin'){
   if(!HYPOTHESIS.test(row.hypothesisId)||!CANDIDATE.test(row.candidate)||
      !HASH.test(row.codeHash)||!HASH.test(row.configHash)||
      !Number.isSafeInteger(row.fromMs)||!Number.isSafeInteger(row.toMs)||
      row.fromMs<FROM||row.toMs>TO||row.fromMs>=row.toMs)
    throw Error('Invalid archived research variant begin event');
  }else if(row.kind==='finish'){
   if(!HASH.test(row.runId)||!HASH.test(row.dataHash)||
      !['new-variant','deterministic-replay'].includes(row.outcome)||
      row.replayOf!==null&&!HASH.test(row.replayOf))
    throw Error('Invalid archived research variant finish event');
  }else throw Error('Unexpected research journal event type');
  rows.push(row);
 }
 const begin=new Map<string,VariantBegin>(),completed=new Set<string>();
 const first=new Map<string,string>();
 for(const row of rows){
  if(row.kind==='begin'){begin.set(row.hash,row);continue;}
  const started=begin.get(row.runId);
  if(!started||completed.has(row.runId))throw Error('Orphan or duplicate research journal finish');
  const key=digest([started.hypothesisId,started.codeHash,started.configHash,row.dataHash]);
  const prev=first.get(key)??null;
  if((prev===null)!==(row.outcome==='new-variant')||row.replayOf!==prev)
   throw Error('Dishonest research replay classification');
  if(prev===null)first.set(key,row.runId);
  completed.add(row.runId);
 }
 return rows;
}
function appendEvent<T extends Omit<VariantBegin,'hash'>|Omit<VariantFinish,'hash'>>(
 root:string,event:T,rows:VariantEvent[]
):string {
 const hash=digest(event);
 appendFileSync(fileFor(root),JSON.stringify({...event,hash})+'\n',{encoding:'utf8',flag:'a'});
 rows.push({...event,hash} as VariantEvent);
 return hash;
}
export function beginResearchVariant(root:string,input:{
 hypothesisId:string;candidate:string;codeHash:string;configHash:string;
 fromMs:number;toMs:number;
},now=Date.now()):string {
 if(!HYPOTHESIS.test(input.hypothesisId)||!CANDIDATE.test(input.candidate)||
    !HASH.test(input.codeHash)||!HASH.test(input.configHash)||
    !Number.isSafeInteger(input.fromMs)||!Number.isSafeInteger(input.toMs)||
    input.fromMs<FROM||input.toMs>TO||input.fromMs>=input.toMs)
  throw Error('Research variant attempts require 2020–2023 dates and complete hashes');
 return withLock(root,()=>{
  const rows=validatedEvents(root);
  return appendEvent(root,{kind:'begin',at:new Date(now).toISOString(),...input,
   prevHash:rows.at(-1)?.hash??null},rows);
 });
}
export function finishResearchVariant(
 root:string,runId:string,dataHash:string,now=Date.now()
):'new-variant'|'deterministic-replay' {
 if(!HASH.test(runId)||!HASH.test(dataHash))throw Error('Invalid research finish hash');
 return withLock(root,()=>{
  const rows=validatedEvents(root);
  const begin=rows.find((row):row is VariantBegin=>row.kind==='begin'&&row.hash===runId);
  if(!begin||rows.some(row=>row.kind==='finish'&&row.runId===runId))
   throw Error('Research attempt missing or already completed');
  const prior=rows.flatMap(row=>{
   if(row.kind!=='finish'||row.outcome!=='new-variant')return [];
   const previous=rows.find((x):x is VariantBegin=>x.kind==='begin'&&x.hash===row.runId);
   return previous?.hypothesisId===begin.hypothesisId&&previous.codeHash===begin.codeHash&&
    previous.configHash===begin.configHash&&row.dataHash===dataHash?[row.runId]:[];
  })[0]??null;
  const outcome=prior?'deterministic-replay':'new-variant';
  appendEvent(root,{kind:'finish',at:new Date(now).toISOString(),runId,dataHash,outcome,
   replayOf:prior,prevHash:rows.at(-1)?.hash??null},rows);
  return outcome;
 });
}
/** Existing baseline counts are not assumed independently verified. Until
 * a separate historical reconciliation is supplied, Stage 1 fails closed. */
export function auditResearchVariants(
 root:string,hypothesisId:string,expectedRegistryCount:number,baselineVariants:number|null
):VariantAudit {
 if(!HYPOTHESIS.test(hypothesisId)||!Number.isSafeInteger(expectedRegistryCount)||
    expectedRegistryCount<0||
    baselineVariants!==null&&(!Number.isSafeInteger(baselineVariants)||baselineVariants<0))
  throw Error('Invalid variant audit request');
 const rows=validatedEvents(root);
 const began=new Map(rows.filter((row):row is VariantBegin=>row.kind==='begin').map(row=>[row.hash,row]));
 const finished=rows.filter((row):row is VariantFinish=>row.kind==='finish');
 const done=new Set(finished.map(row=>row.runId));
 const selected=finished.filter(row=>began.get(row.runId)?.hypothesisId===hypothesisId);
 const uniqueVariants=selected.filter(row=>row.outcome==='new-variant').length;
 const replays=selected.filter(row=>row.outcome==='deterministic-replay').length;
 const unfinished=[...began.values()].filter(row=>row.hypothesisId===hypothesisId&&!done.has(row.hash)).length;
 const reason=baselineVariants===null?'Historical variant baseline is unknown':
  baselineVariants>0?'Existing baseline variants are not backed by immutable trial records':
  unfinished?'Unfinished research attempts cannot be reconciled':
  uniqueVariants!==expectedRegistryCount?'Unique historical attempts do not match registered variantsTested':null;
 return {hypothesisId,uniqueVariants,replays,unfinished,baselineVariants,
  expectedRegistryCount,complete:reason===null,reason,
  fingerprint:rows.length?digest(rows.map(row=>row.hash)):null};
}
