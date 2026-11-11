import {entryQuoteGuard} from '../broker/executionGuards.js';
import type { DecisionContext, Action, DecisionResult, FeatureSnapshot } from '@paper/shared';
import { paperPayoff } from './paper-payoff.js';
export const PAPER_INTELLIGENCE_VERSION = 'paper-intelligence-v2';
type Assessment = {
    pair: string;
    strategy: string;
    regime: string;
    support: string[];
    contradictions: string[];
    invalidation: string;
    action: 'buy' | 'sell' | 'hold';
    payoff: ReturnType<typeof paperPayoff> | null;
    amount: number;
    stop: number;
    target: number;
    correlationAdjustment: number;
};
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Independent evaluation groups, deterministic historical clock and explicit unknown probability.
 * Research hypothesis, not a calibrated forecast or permission to bypass the paper broker. */
export function assessPaperOpportunities(c: DecisionContext) {
    const now = Date.parse(c.timeUTC), markets = object(c.marketContext) && Array.isArray(c.marketContext.markets) ? c.marketContext.markets : [], account = object(c.account) ? c.account : {}, policy = object(c.tradingPolicy) ? c.tradingPolicy : {}, held = c.positions.filter(object), limits = c.limits;
    const duplicates = new Set(c.features.filter((f, i) => c.features.findIndex(g => g.pair === f.pair) !== i).map(f => f.pair));
    const assessments: Assessment[] = c.features.map(f => {
        const a: Assessment = { pair: f.pair, strategy: 'trend-continuation', regime: 'unknown', support: [], contradictions: [], invalidation: 'Trendverlust oder Stop; Slippage/Preislücken können Verlust erhöhen.', action: 'hold', payoff: null, amount: 0, stop: 0, target: 0, correlationAdjustment: 1 }, deny = (s: string) => a.contradictions.push(s), matches = markets.filter((m: any) => m?.pair === f.pair), m = matches[0];
        if (!object(c.execution) || c.execution.mode !== 'paper') {
            deny('paper-simulation-context-required');
            return a;
        }
        if (!finite(now) || !Number.isSafeInteger(f.ts) || f.ts + 900000 > now || now - (f.ts + 900000) > 1200000 || duplicates.has(f.pair) || Object.entries(f).some(([k, v]) => k !== 'pair' && !finite(v)) || [f.price, f.ema20, f.ema50, f.ema50_60m, f.prevEma20, f.prevEma50, f.atr14, f.atrPct].some(n => n <= 0) || f.rsi14 < 0 || f.rsi14 > 100 || f.volumeRatio < 0 || f.spreadPct < 0) {
            deny('invalid-or-stale-closed-feature');
            return a;
        }
        if (matches.length !== 1 || !object(m) || !object(m.quality) || !finite(m.asOf) || m.asOf > now || m.quality.stale !== false || m.quality.bookUsable !== true || !finite(m.quality.bookAgeMs) || m.quality.bookAgeMs < 0 || now - m.asOf + m.quality.bookAgeMs > 5000 || m.quality.lastClosedAt !== f.ts + 900000 || !object(m.feature) || Object.keys(f).some(k => m.feature[k] !== f[k as keyof FeatureSnapshot])) {
            deny('missing-stale-or-mixed-market-evidence');
            return a;
        }
        const bids = m.microstructure?.bids, asks = m.microstructure?.asks, bid = Number(bids?.[0]?.price), ask = Number(asks?.[0]?.price);
        if (!Array.isArray(bids) || !Array.isArray(asks) || !finite(bid) || bid <= 0 || !finite(ask) || ask < bid) {
            deny('invalid-orderbook');
            return a;
        }
        for (const [side, levels] of [['bids', bids], ['asks', asks]] as const) {
            let previous = side === 'asks' ? ask : bid;
            for (const level of levels) {
                const price = Number(level?.price), qty = Number(level?.qty);
                if (!finite(price) || !finite(qty) || price <= 0 || qty <= 0 || side === 'asks' && price < previous || side === 'bids' && price > previous) {
                    deny('invalid-or-unsorted-depth');
                    return a;
                }
                previous = price;
            }
        }
        a.support.push('fresh-matching-closed-candle-and-book');
        const bullish = f.ema20 > f.ema50 && f.price > f.ema50_60m && f.change4h > 0, bearish = f.ema20 < f.ema50 && f.price < f.ema50_60m && f.change4h < 0;
        a.regime = bullish ? 'bullish-trend' : bearish ? 'bearish-trend' : 'mixed-or-ranging';
        if (held.some(p => p.pair === f.pair)) {
            if (bearish) {
                a.action = 'sell';
                a.support.push('held-position-with-confirmed-multi-timeframe-trend-loss');
            }
            else
                deny('already-held-no-scale-in');
            return a;
        }
        const structure=m.regime?.structure;
        if(!object(structure)||structure.version!=='closed-structure-v1'||structure.complete!==true||structure.signalClosedAt!==f.ts+900000||!finite(structure.directionalEfficiency)||structure.directionalEfficiency<0||structure.directionalEfficiency>1||!['upsideBreakout','downsideBreakout','upsideRejection','downsideRejection','twoSidedSweep'].every(k=>typeof structure[k]==='boolean'))
            deny('closed-market-structure-unavailable');
        else {
            if(structure.directionalEfficiency<=.2)deny('low-directional-efficiency-for-trend-entry');
            else a.support.push('closed-path-shows-directional-movement');
            if(structure.upsideRejection)deny('upside-breakout-rejected-at-close');
            if(structure.downsideBreakout)deny('close-below-prior-support');
            if(structure.twoSidedSweep)deny('both-sides-of-prior-range-swept');
            if(structure.upsideBreakout)a.support.push('close-above-excluding-signal-prior-range');
        }
        if (!bullish)
            deny('trend-and-momentum-do-not-agree');
        else
            a.support.push('short-and-hourly-trend-agree-with-four-hour-momentum');
        if (f.rsi14 < 48 || f.rsi14 > 68 || f.volumeRatio < 1.2)
            deny('momentum-or-volume-not-confirmed');
        else
            a.support.push('momentum-and-volume-confirmed');
        const fee = limits.TAKER_FEE_RATE ?? NaN, slip = limits.MAX_ENTRY_SLIPPAGE_BPS ?? NaN, maxSpread = limits.MAX_ENTRY_SPREAD_BPS ?? NaN, maxPosition = limits.MAX_POSITION_PCT ?? NaN, maxPositions = limits.MAX_OPEN_POSITIONS ?? NaN, minOrder = limits.MIN_ORDER_EUR ?? NaN, maxStop = policy.stopLossPct;
        if (![fee, slip, maxSpread, maxPosition, maxPositions, minOrder, maxStop, account.equity, account.cash].every(finite) || fee < 0 || slip < 0 || maxSpread < 0 || maxPosition <= 0 || maxPosition > 1 || maxPositions < 1 || !Number.isInteger(maxPositions) || minOrder <= 0 || account.equity <= 0 || account.cash < 0 || maxStop < .02 || maxStop > .15) {
            deny('unknown-or-invalid-cost-portfolio-limits');
            return a;
        }
        if (account.status !== undefined && account.status !== 'active' || object(account.valuation) && account.valuation.complete === false)
            deny('account-not-active-or-valuation-unknown');
        if (held.length >= maxPositions)
            deny('position-slots-exhausted');
        const quote = entryQuoteGuard(bid, ask, {maxSpreadBps:maxSpread,maxSlippageBps:slip});
        if (!quote.allowed)
            deny('spread-over-hard-limit');
        const atr = f.atrPct / 100;
        if (Math.abs(ask / f.price - 1) > Math.max(.02, 2 * atr))
            deny('price-dislocated-from-closed-evidence');
        if (atr <= 0 || 2 * atr > maxStop) {
            deny('volatility-exceeds-selected-stop-distance');
            return a;
        }
        a.stop = Math.max(.02, 2 * atr);
        a.target = Math.min(.4, Math.max(.03, 2 * a.stop));
        try {
            a.payoff = paperPayoff({ bid, ask, feeRate: fee, slippageBps: slip, stopLossPct: a.stop, takeProfitPct: a.target });
        }
        catch {
            deny('payoff-inputs-invalid');
            return a;
        }
        if (!a.payoff.positiveNetReward || a.payoff.netRewardRisk < 1.5)
            deny('net-payoff-insufficient-after-costs');
        else
            a.support.push('conditional-net-reward-risk-at-least-1.5');
        const resistance = m.regime?.resistanceLast24h;
        if (finite(resistance) && resistance > ask && resistance < a.payoff.targetPrice)
            deny('historical-resistance-before-target');
        if (!f.pair.startsWith('BTC/') && held.some(p => p.pair.startsWith('BTC/'))) {
            const corr = m.regime?.correlationBTC48h;
            if (!object(corr) || corr.complete !== true || !finite(corr.value) || Math.abs(corr.value) > 1)
                deny('btc-correlation-unavailable');
            else if (corr.value >= .8) {
                a.correlationAdjustment = .5;
                a.support.push('positive-btc-correlation-halves-new-budget');
            }
        }
        a.amount = Math.min(account.cash, account.equity * Math.min(.25, maxPosition) * a.correlationAdjustment, account.equity * .0075 / a.payoff.netRisk);
        if (a.amount < minOrder)
            deny('risk-budget-below-minimum-order');
        const quantity = a.amount / (ask * (1 + slip / 10000) * (1 + fee));
        let depth = 0;
        for (const level of asks) {
            const price = Number(level?.price), qty = Number(level?.qty);
            if (!finite(price) || !finite(qty) || price <= 0 || qty <= 0) {
                deny('invalid-depth-level');
                break;
            }
            if (price <= ask * (1 + slip / 10000))
                depth += qty;
        }
        if (depth < quantity)
            deny('insufficient-visible-depth-within-slippage-cap');
        if (!a.contradictions.length)
            a.action = 'buy';
        return a;
    });
    return { version: PAPER_INTELLIGENCE_VERSION, costGuardVersion:'shared-midpoint-spread-v1', asOf: finite(now) ? now : null, simulated: true, estimatedWinProbability: null, expectedValue: null, performanceValidated: false, calibrationStatus: 'unavailable', externalNewsUsedAsSignal: false, assessments };
}
export function paperMockDecision(c: DecisionContext): {
    answer: DecisionResult;
    evidence: ReturnType<typeof assessPaperOpportunities>;
} {
    const evidence = assessPaperOpportunities(c), actions: Action[] = evidence.assessments.filter(a => a.action === 'sell').sort((a, b) => a.pair.localeCompare(b.pair)).slice(0, 3).map(a => ({ type: 'sell', pair: a.pair, sellFraction: 1, confidence: .8, reasoning: 'PAPER-MOCK: Bestand reduzieren; kurzfristiger und stündlicher Trend sowie4h-Momentum negativ. Schutzverkäufe laufen unabhängig.' }));
    // One new proposal per snapshot: no reuse of the same cash/slot across competing candidates.
    if (actions.length < 3) {
        const selected = evidence.assessments.filter(a => a.action === 'buy').sort((a, b) => b.payoff!.netRewardRisk - a.payoff!.netRewardRisk || a.pair.localeCompare(b.pair))[0];
        if (selected)
            actions.push({ type: 'buy', pair: selected.pair, amountEur: selected.amount, stopLossPct: selected.stop, takeProfitPct: selected.target, confidence: .8, reasoning: `PAPER-MOCK: Trend, Momentum/Volumen und frische Daten bestätigt; Netto-CRV ${selected.payoff!.netRewardRisk.toFixed(2)} als bedingtes Szenario. Invalidierung: Trendverlust/Stop. Score0.8 ist keine Wahrscheinlichkeit; Vorteil unvalidiert.` });
    }
    if (!actions.length)
        actions.push({ type: 'hold', confidence: 0, reasoning: ('NO TRADE: ' + [...new Set(evidence.assessments.flatMap(a => a.contradictions))].slice(0, 5).join(', ') + '; keine ausreichend belegte Paper-Gelegenheit.').slice(0, 400) });
    return { answer: { marketView: `PAPER-MOCK ${PAPER_INTELLIGENCE_VERSION}: deterministische Forschungsheuristik, keine KI-Prognose. ${evidence.assessments.filter(a => a.action === 'buy').length} passende Szenarien; Schutzregeln bleiben verbindlich.`, actions }, evidence };
}
