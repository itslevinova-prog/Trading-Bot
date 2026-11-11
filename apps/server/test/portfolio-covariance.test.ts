import {digest} from '../src/provenance/build.js';
import {canonicalJson} from '../src/research/dataset.js';
import {test,expect} from 'vitest';
import type {Candle,DecisionContext,FeatureSnapshot} from '@paper/shared';
import {alignedPortfolioCovariance,covarianceBudget} from '../src/context/portfolio-covariance.js';
import {covariancePaperDecision,CovariancePaperProvider} from '../src/strategy/covariance-paper.js';
const STEP=900000,end=Date.UTC(2026,0,4),now=end+5000,x=Array.from({length:192},(_,i)=>i%2?.01:-.01),y=Array.from({length:192},(_,i)=>i%4<2?.02:-.02);
function bars(pair:string,r:number[]=x,initial=100):Candle[]{let price=initial;return [0,...r].map((v,i)=>{const open=price;price*=Math.exp(v);return {pair,interval:15,ts:end-193*STEP+i*STEP,open,high:Math.max(open,price),low:Math.min(open,price),close:price,volume:1};});}
const panel=(r:number[]=x)=>alignedPortfolioCovariance([{pair:'A/EUR',candles:bars('A/EUR')},{pair:'B/EUR',candles:bars('B/EUR',r)}],now);
test('192aligned log returns use sample covariance, correct predecessor and symmetric Gram matrix',()=>{
 const p=panel();expect(p.valid).toEqual([true,true]);expect(p.returns).toBe(192);expect(p.anchorClosedAt).toBe(end-192*STEP);expect(p.covariance[0]![0]).toBeCloseTo(192/191*.0001,12);expect(p.covariance[0]![1]).toBe(p.covariance[1]![0]);expect(p.covariance[0]![1]).toBe(p.covariance[0]![0]);
});
test('perfect positive correlation derives sqrt2minus1 scale and obeys the incremental variance inequality',()=>{
 const r=covarianceBudget(panel(),now,'A/EUR',100,[{pair:'B/EUR',value:100}]);expect(r.factor).toBeCloseTo(Math.sqrt(2)-1,12);expect(r.afterVariance).toBeCloseTo(r.independentIncrementReference,12);expect(r.afterVariance).toBeLessThan(r.beforeVariance);
});
test('uncorrelated returns preserve original budget; negative correlation never permits a bonus',()=>{
 expect(covarianceBudget(panel(y),now,'A/EUR',100,[{pair:'B/EUR',value:100}]).factor).toBeCloseTo(1,12);expect(covarianceBudget(panel(x.map(v=>-v)),now,'A/EUR',100,[{pair:'B/EUR',value:100}]).factor).toBe(1);
});
test('joint held variance includes every covariance term and scales with actual marked exposures',()=>{
 const p=alignedPortfolioCovariance(['A/EUR','B/EUR','C/EUR'].map(pair=>({pair,candles:bars(pair)})),now),r=covarianceBudget(p,now,'A/EUR',100,[{pair:'B/EUR',value:100},{pair:'C/EUR',value:100}]);expect(r.factor).toBeCloseTo(Math.sqrt(5)-2,12);expect(r.heldVariance).toBeCloseTo(40000*p.covariance[0]![0]!,12);
});
test.each(['missing','duplicate','invalid','shifted'] as const)('%s in the exact193close window stays unknown, no older data substitution',kind=>{
 const rows=bars('A/EUR');if(kind==='missing')rows.splice(20,1);if(kind==='duplicate')rows.push({...rows[20]!});if(kind==='invalid')rows[20]!.low=Infinity;if(kind==='shifted')rows[20]!.ts++;
 const p=alignedPortfolioCovariance([{pair:'A/EUR',candles:rows}],now);expect(p.valid).toEqual([false]);expect(()=>covarianceBudget(p,now,'A/EUR',100,[])).toThrow('Unknown');
});
test('future/unclosed/older candles do not alter historical covariance or hash',()=>{
 const input=bars('A/EUR'),before=alignedPortfolioCovariance([{pair:'A/EUR',candles:input}],now);input.push({...input[0]!,ts:end,close:1e100,high:1e100});input.push({...input[0]!,ts:input[0]!.ts-STEP,close:1e100,high:1e100});expect(alignedPortfolioCovariance([{pair:'A/EUR',candles:input}],now)).toEqual(before);
});
test('incomplete unrelated assets do not invalidate the complete required submatrix',()=>{
 const p=alignedPortfolioCovariance([{pair:'A/EUR',candles:bars('A/EUR')},{pair:'B/EUR',candles:[]}],now);expect(covarianceBudget(p,now,'A/EUR',100,[]).factor).toBe(1);expect(()=>covarianceBudget(p,now,'A/EUR',100,[{pair:'B/EUR',value:100}])).toThrow('Unknown');
});
test('zero observed variance, duplicate positions, stale panels and tampered matrices are rejected',()=>{
 const p=panel();expect(()=>covarianceBudget(panel(x.map(()=>0)),now,'B/EUR',100,[])).toThrow('Unknown');expect(()=>covarianceBudget(p,now,'A/EUR',100,[{pair:'B/EUR',value:1},{pair:'B/EUR',value:1}])).toThrow('Invalid');expect(()=>covarianceBudget(p,now+1,'A/EUR',100,[])).toThrow('Invalid');const bad=structuredClone(p);bad.covariance[0]![1]=0;expect(()=>covarianceBudget(bad,now,'A/EUR',100,[])).toThrow('Invalid');
});
function fixture():DecisionContext{
 const inputs=['ETH/EUR','SOL/EUR'].map(pair=>({pair,candles:bars(pair)}));
 const features:FeatureSnapshot[]=inputs.map(i=>({pair:i.pair,ts:end-STEP,price:i.candles.at(-1)!.close,ema20:99,ema50:98,ema50_60m:97,prevEma20:99,prevEma50:98,rsi14:55,atr14:.5,atrPct:.5,volumeRatio:1.5,change1h:1,change4h:2,change24h:3,spreadPct:.01,distanceEma50Pct:2}));
 return {timeUTC:new Date(now).toISOString(),timeZurich:'fixture',execution:{mode:'paper'},account:{cash:1000,equity:1000},positions:[{pair:'SOL/EUR',qty:1}],recentTrades:[],memory:[],lessons:[],features,limits:{TAKER_FEE_RATE:.001,MAX_ENTRY_SLIPPAGE_BPS:15,MAX_ENTRY_SPREAD_BPS:10,MAX_POSITION_PCT:.15,MAX_OPEN_POSITIONS:2,MIN_ORDER_EUR:10},tradingPolicy:{mode:'safe',stopLossPct:.05},portfolioEvidence:{covariance:alignedPortfolioCovariance(inputs,now)},marketContext:{markets:features.map(f=>({pair:f.pair,asOf:now,feature:structuredClone(f),quality:{stale:false,bookUsable:true,bookAgeMs:0,lastClosedAt:end},microstructure:{bids:[{price:String(f.price),qty:'10'}],asks:[{price:String(f.price*1.0001),qty:'10'}]},regime:{structure:{version:'closed-structure-v1',complete:true,signalClosedAt:end,directionalEfficiency:.8,upsideBreakout:false,downsideBreakout:false,upsideRejection:false,downsideRejection:false,twoSidedSweep:false},resistanceLast24h:110,correlationBTC48h:{complete:true,value:.4}}}))}};
}
test('same-interface provider actually reduces a valid second-position cash budget using held qty and fee/slip projected mark',async()=>{
 const c=fixture(),before=JSON.stringify(c),p=new CovariancePaperProvider(),a=await p.decide(c);expect(a.actions[0]!.type).toBe('buy');if(a.actions[0]!.type==='buy'){expect(a.actions[0]!.amountEur).toBeGreaterThan(10);expect(a.actions[0]!.amountEur).toBeLessThan(150);}expect(JSON.stringify(c)).toBe(before);expect(await p.decide(c)).toEqual(a);expect(p.getEvidence()).toMatchObject({simulated:true,estimatedWinProbability:null,performanceValidated:false});
});
test.each(['missing-panel','unknown-qty','stale-mark','mixed-history','minimum-order'] as const)('%s cannot produce a new exposure',kind=>{
 const c=fixture();if(kind==='missing-panel')delete c.portfolioEvidence;if(kind==='unknown-qty')delete (c.positions[0] as any).qty;if(kind==='stale-mark')(c.marketContext as any).markets[1].asOf=now-6000;if(kind==='mixed-history')(c.portfolioEvidence as any).covariance.lastCloses[1]*=2;if(kind==='minimum-order')c.limits.MIN_ORDER_EUR=100;expect(covariancePaperDecision(c).answer.actions[0]!.type).toBe('hold');
});
test('missing covariance never suppresses a valid held bearish exit',()=>{
 const c=fixture();delete c.portfolioEvidence;const f=c.features[1]!;Object.assign(f,{ema20:95,price:96,change4h:-2});(c.marketContext as any).markets[1].feature=structuredClone(f);expect(covariancePaperDecision(c).answer.actions[0]).toMatchObject({type:'sell',pair:'SOL/EUR'});
});


