import {paperMockDecision} from './paper-intelligence.js';
import type {DecisionProvider,DecisionResult,DecisionContext,FeatureSnapshot,Action} from '@paper/shared';
import {assessSignalQuality,safePositionBudget} from './quality.js';
export function buySignal(f:FeatureSnapshot){return f.prevEma20<=f.prevEma50&&f.ema20>f.ema50&&f.price>f.ema50_60m&&f.rsi14>=45&&f.rsi14<=70&&f.volumeRatio>=1.2&&f.spreadPct<=0.3;}
export function sellSignal(f:FeatureSnapshot){return (f.prevEma20>=f.prevEma50&&f.ema20<f.ema50)||f.rsi14>80;}
export class RuleBasedProvider implements DecisionProvider{
 async decide(c:DecisionContext):Promise<DecisionResult>{
  const positions=(c.positions as {pair:string}[]).map(p=>p.pair),actions:Action[]=[];
  const limits=c.limits??{};const feeRate=limits.TAKER_FEE_RATE??.008;
  const equity=(c.account as {equity:number}).equity;
  for(const f of c.features){if(positions.includes(f.pair)&&sellSignal(f))actions.push({type:'sell',pair:f.pair,sellFraction:1,confidence:.9,reasoning:`Verkaufssignal ${f.pair}: EMA20=${f.ema20.toFixed(2)}, EMA50=${f.ema50.toFixed(2)}, RSI=${f.rsi14.toFixed(1)}.`});}
  const candidates=c.features.filter(f=>!positions.includes(f.pair)&&buySignal(f))
   .map(f=>({f,q:assessSignalQuality(f,feeRate)})).filter(x=>x.q.passed)
   .sort((a,b)=>b.f.volumeRatio-a.f.volumeRatio);
  for(const {f,q} of candidates.slice(0,Math.max(0,3-actions.length))){
   const budget=safePositionBudget(equity,.05);
   if(budget<(limits.MIN_ORDER_EUR??10))continue;
   actions.push({type:'buy',pair:f.pair,amountEur:budget,stopLossPct:.05,takeProfitPct:.10,confidence:.6,
    reasoning:`Qualitätsfilter ${q.score}/${q.maximum}: EMA20 über EMA50 gekreuzt, RSI ${f.rsi14.toFixed(1)}, Volumen ${f.volumeRatio.toFixed(2)}x, Spread ${f.spreadPct.toFixed(2)} %, nominales Risiko max. 0,75 % vor Kosten/Slippage.`});
  }
  if(!actions.length){const matched=c.features.filter(f=>!positions.includes(f.pair)&&buySignal(f));actions.push({type:'hold',confidence:.7,reasoning:matched.length?`${matched.length} Kreuzung(en) erkannt, aber Qualitäts-, Kosten- oder Mindestorderfilter blockiert. Cash bleibt unverändert.`:'Kein bestätigtes Signal auf geschlossenen Kerzen; Cash bleibt unverändert.'});}
  return {marketView:`Konservative Regeln: EMA-Kreuzungen, 6 Qualitätsfilter und nominales Risikobudget. ${candidates.length} qualifizierte Kaufkandidaten (keine Gewinnwahrscheinlichkeit).`,actions};
 }
}
export class BuyAndHoldProvider implements DecisionProvider{async decide(_c:DecisionContext):Promise<DecisionResult>{return {marketView:'Einmaliger BTC-Kauf, anschliessend halten',actions:[{type:'hold',confidence:1,reasoning:'Buy & Hold: keine weiteren Trades'}]};}}
export class MockAiProvider implements DecisionProvider{
 private evidence:ReturnType<typeof paperMockDecision>['evidence']|null=null;
 getEvidence(){return this.evidence?JSON.parse(JSON.stringify(this.evidence)):null;}
 async decide(c:DecisionContext):Promise<DecisionResult>{const result=paperMockDecision(c);this.evidence=result.evidence;return result.answer;}
}

export {TrendVolTargetV1Provider} from './trend-vol-target-v1.js';
