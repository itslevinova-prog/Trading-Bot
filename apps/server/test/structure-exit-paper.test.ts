import {test,expect} from 'vitest';
import type {DecisionContext,FeatureSnapshot} from '@paper/shared';import {parseAiAnswer} from '@paper/shared';
import {structureExitPaperDecision,StructureExitPaperProvider} from '../src/strategy/structure-exit-paper.js';
const now=Date.UTC(2026,0,4,12),ts=now-900000;
function fixture():DecisionContext{
 const f:FeatureSnapshot={pair:'ETH/EUR',ts,price:99,ema20:100,ema50:98,ema50_60m:97,prevEma20:100,prevEma50:98,rsi14:45,atr14:.5,atrPct:.5,volumeRatio:.1,change1h:-1,change4h:1,change24h:2,spreadPct:.01,distanceEma50Pct:1};
 return {timeUTC:new Date(now).toISOString(),timeZurich:'fixture',execution:{mode:'paper'},features:[f],positions:[{pair:f.pair,qty:1,openedAt:now-3600000}],account:{cash:100,equity:200},limits:{},recentTrades:[],memory:[],lessons:[],marketContext:{markets:[{pair:f.pair,asOf:now,feature:structuredClone(f),quality:{stale:false,bookUsable:true,bookAgeMs:0,lastClosedAt:now},microstructure:{bids:[{price:'99',qty:'10'}],asks:[{price:'99.01',qty:'10'}]},regime:{structure:{version:'closed-structure-v1',complete:true,priorCandles:20,signalClosedAt:now,priorSupport:99.5,priorResistance:105,downsideBreakout:true}}}]}};
}
const market=(c:DecisionContext)=>(c.marketContext as any).markets[0];
test('post-entry confirmed support loss exits despite still-positive4h/hourly trend and low entry volume',()=>{
 const c=fixture(),r=structureExitPaperDecision(c);expect(r.answer.actions[0]).toMatchObject({type:'sell',pair:'ETH/EUR',sellFraction:1});expect(r.evidence.originalEntryThesisObserved).toBe(false);expect(r.evidence.exitChecks['ETH/EUR']).toBe('current-structure-break-not-recorded-entry-thesis');
});
test.each(['wick-only','nonnegative-hour','above-short-ema','incomplete','future','wrong-support','missing-origin','new-entry','duplicate-position','stale-book','future-feature','nonpaper'] as const)('%s never fabricates a structural exit',kind=>{
 const c=fixture(),s=market(c).regime.structure;
 if(kind==='wick-only'){s.downsideBreakout=false;s.priorSupport=98;}
 if(kind==='nonnegative-hour')c.features[0]!.change1h=0;if(kind==='above-short-ema')c.features[0]!.ema20=98.5;if(kind==='incomplete')s.complete=false;if(kind==='future')s.signalClosedAt=now+900000;if(kind==='wrong-support')s.priorSupport=98;if(kind==='missing-origin')delete (c.positions[0] as any).openedAt;if(kind==='new-entry')(c.positions[0] as any).openedAt=now;if(kind==='duplicate-position')c.positions.push({...c.positions[0] as any});if(kind==='stale-book')market(c).asOf=now-6000;if(kind==='future-feature')c.features[0]!.ts=now;if(kind==='nonpaper')c.execution={mode:'live'};
 market(c).feature=structuredClone(c.features[0]);expect(structureExitPaperDecision(c).answer.actions.every(a=>a.type==='hold')).toBe(true);
});
test('baseline bearish exit survives missing origin, structure and covariance',()=>{
 const c=fixture();delete (c.positions[0] as any).openedAt;delete market(c).regime.structure;Object.assign(c.features[0]!,{ema20:95,price:96,change4h:-2});market(c).feature=structuredClone(c.features[0]);expect(structureExitPaperDecision(c).answer.actions[0]).toMatchObject({type:'sell',pair:'ETH/EUR'});
});
test('already-confirmed baseline exit is not duplicated by an optional structural exit',()=>{
 const c=fixture();Object.assign(c.features[0]!,{ema20:97,ema50:98,ema50_60m:100,price:96,change4h:-2});market(c).feature=structuredClone(c.features[0]);const r=structureExitPaperDecision(c);expect(r.answer.actions).toHaveLength(1);expect(r.evidence.additionalExitProposals).toBe(0);
});
test('provider is deterministic/schema-valid/read-only with no fabricated probability',async()=>{
 const c=fixture(),before=JSON.stringify(c),p=new StructureExitPaperProvider(),a=await p.decide(c);expect(await p.decide(c)).toEqual(a);expect(JSON.stringify(c)).toBe(before);expect(parseAiAnswer(JSON.stringify(a),new Set(['ETH/EUR'])).valid).toBe(true);expect(p.getEvidence()).toMatchObject({simulated:true,estimatedWinProbability:null,performanceValidated:false});expect(a.actions.length).toBeLessThanOrEqual(3);
});