test.each([
 [[1, -.9, -.9], [-.9, 1, -.9], [-.9, -.9, 1]],
 [[1, -.1, 0], [0, 1, 0], [0, 0, 1]],
])('a self-consistent hash cannot make an invalid covariance matrix usable', (...matrix) => {
 const p = alignedPortfolioCovariance(['A/EUR','B/EUR','C/EUR'].map(pair => ({pair,candles:bars(pair)})),now);
 const {hash: _, ...facts} = {...p, covariance:matrix};
 const rehashed = {...facts,hash:digest(canonicalJson(facts))};
 expect(()=>covarianceBudget(rehashed,now,'A/EUR',100,[{pair:'B/EUR',value:100},{pair:'C/EUR',value:100}])).toThrow('Invalid covariance matrix');
});


test('a repeated market identifier in a rehashed panel cannot select an arbitrary covariance row', () => {
 const {hash: _, ...facts} = panel();
 facts.pairs[1] = facts.pairs[0]!;
 const duplicate = {...facts, hash: digest(canonicalJson(facts))};
 expect(()=>covarianceBudget(duplicate,now,'A/EUR',100,[])).toThrow('Invalid covariance budget inputs');
});

test('invalid covariance blocks the mock entry while allowing its independent held exit', async () => {
 const c = fixture();
 const evidence = c.portfolioEvidence as {covariance: ReturnType<typeof panel>};
 const {hash: _, ...facts} = evidence.covariance;
 const cross = -2 * Math.sqrt(facts.covariance[0]![0]! * facts.covariance[1]![1]!);
 facts.covariance[0]![1] = cross;
 facts.covariance[1]![0] = cross;
 evidence.covariance = {...facts,hash:digest(canonicalJson(facts))};

 const held = c.features[1]!;
 Object.assign(held, {ema20:102,ema50:103,ema50_60m:104,change4h:-2});
 (c.marketContext as any).markets[1].feature = structuredClone(held);
 const provider = new CovariancePaperProvider();
 const decision = await provider.decide(c);
 expect(decision.actions).toMatchObject([{type:'sell',pair:'SOL/EUR'}]);
 expect(provider.getEvidence()?.assessments.find(a=>a.pair==='ETH/EUR')).toMatchObject({
  action:'hold', contradictions:['required-portfolio-covariance-or-mark-unknown'],
 });
});
