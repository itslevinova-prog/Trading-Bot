import {afterEach,beforeEach,expect,test} from 'vitest';
import Database from 'better-sqlite3';
import {existsSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MonthlyMarketStore,recordingFile} from '../src/recorder/storage.js';
import {replayRecorderTrades} from '../src/recorder/reader.js';

const SYMBOL='BTC/USDT';
const JAN=Date.UTC(2022,0,31,23,59,55);
const FEB=Date.UTC(2022,1,1);
let dir:string;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'recorder-restart-fixture-'));});
afterEach(()=>{rmSync(dir,{recursive:true,force:true});});
const store=()=>new MonthlyMarketStore(dir,[SYMBOL],JAN,5000,0,()=>10_000_000_000n);
const book=(ts:number)=>({
 ts,symbol:SYMBOL,bid:100,bidQty:1,ask:101,askQty:1,spreadBps:99.5,
 depthBid10bps:10,depthAsk10bps:10,depthBid25bps:20,depthAsk25bps:20
});
const trade=(ts:number,aggId:number,receivedAt=ts+200,price=100)=>({
 ts,symbol:SYMBOL,aggId,receivedAt,price,qty:1,isBuyerMaker:false
});
test('same confirmed stream across month change and restart has stable replay and no duplicated aggId',()=>{
 const first=store();
 first.appendBook(book(JAN));
 first.appendTrade(trade(JAN+50,40,JAN+200));
 expect(first.flush()).toBe(2);first.close();
 const second=store();
 second.appendTrade(trade(JAN+50,40,JAN+400)); // re-delivery of confirmed ID
 second.appendBook(book(FEB));
 second.appendTrade(trade(FEB+50,41,FEB+180));
 second.flush();second.close();
 expect(existsSync(recordingFile(dir,'2022-01'))).toBe(true);
 expect(existsSync(recordingFile(dir,'2022-02'))).toBe(true);
 const replay=replayRecorderTrades(SYMBOL,JAN,FEB+5000,dir);
 expect(replay.status).toBe('consistent');
 expect(replay.trades.map(x=>x.aggId)).toEqual([40,41]);
 expect(replay.trades.map(x=>x.receivedAt)).toEqual([JAN+200,FEB+180]);
 expect(replay.missingSnapshotSlots).toBe(0);
 expect(replay.missingMonths).toEqual([]);
 expect(replay.fingerprint).toMatch(/^[a-f0-9]{64}$/);
 expect(replayRecorderTrades(SYMBOL,JAN,FEB+5000,dir)).toEqual(replay);
});
test('crash in middle of month-flush retains earlier commit and accepts later replay without losing confirmed trades',()=>{
 const original=store();
 original.appendBook(book(JAN));original.appendTrade(trade(JAN+25,70));
 original.appendBook(book(FEB));original.appendTrade(trade(FEB+25,71));
 // The first transaction commits; the next monthly file intentionally has an unsafe path.
 mkdirSync(recordingFile(dir,'2022-02'));
 expect(()=>original.flush()).toThrow(/Unsafe recorder path/);
 expect(original.queued).toBe(2);
 original.close();
 rmSync(recordingFile(dir,'2022-02'),{recursive:true,force:true});
 const restarted=store();
 restarted.appendTrade(trade(JAN+25,70)); // harmless already-committed duplicate
 restarted.appendBook(book(FEB));
 restarted.appendTrade(trade(FEB+25,71));
 expect(restarted.flush()).toBe(3);
 restarted.close();
 const replay=replayRecorderTrades(SYMBOL,JAN,FEB+5000,dir);
 expect(replay.status).toBe('consistent');
 expect(replay.trades.map(x=>x.aggId)).toEqual([70,71]);
 expect(replay.missingSnapshotSlots).toBe(0);
});
test('missing snapshot clock slot and aggregate ID remain visible; retransmission cannot fill either',()=>{
 const s=store();
 s.appendBook(book(JAN));s.appendBook(book(JAN+10000));
 s.appendTrade(trade(JAN+10,20));s.appendTrade(trade(JAN+10010,22));
 s.appendTrade(trade(JAN+10010,22));s.flush();s.close();
 const replay=replayRecorderTrades(SYMBOL,JAN,JAN+15000,dir);
 expect(replay.status).toBe('incomplete');
 expect(replay.missingSnapshotSlots).toBe(1);
 expect(replay.gaps).toContainEqual({from:JAN+5000,to:JAN+10000,missingSlots:1,kind:'snapshot'});
 expect(replay.trades).toHaveLength(2);
 expect(replay.anomalies.some(x=>x.kind==='id-gap')).toBe(true);
});
test('exchange/receipt chronology inversion is a conflict; reader never rewrites committed rows',()=>{
 const s=store();
 s.appendBook(book(JAN));
 s.appendTrade(trade(JAN+900,80,JAN+1900));
 s.appendTrade(trade(JAN+100,81,JAN+1000));
 s.flush();s.close();
 const file=recordingFile(dir,'2022-01');
 const db=new Database(file,{readonly:true,fileMustExist:true});
 const before=db.prepare('SELECT COUNT(*) AS count FROM agg_trades').get();db.close();
 const replay=replayRecorderTrades(SYMBOL,JAN,JAN+5000,dir);
 expect(replay.status).toBe('conflict');
 expect(replay.anomalies.map(x=>x.kind)).toContain('exchange-order');
 expect(replay.anomalies.map(x=>x.kind)).toContain('receive-order');
 const after=new Database(file,{readonly:true,fileMustExist:true});
 expect(after.prepare('SELECT COUNT(*) AS count FROM agg_trades').get()).toEqual(before);
 after.close();
});
test('legacy market-recorder-v1 without received_at stays unverified after read, migrates additively on writer restart',()=>{
 const s=store();
 s.appendBook(book(JAN));s.appendTrade(trade(JAN+100,9));s.flush();s.close();
 const file=recordingFile(dir,'2022-01');
 const db=new Database(file);
 db.exec('ALTER TABLE agg_trades DROP COLUMN received_at');db.close();
 const old=replayRecorderTrades(SYMBOL,JAN,JAN+5000,dir);
 expect(old.status).toBe('incomplete');
 expect(old.trades[0]?.receivedAt).toBeNull();
 expect(old.missingReceiptTimes).toBe(1);
 const reopened=store();
 reopened.appendTrade(trade(JAN+200,10,JAN+300));reopened.flush();reopened.close();
 const migrated=replayRecorderTrades(SYMBOL,JAN,JAN+5000,dir);
 expect(migrated.trades.map(x=>x.aggId)).toEqual([9,10]);
 expect(migrated.trades[0]?.receivedAt).toBeNull();
 expect(migrated.trades[1]?.receivedAt).toBe(JAN+300);
 expect(migrated.status).toBe('incomplete');
});
test('conflicting duplicate aggregate ID across files is counted once and reported',()=>{
 const s=store();
 s.appendBook(book(JAN));s.appendBook(book(FEB));
 s.appendTrade(trade(JAN+10,50));s.appendTrade(trade(FEB+10,50,FEB+200,120));
 s.flush();s.close();
 const replay=replayRecorderTrades(SYMBOL,JAN,FEB+5000,dir);
 expect(replay.status).toBe('conflict');
 expect(replay.trades).toHaveLength(1);
 expect(replay.anomalies.map(x=>x.kind)).toContain('id-conflict');
});
test('missing month cannot be reconstructed by nearby snapshots or duplicated rows',()=>{
 const s=store();
 s.appendBook(book(JAN));s.appendTrade(trade(JAN+10,88));s.flush();s.close();
 const replay=replayRecorderTrades(SYMBOL,JAN,FEB+5000,dir);
 expect(replay.missingMonths).toEqual(['2022-02']);
 expect(replay.status).toBe('incomplete');
 expect(replay.trades).toHaveLength(1);
});
