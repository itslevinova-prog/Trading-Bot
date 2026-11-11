import {MockAiProvider} from '../src/strategy/providers.js';
import {test,expect} from 'vitest';
import type {Candle,DecisionContext,DecisionProvider,Action} from '@paper/shared';
import {replayRulesPortfolio,type PortfolioOptions,type ReplayMarket} from '../src/research/portfolio.js';
import {mockReplayStudy} from '../src/research/mock-replay-context.js';
const start=Date.UTC(2026,0,1),from=start+250*900000;
const options:PortfolioOptions={startingBalance:1000,feeRate:.001,spreadBps:5,slippageBps:5,fromTs:from,toTs:from+12*900000,decisionIntervalMinutes:15,maxDrawdownPct:.25,minOrderQuote:10,risk:{maxPositionPct:.15,maxOpenPositions:2,maxTradesPerDay:1,cooldownMinutes:120,maxPortfolioRiskPct:.0125,feeRate:.001},entry:{maxSpreadBps:10,maxSlippageBps:15}};
const assumptions={venue:'binance',quoteCurrency:'EUR',visibleDepthQuote:1000,stopLossPct:.05} as const;
const market=():ReplayMarket=>({pair:'BTC/EUR',lotDecimals:6,minQty:.000001,minOrderQuote:5,candles:Array.from({length:270},(_,i):Candle=>({pair:'BTC/EUR',interval:15,ts:start+i*900000,open:100,high:100.1,low:99.9,close:100,volume:10}))});
const buy:Action={type:'buy',pair:'BTC/EUR',amountEur:100,stopLossPct:.05,takeProfitPct:.1,confidence:.8,reasoning:'study fixture'};
const hold:Action={type:'hold',confidence:0,reasoning:'wait'};
const sell:Action={type:'sell',pair:'BTC/EUR',sellFraction:1,confidence:.8,reasoning:'study exit'};
test('study supplies matching closed context and explicitly synthetic liquidity without changing source candles',async()=>{
 const m=market(),before=JSON.stringify(m);let first:DecisionContext|undefined;
 const provider:DecisionProvider={decide:async c=>{first??=structuredClone(c);return {marketView:'fixture',actions:[hold]};}};
 await replayRulesPortfolio([m],options,provider,mockReplayStudy(options,assumptions));
 expect(JSON.stringify(m)).toBe(before);const c=first!,e=c.marketContext as any,frame=e.markets[0];
 expect(frame.asOf).toBe(Date.parse(c.timeUTC));expect(frame.feature).toEqual(c.features[0]);expect(frame.quality.lastClosedAt).toBe(from);expect(frame.regime.structure.complete).toBe(true);
 expect((c.execution as any).simulation.historicalOrderBookObserved).toBe(false);expect(frame.microstructure.scope).toContain('Synthetic');expect(c.limits.MAX_ENTRY_SPREAD_BPS).toBe(10);
});
test('study lets discretionary exits through an exhausted entry cap while legacy default retains its semantics',async()=>{
 const provider:DecisionProvider={decide:async c=>({marketView:'fixture',actions:[Date.parse(c.timeUTC)===from+5000?buy:sell]})};
 const study=await replayRulesPortfolio([market()],options,provider,mockReplayStudy(options,assumptions));
 expect(study.strategy).toBe('paper-mock-study');expect(study.fills[1]).toMatchObject({barTs:from+900000,reason:'study exit',protective:false});
 const legacy=await replayRulesPortfolio([market()],options,provider);expect(legacy.fills[1]!.reason).toBe('evaluation end liquidation');expect(legacy.rejections['Daily strategy trade cap']).toBeGreaterThan(0);
});
test('AI study counts buys only and enforces global entry pause with the existing production guard',async()=>{
 const provider:DecisionProvider={decide:async c=>({marketView:'fixture',actions:[Date.parse(c.timeUTC)===from+900000+5000?sell:buy]})};
 const r=await replayRulesPortfolio([market()],options,provider,mockReplayStudy(options,assumptions));
 expect(r.fills.filter(f=>f.side==='buy')).toHaveLength(1);expect(r.rejections['Kaufpause des Trading-Modus aktiv']).toBeGreaterThan(0);
 expect(r.rejections['Tageslimit erreicht']).toBeGreaterThan(0);
});
test('study stop uses fee-inclusive entry basis and selected maximum stop distance',async()=>{
 const m=market();m.candles[251]={...m.candles[251]!,low:94,close:100};
 const provider:DecisionProvider={decide:async c=>({marketView:'fixture',actions:[Date.parse(c.timeUTC)===from+5000?{...buy,stopLossPct:.1}:hold]})};
 const r=await replayRulesPortfolio([m],options,provider,mockReplayStudy(options,assumptions)),entry=r.fills[0]!,exit=r.fills[1]!;
 expect(exit.reason).toBe('intrabar stop-first');const stop=entry.price*(1+options.feeRate)*.95;
 expect(exit.price).toBeCloseTo(stop*(1-options.spreadBps/20000)*(1-options.slippageBps/10000),10);
});
test('future OHLC and post-boundary volume cannot alter an earlier study observation',async()=>{
 const run=async(change:boolean)=>{const m=market();if(change)m.candles=m.candles.map(c=>c.ts>=from?{...c,high:1e9,low:1,close:1e8,volume:1e12}:c);let first:DecisionContext|undefined;
 await replayRulesPortfolio([m],options,{decide:async c=>{first??=structuredClone(c);return {marketView:'fixture',actions:[hold]};}},mockReplayStudy(options,assumptions));return first;};
 expect(await run(false)).toEqual(await run(true));
});
test('changed policy limits and inconsistent fee assumptions fail before calling a provider',async()=>{
 const study=mockReplayStudy(options,assumptions);(study.policy as unknown as {minEntryMinutes:number}).minEntryMinutes=0;
 await expect(replayRulesPortfolio([market()],options,{decide:async()=>{throw Error('must not call');}},study)).rejects.toThrow('policy differs');
 await expect(replayRulesPortfolio([market()],{...options,risk:{...options.risk,feeRate:.002}},{decide:async()=>{throw Error('must not call');}},mockReplayStudy(options,assumptions))).rejects.toThrow('inconsistent study fees');
});


