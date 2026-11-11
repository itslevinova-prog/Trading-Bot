import type {DecisionContext} from '@paper/shared';
type Obj=Record<string,any>;const object=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v),KEY='researchDigestEncoding',REF='$researchDigest',HEX=/^[a-f0-9]{64}$/;
/** Exact string references only: full source hashes stay in the packet, never shortened. */
export function expandResearchDigests(value:unknown){
 if(!object(value)||!Object.hasOwn(value,KEY))return;
 const meta=value[KEY];if(!object(meta)||meta.format!=='value-digests-v1'||Object.keys(meta).some(k=>!['format','digests'].includes(k))||!Array.isArray(meta.digests)||Array.from(meta.digests).some(s=>typeof s!=='string'||!HEX.test(s))||new Set(meta.digests).size!==meta.digests.length)throw Error('Invalid research digest table');
 const updates:{parent:any;key:string;value:string}[]=[];
 const walk=(v:unknown,parent:any,key:string)=>{if(v&&typeof v==='object'){
  if(object(v)&&Object.hasOwn(v,REF)){const i=v[REF];if(Object.keys(v).length!==1||!Number.isSafeInteger(i)||i<0||i>=meta.digests.length)throw Error('Invalid research digest reference');updates.push({parent,key,value:meta.digests[i]});return;}
  for(const[k,x]of Object.entries(v))walk(x,v,k);
 }};
 for(const[k,v]of Object.entries(value))if(k!==KEY)walk(v,value,k);
 for(const u of updates)u.parent[u.key]=u.value;delete value[KEY];
}
export function encodeResearchDigests(context:DecisionContext):DecisionContext{
 const copy=JSON.parse(JSON.stringify(context));expandResearchDigests(copy);const counts=new Map<string,number>();
 const scan=(v:unknown)=>{if(typeof v==='string'&&HEX.test(v))counts.set(v,(counts.get(v)??0)+1);else if(v&&typeof v==='object'){if(object(v)&&Object.hasOwn(v,REF))throw Error('Reserved research digest reference collision');Object.values(v).forEach(scan);}};scan(copy);
 const digests=[...counts].filter(([,n])=>n>=3).map(([s])=>s).sort();if(!digests.length)return copy;const index=new Map(digests.map((s,i)=>[s,i])),before=JSON.stringify(copy).length;
 const replace=(v:any):any=>{if(typeof v==='string'&&index.has(v))return {[REF]:index.get(v)};if(Array.isArray(v))return v.map(replace);if(object(v))return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)]));return v;};
 const result=replace(copy);result[KEY]={format:'value-digests-v1',digests};return JSON.stringify(result).length<before?result:copy;
}
