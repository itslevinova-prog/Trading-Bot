import {test,expect,vi,beforeEach} from 'vitest';
import {eq} from 'drizzle-orm';import type {DecisionResult} from '@paper/shared';import type {FastifyBaseLogger} from 'fastify';
import {Scheduler} from '../src/strategy/scheduler.js';import {RuleBasedProvider} from '../src/strategy/providers.js';import {PaperExecutionAdapter} from '../src/broker/PaperExecutionAdapter.js';import type {MarketFeed} from '../src/market/types.js';
import {db} from '../src/db.js';import {accounts,decisions,candles} from '../src/schema.js';
import {assessPaperOpportunities} from '../src/strategy/paper-intelligence.js';
const accountId='scheduler-lifecycle',market={venue:'binance',connected:false,tickers:new Map(),books:new Map(),features:new Map()} as unknown as MarketFeed;
const logger={error:vi.fn(),warn:vi.fn(),info:vi.fn()} as unknown as FastifyBaseLogger;
beforeEach(()=>{db.delete(decisions).where(eq(decisions.accountId,accountId)).run();db.delete(accounts).where(eq(accounts.id,accountId)).run();db.insert(accounts).values({id:accountId,name:'Scheduler lifecycle',strategy:'rules',startingBalance:100,cash:100,peakEquity:100,status:'active',createdAt:Date.now()}).run();});
test('paused accounts prepare context without consulting a decision provider',async()=>{db.update(accounts).set({status:'paused'}).where(eq(accounts.id,accountId)).run();const provider=vi.spyOn(RuleBasedProvider.prototype,'decide').mockResolvedValue({marketView:'Test',actions:[]});const scheduler=new Scheduler(market,new PaperExecutionAdapter(market,()=>{},undefined,{isolatedLedgerFixture:true}),()=>{},logger);try{await scheduler.run();expect(provider.mock.calls.filter(([context])=>(context.account as {id:string}).id===accountId)).toHaveLength(0);expect(db.select().from(decisions).where(eq(decisions.accountId,accountId)).get()).toMatchObject({status:'not_sent'});}finally{await scheduler.stop();provider.mockRestore();}});
test('scheduled shutdown drains a pending provider and cancels its actions before the database can close',async()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T19:14:59Z'));let finish:((value:DecisionResult)=>void)|undefined;const provider=vi.spyOn(RuleBasedProvider.prototype,'decide').mockImplementation(async context=>(context.account as {id:string}).id===accountId?await new Promise<DecisionResult>(resolve=>{finish=resolve;}):{marketView:'Other fixture account',actions:[]});const broker=new PaperExecutionAdapter(market,()=>{},undefined,{isolatedLedgerFixture:true}),place=vi.spyOn(broker,'placeMarketOrder'),scheduler=new Scheduler(market,broker,()=>{},logger);try{scheduler.start();await vi.advanceTimersByTimeAsync(6000);expect(finish).toBeTypeOf('function');let done=false;const stopping=scheduler.stop().then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);finish!({marketView:'Delayed answer',actions:[{type:'buy',pair:'BTC/EUR',amountEur:10,stopLossPct:.05,takeProfitPct:.1,confidence:1,reasoning:'Must never execute after shutdown'}]});await stopping;expect(done).toBe(true);expect(place).not.toHaveBeenCalled();expect(db.select().from(decisions).where(eq(decisions.accountId,accountId)).get()).toMatchObject({status:'cancelled'});}finally{finish?.({marketView:'Cleanup',actions:[]});await scheduler.stop();provider.mockRestore();place.mockRestore();vi.useRealTimers();}});


test('stopping immediately after start prevents queued initial work from buying',async()=>{const broker=new PaperExecutionAdapter(market,()=>{},undefined,{isolatedLedgerFixture:true}),place=vi.spyOn(broker,'placeMarketOrder'),scheduler=new Scheduler(market,broker,()=>{},logger);scheduler.start();await scheduler.stop();expect(place).not.toHaveBeenCalled();place.mockRestore();});


test('decision and collected market evidence share one captured clock even while assembly takes time',async()=>{
 vi.useFakeTimers();const base=Date.UTC(2026,9,31,10,30,5);vi.setSystemTime(base);let reads=0;
 const clock=vi.spyOn(Date,'now').mockImplementation(()=>base+3*reads++);
 const scheduler=new Scheduler(market,new PaperExecutionAdapter(market,()=>{},undefined,{isolatedLedgerFixture:true}),()=>{},logger);
 try{const c=scheduler.context(accountId),m=c.marketContext as {asOf:number;markets:{asOf:number}[]};
 expect(m.asOf).toBe(Date.parse(c.timeUTC));expect(m.markets.every(row=>row.asOf===Date.parse(c.timeUTC))).toBe(true);
 expect(clock).toHaveBeenCalled();
 }finally{clock.mockRestore();vi.useRealTimers();await scheduler.stop();}
});


test.each([[-5001,false],[-400,true],[1,false]] as const)('shared snapshot keeps book freshness at %sms strict',async(offset,usable)=>{
 vi.useFakeTimers();const base=Date.UTC(2026,9,31,10,30,5);vi.setSystemTime(base);let reads=0;
 const clock=vi.spyOn(Date,'now').mockImplementation(()=>base+3*reads++);
 const feed={...market,tickers:new Map([['BTC/EUR',{symbol:'BTC/EUR',bid:100,ask:101,last:100,volume:1,change24h:0,receivedAt:base+offset}]]),books:new Map([['BTC/EUR',{symbol:'BTC/EUR',bids:[{price:'100',qty:'1'}],asks:[{price:'101',qty:'1'}],receivedAt:base+offset,valid:true}]])};
 const scheduler=new Scheduler(feed,new PaperExecutionAdapter(feed,()=>{},undefined,{isolatedLedgerFixture:true}),()=>{},logger);
 try{const c=scheduler.context(accountId),m=c.marketContext as {markets:{asOf:number;quality:{bookUsable:boolean;bookAgeMs:number}}[]};
 expect(Date.parse(c.timeUTC)).toBe(base);expect(m.markets[0]!.asOf).toBe(base);
 expect(m.markets[0]!.quality).toMatchObject({bookUsable:usable,bookAgeMs:-offset});
 }finally{clock.mockRestore();vi.useRealTimers();await scheduler.stop();}
});


test('actual scheduler and SQL collector reach mock market reasoning despite advancing wall clock',async()=>{
 vi.useFakeTimers();const base=Date.UTC(2026,9,31,10,30),pair='CLOCK-FIXTURE/EUR';vi.setSystemTime(base);let reads=0;
 const clock=vi.spyOn(Date,'now').mockImplementation(()=>base+3*reads++);
 const feature={pair,ts:base-900000,price:100,ema20:99,ema50:98,ema50_60m:97,prevEma20:99,prevEma50:98,rsi14:55,atr14:.5,atrPct:.5,volumeRatio:1.5,change1h:1,change4h:2,change24h:3,spreadPct:.01,distanceEma50Pct:2};
 const feed={...market,connected:true,features:new Map([[pair,feature]]),tickers:new Map([[pair,{symbol:pair,bid:100,ask:100.01,last:100,volume:1,change24h:3,receivedAt:base-400}]]),books:new Map([[pair,{symbol:pair,bids:[{price:'100',qty:'10'}],asks:[{price:'100.01',qty:'10'}],receivedAt:base-400,valid:true}]])};
 const scheduler=new Scheduler(feed,new PaperExecutionAdapter(feed,()=>{},undefined,{isolatedLedgerFixture:true}),()=>{},logger);
 try{db.delete(candles).where(eq(candles.pair,pair)).run();for(let i=1;i<=200;i++)db.insert(candles).values({pair,interval:15,ts:base-i*900000,open:100,high:110,low:99,close:100,volume:1}).run();
 const c=scheduler.context(accountId),a=assessPaperOpportunities(c).assessments[0]!;
 expect(a.support).toContain('fresh-matching-closed-candle-and-book');expect(a.contradictions).not.toContain('missing-stale-or-mixed-market-evidence');expect(a.regime).toBe('bullish-trend');
 }finally{clock.mockRestore();vi.useRealTimers();db.delete(candles).where(eq(candles.pair,pair)).run();await scheduler.stop();}
});

test('manual account-scoped cycle leaves other strategy accounts untouched',async()=>{
 const provider=vi.spyOn(RuleBasedProvider.prototype,'decide').mockResolvedValue({marketView:'Scoped fixture',actions:[]}),scheduler=new Scheduler(market,new PaperExecutionAdapter(market,()=>{},undefined,{isolatedLedgerFixture:true}),()=>{},logger);
 try{expect(await scheduler.run(accountId)).toBe('completed');expect(provider.mock.calls).toHaveLength(1);expect((provider.mock.calls[0]![0].account as {id:string}).id).toBe(accountId);expect(db.select().from(decisions).where(eq(decisions.accountId,accountId)).get()).toMatchObject({marketView:'Scoped fixture'});await scheduler.stop();expect(await scheduler.run(accountId)).toBe('stopping');}finally{await scheduler.stop();provider.mockRestore();}
});
