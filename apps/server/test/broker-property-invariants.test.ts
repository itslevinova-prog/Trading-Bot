import {afterEach,beforeEach,expect,test} from 'vitest';
import {eq} from 'drizzle-orm';
import {db} from '../src/db.js';
import {accounts,pairs,positions,trades,rejectedOrders} from '../src/schema.js';
import {PaperExecutionAdapter} from '../src/broker/PaperExecutionAdapter.js';
import {config} from '../src/config.js';
import type {MarketFeed} from '../src/market/types.js';

const accountId='property-risk-fixture';
const pair='PROPERTY/EUR';
const feed={connected:true,books:new Map<string,any>(),tickers:new Map(),
 features:new Map(),venue:'binance'} as unknown as MarketFeed;
const random=(seed:number)=>{
 let s=seed>>>0;
 return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
};
const near=(a:number,b:number)=>Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b));
const state=()=>({
 cash:db.select().from(accounts).where(eq(accounts.id,accountId)).get()!.cash,
 positions:db.select().from(positions).where(eq(positions.accountId,accountId)).all(),
 trades:db.select().from(trades).where(eq(trades.accountId,accountId)).all(),
 rejections:db.select().from(rejectedOrders).where(eq(rejectedOrders.accountId,accountId)).all()
});
function cleanup(){
 db.delete(rejectedOrders).where(eq(rejectedOrders.accountId,accountId)).run();
 db.delete(positions).where(eq(positions.accountId,accountId)).run();
 db.delete(trades).where(eq(trades.accountId,accountId)).run();
 db.delete(accounts).where(eq(accounts.id,accountId)).run();
 db.delete(pairs).where(eq(pairs.symbol,pair)).run();
}
let priorLatency:{min:number;max:number};
beforeEach(()=>{
 priorLatency={min:config.SIMULATED_LATENCY_MS_MIN,max:config.SIMULATED_LATENCY_MS_MAX};
 config.SIMULATED_LATENCY_MS_MIN=0;
 config.SIMULATED_LATENCY_MS_MAX=0;
 cleanup();
});
afterEach(()=>{
 config.SIMULATED_LATENCY_MS_MIN=priorLatency.min;
 config.SIMULATED_LATENCY_MS_MAX=priorLatency.max;
 cleanup();
 feed.books.clear();
});
function setup(digits:number,bid:number,ask:number){
 cleanup();
 db.insert(accounts).values({id:accountId,name:'Property risk fixture',strategy:'rules',
  startingBalance:1000,cash:1000,peakEquity:1000,status:'active',createdAt:Date.now()}).run();
 db.insert(pairs).values({symbol:pair,restName:'PROPERTYEUR',base:'PROPERTY',quote:'EUR',
  ordermin:1/10**digits,costmin:10,lotDecimals:digits,pairDecimals:4,
  active:true,volume24hEur:100_000,status:'online',updatedAt:Date.now()}).run();
 feed.connected=true;
 feed.books.clear();
 feed.books.set(pair,{symbol:pair,valid:true,receivedAt:Date.now(),
  bids:[{price:bid.toFixed(4),qty:'10000'}],
  asks:[{price:ask.toFixed(4),qty:'10000'}]});
}
/** Recalculate all ledger changes from actual persisted executions. */
function auditPaper(digits:number,seed:number){
 const s=state(),ctx='seed='+seed+' lotDecimals='+digits;
 let cash=1000,qty=0,basis=0;
 for(const fill of s.trades){
  const cost=fill.qty*fill.fillPrice;
  expect(near(fill.costEur,cost),ctx+' notional').toBe(true);
  expect(near(fill.feeEur,fill.costEur*config.TAKER_FEE_RATE),ctx+' fee').toBe(true);
  expect(Math.abs(fill.qty*10**digits-Math.round(fill.qty*10**digits)),
   ctx+' rounded lot').toBeLessThan(1e-7);
  if(fill.side==='buy'){
   cash-=fill.costEur+fill.feeEur;
   qty+=fill.qty;
   basis+=fill.costEur+fill.feeEur;
  }else{
   expect(fill.qty,ctx+' partial inventory').toBeLessThanOrEqual(qty+1e-8);
   const disposed=basis*fill.qty/qty;
   expect(near(fill.realizedPnlEur??NaN,fill.costEur-fill.feeEur-disposed),
    ctx+' realized net PnL').toBe(true);
   cash+=fill.costEur-fill.feeEur;
   basis-=disposed;qty-=fill.qty;
  }
 }
 expect(near(s.cash,cash),ctx+' cash').toBe(true);
 expect(s.cash,ctx+' cash nonnegative').toBeGreaterThanOrEqual(-1e-8);
 expect(s.positions.length,ctx+' position count').toBe(qty<1e-10?0:1);
 if(qty>1e-10){
  expect(near(s.positions[0]!.qty,qty),ctx+' net quantity').toBe(true);
  expect(near(s.positions[0]!.costBasisEur,basis),ctx+' remaining basis').toBe(true);
 }
 return s;
}

