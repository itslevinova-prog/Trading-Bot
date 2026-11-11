import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {monthOf,recordingFile} from './storage.js';
import type {BookSnapshot} from './types.js';

export const defaultRecordingDir=()=>join(fileURLToPath(new URL('../../../../',import.meta.url)),'data','recordings');
function validate(symbol:string,from:number,to:number) {
  if(!/^[A-Z0-9]{2,20}\/(USDT|USDC|EUR)$/.test(symbol)||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from)
    throw Error('Invalid recorder reader query');
}
function months(from:number,to:number) {
  if(to<=from)return [];
  const result:string[]=[];
  let current=new Date(Date.UTC(new Date(from).getUTCFullYear(),new Date(from).getUTCMonth(),1));
  while(current.getTime()<to){
    result.push(monthOf(current.getTime()));
    if(result.length>240)throw Error('Recording query exceeds 20 years');
    current=new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth()+1,1));
  }
  return result;
}
function eachDb<T>(dir:string,from:number,to:number,query:(db:Database.Database)=>T):T[]{
  const result:T[]=[];
  for(const month of months(from,to)){
    const file=recordingFile(dir,month);
    if(!existsSync(file))continue;
    const db=new Database(file,{readonly:true,fileMustExist:true});
    try{result.push(query(db));}finally{db.close();}
  }
  return result;
}
type BookRow={
  ts:number;symbol:string;bid:number;bid_qty:number;ask:number;ask_qty:number;spread_bps:number;
  depth_bid_10bps:number;depth_ask_10bps:number;depth_bid_25bps:number;depth_ask_25bps:number;
};
const asSnapshot=(r:BookRow):BookSnapshot=>({
  ts:r.ts,symbol:r.symbol,bid:r.bid,bidQty:r.bid_qty,ask:r.ask,askQty:r.ask_qty,
  spreadBps:r.spread_bps,depthBid10bps:r.depth_bid_10bps,depthAsk10bps:r.depth_ask_10bps,
  depthBid25bps:r.depth_bid_25bps,depthAsk25bps:r.depth_ask_25bps,
});
/** Inclusive start, exclusive end. The limit prevents accidental huge analytics reads. */
export function getBookSnapshots(symbol:string,from:number,to:number,
  dir=defaultRecordingDir(),limit=10000):BookSnapshot[]{
  validate(symbol,from,to);
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000000)throw Error('Invalid snapshot limit');
  const rows:BookSnapshot[]=[];
  for(const batch of eachDb(dir,from,to,db=>db.prepare(
    'SELECT * FROM book_snapshots WHERE symbol=? AND ts>=? AND ts<? ORDER BY ts LIMIT ?'
  ).all(symbol,from,to,limit) as BookRow[])){
    for(const r of batch){if(rows.length>=limit)return rows;rows.push(asSnapshot(r));}
  }
  return rows;
}
export function percentile(values:readonly number[],p:number):number|null {
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const position=(sorted.length-1)*p,lo=Math.floor(position),hi=Math.ceil(position);
  return sorted[lo]!+(sorted[hi]!-sorted[lo]!)*(position-lo);
}
export type SpreadStats={samples:number;medianBps:number|null;p90Bps:number|null};
export function getSpreadStats(symbol:string,from:number,to:number,dir=defaultRecordingDir()):SpreadStats {
  validate(symbol,from,to);
  const values:number[]=[];
  for(const batch of eachDb(dir,from,to,db=>db.prepare(
    'SELECT spread_bps AS spread FROM book_snapshots WHERE symbol=? AND ts>=? AND ts<?'
  ).all(symbol,from,to) as {spread:number}[]))
    for(const row of batch)values.push(row.spread);
  return {samples:values.length,medianBps:percentile(values,0.5),p90Bps:percentile(values,0.9)};
}
export type PairCoverage={symbol:string;quote:string;snapshots:number;expected:number;coveragePct:number;
  gaps:number;trades:number;medianBps:number|null;p90Bps:number|null};
export type MonthReport={month:string;file:string;exists:boolean;sizeBytes:number;from:number;to:number;intervalMs:number;
  pairs:PairCoverage[];quotes:{quote:string;pairs:number;medianBps:number|null;p90Bps:number|null}[]};
