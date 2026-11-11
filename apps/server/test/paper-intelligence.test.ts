import {entryQuoteGuard} from '../src/broker/executionGuards.js';
import { test, expect, vi } from 'vitest';
import type { DecisionContext, FeatureSnapshot } from '@paper/shared';
import { MockAiProvider, RuleBasedProvider } from '../src/strategy/providers.js';
import { assessPaperOpportunities, paperMockDecision } from '../src/strategy/paper-intelligence.js';
import { parseAiAnswer } from '@paper/shared';
const now = Date.UTC(2026, 9, 30, 20, 0);
function fixture(): DecisionContext { const f: FeatureSnapshot = { pair: 'ETH/EUR', ts: now - 900000, ema20: 99, ema50: 98, ema50_60m: 97, prevEma20: 99, prevEma50: 98, rsi14: 55, atr14: .5, atrPct: .5, volumeRatio: 1.5, change1h: 1, change4h: 2, change24h: 3, spreadPct: .01, distanceEma50Pct: 2, price: 100 }; return { timeUTC: new Date(now).toISOString(), timeZurich: 'fixture', execution: { mode: 'paper' }, account: { cash: 1000, equity: 1000 }, positions: [], recentTrades: [], features: [f], limits: { TAKER_FEE_RATE: .001, MAX_ENTRY_SLIPPAGE_BPS: 15, MAX_ENTRY_SPREAD_BPS: 10, MAX_POSITION_PCT: .15, MAX_OPEN_POSITIONS: 2, MIN_ORDER_EUR: 10 }, memory: [], lessons: [], tradingPolicy: { mode: 'safe', stopLossPct: .05 }, marketContext: { markets: [{ pair: f.pair, asOf: now, feature: structuredClone(f), quality: { stale: false, bookUsable: true, bookAgeMs: 0, lastClosedAt: now }, microstructure: { bids: [{ price: '100', qty: '10' }], asks: [{ price: '100.01', qty: '10' }] }, regime: { structure: {version:'closed-structure-v1',complete:true,asOf:now,signalClosedAt:now,directionalEfficiency:.8,upsideBreakout:false,downsideBreakout:false,upsideRejection:false,downsideRejection:false,twoSidedSweep:false}, resistanceLast24h: 110, correlationBTC48h: { value: .9, complete: true } } }] } }; }
const market = (c: DecisionContext) => (c.marketContext as any).markets[0];
test('supported trend yields deterministic paper proposal with structured costs and no invented probability', async () => { const c = fixture(), before = JSON.stringify(c), provider = new MockAiProvider(), random = vi.spyOn(Math, 'random').mockImplementation(() => { throw Error('Randomness forbidden'); }); try {
    const a = await provider.decide(c), b = await provider.decide(c);
    expect(a).toEqual(b);
    expect(a.actions[0]).toMatchObject({ type: 'buy', pair: 'ETH/EUR', amountEur: 150, stopLossPct: .02, takeProfitPct: .04 });
    expect(parseAiAnswer(JSON.stringify(a), new Set(['ETH/EUR'])).valid).toBe(true);
    expect(provider.getEvidence()).toMatchObject({ simulated: true, estimatedWinProbability: null, expectedValue: null, performanceValidated: false });
    expect(JSON.stringify(c)).toBe(before);
}
finally {
    random.mockRestore();
} });
test.each(['future', 'stale-book', 'mixed-feature', 'nonpaper', 'missing-limits', 'thin-depth', 'overheated', 'bearish', 'resistance', 'dislocated'] as const)('%s leads to NO TRADE rather than speculative purchase', kind => { const c = fixture(); if (kind === 'future')
    c.features[0]!.ts = now; if (kind === 'stale-book')
    market(c).asOf = now - 6000; if (kind === 'mixed-feature')
    market(c).feature.price = 101; if (kind === 'nonpaper')
    c.execution = { mode: 'live' }; if (kind === 'missing-limits')
    delete c.limits.TAKER_FEE_RATE; if (kind === 'thin-depth')
    market(c).microstructure.asks[0].qty = '.0001'; if (kind === 'overheated') {
    c.features[0]!.rsi14 = 85;
    market(c).feature.rsi14 = 85;
} if (kind === 'bearish') {
    c.features[0]!.change4h = -2;
    market(c).feature.change4h = -2;
} if (kind === 'resistance')
    market(c).regime.resistanceLast24h = 102; if (kind === 'dislocated')
    market(c).microstructure.asks[0].price = '110'; expect(paperMockDecision(c).answer.actions[0]!.type).toBe('hold'); expect(paperMockDecision(c).evidence.assessments[0]!.contradictions.length).toBeGreaterThan(0); });
