import {afterEach,beforeEach,expect,test} from 'vitest';
import {eq} from 'drizzle-orm';
import {db} from '../src/db.js';
import {accounts,pairs,positions,trades,rejectedOrders} from '../src/schema.js';
import {config} from '../src/config.js';
import {PaperExecutionAdapter} from '../src/broker/PaperExecutionAdapter.js';
import type {MarketFeed} from '../src/market/types.js';

const id='rounded-gate-fixture',pair='ROUND/EUR';
const feed={connected:true,books:new Map<string,any>(),tickers:new Map(),
 features:new Map(),venue:'binance'} as unknown as MarketFeed;
const order={accountId:id,pair,side:'buy' as const,amountEur:50,
 reason:'Rounded order offline fixture',decisionId:'rounded-gate-1'};
const cash=()=>db.select().from(accounts).where(eq(accounts.id,id)).get()!.cash;
const fills=()=>db.select().from(trades).where(eq(trades.accountId,id)).all();
const rejected=()=>db.select().from(rejectedOrders).where(eq(rejectedOrders.accountId,id)).all();
const held=()=>db.select().from(positions).where(eq(positions.accountId,id)).all();
const book=()=>({symbol:pair,valid:true,receivedAt:Date.now(),
 bids:[{price:'10',qty:'1000'}],asks:[{price:'10.01',qty:'1000'}]});
let priorLatency:{min:number;max:number};
function cleanup(){
 db.delete(rejectedOrders).where(eq(rejectedOrders.accountId,id)).run();
 db.delete(positions).where(eq(positions.accountId,id)).run();
 db.delete(trades).where(eq(trades.accountId,id)).run();
 db.delete(accounts).where(eq(accounts.id,id)).run();
 db.delete(pairs).where(eq(pairs.symbol,pair)).run();
}
beforeEach(()=>{
 priorLatency={min:config.SIMULATED_LATENCY_MS_MIN,max:config.SIMULATED_LATENCY_MS_MAX};
 config.SIMULATED_LATENCY_MS_MIN=0;config.SIMULATED_LATENCY_MS_MAX=0;
 cleanup();
 db.insert(accounts).values({id,name:'Rounded risk fixture',strategy:'rules',
  startingBalance:1000,cash:1000,peakEquity:1000,status:'active',createdAt:Date.now()}).run();
 db.insert(pairs).values({symbol:pair,restName:'ROUNDEUR',base:'ROUND',quote:'EUR',
  ordermin:.1,costmin:10,lotDecimals:1,pairDecimals:2,active:true,
  volume24hEur:100000,status:'online',updatedAt:Date.now()}).run();
 feed.connected=true;feed.books.clear();feed.books.set(pair,book());
});
afterEach(()=>{
 config.SIMULATED_LATENCY_MS_MIN=priorLatency.min;
 config.SIMULATED_LATENCY_MS_MAX=priorLatency.max;
 cleanup();
});

test('final portfolio provider must approve the exact rounded debit including fees',async()=>{
 const values:number[]=[];
 const broker=new PaperExecutionAdapter(feed,()=>{},undefined,{isolatedLedgerFixture:true});
 broker.setPortfolioRiskGuard((_id,_pair,amount)=>{
  values.push(amount);
  return {allowed:true,approvedAmount:values.length===3?amount-.1:amount,
   reasons:values.length===3?['final budget reduced']:[]};
 });
 const result=await broker.placeMarketOrder(order);
 expect(result.ok).toBe(false);
 expect(result.reason).toContain('nach Lot-Rundung');
 expect(values).toHaveLength(3);
 expect(values[2]).toBeLessThan(values[1]!);
 expect(values[2]).toBeGreaterThan(0);
 expect(fills()).toHaveLength(0);
 expect(held()).toHaveLength(0);
 expect(cash()).toBe(1000);
 expect(rejected().at(-1)?.reason).toContain('nach Lot-Rundung');
});
test('approved rounded amount debits exact notional plus fee and stays inside all budgets',async()=>{
 const values:number[]=[];
 const broker=new PaperExecutionAdapter(feed,()=>{},undefined,{isolatedLedgerFixture:true});
 broker.setPortfolioRiskGuard((_id,_pair,amount)=>{
  values.push(amount);
  return {allowed:true,approvedAmount:amount,reasons:[]};
 });
 const result=await broker.placeMarketOrder(order);
 expect(result.ok).toBe(true);
 expect(values).toHaveLength(3);
 const fill=fills()[0]!;
 expect(fill.qty*10).toBeCloseTo(Math.round(fill.qty*10));
 expect(fill.costEur+fill.feeEur).toBeCloseTo(values[2]!,8);
 expect(fill.costEur+fill.feeEur).toBeLessThanOrEqual(values[1]!+1e-7);
 expect(cash()).toBeCloseTo(1000-fill.costEur-fill.feeEur);
 expect(held()[0]!.qty).toBe(fill.qty);
});
test('an insufficient minimum order after lot rounding never persists a partial fill',async()=>{
 db.update(pairs).set({costmin:49.99,lotDecimals:0}).where(eq(pairs.symbol,pair)).run();
 const broker=new PaperExecutionAdapter(feed,()=>{},undefined,{isolatedLedgerFixture:true});
 const out=await broker.placeMarketOrder(order);
 expect(out.ok).toBe(false);
 expect(out.reason).toContain('Mindestgrösse');
 expect(fills()).toHaveLength(0);
 expect(held()).toHaveLength(0);
 expect(cash()).toBe(1000);
});

test('a changed orderbook during asynchronous final risk approval never writes a fill',async()=>{
 const broker=new PaperExecutionAdapter(feed,()=>{},undefined,{isolatedLedgerFixture:true});
 let calls=0;
 broker.setPortfolioRiskGuard((_id,_pair,amount)=>{
  calls++;
  if(calls===3)feed.books.set(pair,{...book(),receivedAt:Date.now()-config.MAX_BOOK_AGE_MS-1});
  return {allowed:true,approvedAmount:amount,reasons:[]};
 });
 const out=await broker.placeMarketOrder(order);
 expect(calls).toBe(3);
 expect(out.ok).toBe(false);
 expect(out.reason).toContain('Orderbuch vor Persistenz');
 expect(fills()).toHaveLength(0);
 expect(held()).toHaveLength(0);
 expect(cash()).toBe(1000);
});

test('an in-place bid edit while final provider approves cannot keep an old execution quote',async()=>{
 const broker=new PaperExecutionAdapter(feed,()=>{},undefined,{isolatedLedgerFixture:true});
 let calls=0;
 broker.setPortfolioRiskGuard((_id,_pair,amount)=>{
  calls++;
  if(calls===3)(feed.books.get(pair)!.bids[0] as {price:string}).price='9.90';
  return {allowed:true,approvedAmount:amount,reasons:[]};
 });
 const out=await broker.placeMarketOrder(order);
 expect(calls).toBe(3);
 expect(out.ok).toBe(false);
 expect(out.reason).toContain('Orderbuch vor Persistenz');
 expect(fills()).toHaveLength(0);
 expect(held()).toHaveLength(0);
});
