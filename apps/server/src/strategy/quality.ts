import type {FeatureSnapshot} from '@paper/shared';

/** Fixed safety/quality gates, not a machine-learned probability of success. */
export type QualityAssessment={score:number;maximum:number;passed:boolean;checks:{name:string;passed:boolean;detail:string}[];breakEvenMovePct:number};
export function assessSignalQuality(f:FeatureSnapshot,feeRate:number):QualityAssessment{
 const costPct=feeRate*200+f.spreadPct; // two taker fees (%), plus entry spread (%)
 const checks=[
  {name:'Übergeordneter Trend',passed:f.price>f.ema50_60m&&f.change4h>0,detail:`4h ${f.change4h.toFixed(2)} %; 60m EMA50 ${f.ema50_60m.toFixed(2)}`},
  {name:'Technische Stärke',passed:f.ema20>f.ema50&&f.distanceEma50Pct>=0&&f.distanceEma50Pct<=5,detail:`Abstand EMA50 ${f.distanceEma50Pct.toFixed(2)} %`},
  {name:'Momentum ohne Überhitzung',passed:f.rsi14>=48&&f.rsi14<=68,detail:`RSI ${f.rsi14.toFixed(1)}`},
  {name:'Volumen bestätigt',passed:f.volumeRatio>=1.2,detail:`${f.volumeRatio.toFixed(2)}× Volumendurchschnitt`},
  {name:'Volatilität kontrollierbar',passed:f.atrPct>=.8&&f.atrPct<=5,detail:`ATR ${f.atrPct.toFixed(2)} %`},
  {name:'Kosten und Liquidität',passed:f.spreadPct>=0&&f.spreadPct<=.20&&.10*100>=costPct*3,detail:`Spread ${f.spreadPct.toFixed(3)} %, geschätzte Roundtripkosten ≥ ${costPct.toFixed(2)} %`}
 ];
 const score=checks.filter(c=>c.passed).length;
 // All must pass. A partial score is information only, NOT a buy permission.
 return {score,maximum:checks.length,passed:score===checks.length,checks,breakEvenMovePct:Math.round(costPct*100)/100};
}
/** Position budget at risk = equity * fraction, BEFORE fees/gaps/slippage. */
export function safePositionBudget(equity:number,stopLossPct:number,riskFraction=.0075,maxPositionFraction=.25):number{
 if(!Number.isFinite(equity)||!Number.isFinite(stopLossPct)||equity<=0||stopLossPct<=0)return 0;
 return Math.max(0,Math.min(equity*maxPositionFraction,equity*riskFraction/stopLossPct));
}
