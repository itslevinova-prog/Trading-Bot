import {test,expect} from 'vitest';
import type {DecisionContext,DecisionProvider} from '@paper/shared';
import {replayRulesPortfolio,type PortfolioOptions,type ReplayMarket} from '../src/research/portfolio.js';
import {entrySupportReplayStudy} from '../src/research/entry-support-replay.js';
const start=Date.UTC(2026,0,1),from=start+250*900000,pair='BTC/EUR',options:PortfolioOptions={startingBalance:100,feeRate:.001,spreadBps:5,slippageBps:5,fromTs:from,decisionIntervalMinutes:15,maxDrawdownPct:.25,minOrderQuote:10,risk:{maxPositionPct:.3,maxOpenPositions:4,maxTradesPerDay:10,cooldownMinutes:60,maxPortfolioRiskPct:.025,feeRate:.001},entry:{maxSpreadBps:20,maxSlippageBps:30}};
const market=():ReplayMarket=>({pair,lotDecimals:6,minQty:.000001,minOrderQuote:5,candles:Array.from({length:270},(_,i)=>({pair,interval:15,ts:start+i*900000,open:100,close:100,high:101,low:99,volume:100}))});
async function run(amount:number,future=false,duplicate=false){
 const seen:DecisionContext[]=[],provider:DecisionProvider={decide:async c=>{seen.push(structuredClone(c));return {marketView:'Synthetic attribution fixture only',actions:Date.parse(c.timeUTC)===from+5000?Array.from({length:duplicate?2:1},()=>({type:'buy' as const,pair,amountEur:amount,stopLossPct:.05,takeProfitPct:.1,confidence:1,reasoning:'Synthetic fixture entry'})):[{type:'hold',confidence:0,reasoning:'Fixture wait'}]};},getEvidence:()=>({version:'fixture-only',assessments:[{pair,action:'buy',strategy:'trend-continuation',invalidation:'Fixture stop',support:['fixture'],contradictions:[]}]})};
 const capture=entrySupportReplayStudy(options,{venue:'kraken',quoteCurrency:'EUR',visibleDepthQuote:1000,stopLossPct:.05},provider,'fixture-scope'),m=market();if(future)m.candles[251]={...m.candles[251]!,high:120};
 const result=await replayRulesPortfolio([m],options,provider,capture.study);return {result,records:capture.records(),seen};
}
test('only actually accepted fills acquire source identity, available to the next modelled closed snapshot',async()=>{
 const good=await run(12);expect(good.records.entries).toHaveLength(1);expect(good.records).toMatchObject({availabilityDomain:'modelled-historical-only'});expect(good.records.entries[0]!.snapshot).toMatchObject({sourceObserved:true,eligibleForThesisPolicy:true,contextDomain:'historical-simulation',recordedStructure:{priorSupport:99}});expect(good.seen[0]!.positions).toHaveLength(0);expect(good.seen.some(c=>(c.positions[0] as any)?.entryEvidence?.eligibleForThesisPolicy===true)).toBe(true);
 const rejected=await run(1);expect(rejected.result.fills).toHaveLength(0);expect(rejected.records.entries).toHaveLength(0);
});
test('future OHLC mutation cannot rewrite the original accepted entry snapshot',async()=>{
 const a=await run(12),b=await run(12,true);expect(a.records.entries[0]).toEqual(b.records.entries[0]);
});

test('full original duplicate buy proposals are never silently rewritten into a unique entry source',async()=>{
 const r=await run(12,false,true);expect(r.records.entries.length).toBeGreaterThan(0);expect(r.records.entries.every(e=>e.snapshot.sourceObserved===false&&e.snapshot.eligibleForThesisPolicy===false)).toBe(true);
});