test('multiple seeded lots preserve exact approved debit, partial sale basis, fees and cash',async()=>{
 for(let seed=1;seed<=12;seed++){
  const rnd=random(seed),digits=Math.floor(rnd()*5),mid=10+Math.floor(rnd()*800)/100;
  const bid=mid,ask=mid+0.01;
  setup(digits,bid,ask);
  const broker=new PaperExecutionAdapter(feed,()=>{},undefined,{isolatedLedgerFixture:true});
  const approvals:number[]=[];
  broker.setPortfolioRiskGuard((_account,_pair,amount)=>{
   approvals.push(amount);
   return {allowed:true,approvedAmount:amount,reasons:[]};
  });
  const amountEur=100+Math.floor(rnd()*180);
  const bought=await broker.placeMarketOrder({accountId,pair,side:'buy',amountEur,
   reason:'seed='+seed,decisionId:'prop-buy-'+seed});
  expect(bought.ok,'seed='+seed+' purchase: '+bought.reason).toBe(true);
  const buyAudit=auditPaper(digits,seed);
  expect(buyAudit.trades.length,'seed='+seed).toBe(1);
  expect(buyAudit.trades[0]!.costEur+buyAudit.trades[0]!.feeEur,
   'seed='+seed+' all-in fee budget').toBeLessThanOrEqual(amountEur+1e-7);
  expect(approvals.length,'seed='+seed+' three approval stages').toBe(3);
  expect(near(approvals[2]!,buyAudit.trades[0]!.costEur+buyAudit.trades[0]!.feeEur),
   'seed='+seed+' final rounded debit').toBe(true);
  const sold=await broker.placeMarketOrder({accountId,pair,side:'sell',sellFraction:.5,
   reason:'seed='+seed+' partial sell',decisionId:'prop-sell-'+seed});
  // Whole-unit lots can round .5 of the position below the broker minimum.
  if(sold.ok){
   const after=auditPaper(digits,seed);
   expect(after.trades.length,'seed='+seed+' sell recorded').toBe(2);
   expect(after.trades[1]!.side).toBe('sell');
   expect(after.positions[0]!.qty,'seed='+seed+' partial lot left').toBeGreaterThan(0);
  }else{
   const after=auditPaper(digits,seed);
   expect(after.trades.length,'seed='+seed+' rejected sell unchanged').toBe(1);
  }
 }
});

test('post-latency provider under-approval rejects rounded execution without a ledger mutation',async()=>{
 for(let seed=41;seed<=46;seed++){
  const rnd=random(seed),digits=Math.floor(rnd()*4)+1,mid=10+Math.floor(rnd()*500)/100;
  setup(digits,mid,mid+.01);
  const broker=new PaperExecutionAdapter(feed,()=>{},undefined,{isolatedLedgerFixture:true});
  let calls=0;
  broker.setPortfolioRiskGuard((_account,_pair,amount)=>{
   calls++;
   return {allowed:true,approvedAmount:calls===3?Math.max(0,amount-.25):amount,reasons:[]};
  });
  const out=await broker.placeMarketOrder({accountId,pair,side:'buy',amountEur:100,
   reason:'seed='+seed+' underapproved',decisionId:'prop-deny-'+seed});
  expect(out.ok,'seed='+seed).toBe(false);
  expect(calls,'seed='+seed+' all three gates').toBe(3);
  const after=auditPaper(digits,seed);
  expect(after.cash,'seed='+seed).toBe(1000);
  expect(after.trades,'seed='+seed).toHaveLength(0);
  expect(after.positions,'seed='+seed).toHaveLength(0);
  expect(after.rejections.at(-1)?.reason,'seed='+seed).toContain('nach Lot-Rundung');
 }
});
