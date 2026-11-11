import {test,expect,vi} from 'vitest';import {and,eq,inArray} from 'drizzle-orm';
import type {Candle,FeatureSnapshot} from '@paper/shared';import type {MarketFeed} from '../src/market/types.js';
import {config} from '../src/config.js';import {db} from '../src/db.js';import {candles,accounts,decisions,decisionEvidence} from '../src/schema.js';
import {collectMarketContext} from '../src/context/collector.js';import {Scheduler} from '../src/strategy/scheduler.js';import {PaperExecutionAdapter} from '../src/broker/PaperExecutionAdapter.js';import {StructureExitPaperProvider} from '../src/strategy/structure-exit-paper.js';
const end=Date.UTC(2026,0,4,12),now=end+5000,pairs=['CTXA/EUR','CTXB/EUR'],accountId='mock-live-policy-fixture';
const logger={error:vi.fn(),warn:vi.fn(),info:vi.fn()} as any;
function fixture(){
 const saved={...config};vi.useFakeTimers();vi.setSystemTime(now);Object.assign(config,{PAPER_EXPERIMENT_MODE:'mock',PAPER_MOCK_POLICY:'structure-exit-v1',AI_PROVIDER:'mock',AI_ENABLED:false,AI_ALLOW_REMOTE:false,CONTEXT_EXTERNAL_ENABLED:false});
 db.delete(candles).where(inArray(candles.pair,pairs)).run();
 for(const pair of pairs){const rows:Candle[]=Array.from({length:193},(_,i)=>{const p=i%2?101:100;return {pair,interval:15,ts:end-193*900000+i*900000,open:p,high:p,low:p,close:p,volume:1};});db.insert(candles).values(rows).run();}
 const features:FeatureSnapshot[]=pairs.map(pair=>({pair,ts:end-900000,price:100,ema20:99,ema50:98,ema50_60m:97,prevEma20:99,prevEma50:98,rsi14:55,atr14:.5,atrPct:.5,volumeRatio:1.5,change1h:1,change4h:2,change24h:3,spreadPct:.01,distanceEma50Pct:2}));
 const feed={venue:'binance',connected:true,features:new Map(features.map(f=>[f.pair,f])),tickers:new Map(pairs.map(symbol=>[symbol,{symbol,bid:100,ask:100.01,last:100,volume:1,change24h:1,receivedAt:now}])),books:new Map(pairs.map(symbol=>[symbol,{symbol,valid:true,receivedAt:now,bids:[{price:'100',qty:'10'}],asks:[{price:'100.01',qty:'10'}]}]))} as unknown as MarketFeed;
 return {feed,close:()=>{Object.assign(config,saved);db.delete(decisions).where(eq(decisions.accountId,accountId)).run();db.delete(accounts).where(eq(accounts.id,accountId)).run();db.delete(candles).where(inArray(candles.pair,pairs)).run();vi.useRealTimers();}};
}
test('real SQLite collector computes192returns from raw history, not the24bar compact display',()=>{
 const f=fixture();try{const c=collectMarketContext(f.feed,now);expect(c.markets[0]!.candles.m15).toHaveLength(24);expect(c.covariance).toMatchObject({asOf:now,returns:192,valid:[true,true],lastClosedAt:end});expect(c.covariance!.covariance[0]![1]).toBeGreaterThan(0);}finally{f.close();}
});
test('future extreme DB candle cannot change earlier panel; missing predecessor stays unknown',()=>{
 const f=fixture();try{const before=collectMarketContext(f.feed,now).covariance;db.insert(candles).values({pair:pairs[0]!,interval:15,ts:end,open:1e10,high:1e10,low:1e10,close:1e10,volume:1}).run();expect(collectMarketContext(f.feed,now).covariance).toEqual(before);
 db.delete(candles).where(and(inArray(candles.pair,pairs),eq(candles.ts,end-193*900000))).run();expect(collectMarketContext(f.feed,now).covariance!.valid).toEqual([false,false]);}finally{f.close();}
});
test('legacy/default collection remains covariance-free and empty feeds do not invent a matrix',()=>{
 const f=fixture();try{config.PAPER_MOCK_POLICY='trend-v2';expect(collectMarketContext(f.feed,now).covariance).toBeUndefined();config.PAPER_MOCK_POLICY='structure-exit-v1';const empty={...f.feed,tickers:new Map(),features:new Map()} as unknown as MarketFeed;expect(collectMarketContext(empty,now).covariance).toBeUndefined();}finally{f.close();}
});
test('actual scheduler consults selected mock and durably retains all risk facts once without a real call or order',async()=>{
 const f=fixture(),fetch=vi.spyOn(globalThis,'fetch'),consult=vi.spyOn(StructureExitPaperProvider.prototype,'decide');db.delete(decisions).where(eq(decisions.accountId,accountId)).run();db.delete(accounts).where(eq(accounts.id,accountId)).run();db.insert(accounts).values({id:accountId,name:'Mock context fixture',strategy:'ai',startingBalance:1000,cash:1000,peakEquity:1000,status:'active',createdAt:now-1000}).run();
 const broker=new PaperExecutionAdapter(f.feed,()=>{}),place=vi.spyOn(broker,'placeMarketOrder'),scheduler=new Scheduler(f.feed,broker,()=>{},logger);
 try{await scheduler.run();const calls=consult.mock.calls.filter(([c])=>(c.account as any).id===accountId);expect(calls).toHaveLength(1);const ctx=calls[0]![0];expect((ctx.portfolioEvidence as any).covariance.asOf).toBe(Date.parse(ctx.timeUTC));expect((ctx.marketContext as any).covariance).toBeUndefined();
 const row=db.select().from(decisions).where(eq(decisions.accountId,accountId)).get()!;expect(row).toMatchObject({provider:'mock:structure-exit-v1',status:'hold'});expect(row.contextJson).not.toBeNull();const stored=JSON.parse(row.contextJson!);expect(stored.portfolioEvidence.covariance).toEqual((ctx.portfolioEvidence as any).covariance);const evidence=db.select().from(decisionEvidence).where(eq(decisionEvidence.decisionId,row.id)).get()!;expect(JSON.parse(evidence.evidenceJson).version).toBe('structure-exit-paper-v1');expect(place).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 }finally{await scheduler.stop();place.mockRestore();consult.mockRestore();fetch.mockRestore();f.close();}
});