function fileBytes(file:string){let size=0;for(const suffix of ['','-wal','-shm']){try{size+=statSync(file+suffix).size;}catch{/* Missing WAL/SHM is valid. */}}return size;}
/** Valid-book coverage is sampled-slot coverage, not a claim about the time between snapshots. */
export function getMonthReport(month:string,dir=defaultRecordingDir(),now=Date.now()):MonthReport {
  const file=recordingFile(dir,month),from=Date.parse(month+'-01T00:00:00.000Z');
  const [year,mo]=month.split('-').map(Number);
  const until=Date.UTC(year!,mo!,1),to=Math.min(until,now);
  if(!existsSync(file))return {month,file,exists:false,sizeBytes:0,from,to,intervalMs:5000,pairs:[],quotes:[]};
  const db=new Database(file,{readonly:true,fileMustExist:true});
  try {
    const meta=new Map((db.prepare('SELECT key,value FROM meta').all() as {key:string;value:string}[])
      .map(r=>[r.key,r.value]));
    if(meta.get('format')!=='market-recorder-v1')throw Error('Unknown recorder file format');
    const start=Math.max(from,Number(meta.get('started_at')??from));
    const intervalMs=Number(meta.get('snapshot_ms')??5000);
    if(!Number.isSafeInteger(intervalMs)||intervalMs<=0)throw Error('Invalid recorder interval');
    const expected=Math.max(0,Math.floor((to-1)/intervalMs)-Math.ceil(start/intervalMs)+1);
    const universe=JSON.parse(meta.get('universe')??'[]') as string[];
    const recorded=(db.prepare('SELECT symbol,COUNT(*) AS n FROM book_snapshots WHERE ts>=? AND ts<? GROUP BY symbol')
      .all(from,to) as {symbol:string;n:number}[]);
    const count=new Map(recorded.map(r=>[r.symbol,r.n]));
    const tradeCounts=new Map((db.prepare('SELECT symbol,COUNT(*) AS n FROM agg_trades WHERE ts>=? AND ts<? GROUP BY symbol')
      .all(from,to) as {symbol:string;n:number}[]).map(r=>[r.symbol,r.n]));
    const gaps=new Map((db.prepare("SELECT symbol,COUNT(*) AS n FROM events WHERE type='gap_start' AND ts>=? AND ts<? GROUP BY symbol")
      .all(from,to) as {symbol:string|null;n:number}[]).filter(r=>r.symbol!==null).map(r=>[r.symbol!,r.n]));
    const symbols=[...new Set([...universe,...recorded.map(r=>r.symbol)])].sort();
    const pairs=symbols.map(symbol=>{
      const stats=getSpreadStats(symbol,from,to,dir),snapshots=count.get(symbol)??0;
      return {symbol,quote:symbol.split('/')[1]??'',snapshots,expected,
        coveragePct:expected>0?Math.min(100,100*snapshots/expected):0,
        gaps:gaps.get(symbol)??0,trades:tradeCounts.get(symbol)??0,
        medianBps:stats.medianBps,p90Bps:stats.p90Bps};
    });
    const quotes=['USDT','USDC','EUR'].map(quote=>{
      const selected=pairs.filter(p=>p.quote===quote);
      // Exact pooled quote percentiles, streamed from SQLite's sorted cursor.
      const pattern='%/'+quote;
      const row=db.prepare('SELECT COUNT(*) AS n FROM book_snapshots WHERE symbol LIKE ? AND ts>=? AND ts<?')
        .get(pattern,from,to) as {n:number};
      const quantile=(p:number,values:Map<number,number>)=>{
        if(!row.n)return null;
        const position=(row.n-1)*p,lo=Math.floor(position),hi=Math.ceil(position);
        const a=values.get(lo),b=values.get(hi);
        return a===undefined||b===undefined?null:a+(b-a)*(position-lo);
      };
      const indices=[0.5,0.9].flatMap(p=>[Math.floor((row.n-1)*p),Math.ceil((row.n-1)*p)]);
      const max=Math.max(...indices),wanted=new Set(indices),values=new Map<number,number>();
      if(row.n){
        const cursor=db.prepare('SELECT spread_bps AS spread FROM book_snapshots WHERE symbol LIKE ? AND ts>=? AND ts<? ORDER BY spread_bps')
          .iterate(pattern,from,to) as Iterable<{spread:number}>;
        let i=0;for(const {spread} of cursor){if(wanted.has(i))values.set(i,spread);if(i++>=max)break;}
      }
      return {quote,pairs:selected.length,medianBps:quantile(0.5,values),p90Bps:quantile(0.9,values)};
    });
    return {month,file,exists:true,sizeBytes:fileBytes(file),from,to,intervalMs,pairs,quotes};
  }finally{db.close();}
}

