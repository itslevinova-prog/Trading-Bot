import Database from 'better-sqlite3';
import {existsSync,lstatSync,mkdirSync,statfsSync} from 'node:fs';
import {join} from 'node:path';
import type {AggTrade,BookSnapshot,RecorderEvent} from './types.js';

type Row = {kind:'book'; value:BookSnapshot} | {kind:'trade';value:AggTrade} | {kind:'event';value:RecorderEvent};
export const monthOf = (ts:number):string => {
  if(!Number.isSafeInteger(ts)||ts<0||ts>8640000000000000)throw Error('Invalid recording timestamp');
  return new Date(ts).toISOString().slice(0,7);
};
export const recordingFile = (dir:string,month:string) => {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Invalid UTC recording month');
  return join(dir,`market-${month}.db`);
};
export function freeSpaceBytes(dir:string):bigint {
  const stat=statfsSync(dir,{bigint:true});
  return stat.bavail*stat.bsize;
}
function assertRegular(file:string) {
  if(!existsSync(file))return;
  const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1)throw Error('Unsafe recorder path: '+file);
}
function openMonth(file:string,universe:readonly string[],startedAt:number,snapshotMs:number):Database.Database {
  assertRegular(file);
  for(const suffix of ['-wal','-shm','-journal'])assertRegular(file+suffix);
  const db=new Database(file);
  try {
    const existing=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).map(x=>x.name);
    const allowed=new Set(['meta','book_snapshots','agg_trades','events']);
    if(existing.length&&(existing.length!==4||existing.some(name=>!allowed.has(name))))throw Error('Existing file is not an owned market recording');
    if(existing.length){
      const row=db.prepare("SELECT value FROM meta WHERE key='format'").get() as {value:string}|undefined;
      if(row?.value!=='market-recorder-v1')throw Error('Recorder database format mismatch');
    }
    db.pragma('journal_mode = WAL');db.pragma('synchronous = NORMAL');db.pragma('busy_timeout = 5000');
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS book_snapshots(
        ts INTEGER NOT NULL,symbol TEXT NOT NULL,bid REAL NOT NULL,bid_qty REAL NOT NULL,
        ask REAL NOT NULL,ask_qty REAL NOT NULL,spread_bps REAL NOT NULL,
        depth_bid_10bps REAL NOT NULL,depth_ask_10bps REAL NOT NULL,
        depth_bid_25bps REAL NOT NULL,depth_ask_25bps REAL NOT NULL,
        PRIMARY KEY(symbol,ts));
      CREATE INDEX IF NOT EXISTS snapshot_clock ON book_snapshots(ts,symbol);
      CREATE TABLE IF NOT EXISTS agg_trades(
        ts INTEGER NOT NULL,symbol TEXT NOT NULL,agg_id INTEGER NOT NULL,
        price REAL NOT NULL,qty REAL NOT NULL,is_buyer_maker INTEGER NOT NULL,
        received_at INTEGER,
        PRIMARY KEY(symbol,agg_id));
      CREATE INDEX IF NOT EXISTS trade_clock ON agg_trades(symbol,ts);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,ts INTEGER NOT NULL,
        symbol TEXT,type TEXT NOT NULL,detail TEXT);
      CREATE INDEX IF NOT EXISTS event_clock ON events(symbol,ts);
    `);
    // Existing owned v1 files gain an optional column without changing old events.
    const tradeColumns=db.pragma('table_info(agg_trades)') as {name:string}[];
    if(!tradeColumns.some(column=>column.name==='received_at'))
      db.exec('ALTER TABLE agg_trades ADD COLUMN received_at INTEGER');
    const meta=db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)');
    db.transaction(()=>{
      meta.run('format','market-recorder-v1');
      meta.run('started_at',String(startedAt));
      meta.run('universe',JSON.stringify(universe));
      meta.run('snapshot_ms',String(snapshotMs));
    })();
    return db;
  }catch(error){db.close();throw error;}
}
/** Independent monthly WAL store; no Paper database or schema imports. */
export class MonthlyMarketStore {
  private pending:Row[]=[];
  private db:Database.Database|null=null;
  private openFor:string|null=null;
  private readonly minimumBytes:bigint;
  lastWriteAt:number|null=null;
  constructor(readonly dir:string,private readonly universe:readonly string[],
    private readonly startedAt:number,private readonly snapshotMs:number,minFreeGb:number,
    private readonly diskFree:(directory:string)=>bigint=freeSpaceBytes){
    mkdirSync(dir,{recursive:true});
    this.minimumBytes=BigInt(Math.ceil(minFreeGb*1024*1024*1024));
  }
  hasSpace():boolean {
    try{return this.diskFree(this.dir)>=this.minimumBytes;}catch{return false;}
  }
  get queued(){return this.pending.length;}
  appendBook(value:BookSnapshot){return this.add({kind:'book',value});}
  appendTrade(value:AggTrade){
    const receivedAt=value.receivedAt??Date.now();
    if(!Number.isSafeInteger(receivedAt)||receivedAt<0)return false;
    return this.add({kind:'trade',value:{...value,receivedAt}});
  }
  appendEvent(value:RecorderEvent){return this.add({kind:'event',value});}
  private add(row:Row){
    if(this.pending.length>=200000)return false;
    this.pending.push(row);return true;
  }
  discardPending(){const n=this.pending.length;this.pending=[];return n;}
  private switchMonth(month:string) {
    if(this.openFor===month)return this.db!;
    this.db?.close();this.db=null;this.openFor=null;
    this.db=openMonth(recordingFile(this.dir,month),this.universe,this.startedAt,this.snapshotMs);
    this.openFor=month;return this.db;
  }
  flush():number {
    if(!this.pending.length)return 0;
    if(!this.hasSpace())return 0;
    const groups=new Map<string,Row[]>();
    for(const row of this.pending){const month=monthOf(row.value.ts);const group=groups.get(month)??[];group.push(row);groups.set(month,group);}
    let committed=0;
    for(const [month,rows] of groups){
      const db=this.switchMonth(month);
      const book=db.prepare('INSERT OR IGNORE INTO book_snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?)');
      const trade=db.prepare('INSERT OR IGNORE INTO agg_trades(ts,symbol,agg_id,price,qty,is_buyer_maker,received_at) VALUES(?,?,?,?,?,?,?)');
      const event=db.prepare('INSERT INTO events(ts,symbol,type,detail) VALUES(?,?,?,?)');
      db.transaction(()=>{
        for(const row of rows){
          if(row.kind==='book'){const v=row.value;book.run(v.ts,v.symbol,v.bid,v.bidQty,v.ask,v.askQty,v.spreadBps,v.depthBid10bps,v.depthAsk10bps,v.depthBid25bps,v.depthAsk25bps);}
          else if(row.kind==='trade'){const v=row.value;trade.run(v.ts,v.symbol,v.aggId,v.price,v.qty,v.isBuyerMaker?1:0,v.receivedAt??null);}
          else {const v=row.value;event.run(v.ts,v.symbol,v.type,v.detail??null);}
        }
      })();
      committed+=rows.length;
      // Failed later month remains retryable. Duplicates in earlier months are harmless for book/trades.
      this.pending=this.pending.filter(row=>monthOf(row.value.ts)!==month);
    }
    this.lastWriteAt=Date.now();
    return committed;
  }
  close(){this.db?.close();this.db=null;this.openFor=null;}
}
