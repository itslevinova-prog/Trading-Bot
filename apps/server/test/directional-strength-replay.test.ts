import {expect,test} from 'vitest';
import type {DecisionContext} from '@paper/shared';
import type {ReplayCausalMarket,ReplayStudy} from '../src/research/portfolio.js';
import {closedDirectionalStrength} from '../src/context/directional-strength.js';
import {directionalStrengthReplayStudy} from '../src/research/directional-strength-replay.js';
const STEP=900000,end=Date.UTC(2026,0,4),pair='ETH/EUR';
const market=():ReplayCausalMarket=>({pair,bid:300,ask:301,hourly:[],candles:Array.from({length:193},(_,i)=>({pair,interval:15,ts:end-(193-i)*STEP,open:100+i,close:100.5+i,high:101+i,low:99+i,volume:1}))});
const context=()=>({timeUTC:new Date(end+5000).toISOString(),features:[{pair,sentinel:'unchanged'}],marketContext:{sentinel:true,markets:[{pair,regime:{hourlyTrend:{sentinel:true}},feature:{sentinel:true}}]}} as unknown as DecisionContext);
const base=(enrich:ReplayStudy['enrich']=x=>x):ReplayStudy=>({kind:'paper-mock-study',policy:{} as any,enrich,onBuyFill:()=>{}});
const descriptor=(c:DecisionContext)=>(c.marketContext as any).markets[0].regime.directionalStrength;

test('full source and exact replay193bar tail produce identical descriptors without mutation',()=>{
 const m=market(),c=context(),before=JSON.stringify({m,c}),b=base(),s=directionalStrengthReplayStudy(b),next=s.enrich(c,[m]);
 expect(descriptor(next)).toEqual(closedDirectionalStrength(pair,m.candles,end+5000));
 expect(descriptor(next)).toMatchObject({complete:true,closedAt:end});
 expect(next.features).toBe(c.features);expect(s.policy).toBe(b.policy);expect(s.onBuyFill).toBe(b.onBuyFill);
 expect((next.marketContext as any).markets[0].regime.hourlyTrend).toEqual({sentinel:true});
 expect(JSON.stringify({m,c})).toBe(before);expect(descriptor(s.enrich(c,[m]))).toEqual(descriptor(next));
});
test('uses base-enriched clock and frame, calls base once',()=>{
 let calls=0;const c=context(),m=market(),s=directionalStrengthReplayStudy(base(x=>{calls++;return {...x,timeUTC:new Date(end+STEP+5000).toISOString()};}));
 expect(descriptor(s.enrich(c,[m]))).toMatchObject({complete:false,closedAt:end+STEP,adx:null});expect(calls).toBe(1);
});
test.each(['absent','duplicate','short','foreign','invalid-clock'] as const)('%s produces explicit unknown, never a fabricated zero',kind=>{
 const c=context(),m=market();let sources=[m];if(kind==='absent')sources=[];if(kind==='duplicate')sources=[m,structuredClone(m)];if(kind==='short')m.candles.shift();if(kind==='foreign')m.candles[10]!.pair='BTC/EUR';if(kind==='invalid-clock')c.timeUTC='invalid';
 expect(descriptor(directionalStrengthReplayStudy(base()).enrich(c,sources))).toMatchObject({complete:false,adx:null,movementBalance:null});
});
test('future and older poisoned data cannot change the closed descriptor',()=>{
 const m=market(),c=context(),s=directionalStrengthReplayStudy(base()),a=descriptor(s.enrich(c,[m]));
 m.candles.push({...m.candles[0]!,ts:end,high:1e50,volume:1e50});m.candles.unshift({...m.candles[0]!,ts:end-194*STEP,high:1e50});
 expect(descriptor(s.enrich(c,[m]))).toEqual(a);
});
test('missing base market context fails explicitly before pretending enrichment succeeded',()=>{
 const c=context();delete c.marketContext;expect(()=>directionalStrengthReplayStudy(base()).enrich(c,[])).toThrow('Research market context unavailable');
});

test('real continuous broker callback supplies193closed bars and adding descriptor preserves every fill and equity point',async()=>{
 const {replayRulesPortfolio}=await import('../src/research/portfolio.js');const {mockReplayStudy}=await import('../src/research/mock-replay-context.js');
 const start=end-250*STEP,m={...market(),lotDecimals:6,minQty:.000001,minOrderQuote:5,candles:Array.from({length:270},(_,i)=>({pair,interval:15,ts:start+i*STEP,open:100+i*.01,close:100.005+i*.01,high:100.1+i*.01,low:99.9+i*.01,volume:10}))};
 const options={startingBalance:1000,feeRate:.001,spreadBps:5,slippageBps:5,fromTs:end,toTs:end+12*STEP,decisionIntervalMinutes:15,maxDrawdownPct:.25,minOrderQuote:10,risk:{maxPositionPct:.15,maxOpenPositions:2,maxTradesPerDay:1,cooldownMinutes:120,maxPortfolioRiskPct:.0125,feeRate:.001},entry:{maxSpreadBps:10,maxSlippageBps:15}};
 const assumptions={venue:'binance',quoteCurrency:'EUR',visibleDepthQuote:1000,stopLossPct:.05} as const,oldContexts:DecisionContext[]=[],newContexts:DecisionContext[]=[];
 const provider=(contexts:DecisionContext[])=>({decide:async(c:DecisionContext)=>{contexts.push(structuredClone(c));return {marketView:'fixture',actions:Date.parse(c.timeUTC)===end+5000?[{type:'buy' as const,pair,amountEur:100,stopLossPct:.05,takeProfitPct:.1,confidence:.8,reasoning:'fixed integration fixture'}]:[{type:'hold' as const,confidence:0,reasoning:'wait'}]};}});
 const before=JSON.stringify(m),original=await replayRulesPortfolio([m],options,provider(oldContexts),mockReplayStudy(options,assumptions));
 const enriched=await replayRulesPortfolio([m],options,provider(newContexts),directionalStrengthReplayStudy(mockReplayStudy(options,assumptions)));
 expect(original.fills.filter(f=>f.side==='buy')).toHaveLength(1);expect(enriched).toEqual(original);expect(newContexts).toHaveLength(13);
 for(let i=0;i<newContexts.length;i++){const c=newContexts[i]!,at=Date.parse(c.timeUTC);expect(descriptor(c)).toEqual(closedDirectionalStrength(pair,m.candles,at));expect(descriptor(c).complete).toBe(true);const stripped=structuredClone(c);delete (stripped.marketContext as any).markets[0].regime.directionalStrength;expect(stripped).toEqual(oldContexts[i]);}
 expect(JSON.stringify(m)).toBe(before);
});