export type ReplayTrade={
 ts:number;receivedAt:number|null;symbol:string;aggId:number;
 price:number;qty:number;isBuyerMaker:boolean;
};
export type ReplayGap={from:number;to:number;missingSlots:number;kind:'snapshot'|'recorder-event'};
export type ReplayAnomaly={
 kind:'missing-month'|'receipt-unknown'|'id-gap'|'exchange-order'|'receive-order'|
  'receive-before-exchange'|'id-conflict'|'invalid-snapshot-clock'|'invalid-recording-format';
 at:number|null;detail:string;
};
export type RecorderReplay={
 symbol:string;from:number;to:number;status:'consistent'|'incomplete'|'conflict';
 trades:ReplayTrade[];
 gaps:ReplayGap[];missingSnapshotSlots:number;missingMonths:string[];
 missingReceiptTimes:number;duplicateTradeIds:number;anomalies:ReplayAnomaly[];fingerprint:string;
};
type SqlTrade={ts:number;symbol:string;aggId:number;price:number;qty:number;
 isBuyerMaker:number;receivedAt:number|null};
/** Deterministic, read-only replay of committed monthly recorder events.
 * Exchange time and aggregate id determine event identity; reception time
 * is retained when available, never manufactured for old v1 databases. */
export function replayRecorderTrades(symbol:string,from:number,to:number,
 dir=defaultRecordingDir()):RecorderReplay{
 validate(symbol,from,to);
 if(from>=to||to-from>62*86_400_000)throw Error('Recorder replay requires a positive window of at most 62 days');
 const anomalies:ReplayAnomaly[]=[],gaps:ReplayGap[]=[],missingMonths:string[]=[];
 const original:ReplayTrade[]=[];
 let missingSnapshotSlots=0;
 for(const month of months(from,to)){
  const file=recordingFile(dir,month);
  const beginning=Date.parse(month+'-01T00:00:00.000Z');
  const [year,mo]=month.split('-').map(Number);
  const ending=Date.UTC(year!,mo!,1),localFrom=Math.max(from,beginning),localTo=Math.min(to,ending);
  if(!existsSync(file)){
   missingMonths.push(month);
   anomalies.push({kind:'missing-month',at:localFrom,
    detail:'No committed monthly recorder file at '+month+'; missing trades/snapshots are unknown'});
   continue;
  }
  const db=new Database(file,{readonly:true,fileMustExist:true});
  try{
   const meta=new Map((db.prepare('SELECT key,value FROM meta').all() as {key:string;value:string}[])
    .map(x=>[x.key,x.value]));
   if(meta.get('format')!=='market-recorder-v1'){
    anomalies.push({kind:'invalid-recording-format',at:localFrom,
     detail:'Unsupported recording format for '+month});
    continue;
   }
   const interval=Number(meta.get('snapshot_ms'));
   const startedAt=Number(meta.get('started_at'));
   if(!Number.isSafeInteger(interval)||interval<1||
      !Number.isSafeInteger(startedAt)||startedAt<0){
    anomalies.push({kind:'invalid-snapshot-clock',at:localFrom,
     detail:'Unverified snapshot interval or recording start at '+month});
   }else{
    // Only count expected aligned snapshots after the recorded session started.
    const begin=Math.max(localFrom,startedAt);
    const startSlot=Math.ceil(begin/interval)*interval;
    const endSlot=Math.ceil(localTo/interval)*interval;
    if(startSlot<endSlot){
     const stored=(db.prepare('SELECT ts FROM book_snapshots WHERE symbol=? AND ts>=? AND ts<? ORDER BY ts')
      .all(symbol,startSlot,localTo) as {ts:number}[]).map(x=>x.ts);
     let cursor=startSlot;
     const appendGap=(end:number)=>{
      if(end<=cursor)return;
      const missingSlots=(end-cursor)/interval;
      gaps.push({from:cursor,to:end,missingSlots,kind:'snapshot'});
      missingSnapshotSlots+=missingSlots;
      cursor=end;
     };
     for(const at of stored){
      if(at%interval!==0||at<cursor)continue;
      appendGap(at);
      cursor=at+interval;
     }
     appendGap(endSlot);
    }
   }
   const columns=db.pragma('table_info(agg_trades)') as {name:string}[];
   const receipt=columns.some(x=>x.name==='received_at')?'received_at':'NULL';
   const raw=db.prepare('SELECT ts,symbol,agg_id AS aggId,price,qty,is_buyer_maker AS isBuyerMaker,'+
    receipt+' AS receivedAt FROM agg_trades WHERE symbol=? AND ts>=? AND ts<? ORDER BY ts,agg_id')
    .all(symbol,localFrom,localTo) as SqlTrade[];
   for(const row of raw){
    original.push({ts:row.ts,receivedAt:row.receivedAt,symbol:row.symbol,aggId:row.aggId,
     price:row.price,qty:row.qty,isBuyerMaker:row.isBuyerMaker===1});
   }
   const markers=db.prepare(
    "SELECT ts,type FROM events WHERE (symbol=? OR symbol IS NULL) AND type IN ('gap_start','queue_overflow','storage_paused') AND ts>=? AND ts<? ORDER BY ts,id"
   ).all(symbol,localFrom,localTo) as {ts:number;type:string}[];
   for(const marker of markers){
    gaps.push({from:marker.ts,to:marker.ts,missingSlots:0,kind:'recorder-event'});
   }
  }finally{db.close();}
 }
 original.sort((a,b)=>a.ts-b.ts||
  (a.receivedAt??Number.MAX_SAFE_INTEGER)-(b.receivedAt??Number.MAX_SAFE_INTEGER)||
  a.aggId-b.aggId);
 const trades:ReplayTrade[]=[],identities=new Map<number,ReplayTrade>();
 let duplicateTradeIds=0;
 for(const row of original){
  if(!Number.isSafeInteger(row.ts)||!Number.isSafeInteger(row.aggId)||row.aggId<0||
     !Number.isFinite(row.price)||row.price<=0||!Number.isFinite(row.qty)||row.qty<=0||
     row.receivedAt!==null&&(!Number.isSafeInteger(row.receivedAt)||row.receivedAt<0)){
    anomalies.push({kind:'id-conflict',at:row.ts,detail:'Malformed persisted aggregate trade'});
    continue;
  }
  const earlier=identities.get(row.aggId);
  if(earlier){
   duplicateTradeIds++;
   if(earlier.ts!==row.ts||earlier.price!==row.price||earlier.qty!==row.qty||
      earlier.isBuyerMaker!==row.isBuyerMaker){
    anomalies.push({kind:'id-conflict',at:row.ts,detail:'Aggregate ID '+row.aggId+' differs across monthly files'});
   }
   continue; // Same ID is never counted twice, even across month files.
  }
  identities.set(row.aggId,row);
  trades.push(row);
 }
 trades.sort((a,b)=>a.ts-b.ts||
  (a.receivedAt??Number.MAX_SAFE_INTEGER)-(b.receivedAt??Number.MAX_SAFE_INTEGER)||
  a.aggId-b.aggId);
 const missingReceiptTimes=trades.filter(x=>x.receivedAt===null).length;
 if(missingReceiptTimes)anomalies.push({kind:'receipt-unknown',at:null,
  detail:missingReceiptTimes+' old trades have no archived local reception time; arrival ordering unverified'});
 const byId=[...trades].sort((a,b)=>a.aggId-b.aggId);
 for(let i=1;i<byId.length;i++){
  const previous=byId[i-1]!,next=byId[i]!;
  if(previous.aggId+1<next.aggId)anomalies.push({kind:'id-gap',at:next.ts,
   detail:'Missing aggregate IDs '+(previous.aggId+1)+' through '+(next.aggId-1)});
  if(previous.ts>next.ts)anomalies.push({kind:'exchange-order',at:next.ts,
   detail:'Aggregate ID chronology contradicts exchange timestamps'});
  if(previous.receivedAt!==null&&next.receivedAt!==null&&
     previous.receivedAt>next.receivedAt)anomalies.push({kind:'receive-order',at:next.ts,
      detail:'Arrival timestamps invert aggregate ID chronology'});
 }
 for(const row of trades){
  if(row.receivedAt!==null&&row.receivedAt+1000<row.ts)
   anomalies.push({kind:'receive-before-exchange',at:row.ts,
    detail:'Local reception precedes exchange time beyond one-second clock tolerance'});
 }
 anomalies.sort((a,b)=>(a.at??-1)-(b.at??-1)||a.kind.localeCompare(b.kind));
 gaps.sort((a,b)=>a.from-b.from||a.kind.localeCompare(b.kind));
 const severe=new Set<ReplayAnomaly['kind']>([
  'exchange-order','id-conflict','receive-before-exchange','invalid-recording-format','invalid-snapshot-clock'
 ]);
 const status:RecorderReplay['status']=anomalies.some(a=>severe.has(a.kind))?'conflict':
  anomalies.length||gaps.length||missingSnapshotSlots?'incomplete':'consistent';
 const payload={symbol,from,to,status,trades,gaps,missingSnapshotSlots,missingMonths,
  missingReceiptTimes,duplicateTradeIds,anomalies};
 const fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 return {...payload,fingerprint};
}