test('real current mock can actually enter through the causal OHLC study producer',async()=>{
 const prices=(i:number)=>100+i*.02+Math.sin(i/6)*.8;
 const m=market();m.candles=Array.from({length:650},(_,i)=>{const close=prices(i),open=prices(i-1);return {pair:'BTC/EUR',interval:15,ts:start+i*900000,open,close,high:Math.max(open,close)*(i%96===0?1.10:1.001),low:Math.min(open,close)*.999,volume:i%2?300:100};});
 const o={...options,toTs:start+649*900000,risk:{...options.risk,maxTradesPerDay:4}};
 const r=await replayRulesPortfolio([m],o,new MockAiProvider(),mockReplayStudy(o,assumptions));
 expect(r.decisions).toBeGreaterThan(100);expect(r.fills.some(f=>f.side==='buy')).toBe(true);expect(r.fees).toBeGreaterThan(0);
});


test('effective safe policy remains stricter than permissive hard risk and quote caps',async()=>{
 const o={...options,spreadBps:40,risk:{...options.risk,maxPositionPct:.5,maxOpenPositions:10,maxTradesPerDay:20,cooldownMinutes:0,maxPortfolioRiskPct:.5},entry:{maxSpreadBps:500,maxSlippageBps:500}};
 const provider:DecisionProvider={decide:async()=>({marketView:'fixture',actions:[{...buy,amountEur:500}]})};
 const r=await replayRulesPortfolio([market()],o,provider,mockReplayStudy(o,assumptions));expect(r.fills).toHaveLength(0);expect(Object.keys(r.rejections).length).toBeGreaterThan(0);
 const narrow={...o,spreadBps:5};const accepted=await replayRulesPortfolio([market()],narrow,provider,mockReplayStudy(narrow,assumptions));
 expect(accepted.fills[0]!.qty*accepted.fills[0]!.price).toBeLessThan(150);
});