test('fees that destroy net reward refuse an otherwise supported setup', () => { const c = fixture(); c.limits.TAKER_FEE_RATE = .05; const a = assessPaperOpportunities(c).assessments[0]!; expect(a.action).toBe('hold'); expect(a.contradictions).toContain('net-payoff-insufficient-after-costs'); expect(a.payoff!.breakEvenRequiredWinRate).toBeNull(); });
test('confirmed BTC correlation halves prospective sizing; missing correlation is unknown', () => { const c = fixture(); c.positions = [{ pair: 'BTC/EUR', currentValue: 150 }]; expect(assessPaperOpportunities(c).assessments[0]!).toMatchObject({ action: 'buy', amount: 75, correlationAdjustment: .5 }); market(c).regime.correlationBTC48h = null; expect(assessPaperOpportunities(c).assessments[0]!.action).toBe('hold'); });
test('held bearish exposure can close independently of entry-only volume or portfolio limits', () => { const c = fixture(); c.positions = [{ pair: 'ETH/EUR' }]; Object.assign(c.features[0]!, { ema20: 95, ema50: 98, price: 96, change4h: -2, volumeRatio: .1 }); market(c).feature = structuredClone(c.features[0]); expect(paperMockDecision(c).answer.actions[0]).toMatchObject({ type: 'sell', sellFraction: 1 }); });
test('ambiguous duplicates abstain and original baseline is not replaced by mock logic', async () => { const c = fixture(); c.features.push({ ...c.features[0]! }); expect(paperMockDecision(c).answer.actions.every(a => a.type === 'hold')).toBe(true); const baseline = await new RuleBasedProvider().decide(fixture()); expect(baseline.actions[0]!.type).toBe('hold'); });
test('bad deeper levels and paused or unknown-valued accounts cannot produce buys', () => { for (const bad of ['depth', 'paused', 'valuation']) {
    const c = fixture();
    if (bad === 'depth')
        market(c).microstructure.asks.push({ price: '90', qty: '1' });
    if (bad === 'paused')
        (c.account as any).status = 'paused';
    if (bad === 'valuation')
        (c.account as any).valuation = { complete: false };
    expect(paperMockDecision(c).answer.actions[0]!.type).toBe('hold');
} });
test('feature order cannot change which single new proposal is chosen', () => { const c = fixture(), f = { ...c.features[0]!, pair: 'SOL/EUR' }, m = structuredClone(market(c)); m.pair = f.pair; m.feature = f; c.features.push(f); (c.marketContext as any).markets.push(m); const first = paperMockDecision(c).answer; c.features.reverse(); expect(paperMockDecision(c).answer).toEqual(first); expect(first.actions.filter(a => a.type === 'buy')).toHaveLength(1); });
test('incomplete slots, exhausted cash and selected stop too tight all refuse new exposure', () => { for (const patch of ['slots', 'cash', 'stop']) {
    const c = fixture();
    if (patch === 'slots')
        c.limits.MAX_OPEN_POSITIONS = 0;
    if (patch === 'cash')
        (c.account as any).cash = 0;
    if (patch === 'stop') {
        c.features[0]!.atrPct = 3;
        market(c).feature.atrPct = 3;
    }
    expect(paperMockDecision(c).answer.actions[0]!.type).toBe('hold');
} });


test.each(['missing','noisy','rejected','sweep','below-support','future','wrong-close'] as const)('observed %s structure vetoes trend entries',kind=>{
 const c=fixture(),s=market(c).regime.structure;
 if(kind==='missing')delete market(c).regime.structure;
 if(kind==='noisy')s.directionalEfficiency=.2;
 if(kind==='rejected')s.upsideRejection=true;
 if(kind==='sweep')s.twoSidedSweep=true;
 if(kind==='below-support')s.downsideBreakout=true;
 if(kind==='future')s.signalClosedAt=now+1;
 if(kind==='wrong-close')s.signalClosedAt=now-900000;
 const a=assessPaperOpportunities(c).assessments[0]!;expect(a.action).toBe('hold');expect(a.contradictions.length).toBeGreaterThan(0);
});
test('entry structure uncertainty does not suppress an existing bearish exit',()=>{
 const c=fixture();delete market(c).regime.structure;c.positions=[{pair:'ETH/EUR'}];Object.assign(c.features[0]!,{ema20:95,price:96,change4h:-2});market(c).feature=structuredClone(c.features[0]);expect(assessPaperOpportunities(c).assessments[0]!.action).toBe('sell');
});

test.each([[10,10,true],[10.1,10,false],[0,0,true]] as const)('model and broker agree for midpoint spread%s at hard limit%s', (spread,limit,allowed)=>{
 const c=fixture(),bid=100*(1-spread/20000),ask=100*(1+spread/20000);c.limits.MAX_ENTRY_SPREAD_BPS=limit;c.features[0]!.spreadPct=spread/100;market(c).feature=structuredClone(c.features[0]);market(c).microstructure={bids:[{price:String(bid),qty:'100'}],asks:[{price:String(ask),qty:'100'}]};
 expect(entryQuoteGuard(bid,ask,{maxSpreadBps:limit,maxSlippageBps:15}).allowed).toBe(allowed);const a=assessPaperOpportunities(c).assessments[0]!;expect(a.contradictions.includes('spread-over-hard-limit')).toBe(!allowed);expect(a.action).toBe(allowed?'buy':'hold');
});


test('mock decisions do not consume unqualified ticker statistics or their aggregate age',()=>{const c=fixture(),expected=paperMockDecision(c);Object.defineProperty(market(c),'ticker',{get(){throw Error('Unqualified ticker read');}});Object.defineProperty(market(c).quality,'tickerAgeMs',{get(){throw Error('Unqualified aggregate ticker age read');}});expect(paperMockDecision(c)).toEqual(expected);});