export type ReceivedTradeCutoff={
 cutoffMs:number;symbol:string;
 /** Only these already-received rows can be considered by a decision. */
 eligible:ReplayTrade[];
 excluded:{late:number;unknownReceipt:number;clockConflict:number};
 sourceStatus:RecorderReplay['status'];
 sourceFingerprint:string;
 anomalies:ReplayAnomaly[];
 duplicateTradeIds:number;
};
/** Read-only point-in-time replay. A delayed exchange print must NOT be
 * reinterpreted as available at exchange time. No future exchange events
 * are queried, no missing receipt timestamps are guessed. */
export function readTradesReceivedBy(symbol:string,from:number,to:number,cutoffMs:number,
 dir=defaultRecordingDir()):ReceivedTradeCutoff {
 validate(symbol,from,to);
 if(!Number.isSafeInteger(cutoffMs)||cutoffMs<from||cutoffMs>=to)
  throw Error('Invalid decision cutoff for reception-time replay');
 // Only exchange events whose exchange time was at or before the decision
 // may be read. Future order flow never enters the replay result.
 const end=Math.min(to,cutoffMs+1);
 const source=replayRecorderTrades(symbol,from,end,dir);
 const eligible:ReplayTrade[]=[];
 let late=0,unknownReceipt=0,clockConflict=0;
 for(const trade of source.trades){
  if(trade.receivedAt===null){unknownReceipt++;continue;}
  if(trade.receivedAt<trade.ts){clockConflict++;continue;}
  if(trade.receivedAt>cutoffMs){late++;continue;}
  eligible.push(trade);
 }
 // Keep deterministic exchange/receipt/ID ordering, never infer arrival
 // chronology from exchange timestamps alone.
 eligible.sort((a,b)=>a.receivedAt!-b.receivedAt!||
  a.ts-b.ts||a.aggId-b.aggId);
 return {symbol,cutoffMs,eligible,
  excluded:{late,unknownReceipt,clockConflict},
  sourceStatus:source.status,sourceFingerprint:source.fingerprint,
  anomalies:source.anomalies,duplicateTradeIds:source.duplicateTradeIds};
}


