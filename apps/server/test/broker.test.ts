import {createRuntimeProvenance} from '../src/provenance/build.js';
import {beforeEach,test,expect,vi} from 'vitest';
import {db,sqlite} from '../src/db.js';import {accounts,pairs,positions,trades,rejectedOrders,tradeProvenance} from '../src/schema.js';
import {PaperExecutionAdapter} from '../src/broker/PaperExecutionAdapter.js';import type {KrakenMarket} from '../src/market/kraken.js';import {eq} from 'drizzle-orm';
const ticker={symbol:'TEST/EUR',bid:10,ask:10.2,last:10.1,volume:10000,change24h:0,receivedAt:Date.now()};
const market={connected:true,tickers:new Map([['TEST/EUR',ticker]]),books:new Map<string,any>()} as unknown as KrakenMarket;
const broker=new PaperExecutionAdapter(market,()=>{},undefined,{isolatedLedgerFixture:true});
const order={accountId:'test-rules',pair:'TEST/EUR',side:'buy' as const,amountEur:25,reason:'Unit-Test',decisionId:'D1'};
const validBook=()=>({symbol:'TEST/EUR',bids:[{price:'10',qty:'100'}],asks:[{price:'10.2',qty:'1'},{price:'10.4',qty:'100'}],receivedAt:Date.now(),valid:true});
beforeEach(()=>{
 db.delete(trades).where(eq(trades.accountId,'test-rules')).run();db.delete(rejectedOrders).where(eq(rejectedOrders.accountId,'test-rules')).run();db.delete(positions).where(eq(positions.accountId,'test-rules')).run();db.delete(accounts).where(eq(accounts.id,'test-rules')).run();
 db.insert(accounts).values({id:'test-rules',name:'Test',strategy:'rules',startingBalance:100,cash:100,peakEquity:100,status:'active',createdAt:Date.now()}).run();
 db.insert(pairs).values({symbol:'TEST/EUR',restName:'TESTEUR',base:'TEST',quote:'EUR',ordermin:.01,costmin:5,lotDecimals:4,pairDecimals:2,active:true,volume24hEur:10000,status:'online',updatedAt:Date.now()}).onConflictDoUpdate({target:pairs.symbol,set:{ordermin:.01,costmin:5,active:true}}).run();
 market.books.clear();market.connected=true;market.books.set('TEST/EUR',validBook());
});
test('market buy walks multiple ask levels and charges fees without negative cash',async()=>{
 const out=await broker.placeMarketOrder(order);expect(out.ok).toBe(true);const trade=db.select().from(trades).where(eq(trades.accountId,'test-rules')).get()!;
 expect(trade.fillPrice).toBeGreaterThan(10.2);expect(trade.feeEur).toBeCloseTo(trade.costEur*.008);expect(trade.qty*10000).toBeCloseTo(Math.round(trade.qty*10000));
 const account=db.select().from(accounts).where(eq(accounts.id,'test-rules')).get()!;expect(account.cash).toBeGreaterThanOrEqual(0);expect(account.cash).toBeCloseTo(100-trade.costEur-trade.feeEur);
});
test('stale book rejects a trade',async()=>{market.books.set('TEST/EUR',{...validBook(),receivedAt:Date.now()-10000});expect((await broker.placeMarketOrder(order)).ok).toBe(false);});
test('wide spreads and deep-book impact cannot enter through a model order',async()=>{market.books.set('TEST/EUR',{...validBook(),asks:[{price:'12',qty:'100'}]});expect((await broker.placeMarketOrder(order)).ok).toBe(false);market.books.set('TEST/EUR',{...validBook(),asks:[{price:'10.2',qty:'1'},{price:'100',qty:'100'}]});const result=await broker.placeMarketOrder({...order,decisionId:'impact'});expect(result.ok).toBe(false);expect(result.reason).toContain('Slippage');expect(db.select().from(trades).where(eq(trades.accountId,'test-rules')).all()).toHaveLength(0);});
test('entry cost guards never block a protective full exit',async()=>{expect((await broker.placeMarketOrder(order)).ok).toBe(true);market.books.set('TEST/EUR',{...validBook(),bids:[{price:'8',qty:'100'}]});const result=await broker.placeMarketOrder({accountId:'test-rules',pair:'TEST/EUR',side:'sell',sellFraction:1,reason:'protective fixture',protectiveExit:true,decisionId:'protective'});expect(result.ok).toBe(true);expect(db.select().from(positions).where(eq(positions.accountId,'test-rules')).all()).toHaveLength(0);});

