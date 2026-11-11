import {mockReplayStudy} from '../src/research/mock-replay-context.js';
import {expect,test} from 'vitest';
import {replayRulesPortfolio,type PortfolioOptions,type ReplayMarket} from '../src/research/portfolio.js';
import type {Candle,DecisionContext,DecisionProvider,Action} from '@paper/shared';
const start=Date.UTC(2026,0,1),from=start+250*900000;
const options:PortfolioOptions={startingBalance:100,feeRate:.001,spreadBps:10,slippageBps:8,fromTs:from,decisionIntervalMinutes:15,maxDrawdownPct:.25,minOrderQuote:10,risk:{maxPositionPct:.3,maxOpenPositions:4,maxTradesPerDay:10,cooldownMinutes:60,maxPortfolioRiskPct:.025,feeRate:.001},entry:{maxSpreadBps:20,maxSlippageBps:30}};
const candles=(pair:string,count=270):Candle[]=>Array.from({length:count},(_,i)=>({pair,interval:15,ts:start+i*900000,open:100,close:100,high:101,low:99,volume:100}));
const market=(pair='BTC/EUR'):ReplayMarket=>({pair,candles:candles(pair),lotDecimals:6,minQty:.000001,minOrderQuote:5});
const buy=(pair:string):Action=>({type:'buy',pair,amountEur:15,stopLossPct:.05,takeProfitPct:.1,confidence:.5,reasoning:'engine fixture'});
const once=(actions:Action[]):DecisionProvider=>({decide:async context=>({marketView:'fixture',actions:Date.parse(context.timeUTC)===from+5000?actions:[{type:'hold',confidence:0,reasoning:'fixture wait'}]})});
test('default replay calls actual rules and never invents profit from no signals',async()=>{const result=await replayRulesPortfolio([market()],options);expect(result.strategy).toBe('actual-rule-provider');expect(result.fills).toHaveLength(0);expect(result.returnPct).toBe(0);expect(result.winRatePct).toBeNull();expect(result.benchmarkReturnPct).toBeLessThan(0);});
test('entry observes only closed history and pays both sides of trading costs',async()=>{let first:DecisionContext|undefined;const delegate=once([buy('BTC/EUR')]);const provider:DecisionProvider={decide:async c=>{first??=JSON.parse(JSON.stringify(c));return delegate.decide(c);}};const r=await replayRulesPortfolio([market()],options,provider);expect(first!.features.length).toBe(1);expect(first!.features[0]!.ts+900000).toBeLessThanOrEqual(from);expect(r.fills).toHaveLength(2);expect(r.fills[0]!.barTs).toBe(from);expect(r.fills[0]!.signalBarTs).toBe(from-900000);expect(r.finalEquity).toBeLessThan(100);expect(r.fees).toBeGreaterThan(0);expect(r.curve.at(-1)!.positions).toBe(0);expect(r.finalEquity-100).toBeCloseTo(r.fills[1]!.realizedPnl!,8);});
test('simultaneous stop and target uses adverse stop-first assumption',async()=>{const m=market();m.candles[250]={...m.candles[250]!,low:80,high:130};const r=await replayRulesPortfolio([m],options,once([buy('BTC/EUR')]));expect(r.fills[1]).toMatchObject({reason:'intrabar stop-first',intrabarOrderAmbiguous:true});expect(r.fills[1]!.realizedPnl).toBeLessThan(0);});
test('price gap stop exits at worse open rather than a guaranteed stop price',async()=>{const m=market();m.candles[251]={...m.candles[251]!,open:70,low:69,high:101,close:100};const r=await replayRulesPortfolio([m],options,once([buy('BTC/EUR')]));expect(r.fills[1]!.reason).toBe('gap stop');expect(r.fills[1]!.intrabarOrderAmbiguous).toBeUndefined();expect(r.fills[1]!.price).toBeLessThan(70);});
test('an opening gap above the target resolves a later dual touch without ambiguity',async()=>{
 const m=market();
 m.candles[251]={...m.candles[251]!,open:120,high:130,low:80,close:100};
 const result=await replayRulesPortfolio([m],options,once([buy('BTC/EUR')]));
 const exit=result.fills[1]!;
 expect(exit.reason).toBe('gap target (conservative target fill)');
 expect(exit.price).toBeLessThan(120);
 expect(exit.intrabarOrderAmbiguous).toBeUndefined();
});
test('simultaneous markets share cash and a single portfolio risk budget',async()=>{const names=['BTC/EUR','ETH/EUR','SOL/EUR','XRP/EUR'];const r=await replayRulesPortfolio(names.map(pair=>market(pair)),options,once(names.map(buy)));const entries=r.fills.filter(f=>f.side==='buy');expect(entries.length).toBeLessThan(4);expect(entries.reduce((s,f)=>s+f.qty*f.price*.05+2*f.fee,0)).toBeLessThanOrEqual(2.5);expect(r.curve.every(p=>p.cash>=0)).toBe(true);expect(Object.keys(r.rejections).length).toBeGreaterThan(0);});
test('held market data gaps block new exposure and are reported',async()=>{const a=market(),b=market('ETH/EUR');a.candles=a.candles.filter(c=>c.ts!==from+900000);const provider:DecisionProvider={decide:async c=>({marketView:'fixture',actions:Date.parse(c.timeUTC)===from+5000?[buy('BTC/EUR')]:Date.parse(c.timeUTC)===from+900000+5000?[buy('ETH/EUR')]:[{type:'hold',confidence:0,reasoning:'wait'}]})};const r=await replayRulesPortfolio([a,b],options,provider);expect(r.missingValuationBars).toBe(1);expect(r.rejections['Stale portfolio valuation']).toBe(1);expect(r.fills.filter(f=>f.side==='buy')).toHaveLength(1);});
test('a gap below minimum exit size remains dust instead of fictional liquidation cash',async()=>{const m=market();m.candles[269]={...m.candles[269]!,open:40,high:41,low:39,close:40};const r=await replayRulesPortfolio([m],options,once([buy('BTC/EUR')]));expect(r.unliquidatedPositions).toBe(1);expect(r.closedTrades).toBe(0);expect(r.finalEquity).toBeGreaterThan(r.curve.at(-1)!.cash);expect(r.rejections['Exit below exchange minimum']).toBeGreaterThan(0);});
test('later altered candles cannot change an earlier provider observation',async()=>{const run=async(change:boolean)=>{const m=market();if(change)m.candles=m.candles.map(c=>c.ts>=from+3*900000?{...c,open:200,close:210,high:220,low:190}:c);let first:DecisionContext|undefined;await replayRulesPortfolio([m],options,{decide:async c=>{first??=JSON.parse(JSON.stringify(c));return {marketView:'x',actions:[]};}});return first;};expect(await run(false)).toEqual(await run(true));});
test('invalid or incompatible replay inputs fail instead of returning misleading empty profits',async()=>{await expect(replayRulesPortfolio([market()],{...options,decisionIntervalMinutes:1})).rejects.toThrow();await expect(replayRulesPortfolio([market(),market()],options)).rejects.toThrow();await expect(replayRulesPortfolio([market()],{...options,feeRate:Infinity})).rejects.toThrow();await expect(replayRulesPortfolio([market()],{...options,toTs:Infinity})).rejects.toThrow('Invalid portfolio replay bounds');});