/** Frozen, read-only public trade evidence for an ex-post selection study.
 * Any missing snapshot slot, receipt timestamp, month, or replay anomaly
 * makes the entire window incomplete; no queue positions are inferred. */
export type MakerSelectionWindow={
 symbol:string;from:number;to:number;
 status:'complete'|'insufficient_evidence';
 sourceStatus:RecorderReplay['status'];
 sourceFingerprint:string;
 trades:ReplayTrade[];
 gaps:ReplayGap[];
 missingMonths:string[];
 anomalies:ReplayAnomaly[];
};
export function makerSelectionWindowFromReplay(replay:RecorderReplay):MakerSelectionWindow {
 const receiptUnknown=replay.trades.some(t=>t.receivedAt===null||
   t.receivedAt<t.ts||!Number.isSafeInteger(t.receivedAt));
 return {
  symbol:replay.symbol,from:replay.from,to:replay.to,
  status:replay.status==='consistent'&&!receiptUnknown&&
   !replay.gaps.length&&!replay.missingMonths.length&&!replay.anomalies.length?
   'complete':'insufficient_evidence',
  sourceStatus:replay.status,sourceFingerprint:replay.fingerprint,
  trades:replay.trades.map(t=>({...t})),
  gaps:replay.gaps.map(g=>({...g})),missingMonths:[...replay.missingMonths],
  anomalies:replay.anomalies.map(a=>({...a}))
 };
}
export function readMakerSelectionWindow(symbol:string,from:number,to:number,
 dir=defaultRecordingDir()):MakerSelectionWindow {
 return makerSelectionWindowFromReplay(replayRecorderTrades(symbol,from,to,dir));
}
