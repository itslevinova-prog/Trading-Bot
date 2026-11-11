import {afterEach,beforeEach,expect,test} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MonthlyMarketStore,recordingFile} from '../src/recorder/storage.js';
import {readTradesReceivedBy} from '../src/recorder/reader.js';
import {receivedCostReplay,summariseReceivedCostReplay} from '../src/recorder/cost-hurdle.js';

const SYMBOL='BTC/USDT',DAY=86_400_000,FROM=Date.UTC(2022,5,10);
let dir:string;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'receipt-replay-'));});
afterEach(()=>{rmSync(dir,{recursive:true,force:true});});
const store=(start=FROM)=>new MonthlyMarketStore(dir,[SYMBOL],start,5000,0,()=>10_000_000_000n);
const trade=(ts:number,aggId:number,receivedAt:number)=>({
 ts,aggId,receivedAt,symbol:SYMBOL,price:100,qty:2,isBuyerMaker:false
});
const book=(ts:number)=>({ts,symbol:SYMBOL,bid:100,ask:101,bidQty:1,askQty:1,
 spreadBps:99.5,depthBid10bps:10,depthAsk10bps:10,
 depthBid25bps:20,depthAsk25bps:20});
test('late received event is never included at an earlier decision cutoff',()=>{
 const s=store();
 s.appendBook(book(FROM));s.appendBook(book(FROM+5000));
 s.appendTrade(trade(FROM+100,10,FROM+300));
 s.appendTrade(trade(FROM+1000,11,FROM+8000));
 s.flush();s.close();
 const before=readTradesReceivedBy(SYMBOL,FROM,FROM+20_000,FROM+5000,dir);
 expect(before.eligible.map(x=>x.aggId)).toEqual([10]);
 expect(before.excluded).toEqual({late:1,unknownReceipt:0,clockConflict:0});
 expect(before.eligible[0]?.receivedAt).toBe(FROM+300);
 const quality=summariseReceivedCostReplay(before);
 expect(quality.eligibleTrades).toBe(1);
 expect(quality.rejectedLate).toBe(1);
 expect(quality.status).toBe('insufficient');
 expect(quality.medianReceiptLatencyMs).toBe(200);
 expect(quality.maxReceiptLatencyMs).toBe(200);
 expect(quality.executableCostEvidenceComplete).toBe(false);
 const previousFingerprint=quality.fingerprint;
 // This exchange event occurred later than the decision. Adding it to the
 // archive may not change ANY prior decision's admissible cost observations.
 const later=store();later.appendTrade(trade(FROM+6000,12,FROM+6200));later.flush();later.close();
 const again=receivedCostReplay(SYMBOL,FROM,FROM+20_000,FROM+5000,dir);
 expect(again).toEqual(quality);
 expect(again.fingerprint).toBe(previousFingerprint);
});
test('different cutoff receives trade only once its local receipt has occurred',()=>{
 const s=store();
 for(let t=FROM;t<=FROM+10000;t+=5000)s.appendBook(book(t));
 s.appendTrade(trade(FROM+100,1,FROM+200));
 s.appendTrade(trade(FROM+1100,2,FROM+6100));
 s.flush();s.close();
 const early=readTradesReceivedBy(SYMBOL,FROM,FROM+20_000,FROM+5000,dir);
 const late=readTradesReceivedBy(SYMBOL,FROM,FROM+20_000,FROM+10000,dir);
 expect(early.eligible.map(x=>x.aggId)).toEqual([1]);
 expect(late.eligible.map(x=>x.aggId)).toEqual([1,2]);
 expect(receivedCostReplay(SYMBOL,FROM,FROM+20_000,FROM+10000,dir).medianReceiptLatencyMs)
  .toBeCloseTo((100+5000)/2,10);
});
test('legacy missing receive timestamp is unknown and never substituted from exchange time',()=>{
 const s=store();
 s.appendBook(book(FROM));s.appendBook(book(FROM+5000));
 s.appendTrade(trade(FROM+300,1,FROM+400));
 s.flush();s.close();
 const db=new Database(recordingFile(dir,'2022-06'));
 db.prepare('UPDATE agg_trades SET received_at=NULL WHERE agg_id=?').run(1);
 db.close();
 const received=readTradesReceivedBy(SYMBOL,FROM,FROM+10000,FROM+5000,dir);
 expect(received.eligible).toHaveLength(0);
 expect(received.excluded.unknownReceipt).toBe(1);
 const report=summariseReceivedCostReplay(received);
 expect(report.status).toBe('insufficient');
 expect(report.unknownReceipt).toBe(1);
 expect(report.knownReceiptPct).toBe(0);
 expect(report.medianReceiptLatencyMs).toBeNull();
 expect(report.reasons).toContain('UNKNOWN_RECEIPTS_EXCLUDED: 1');
});
test('backward local clock or future exchange timestamp is invalid, not profitable evidence',()=>{
 const s=store();
 s.appendBook(book(FROM));s.appendBook(book(FROM+5000));
 s.appendTrade(trade(FROM+3000,1,FROM+2999));
 s.flush();s.close();
 const received=readTradesReceivedBy(SYMBOL,FROM,FROM+10000,FROM+5000,dir);
 expect(received.eligible).toHaveLength(0);
 expect(received.excluded.clockConflict).toBe(1);
 const report=summariseReceivedCostReplay(received);
 expect(report.status).toBe('invalid');
 expect(report.clockConflict).toBe(1);
 expect(report.executableCostEvidenceComplete).toBe(false);
});
test('contradictory agg-id receipt chronology is invalid even if clocks are individually causal',()=>{
 const s=store();
 s.appendBook(book(FROM));s.appendBook(book(FROM+5000));
 s.appendTrade(trade(FROM+100,5,FROM+3000));
 s.appendTrade(trade(FROM+1100,6,FROM+1500));
 s.flush();s.close();
 const report=receivedCostReplay(SYMBOL,FROM,FROM+10000,FROM+5000,dir);
 expect(report.status).toBe('invalid');
 expect(report.chronologyAnomalies).toBeGreaterThan(0);
 expect(report.reasons.join(' ')).toContain('CLOCK_OR_ORDER_CONFLICT');
 expect(report.eligibleTradeIds).toEqual([6,5]);
});
test('duplicate aggregate id across UTC month is read only once and flagged',()=>{
 const jan=Date.UTC(2022,0,31,23,59,55),feb=Date.UTC(2022,1,1);
 const s=store(jan);
 s.appendBook(book(jan));s.appendBook(book(feb));s.appendTrade(trade(jan+10,50,jan+20));
 s.appendTrade(trade(feb+10,50,feb+20));s.flush();s.close();
 const report=receivedCostReplay(SYMBOL,jan,feb+10_000,feb+5000,dir);
 expect(report.eligibleTradeIds).toEqual([50]);
 expect(report.duplicateIds).toBe(1);
 expect(report.reasons).toContain('DUPLICATE_AGG_IDS_DEDUPLICATED: 1');
 expect(report.executableCostEvidenceComplete).toBe(false);
});
test('invalid cutoff is rejected before any market archive access',()=>{
 expect(()=>readTradesReceivedBy(SYMBOL,FROM,FROM+1000,FROM+1000,dir))
  .toThrow(/cutoff/);
 expect(()=>readTradesReceivedBy(SYMBOL,FROM,FROM+1000,FROM-1,dir))
  .toThrow(/cutoff/);
 expect(()=>readTradesReceivedBy(SYMBOL,FROM,FROM+1000,Number.NaN,dir))
  .toThrow(/cutoff/);
});