test('pause while order waits for execution blocks the buy',async()=>{vi.useFakeTimers();try{const pending=broker.placeMarketOrder({...order,decisionId:'pause-race'});await Promise.resolve();await Promise.resolve();db.update(accounts).set({status:'paused'}).where(eq(accounts.id,'test-rules')).run();await vi.runAllTimersAsync();expect((await pending).ok).toBe(false);expect(db.select().from(trades).where(eq(trades.accountId,'test-rules')).all()).toHaveLength(0);}finally{vi.useRealTimers();}});
test('ordermin and costmin reject small order',async()=>{db.update(pairs).set({costmin:30}).where(eq(pairs.symbol,'TEST/EUR')).run();expect((await broker.placeMarketOrder(order)).ok).toBe(false);});
test('sellFraction halves an existing position and records fee',async()=>{
 const first=await broker.placeMarketOrder(order);expect(first.ok).toBe(true);const prior=db.select().from(positions).where(eq(positions.accountId,'test-rules')).get()!;
 const sold=await broker.placeMarketOrder({accountId:'test-rules',pair:'TEST/EUR',side:'sell',sellFraction:.5,reason:'Test-Verkauf',decisionId:'D2'});expect(sold.ok).toBe(true);
 const next=db.select().from(positions).where(eq(positions.accountId,'test-rules')).get()!;expect(next.qty).toBeLessThan(prior.qty);expect(next.qty).toBeGreaterThan(0);
});

test('entry and protective exit carry their original execution version atomically',async()=>{
 const identity=createRuntimeProvenance({verified:true,buildId:'a'.repeat(64),builtAt:new Date().toISOString(),sourceFiles:1,runtimeFiles:1,reasons:[]},{EXCHANGE:'binance',QUOTE_CURRENCY:'EUR'}),tracked=new PaperExecutionAdapter(market,()=>{},identity,{isolatedLedgerFixture:true});
 expect((await tracked.placeMarketOrder(order)).ok).toBe(true);
 expect((await tracked.placeMarketOrder({accountId:'test-rules',pair:'TEST/EUR',side:'sell',sellFraction:1,protectiveExit:true,reason:'stop fixture',decisionId:'no-regular-decision'})).ok).toBe(true);
 const fills=db.select().from(trades).where(eq(trades.accountId,'test-rules')).all();expect(fills).toHaveLength(2);
 for(const fill of fills){const provenance=db.select().from(tradeProvenance).where(eq(tradeProvenance.tradeId,fill.id)).get()!;expect(provenance.runId).toBe(identity.runId);expect(provenance.verified).toBe(true);expect(provenance.evaluationVersion).toBe(tracked.executionProvenance().evaluationVersion);}
});
test('failure to persist execution identity rolls back cash and the fill',async()=>{
 const identity=createRuntimeProvenance({verified:true,buildId:'b'.repeat(64),builtAt:new Date().toISOString(),sourceFiles:1,runtimeFiles:1,reasons:[]},{EXCHANGE:'binance'});identity.runId='00000000-0000-4000-8000-000000000000';const tracked=new PaperExecutionAdapter(market,()=>{},identity,{isolatedLedgerFixture:true});
 sqlite.exec("CREATE TRIGGER test_provenance_abort BEFORE INSERT ON trade_provenance WHEN NEW.run_id='00000000-0000-4000-8000-000000000000' BEGIN SELECT RAISE(ABORT,'test provenance failure'); END");
 try{await expect(tracked.placeMarketOrder(order)).rejects.toThrow('test provenance failure');expect(db.select().from(trades).where(eq(trades.accountId,'test-rules')).all()).toHaveLength(0);expect(db.select().from(accounts).where(eq(accounts.id,'test-rules')).get()!.cash).toBe(100);expect(db.select().from(positions).where(eq(positions.accountId,'test-rules')).all()).toHaveLength(0);}finally{sqlite.exec('DROP TRIGGER test_provenance_abort');}
});