test('failed protective replay exits latch through a price recovery and keep provider decisions paused',async()=>{const m=market();m.candles[251]={...m.candles[251]!,open:60,high:61,low:59,close:60};const observed:number[]=[];const delegate=once([buy('BTC/EUR')]),provider:DecisionProvider={decide:async c=>{observed.push(Date.parse(c.timeUTC)-5000);return delegate.decide(c);}};const result=await replayRulesPortfolio([m],options,provider);expect(result.paused).toBe(true);expect(result.maxDrawdownPct).toBeLessThan(25);expect(result.rejections['Exit below exchange minimum']).toBeGreaterThan(0);expect(result.fills[1]).toMatchObject({reason:'latched protective retry',barTs:from+2*900000,protective:true});expect(result.closedTrades).toBe(1);expect(observed).toEqual([from]);});
test('drawdown-paused replay never calls the provider again after a fully executable gap stop',async()=>{const m=market();m.candles[251]={...m.candles[251]!,open:70,high:71,low:69,close:70};let calls=0;const delegate=once([buy('BTC/EUR')]);const result=await replayRulesPortfolio([m],{...options,maxDrawdownPct:.01},{decide:async c=>{calls++;return delegate.decide(c);}});expect(result.closedTrades).toBe(1);expect(result.paused).toBe(true);expect(result.fills[1]!.reason).toBe('gap stop');expect(calls).toBe(1);});


test('confirmed-buy observer receives isolated copies and cannot alter simulated economic state',async()=>{
 const o={...options,spreadBps:5,slippageBps:5},base=mockReplayStudy(o,{venue:'kraken',quoteCurrency:'EUR',visibleDepthQuote:1000,stopLossPct:.05}),entry={...buy('BTC/EUR'),amountEur:12,confidence:1} as Action;let observed=0;
 const expected=await replayRulesPortfolio([market()],o,once([entry]),base);const result=await replayRulesPortfolio([market()],o,once([entry]),{...base,onBuyFill:e=>{observed++;expect(e.fill.qty).toBeGreaterThan(0);expect(e.context.positions).toHaveLength(0);e.fill.qty=999;e.position.qty=999;e.context.features[0]!.price=-1;e.action.amountEur=999999;}});expect(observed).toBe(1);expect(result).toEqual(expected);
});
test('rejected proposals cannot create a buy-fill origin and asynchronous observers are refused',async()=>{
 const o={...options,spreadBps:5,slippageBps:5},base=mockReplayStudy(o,{venue:'kraken',quoteCurrency:'EUR',visibleDepthQuote:1000,stopLossPct:.05});let observed=0;const bad={...buy('BTC/EUR'),amountEur:1,confidence:1} as Action;await replayRulesPortfolio([market()],o,once([bad]),{...base,onBuyFill:()=>{observed++;}});expect(observed).toBe(0);
 const good={...buy('BTC/EUR'),amountEur:12,confidence:1} as Action;await expect(replayRulesPortfolio([market()],o,once([good]),{...base,onBuyFill:async()=>{}})).rejects.toThrow('synchronous');
});

