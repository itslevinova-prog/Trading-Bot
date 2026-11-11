import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';import {dirname} from 'node:path';import {mkdirSync} from 'node:fs';
import {assertInitialIntent,assertIntentTransition,isUnresolvedIntent} from './intent-state.js';
export type Intent={id:string;pair:string;side:string;state:string;createdAt:number;payload:string;result:string};
export type IntentEvent={ordinal:number;fromState:string|null;toState:string;result:string;recordedAt:number;intentHash:string;previousHash:string;eventHash:string;origin:'initial'|'transition'|'legacy_transition'};
export type IntentAudit={recordedFromOrigin:boolean;events:IntentEvent[];localIntegrityChecked:true;exchangeOutcomeAttested:false};
export interface Journal {get(id:string):Intent|undefined;unresolved():Intent[];recent(since:number):Intent[];put(intent:Intent):void;update(id:string,state:string,result:string):void;getMeta(key:string):string|undefined;setMeta(key:string,value:string):void;transition?(id:string,from:string,to:string,result:string):void;audit?(id:string):IntentAudit;}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const intentHash=(i:Intent)=>hash({id:i.id,pair:i.pair,side:i.side,createdAt:i.createdAt,payload:i.payload});
const hashEvent=(id:string,event:Omit<IntentEvent,'eventHash'>)=>hash({id,...event});
const bounded=(text:string,max:number)=>typeof text==='string'&&Buffer.byteLength(text,'utf8')<=max;
function validate(i:Intent){if(!/^[A-Za-z0-9_:-]{1,100}$/.test(i.id)||!/^[-A-Z0-9.]{1,40}\/[-A-Z0-9.]{1,40}$/.test(i.pair)||!Number.isSafeInteger(i.createdAt)||i.createdAt<0||!bounded(i.side,20)||!bounded(i.state,64)||!bounded(i.payload,100000)||!bounded(i.result,500000))throw Error('Invalid bounded native intent');}
const selectFields='ordinal,from_state AS fromState,to_state AS toState,result,recorded_at AS recordedAt,intent_hash AS intentHash,previous_hash AS previousHash,event_hash AS eventHash,origin';
export class SqliteJournal implements Journal {
 private db:Database.Database;
 constructor(file:string,identity:string){
  mkdirSync(dirname(file),{recursive:true});this.db=new Database(file);
  try{
   this.db.pragma('journal_mode=WAL');this.db.pragma('synchronous=FULL');this.db.pragma('foreign_keys=ON');
   this.db.exec('CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY,pair TEXT NOT NULL,side TEXT NOT NULL,state TEXT NOT NULL,createdAt INTEGER NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL);CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
   const old=this.getMeta('identity');if(old&&old!==identity)throw Error('Live-Journal gehört zu anderem Netzwerk/Konto');
   this.db.exec(`CREATE TABLE IF NOT EXISTS intent_events(intent_id TEXT NOT NULL REFERENCES intents(id),ordinal INTEGER NOT NULL,from_state TEXT,to_state TEXT NOT NULL,result TEXT NOT NULL,recorded_at INTEGER NOT NULL,intent_hash TEXT NOT NULL,previous_hash TEXT NOT NULL,event_hash TEXT NOT NULL,origin TEXT NOT NULL,PRIMARY KEY(intent_id,ordinal));`);
   this.db.exec('CREATE TABLE IF NOT EXISTS legacy_intent_origins(intent_id TEXT PRIMARY KEY REFERENCES intents(id),observed_at INTEGER NOT NULL,intent_hash TEXT NOT NULL,observed_state TEXT NOT NULL,result_hash TEXT NOT NULL)');
   const version=this.getMeta('nativeJournalSchema');if(version&&version!=='2')throw Error('Unsupported native journal schema');
   if(!version)this.db.transaction(()=>{const rows=this.db.prepare('SELECT * FROM intents LIMIT 10001').all() as Intent[];if(rows.length>10000)throw Error('Legacy native journal exceeds review bound');for(const row of rows){validate(row);if(this.events(row.id).length)throw Error('Unversioned native event history');this.db.prepare('INSERT INTO legacy_intent_origins VALUES (?,?,?,?,?)').run(row.id,Date.now(),intentHash(row),row.state,hash(row.result));}this.setMeta('nativeJournalSchema','2');}).immediate();
   this.setMeta('identity',identity);
  }catch(error){this.db.close();throw error;}
 }
 private raw(id:string){return this.db.prepare('SELECT * FROM intents WHERE id=?').get(id) as Intent|undefined;}
 private events(id:string){const size=this.db.prepare('SELECT count(*) AS n,coalesce(sum(length(CAST(result AS BLOB))),0) AS bytes FROM intent_events WHERE intent_id=?').get(id) as {n:number;bytes:number};if(size.n>10000||size.bytes>10000000)throw Error('Native event history exceeds review bound');const rows=this.db.prepare(`SELECT ${selectFields} FROM intent_events WHERE intent_id=? ORDER BY ordinal LIMIT 10001`).all(id) as IntentEvent[];if(rows.length>10000)throw Error('Native event history exceeds review bound');return rows;}
 private auditInside(id:string):IntentAudit{
  const row=this.raw(id);if(!row)throw Error('Native intent missing');const events=this.events(id),legacy=this.db.prepare('SELECT * FROM legacy_intent_origins WHERE intent_id=?').get(id) as {intent_hash:string;observed_state:string;result_hash:string}|undefined;if(!events.length&&(!legacy||legacy.intent_hash!==intentHash(row)||legacy.observed_state!==row.state||legacy.result_hash!==hash(row.result)))throw Error('Native origin evidence missing or changed');if(events[0]?.origin==='legacy_transition'&&(!legacy||legacy.intent_hash!==intentHash(row)||legacy.observed_state!==events[0].fromState)||events[0]?.origin==='initial'&&legacy)throw Error('Native legacy origin mismatch');let previous='';let previousState:string|null=null;
  for(const [index,event] of events.entries()){
   const {eventHash:recorded,...contents}=event;
   if(event.ordinal!==index+1||event.previousHash!==previous||event.intentHash!==intentHash(row)||!Number.isSafeInteger(event.recordedAt)||event.recordedAt<0||recorded!==hashEvent(id,contents)||index>0&&event.fromState!==previousState||index===0&&!(event.origin==='initial'&&event.fromState===null||event.origin==='legacy_transition'&&event.fromState!==null)||index>0&&event.origin!=='transition')throw Error('Native journal evidence mismatch');
   if(event.origin==='initial')assertInitialIntent(row.side,event.toState);else assertIntentTransition(row.side,event.fromState!,event.toState);
   previous=event.eventHash;previousState=event.toState;
  }
  const last=events.at(-1);if(last&&(last.toState!==row.state||last.result!==row.result))throw Error('Native journal current state mismatch');
  return {recordedFromOrigin:events[0]?.origin==='initial',events,localIntegrityChecked:true,exchangeOutcomeAttested:false};
 }
 audit(id:string):IntentAudit{return this.db.transaction(()=>this.auditInside(id))();}
 private checked(id:string){const row=this.raw(id);if(row)this.auditInside(id);return row;}
 get(id:string){return this.db.transaction(()=>this.checked(id))();}
 private checkedRows(rows:Intent[]){if(rows.length>10000)throw Error('Native journal row bound exceeded');for(const row of rows)this.auditInside(row.id);return rows;}
 unresolved(){return this.db.transaction(()=>{if((this.db.pragma('foreign_key_check') as unknown[]).length)throw Error('Native journal orphaned evidence');const keys=this.db.prepare('SELECT id FROM intents ORDER BY createdAt,id LIMIT 10001').all() as {id:string}[];if(keys.length>10000)throw Error('Native journal row bound exceeded');return keys.map(row=>this.checked(row.id)!).filter(isUnresolvedIntent);})();}
 recent(since:number){if(!Number.isFinite(since))throw Error('Invalid journal range');return this.db.transaction(()=>this.checkedRows(this.db.prepare('SELECT * FROM intents WHERE createdAt>=? ORDER BY createdAt,id LIMIT 10001').all(since) as Intent[]))();}

 private append(i:Intent,fromState:string|null,origin:IntentEvent['origin']){
  const rows=this.events(i.id),last=rows.at(-1);if(rows.length>=10000||rows.reduce((bytes,e)=>bytes+Buffer.byteLength(e.result,'utf8'),0)+Buffer.byteLength(i.result,'utf8')>10000000)throw Error('Native event history exceeds review bound');
  const content:Omit<IntentEvent,'eventHash'>={ordinal:rows.length+1,fromState,toState:i.state,result:i.result,recordedAt:Date.now(),intentHash:intentHash(i),previousHash:last?.eventHash??'',origin};
  this.db.prepare('INSERT INTO intent_events VALUES (@id,@ordinal,@fromState,@toState,@result,@recordedAt,@intentHash,@previousHash,@eventHash,@origin)').run({id:i.id,...content,eventHash:hashEvent(i.id,content)});
 }
 put(i:Intent){validate(i);assertInitialIntent(i.side,i.state);this.db.transaction(()=>{this.db.prepare('INSERT INTO intents VALUES (@id,@pair,@side,@state,@createdAt,@payload,@result)').run(i);this.append(i,null,'initial');}).immediate();}
 /** Reserve an exit atomically against every unresolved mutation in this account journal. */
 reserveExit(i:Intent){if(i.side!=='sell'||i.state!=='exit_prepared')throw Error('Invalid exit reservation');this.db.transaction(()=>{if(this.unresolved().length)throw Error('Another unresolved native mutation blocks exit reservation');this.put(i);}).immediate();}
 transition(id:string,from:string,to:string,result:string){
  if(!bounded(result,500000))throw Error('Native receipt exceeds bound');
  this.db.transaction(()=>{
   const row=this.get(id);if(!row||row.state!==from)throw Error('Native intent phase changed or missing');assertIntentTransition(row.side,from,to);
   const changed=this.db.prepare('UPDATE intents SET state=?,result=? WHERE id=? AND state=?').run(to,result,id,from);if(changed.changes!==1)throw Error('Native intent transition not committed');
   this.append({...row,state:to,result},from,this.events(id).length?'transition':'legacy_transition');
  }).immediate();
 }
 update(id:string,state:string,result:string){const row=this.get(id);if(!row)throw Error('Native intent missing');this.transition(id,row.state,state,result);}
 getMeta(key:string){return (this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined)?.value;}
 setMeta(key:string,value:string){if(!bounded(key,100)||!bounded(value,100000))throw Error('Invalid journal metadata');this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
 close(){this.db.close();}
}