function heldOther(){db.insert(positions).values({id:'other-held',accountId:order.accountId,pair:'OTHER/EUR',qty:2,avgEntryPrice:10,costBasisEur:20,stopLossPrice:9.9,openedAt:Date.now()}).run();market.books.set('OTHER/EUR',{...validBook(),symbol:'OTHER/EUR'});}
test('a fresh order market cannot hide missing held valuation behind historical ticker/entry prices',async()=>{heldOther();market.books.delete('OTHER/EUR');const out=await broker.placeMarketOrder(order);expect(out).toMatchObject({ok:false});expect(out.reason).toContain('Portfoliobewertung');expect(broker.getBalances(order.accountId).equity).toBeNull();expect(db.select().from(trades).where(eq(trades.accountId,order.accountId)).all()).toHaveLength(0);});
test('held quote becoming stale during latency blocks the buy without changing cash',async()=>{vi.useFakeTimers();try{heldOther();const pending=broker.placeMarketOrder(order);await Promise.resolve();await Promise.resolve();market.books.set('OTHER/EUR',{...validBook(),symbol:'OTHER/EUR',receivedAt:Date.now()-10000});await vi.runAllTimersAsync();const out=await pending;expect(out.ok).toBe(false);expect(out.reason).toContain('Portfoliobewertung nach Latenz');expect(broker.getBalances(order.accountId).cash).toBe(100);}finally{vi.useRealTimers();}});
test('unknown separate holdings never block a protective sell on a fresh executable book',async()=>{expect((await broker.placeMarketOrder(order)).ok).toBe(true);heldOther();market.books.delete('OTHER/EUR');expect((await broker.placeMarketOrder({...order,side:'sell',amountEur:undefined,sellFraction:1,protectiveExit:true})).ok).toBe(true);});
test('future order timestamps and disconnected cached books cannot open exposure',async()=>{market.books.set(order.pair,{...validBook(),receivedAt:Date.now()+10000});expect((await broker.placeMarketOrder(order)).ok).toBe(false);market.books.set(order.pair,validBook());market.connected=false;expect((await broker.placeMarketOrder(order)).ok).toBe(false);});


test('actual paper buy atomically binds the concrete position ID to its original fill, never a nearby pair trade',async()=>{
 expect((await broker.placeMarketOrder(order)).ok).toBe(true);const p=db.select().from(positions).where(eq(positions.accountId,'test-rules')).get()!,t=db.select().from(trades).where(eq(trades.accountId,'test-rules')).get()!;
 const row=sqlite.prepare('SELECT * FROM position_entry_evidence WHERE trade_id=?').get(t.id) as any;expect(row).toMatchObject({position_id:p.id,trade_id:t.id,account_id:p.accountId,pair:p.pair,entry_kind:'open'});const saved=JSON.parse(row.snapshot_json);expect(saved.fill).toMatchObject({qty:t.qty,fillPrice:t.fillPrice,decisionId:t.decisionId});expect(saved.sourceObserved).toBe(false);expect(saved.appliedProtection).toMatchObject({stopLossPrice:p.stopLossPrice,takeProfitPrice:p.takeProfitPrice});
 expect((await broker.placeMarketOrder({...order,side:'sell',sellFraction:1,reason:'close test'})).ok).toBe(true);expect(db.select().from(positions).where(eq(positions.id,p.id)).get()).toBeUndefined();expect(sqlite.prepare('SELECT snapshot_json FROM position_entry_evidence WHERE trade_id=?').get(t.id)).toEqual({snapshot_json:row.snapshot_json});
});
test('entry evidence insertion failure rolls back the real simulated buy, cash and position together',async()=>{
 const before=db.select().from(accounts).where(eq(accounts.id,'test-rules')).get()!.cash;sqlite.exec("CREATE TEMP TRIGGER reject_entry_fixture BEFORE INSERT ON position_entry_evidence BEGIN SELECT RAISE(ABORT,'entry evidence fixture failure'); END");
 try{await expect(broker.placeMarketOrder(order)).rejects.toThrow('entry evidence fixture failure');expect(db.select().from(trades).where(eq(trades.accountId,'test-rules')).all()).toHaveLength(0);expect(db.select().from(positions).where(eq(positions.accountId,'test-rules')).all()).toHaveLength(0);expect(db.select().from(accounts).where(eq(accounts.id,'test-rules')).get()!.cash).toBe(before);}
 finally{sqlite.exec('DROP TRIGGER reject_entry_fixture');}
});

