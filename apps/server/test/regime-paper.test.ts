import {test,expect} from 'vitest';
import type {DecisionContext,FeatureSnapshot} from '@paper/shared';
import {parseAiAnswer} from '@paper/shared';
import {regimePaperDecision,RegimePaperProvider} from '../src/strategy/regime-paper.js';
import {paperMockDecision} from '../src/strategy/paper-intelligence.js';
const now=Date.UTC(2026,9,31,16),ts=now-900000;
function fixture():DecisionContext{
 const c:DecisionContext={timeUTC:new Date(now).toISOString(),timeZurich:'fixture',execution:{mode:'paper'},features:[],positions:[],account:{cash:1000,equity:1000},recentTrades:[],memory:[],lessons:[],limits:{TAKER_FEE_RATE:.001,MAX_ENTRY_SLIPPAGE_BPS:15,MAX_ENTRY_SPREAD_BPS:10,MAX_POSITION_PCT:.15,MAX_OPEN_POSITIONS:3,MIN_ORDER_EUR:10},tradingPolicy:{mode:'safe',stopLossPct:.05},marketContext:{markets:[]}};
 add(c,'ETH/EUR');add(c,'BTC/EUR');return c;
}
function add(c:DecisionContext,pair:string){
 const f:FeatureSnapshot={pair,ts,ema20:99,ema50:98,ema50_60m:97,prevEma20:99,prevEma50:98,rsi14:55,atr14:.5,atrPct:.5,volumeRatio:1.5,change1h:1,change4h:2,change24h:3,spreadPct:.01,distanceEma50Pct:2,price:100};c.features.push(f);
 (c.marketContext as any).markets.push({pair,asOf:now,feature:structuredClone(f),quality:{stale:false,bookUsable:true,bookAgeMs:0,lastClosedAt:now},microstructure:{bids:[{price:'100',qty:'10'}],asks:[{price:'100.01',qty:'10'}]},regime:{structure:{version:'closed-structure-v1',complete:true,signalClosedAt:now,directionalEfficiency:.8,upsideBreakout:false,downsideBreakout:false,upsideRejection:false,downsideRejection:false,twoSidedSweep:false},resistanceLast24h:110,correlationBTC48h:{complete:true,value:.9}}});
}
const frame=(c:DecisionContext,pair:string)=>(c.marketContext as any).markets.find((m:any)=>m.pair===pair);
function bearish(c:DecisionContext,pair='BTC/EUR'){
 const f=c.features.find(f=>f.pair===pair)!;Object.assign(f,{ema20:95,ema50:98,ema50_60m:97,price:96,change4h:-2});frame(c,pair).feature=structuredClone(f);frame(c,pair).microstructure={bids:[{price:'96',qty:'10'}],asks:[{price:'96.01',qty:'10'}]};
}
test('bearish BTC vetoes an otherwise valid high-correlation alt without requiring a BTC holding',()=>{
 const c=fixture();bearish(c);expect(paperMockDecision(c).evidence.assessments.find(a=>a.pair==='ETH/EUR')!.action).toBe('buy');const r=regimePaperDecision(c);expect(r.answer.actions.every(a=>a.type==='hold')).toBe(true);expect(r.evidence.assessments.find(a=>a.pair==='ETH/EUR')!.contradictions).toContain('high-btc-correlation-conflicts-with-bearish-reference');
});
test('low positive and negative correlations neither inherit a bearish veto nor earn larger budgets',()=>{
 for(const corr of [.2,-.9]){const c=fixture();bearish(c);frame(c,'ETH/EUR').regime.correlationBTC48h.value=corr;expect(regimePaperDecision(c).answer.actions[0]).toMatchObject({type:'buy',pair:'ETH/EUR',amountEur:150});}
});
test.each(['missing','future','stale','different-window','duplicate','dislocated'] as const)('%s BTC reference is unknown and blocks correlated alt exposure',kind=>{
 const c=fixture();if(kind==='dislocated'){frame(c,'BTC/EUR').microstructure.asks[0].price='120';}if(kind==='missing')c.features=c.features.filter(f=>!f.pair.startsWith('BTC/'));if(kind==='future')frame(c,'BTC/EUR').asOf=now+1;if(kind==='stale')frame(c,'BTC/EUR').asOf=now-6000;if(kind==='different-window'){const f=c.features.find(f=>f.pair==='BTC/EUR')!;f.ts-=900000;frame(c,f.pair).feature=structuredClone(f);frame(c,f.pair).quality.lastClosedAt-=900000;}if(kind==='duplicate')c.features.push({...c.features.find(f=>f.pair==='BTC/EUR')!});
 const a=regimePaperDecision(c).evidence.assessments.find(a=>a.pair==='ETH/EUR')!;expect(a.action).toBe('hold');expect(a.contradictions).toContain('btc-market-regime-unavailable');
});
test('missing candidate correlation never becomes independent market exposure',()=>{const c=fixture();delete frame(c,'ETH/EUR').regime.correlationBTC48h;expect(regimePaperDecision(c).evidence.assessments.find(a=>a.pair==='ETH/EUR')!.contradictions).toContain('btc-regime-correlation-unknown');});
test('two held alts with a shared BTC factor reduce new-alt budget once, not once per holding',()=>{
 const c=fixture();add(c,'SOL/EUR');add(c,'XRP/EUR');c.positions=[{pair:'SOL/EUR'},{pair:'XRP/EUR'}];const e=regimePaperDecision(c).evidence.assessments.find(a=>a.pair==='ETH/EUR')!;expect(e).toMatchObject({action:'buy',amount:75,correlationAdjustment:.5});
});
test('existing BTC budget adjustment is not applied twice',()=>{
 const c=fixture();c.positions=[{pair:'BTC/EUR'}];expect(regimePaperDecision(c).answer.actions[0]).toMatchObject({type:'buy',pair:'ETH/EUR',amountEur:75});
});
test('unknown held common-factor data blocks new correlated exposure without suppressing exits',()=>{
 const c=fixture();add(c,'SOL/EUR');c.positions=[{pair:'SOL/EUR'}];bearish(c,'SOL/EUR');delete frame(c,'SOL/EUR').regime.correlationBTC48h;
 const r=regimePaperDecision(c);expect(r.answer.actions[0]).toMatchObject({type:'sell',pair:'SOL/EUR'});expect(r.evidence.assessments.find(a=>a.pair==='ETH/EUR')!.action).toBe('hold');
});
test('proxy reduction below minimum order abstains; baseline refusals never become buys',()=>{
 const c=fixture();add(c,'SOL/EUR');c.positions=[{pair:'SOL/EUR'}];c.limits.MIN_ORDER_EUR=100;expect(regimePaperDecision(c).evidence.assessments.find(a=>a.pair==='ETH/EUR')!.contradictions).toContain('shared-factor-risk-budget-below-minimum-order');
 frame(c,'ETH/EUR').microstructure.asks[0].qty='.0001';expect(regimePaperDecision(c).evidence.assessments.find(a=>a.pair==='ETH/EUR')!.action).toBe('hold');
});
test('when first candidate is vetoed a valid alternative can be selected; one buy maximum',()=>{
 const c=fixture();bearish(c);add(c,'SOL/EUR');frame(c,'SOL/EUR').regime.correlationBTC48h.value=.2;expect(regimePaperDecision(c).answer.actions).toMatchObject([{type:'buy',pair:'SOL/EUR'}]);
});
test('provider is deterministic, read-only, schema-valid and exposes explicitly unknown predictive performance',async()=>{
 const c=fixture(),before=JSON.stringify(c),p=new RegimePaperProvider(),a=await p.decide(c);expect(await p.decide(c)).toEqual(a);expect(JSON.stringify(c)).toBe(before);expect(parseAiAnswer(JSON.stringify(a),new Set(c.features.map(f=>f.pair))).valid).toBe(true);expect(p.getEvidence()).toMatchObject({simulated:true,estimatedWinProbability:null,performanceValidated:false});
 c.features.reverse();expect((await p.decide(c)).actions).toEqual(a.actions);
});
