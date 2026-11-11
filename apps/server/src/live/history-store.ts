import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';import {isAbsolute,resolve,dirname} from 'node:path';import {lstatSync,mkdirSync} from 'node:fs';
import type {Candle} from '@paper/shared';import {historyPlan} from '../market/history.js';import {tradingBase,type TradingEnvironment} from './BinanceClient.js';
export const NATIVE_HISTORY_DAYS=90;
export function nativeHistoryPlan(known:number[],interval:15|60,now:number){if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid native history clock');return historyPlan(known,interval,NATIVE_HISTORY_DAYS,Math.floor(now/(interval*60000))*interval*60000,2,1);}
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function safePath(path:string){let at=resolve(path);for(;;){let stat;try{stat=lstatSync(at);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}if(stat?.isSymbolicLink())throw Error('Native public history path may not use links');const next=dirname(at);if(next===at)break;at=next;}}
function key(pair:string,interval:number,quote:string){if(!new RegExp(`^[A-Z0-9.-]{1,40}/${quote}$`).test(pair)||![15,60].includes(interval))throw Error('Invalid native history series');}
function valid(c:Candle,pair:string,interval:15|60,asOf:number){if(c.pair!==pair||c.interval!==interval||!Number.isSafeInteger(c.ts)||c.ts<0||c.ts%(interval*60000)!==0||c.ts+interval*60000>asOf||![c.open,c.high,c.low,c.close,c.volume].every(x=>typeof x==='number'&&Number.isFinite(x))||c.low<=0||c.volume<0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close))throw Error('Invalid closed native history candle');}
export type StoredHistory={bars:Candle[];storedAsOf:number|null;storedHash:string|null;dataHash:string|null};
/** Local public-data consistency, not exchange attestation. No private account tables or keys. */
export class NativeHistoryStore {
 private db:Database.Database;readonly file:string;readonly namespace:string;
 constructor(root:string,readonly network:TradingEnvironment,readonly quote:string){
  if(!isAbsolute(root)||!['live','testnet'].includes(network)||!['EUR','USDT','USDC'].includes(quote))throw Error('Invalid native history namespace');safePath(root);mkdirSync(root,{recursive:true});this.file=resolve(root,`native-public-${network}-${quote}.db`);for(const suffix of ['','-wal','-shm'])safePath(this.file+suffix);
  this.namespace=JSON.stringify({format:1,venue:'binance',network,quote,origin:tradingBase(network)});this.db=new Database(this.file,{timeout:2000});
  try{const names=(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).map(r=>r.name);if(names.some(n=>!['identity','series','history_bars'].includes(n)))throw Error('Foreign database is not a native public history cache');
   this.db.pragma('journal_mode=WAL');this.db.pragma('synchronous=FULL');this.db.pragma('foreign_keys=ON');
   this.db.exec('CREATE TABLE IF NOT EXISTS identity(id INTEGER PRIMARY KEY CHECK(id=1),namespace TEXT NOT NULL); CREATE TABLE IF NOT EXISTS series(pair TEXT NOT NULL,interval INTEGER NOT NULL,as_of INTEGER NOT NULL,row_count INTEGER NOT NULL,data_hash TEXT NOT NULL,PRIMARY KEY(pair,interval)); CREATE TABLE IF NOT EXISTS history_bars(pair TEXT NOT NULL,interval INTEGER NOT NULL,ts INTEGER NOT NULL,open REAL NOT NULL,high REAL NOT NULL,low REAL NOT NULL,close REAL NOT NULL,volume REAL NOT NULL,PRIMARY KEY(pair,interval,ts),FOREIGN KEY(pair,interval) REFERENCES series(pair,interval));');
   const identity=this.db.prepare('SELECT namespace FROM identity WHERE id=1').get() as {namespace:string}|undefined;if(identity&&identity.namespace!==this.namespace)throw Error('Native public history namespace mismatch');if(!identity){if((this.db.prepare('SELECT COUNT(*) AS n FROM series').get() as {n:number}).n||(this.db.prepare('SELECT COUNT(*) AS n FROM history_bars').get() as {n:number}).n)throw Error('Native public history has no original identity');this.db.prepare('INSERT INTO identity VALUES(1,?)').run(this.namespace);}
  }catch(e){this.db.close();throw e;}
 }
 private checkIdentity(){const rows=this.db.prepare('SELECT id,namespace FROM identity').all() as {id:number;namespace:string}[];if(rows.length!==1||rows[0]!.id!==1||rows[0]!.namespace!==this.namespace)throw Error('Native public history identity changed');}
 private content(pair:string,interval:15|60,asOf:number,bars:Candle[]){return hash({namespace:this.namespace,pair,interval,asOf,rows:bars.map(c=>[c.ts,c.open,c.high,c.low,c.close,c.volume])});}
 private readInside(pair:string,interval:15|60,now:number):StoredHistory{
  key(pair,interval,this.quote);if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid native history clock');this.checkIdentity();
  const meta=this.db.prepare('SELECT as_of,row_count,data_hash FROM series WHERE pair=? AND interval=?').get(pair,interval) as {as_of:number;row_count:number;data_hash:string}|undefined;
  const bars=this.db.prepare('SELECT pair,interval,ts,open,high,low,close,volume FROM history_bars WHERE pair=? AND interval=? ORDER BY ts LIMIT 9001').all(pair,interval) as Candle[];
  if(!meta){if(bars.length)throw Error('Orphan native history rows');return {bars:[],storedAsOf:null,storedHash:null,dataHash:null};}
  if(!Number.isSafeInteger(meta.as_of)||meta.as_of<0||meta.as_of>now||!Number.isSafeInteger(meta.row_count)||meta.row_count!==bars.length||bars.length>9000)throw Error('Invalid/future native history manifest');
  for(const c of bars)valid(c,pair,interval,meta.as_of);if(this.content(pair,interval,meta.as_of,bars)!==meta.data_hash)throw Error('Native public history checksum mismatch');
  const plan=nativeHistoryPlan([],interval,now),selected=bars.filter(c=>c.ts>=plan.start&&c.ts<=plan.end);return {bars:selected,storedAsOf:meta.as_of,storedHash:meta.data_hash,dataHash:this.content(pair,interval,now,selected)};
 }
 read(pair:string,interval:15|60,now:number):StoredHistory{return this.db.transaction(()=>this.readInside(pair,interval,now))();}
 merge(pair:string,interval:15|60,rows:Candle[],asOf:number){
  key(pair,interval,this.quote);if(rows.length>1000||!Number.isSafeInteger(asOf)||asOf<0)throw Error('Invalid bounded native history write');for(const c of rows)valid(c,pair,interval,asOf);
  this.db.transaction(()=>{const old=this.readInside(pair,interval,asOf);if(!rows.length)return;const plan=nativeHistoryPlan([],interval,asOf),unique=new Map<number,Candle>();for(const c of rows){if(unique.has(c.ts))throw Error('Duplicate native history page time');if(c.ts<plan.start||c.ts>plan.end)throw Error('Native history page outside retention');unique.set(c.ts,c);}
   const count=(this.db.prepare('SELECT COUNT(*) AS n FROM series').get() as {n:number}).n;if(old.storedAsOf===null&&count>=200)throw Error('Native history series bound exceeded');
   this.db.prepare('INSERT INTO series VALUES(?,?,?,?,?) ON CONFLICT(pair,interval) DO NOTHING').run(pair,interval,asOf,0,'');const insert=this.db.prepare('INSERT INTO history_bars VALUES(@pair,@interval,@ts,@open,@high,@low,@close,@volume) ON CONFLICT(pair,interval,ts) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume');for(const c of unique.values())insert.run(c);
   this.db.prepare('DELETE FROM history_bars WHERE pair=? AND interval=? AND ts<?').run(pair,interval,plan.start);
   const all=this.db.prepare('SELECT pair,interval,ts,open,high,low,close,volume FROM history_bars WHERE pair=? AND interval=? ORDER BY ts LIMIT 9001').all(pair,interval) as Candle[];if(all.length>9000)throw Error('Native history row bound exceeded');
   this.db.prepare('UPDATE series SET as_of=?,row_count=?,data_hash=? WHERE pair=? AND interval=?').run(asOf,all.length,this.content(pair,interval,asOf,all),pair,interval);
  })();
 }
 close(){if(this.db.open)this.db.close();}
}
