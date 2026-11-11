import {afterEach,beforeEach,expect,test} from 'vitest';
import Database from 'better-sqlite3';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MonthlyMarketStore,recordingFile,monthOf} from '../src/recorder/storage.js';
import {getBookSnapshots,getMonthReport,getSpreadStats} from '../src/recorder/reader.js';
import {acquireRecorderLock} from '../src/recorder/lock.js';

let dir:string;const sym='BTC/USDT',jan=Date.UTC(2026,0,31,23,59,59),feb=Date.UTC(2026,1,1,0,0,0);
const book=(ts:number,spreadBps=10)=>({
  ts,symbol:sym,bid:100,bidQty:2,ask:100.1,askQty:3,spreadBps,
  depthBid10bps:200,depthAsk10bps:300.3,depthBid25bps:200,depthAsk25bps:300.3,
});
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'market-recorder-'));});
afterEach(()=>{rmSync(dir,{recursive:true,force:true});});
test('batch flush creates independent WAL month files, readback and duplicate trade deduplication',()=>{
  const store=new MonthlyMarketStore(dir,[sym],jan,5000,0,()=>10_000_000_000n);
  store.appendBook(book(jan));store.appendBook(book(feb,20));
  store.appendTrade({ts:jan,symbol:sym,aggId:4,price:100,qty:2,isBuyerMaker:false});
  store.appendTrade({ts:jan,symbol:sym,aggId:4,price:100,qty:2,isBuyerMaker:false});
  store.appendEvent({ts:feb,symbol:sym,type:'gap_start'});
  expect(store.queued).toBe(5);expect(store.flush()).toBe(5);
  store.close();
  expect(existsSync(recordingFile(dir,'2026-01'))).toBe(true);
  expect(existsSync(recordingFile(dir,'2026-02'))).toBe(true);
  const janDb=new Database(recordingFile(dir,'2026-01'),{readonly:true});
  expect(janDb.prepare('SELECT COUNT(*) AS count FROM agg_trades').get()).toEqual({count:1});
  expect(janDb.pragma('journal_mode',{simple:true})).toBe('wal');
  janDb.close();
  expect(getBookSnapshots(sym,jan,feb+1000,dir)).toHaveLength(2);
  expect(getSpreadStats(sym,jan,feb+1000,dir)).toEqual({samples:2,medianBps:15,p90Bps:19});
  expect(getMonthReport('2026-02',dir,feb+10000).pairs[0]).toMatchObject({symbol:sym,snapshots:1,gaps:1});
});
test('low free disk space prevents writes, preserves batch, and does not create database',()=>{
  let free=0n;
  const store=new MonthlyMarketStore(dir,[sym],jan,5000,5,()=>free);
  store.appendBook(book(jan));
  expect(store.hasSpace()).toBe(false);expect(store.flush()).toBe(0);
  expect(existsSync(recordingFile(dir,'2026-01'))).toBe(false);
  free=6n*1024n*1024n*1024n;
  expect(store.flush()).toBe(1);store.close();
  expect(getBookSnapshots(sym,jan,jan+1,dir)).toHaveLength(1);
});
test('month helper rejects invalid clocks, and locks block double start and clean up',()=>{
  expect(monthOf(jan)).toBe('2026-01');expect(monthOf(feb)).toBe('2026-02');
  expect(()=>monthOf(-1)).toThrow();
  const file=join(dir,'.lock'),release=acquireRecorderLock(file);
  expect(()=>acquireRecorderLock(file)).toThrow('already running');
  expect(JSON.parse(readFileSync(file,'utf8')).pid).toBe(process.pid);
  release();expect(existsSync(file)).toBe(false);
  const second=acquireRecorderLock(file);second();
});
