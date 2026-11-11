import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import Database from 'better-sqlite3';
import {eq} from 'drizzle-orm';
import {db,sqlite} from '../src/db.js';
import {accounts,pairs,positions,trades,rejectedOrders} from '../src/schema.js';
import {config} from '../src/config.js';
import {PaperExecutionAdapter} from '../src/broker/PaperExecutionAdapter.js';
import {initPaperReconcileGuard} from '../src/broker/paper-reconcile.js';
import type {MarketFeed} from '../src/market/types.js';

const id='fault-injection-paper',pair='FAULT/EUR';
const order={accountId:id,pair,side:'buy' as const,amountEur:50,
 stopLossPct:.05,confidence:1,reason:'Offline failure injection',
 decisionId:'fault-injection-1'};
const feed={connected:true,venue:'binance',tickers:new Map(),features:new Map(),
 books:new Map<string,any>()} as unknown as MarketFeed;
const current=()=>db.select().from(accounts).where(eq(accounts.id,id)).get()!;
const fills=()=>db.select().from(trades).where(eq(trades.accountId,id)).all();
const held=()=>db.select().from(positions).where(eq(positions.accountId,id)).all();
const denied=()=>db.select().from(rejectedOrders).where(eq(rejectedOrders.accountId,id)).all();
function book(){
 feed.books.set(pair,{symbol:pair,valid:true,receivedAt:Date.now(),
  bids:[{price:'10',qty:'1000'}],asks:[{price:'10.01',qty:'1000'}]});
}
let previousConfig:{SIMULATED_LATENCY_MS_MIN:number;SIMULATED_LATENCY_MS_MAX:number};
function cleanup(){
 db.delete(rejectedOrders).where(eq(rejectedOrders.accountId,id)).run();
 db.delete(positions).where(eq(positions.accountId,id)).run();
 db.delete(trades).where(eq(trades.accountId,id)).run();
 db.delete(accounts).where(eq(accounts.id,id)).run();
 db.delete(pairs).where(eq(pairs.symbol,pair)).run();
 sqlite.prepare('DELETE FROM paper_reconcile_blocks WHERE account_id=?').run(id);
 sqlite.prepare('DELETE FROM paper_reconcile_audit WHERE account_id=?').run(id);
}
beforeEach(()=>{
 vi.useRealTimers();
 previousConfig={SIMULATED_LATENCY_MS_MIN:config.SIMULATED_LATENCY_MS_MIN,
  SIMULATED_LATENCY_MS_MAX:config.SIMULATED_LATENCY_MS_MAX};
 config.SIMULATED_LATENCY_MS_MIN=0;config.SIMULATED_LATENCY_MS_MAX=0;
 initPaperReconcileGuard(sqlite);
 cleanup();
 db.insert(accounts).values({id,name:'Fault injection test',strategy:'rules',
  startingBalance:1000,cash:1000,peakEquity:1000,status:'active',createdAt:Date.now()}).run();
 db.insert(pairs).values({symbol:pair,restName:'FAULTEUR',base:'FAULT',quote:'EUR',
  ordermin:.0001,costmin:10,lotDecimals:6,pairDecimals:4,active:true,
  volume24hEur:100000,status:'online',updatedAt:Date.now()}).run();
 feed.connected=true;feed.books.clear();book();
});
afterEach(()=>{
 vi.useRealTimers();
 config.SIMULATED_LATENCY_MS_MIN=previousConfig.SIMULATED_LATENCY_MS_MIN;
 config.SIMULATED_LATENCY_MS_MAX=previousConfig.SIMULATED_LATENCY_MS_MAX;
 cleanup();
});
test('injected SQLITE_BUSY leaves zero fills/cash changes and never silently retries',async()=>{
 const broker=new PaperExecutionAdapter(feed,()=>{});
 const file=(sqlite.pragma('database_list') as Array<{name:string;file:string}>)
  .find(row=>row.name==='main')?.file;
 expect(file).toBeTruthy();
 const writer=new Database(file!);
 const timeout=sqlite.pragma('busy_timeout',{simple:true}) as number;
 try{
  sqlite.pragma('busy_timeout = 0');
  writer.exec('BEGIN IMMEDIATE');
  await expect(broker.placeMarketOrder(order)).rejects.toMatchObject({code:'SQLITE_BUSY'});
  expect(fills()).toHaveLength(0);
  expect(held()).toHaveLength(0);
  expect(current().cash).toBe(1000);
 }finally{
  writer.exec('ROLLBACK');writer.close();
  sqlite.pragma('busy_timeout = '+timeout);
 }
 // The failed request never runs automatically after SQLite becomes available.
 expect(fills()).toHaveLength(0);
 const accepted=await broker.placeMarketOrder({...order,decisionId:'after-explicit-recovery'});
 expect(accepted.ok).toBe(true);
 expect(fills()).toHaveLength(1);
});
test('injected SQLite transaction abort rolls back fill, cash and position atomically',async()=>{
 const broker=new PaperExecutionAdapter(feed,()=>{});
 sqlite.exec("CREATE TEMP TRIGGER fault_commit_abort BEFORE INSERT ON positions WHEN NEW.account_id='"+
  id+"' BEGIN SELECT RAISE(ABORT,'injected position commit failure'); END");
 try{
  await expect(broker.placeMarketOrder(order)).rejects.toThrow('injected position commit failure');
  expect(fills()).toHaveLength(0);
  expect(held()).toHaveLength(0);
  expect(current().cash).toBe(1000);
 }finally{sqlite.exec('DROP TRIGGER fault_commit_abort');}
 expect(fills()).toHaveLength(0);
 expect((await broker.placeMarketOrder({...order,decisionId:'explicit-retry'})).ok).toBe(true);
 expect(fills()).toHaveLength(1);
});
test('feed disconnect during simulated execution delay rejects order with no later ghost fill',async()=>{
 vi.useFakeTimers();vi.setSystemTime(Date.UTC(2026,10,1));
 config.SIMULATED_LATENCY_MS_MIN=100;config.SIMULATED_LATENCY_MS_MAX=100;
 book();
 const broker=new PaperExecutionAdapter(feed,()=>{});
 const pending=broker.placeMarketOrder(order);
 await vi.advanceTimersByTimeAsync(1);
 feed.connected=false;
 await vi.advanceTimersByTimeAsync(150);
 const result=await pending;
 expect(result.ok).toBe(false);
 expect(result.reason).toContain('Börsenverbindung');
 expect(denied().some(x=>x.reason.includes('Börsenverbindung'))).toBe(true);
 expect(fills()).toHaveLength(0);
 expect(held()).toHaveLength(0);
 expect(current().cash).toBe(1000);
 feed.connected=true;book();
 await vi.advanceTimersByTimeAsync(1000);
 expect(fills()).toHaveLength(0);
});
test('late risk denial after valid pre-check blocks fill; no stale earlier approval used',async()=>{
 vi.useFakeTimers();vi.setSystemTime(Date.UTC(2026,10,1));
 config.SIMULATED_LATENCY_MS_MIN=100;config.SIMULATED_LATENCY_MS_MAX=100;book();
 const broker=new PaperExecutionAdapter(feed,()=>{});
 let calls=0;
 broker.setPortfolioRiskGuard(async()=>{
  calls++;
  if(calls===1)return {allowed:true,approvedAmount:50,reasons:[]};
  await new Promise<void>(resolve=>setTimeout(resolve,50));
  return {allowed:false,approvedAmount:0,reasons:['risk changed during latency']};
 });
 const pending=broker.placeMarketOrder(order);
 await vi.advanceTimersByTimeAsync(250);
 const result=await pending;
 expect(calls).toBe(2);
 expect(result.ok).toBe(false);
 expect(result.reason).toContain('RiskEngine nach Latenz');
 expect(fills()).toHaveLength(0);
 expect(current().cash).toBe(1000);
});
test('late coin-quality restriction after first allowed check denies new exposure',async()=>{
 vi.useFakeTimers();vi.setSystemTime(Date.UTC(2026,10,1));
 config.SIMULATED_LATENCY_MS_MIN=100;config.SIMULATED_LATENCY_MS_MAX=100;book();
 const broker=new PaperExecutionAdapter(feed,()=>{});
 let calls=0;
 broker.setCoinQualityGuard(async()=>{
  calls++;
  if(calls===1)return {allowed:true,reason:'contemporary check'};
  await new Promise<void>(resolve=>setTimeout(resolve,40));
  return {allowed:false,reason:'late historical monitoring observation'};
 });
 const pending=broker.placeMarketOrder(order);
 await vi.advanceTimersByTimeAsync(250);
 const result=await pending;
 expect(calls).toBe(2);
 expect(result.ok).toBe(false);
 expect(result.reason).toContain('late historical monitoring observation');
 expect(fills()).toHaveLength(0);
 expect(held()).toHaveLength(0);
});
test('RiskEngine timeout and late successful response cannot create deferred fills',async()=>{
 vi.useFakeTimers();vi.setSystemTime(Date.UTC(2026,10,1));book();
 const broker=new PaperExecutionAdapter(feed,()=>{});
 let answer:(v:{allowed:boolean;approvedAmount:number;reasons:string[]})=>void=()=>{};
 broker.setPortfolioRiskGuard(()=>new Promise(resolve=>{answer=resolve;}));
 const pending=broker.placeMarketOrder(order);
 await vi.advanceTimersByTimeAsync(2600);
 const result=await pending;
 expect(result.ok).toBe(false);
 expect(result.reason).toContain('RiskEngine timeout');
 expect(fills()).toHaveLength(0);
 answer({allowed:true,approvedAmount:50,reasons:[]});
 await Promise.resolve();
 await vi.advanceTimersByTimeAsync(100);
 expect(fills()).toHaveLength(0);
 expect(held()).toHaveLength(0);
 expect(current().cash).toBe(1000);
});
test('coin-quality source timeout is a rejection and never becomes an unhandled fill',async()=>{
 vi.useFakeTimers();vi.setSystemTime(Date.UTC(2026,10,1));book();
 const broker=new PaperExecutionAdapter(feed,()=>{});
 let answer:(v:{allowed:boolean;reason:string})=>void=()=>{};
 broker.setCoinQualityGuard(()=>new Promise(resolve=>{answer=resolve;}));
 const pending=broker.placeMarketOrder(order);
 await vi.advanceTimersByTimeAsync(2600);
 const result=await pending;
 expect(result.ok).toBe(false);
 expect(result.reason).toContain('Coin quality: timeout');
 answer({allowed:true,reason:'arrived too late'});
 await vi.advanceTimersByTimeAsync(100);
 expect(fills()).toHaveLength(0);
});
test('rejected asynchronous risk provider is caught and serialised as denial, no duplicate fills',async()=>{
 const broker=new PaperExecutionAdapter(feed,()=>{});
 broker.setPortfolioRiskGuard(async()=>{throw Error('offline risk failure');});
 const [one,two]=await Promise.all([
  broker.placeMarketOrder(order),
  broker.placeMarketOrder({...order,decisionId:'second-after-failure'})
 ]);
 expect(one.ok).toBe(false);expect(two.ok).toBe(false);
 expect(one.reason).toContain('RiskEngine unavailable');
 expect(two.reason).toContain('RiskEngine unavailable');
 expect(fills()).toHaveLength(0);
 expect(held()).toHaveLength(0);
 expect(current().cash).toBe(1000);
 expect(denied()).toHaveLength(2);
});