test('drawdown blocks entry before the minute scheduler pauses the account and survives broker restart',async()=>{
 db.update(accounts).set({peakEquity:200}).where(eq(accounts.id,'test-rules')).run();
 for(const activeBroker of [broker,new PaperExecutionAdapter(market,()=>{},undefined,{isolatedLedgerFixture:true})]){
  const result=await activeBroker.placeMarketOrder(order);expect(result.ok).toBe(false);expect(result.reason).toContain('Drawdown');
 }
 expect(db.select().from(accounts).where(eq(accounts.id,'test-rules')).get()!.status).toBe('active');
 expect(db.select().from(trades).where(eq(trades.accountId,'test-rules')).all()).toHaveLength(0);
});
test('drawdown appearing during execution latency blocks the queued entry',async()=>{
 vi.useFakeTimers();try{
  const pending=broker.placeMarketOrder(order);await Promise.resolve();await Promise.resolve();
  db.update(accounts).set({peakEquity:200}).where(eq(accounts.id,'test-rules')).run();
  await vi.runAllTimersAsync();const result=await pending;expect(result.ok).toBe(false);expect(result.reason).toContain('Drawdown');
  expect(db.select().from(trades).where(eq(trades.accountId,'test-rules')).all()).toHaveLength(0);
 }finally{vi.useRealTimers();}
});
test('persisted drawdown cannot block a protective full exit',async()=>{
 expect((await broker.placeMarketOrder(order)).ok).toBe(true);
 db.update(accounts).set({peakEquity:200}).where(eq(accounts.id,'test-rules')).run();
 const result=await new PaperExecutionAdapter(market,()=>{},undefined,{isolatedLedgerFixture:true}).placeMarketOrder({...order,side:'sell',sellFraction:1,protectiveExit:true,decisionId:'drawdown-exit'});
 expect(result.ok).toBe(true);expect(db.select().from(positions).where(eq(positions.accountId,'test-rules')).all()).toHaveLength(0);
});

test('entry costs cannot open a fill already beyond the persisted drawdown limit',async()=>{
 const {config}=await import('../src/config.js');
 db.update(accounts).set({peakEquity:100/(1-config.MAX_DRAWDOWN_PCT)-.05}).where(eq(accounts.id,'test-rules')).run();
 const result=await broker.placeMarketOrder(order);expect(result.ok).toBe(false);expect(result.reason).toContain('Drawdown');
 expect(db.select().from(trades).where(eq(trades.accountId,'test-rules')).all()).toHaveLength(0);
});

test('coin-quality unknown vetoes all paper buys before the portfolio RiskEngine but never blocks protective sells',async()=>{
 const isolated=new PaperExecutionAdapter(market,()=>{},undefined,{isolatedLedgerFixture:true});
 const portfolio=vi.fn(()=>({allowed:true,approvedAmount:25,reasons:[]}));
 isolated.setPortfolioRiskGuard(portfolio);
 isolated.setCoinQualityGuard(async()=>({allowed:false,reason:'unknown public tags'}));
 const denied=await isolated.placeMarketOrder({...order,decisionId:'quality-denied'});
 expect(denied).toMatchObject({ok:false});
 expect(denied.reason).toContain('Coin quality');
 expect(portfolio).not.toHaveBeenCalled();
 expect(db.select().from(trades).where(eq(trades.accountId,'test-rules')).all()).toHaveLength(0);
 expect((await broker.placeMarketOrder({...order,decisionId:'quality-regular'})).ok).toBe(true);
 const exit=await isolated.placeMarketOrder({accountId:'test-rules',pair:'TEST/EUR',
  side:'sell',sellFraction:1,reason:'protective safety exit',protectiveExit:true,decisionId:'quality-exit'});
 expect(exit.ok).toBe(true);
});

test('default PaperExecutionAdapter persistently blocks an inconsistent account before any new buy',async()=>{
 db.update(accounts).set({cash:130}).where(eq(accounts.id,'test-rules')).run();
 const productionGate=new PaperExecutionAdapter(market,()=>{});
 const result=await productionGate.placeMarketOrder(order);
 expect(result.ok).toBe(false);
 expect(result.reason).toContain('PAPER_RECONCILE_BLOCKED: cash_mismatch');
 expect(db.select().from(trades).where(eq(trades.accountId,'test-rules')).all()).toHaveLength(0);
 expect(db.select().from(accounts).where(eq(accounts.id,'test-rules')).get()!.cash).toBe(130);
 const stored=sqlite.prepare('SELECT reason_code FROM paper_reconcile_blocks WHERE account_id=?')
  .get('test-rules') as {reason_code:string}|undefined;
 expect(stored?.reason_code).toBe('cash_mismatch');
});