test('known entry fees and spread cannot create exposure beyond the replay drawdown limit',async()=>{
 const result=await replayRulesPortfolio([market()],{...options,maxDrawdownPct:.0001},once([buy('BTC/EUR')]));
 expect(result.fills).toHaveLength(0);expect(result.fees).toBe(0);expect(result.finalEquity).toBe(100);
 expect(result.rejections['Drawdown-Grenze erreicht; neue Einstiege gesperrt']).toBe(1);
});

test('a full feed gap counts missing valuation clocks while a position is open',async()=>{
 const m=market(),step=900000;
 m.candles=m.candles.filter(c=>c.ts!==from+step&&c.ts!==from+2*step);
 const result=await replayRulesPortfolio([m],options,once([buy('BTC/EUR')]));
 expect(result.missingValuationBars).toBe(2);
 expect(result.curve.some(point=>point.ts===from+2*step)).toBe(false);
});

test('an unavailable final requested bar cannot liquidate at the last earlier close',async()=>{
 const m=market(),step=900000,to=from+19*step;
 m.candles=m.candles.filter(c=>c.ts<to);
 const result=await replayRulesPortfolio([m],{...options,toTs:to},once([buy('BTC/EUR')]));
 expect(result.fills.map(f=>f.side)).toEqual(['buy']);
 expect(result.missingValuationBars).toBe(1);
 expect(result.unliquidatedPositions).toBe(1);
 expect(result.rejections['Cannot liquidate missing final market']).toBe(1);
 expect(result.benchmarkReturnPct).toBeNull();
});

test('mixed fresh and stale marks cannot create a fictitious drawdown peak',async()=>{
 const a=market(),b=market('ETH/EUR'),gap=from+900000;
 a.candles=a.candles.map(c=>c.ts===gap?{...c,open:150,high:151,low:149,close:150}:c);
 b.candles=b.candles.filter(c=>c.ts!==gap);
 const entry=(pair:string)=>({...buy(pair),takeProfitPct:undefined}) as Action;
 const result=await replayRulesPortfolio([a,b],{...options,maxDrawdownPct:.04},once([entry(a.pair),entry(b.pair)]));
 expect(result.fills.filter(f=>f.side==='buy')).toHaveLength(2);
 expect(result.missingValuationBars).toBe(1);
 expect(result.paused).toBe(false);
 expect(result.maxDrawdownPct).toBeLessThan(1);
 expect(result.curve.find(point=>point.ts===gap+900000)?.valuationComplete).toBe(false);
});

test('synthetic bid triggers a stop the raw low narrowly misses and defers a raw target touch',async()=>{
 const entry=await replayRulesPortfolio([market()],options,once([buy('BTC/EUR')]));
 const price=entry.fills[0]!.price;
 const stop=price*.95,target=price*1.1;
 const stopMarket=market();
 stopMarket.candles[251]={...stopMarket.candles[251]!,low:stop*1.00025};
 const bidOptions={...options,protectionTrigger:'synthetic-bid' as const};
 const legacy=await replayRulesPortfolio([stopMarket],options,once([buy('BTC/EUR')]));
 const bid=await replayRulesPortfolio([stopMarket],bidOptions,once([buy('BTC/EUR')]));
 expect(legacy.fills[1]!.reason).toBe('evaluation end liquidation');
 expect(bid.fills[1]!.reason).toBe('intrabar stop-first');
 expect(bid.fills[1]!.price).toBeCloseTo(stop*(1-options.slippageBps/10000),10);
 const targetMarket=market();
 targetMarket.candles[251]={...targetMarket.candles[251]!,high:target*1.00025};
 const targetLegacy=await replayRulesPortfolio([targetMarket],options,once([buy('BTC/EUR')]));
 const targetBid=await replayRulesPortfolio([targetMarket],bidOptions,once([buy('BTC/EUR')]));
 expect(targetLegacy.fills[1]!.reason).toBe('intrabar target');
 expect(targetBid.fills[1]!.reason).toBe('evaluation end liquidation');
});
