/**
 * Pre-registered, deterministic robustness checks on CLOSED historical candles.
 * This module NEVER chooses parameters based on evaluation folds and NEVER places orders.
 * All outputs are historical diagnostics, not probabilities of future returns.
 */
import {cleanCandles,runSegment,type ResearchCandle,type ResearchRequest,type ResearchSummary,type ResearchTrade} from './backtest.js';

export type ValidationFold={from:number;to:number;bars:number;summary:ResearchSummary};
export type ResearchVerdict='too_little_data'|'not_confirmed'|'historically_resilient';
export type RobustnessResult={
  label:string;verdict:ResearchVerdict;folds:ValidationFold[];positiveFolds:number;
  evaluatedTrades:number;historicalWinRatePct:number|null;winRateLower95Pct:number|null;
  worstFoldReturnPct:number|null;worstFoldDrawdownPct:number|null;
  doubleCostReturnPct:number|null;bootstrapP05Pct:number|null;bootstrapMedianPct:number|null;
  missingBars:number;gapFractionPct:number;dataStart:number;dataEnd:number;
  warnings:string[];evaluationRules:string[];
};
const round=(v:number)=>Math.round(v*100)/100;

/** Wilson bound: finite sample diagnostic, not a forecast of success. */
export function wilsonLowerBound(successes:number,trials:number,z=1.96):number|null{
 if(!Number.isInteger(trials)||trials<=0||!Number.isInteger(successes)||successes<0||successes>trials)return null;
 const p=successes/trials, z2=z*z,den=1+z2/trials;
 return Math.max(0,(p+z2/(2*trials)-z*Math.sqrt((p*(1-p)+z2/(4*trials))/trials))/den);
}

/** Repeatable seeded bootstrap of historical CLOSED-TRADE returns, no look-ahead. */
export function bootstrapReturns(trades:Pick<ResearchTrade,'pnlPct'>[],samples=1000):{p05:number;median:number}|null{
 if(trades.length<10)return null;
 let state=0x6d2b79f5;
 const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
 const outcomes:number[]=[];
 for(let s=0;s<samples;s++){
  let equity=1;
  for(let t=0;t<trades.length;t++){
   const choice=trades[Math.floor(next()*trades.length)]!;
   // Paper research max position size 25%, so trade P/L percentage is scaled by 25%.
   equity*=1+Math.max(-1,choice.pnlPct/100)*.25;
  }
  outcomes.push((equity-1)*100);
 }
 outcomes.sort((a,b)=>a-b);
 return {p05:round(outcomes[Math.floor((samples-1)*.05)]!),median:round(outcomes[Math.floor((samples-1)*.5)]!)};
}

export function analyzeRobustness(rows:ResearchCandle[],request:ResearchRequest):RobustnessResult{
 const candles=cleanCandles(rows);
 if(candles.length<130)throw Error('Mindestens 130 Kerzen für eine Robustheitsanalyse nötig');
 let missingBars=0;
 for(let i=1;i<candles.length;i++){
  const interval=candles[i]!.ts-candles[i-1]!.ts;
  if(interval>900000*1.1)missingBars+=Math.max(0,Math.round(interval/900000)-1);
 }
 const gapFractionPct=round(100*missingBars/(candles.length+missingBars));
 // Fixed, non-overlapping evaluation periods. No hyperparameter selection on these periods.
 // Older closed candles used only for indicator warmup of later folds.
 const boundaries=[Math.floor(candles.length*.50),Math.floor(candles.length*.667),Math.floor(candles.length*.834),candles.length];
 const folds:ValidationFold[]=[],allTrades:ResearchTrade[]=[];
 for(let f=0;f<3;f++){
  const start=boundaries[f]!,end=boundaries[f+1]!;
  const historicalPrefix=candles.slice(0,end);
  const result=runSegment(historicalPrefix,start,end,request);
  folds.push({from:result.from,to:result.to,bars:result.summary.bars,summary:result.summary});
  allTrades.push(...result.trades);
 }
 const stressed=runSegment(candles,boundaries[0]!,candles.length,{...request,feeRate:Math.min(.05,request.feeRate*2),slippagePct:Math.min(.05,request.slippagePct*2)});
 const trades=allTrades.length,wins=allTrades.filter(t=>t.pnlEur>0).length;
 const positiveFolds=folds.filter(f=>f.summary.returnPct>0).length;
 const bootstrap=bootstrapReturns(allTrades);
 const warnings:string[]=[];
 const historyDays=(candles.at(-1)!.ts-candles[0]!.ts+900000)/86400000;
 if(candles.length<8000||historyDays<89)warnings.push('Kurze Kurshistorie: mindestens rund 90 Tage für diese Vorprüfung; mehrere Marktzyklen fehlen weiterhin.');
 if(trades<30)warnings.push(`Nur ${trades} abgeschlossene Positionen in den Prüfperioden; statistisch zu wenig für eine robuste Trefferquote.`);
 if(gapFractionPct>1)warnings.push(`${gapFractionPct} % geschätzte Kerzenlücken. Die Analyse kann verzerrt sein.`);
 if(positiveFolds<2)warnings.push('Weniger als zwei von drei Zeitfenstern mit positiver Nettorendite.');
 if(stressed.summary.returnPct<=0)warnings.push('Mit doppelten Handelskosten bleibt im gesamten Prüfzeitraum kein positiver Nettoertrag.');
 const lastFoldPositive=(folds.at(-1)?.summary.returnPct??0)>0;
 if(!lastFoldPositive)warnings.push('Die jüngste Prüfperiode ist nicht positiv; ältere Gewinne kompensieren diesen fehlenden Nachweis nicht.');
 const enoughData=candles.length>=8000&&historyDays>=89&&trades>=30&&gapFractionPct<=1;
 const verdict:ResearchVerdict=!enoughData?'too_little_data':positiveFolds>=2&&lastFoldPositive&&stressed.summary.returnPct>0?'historically_resilient':'not_confirmed';
 return {label:'Historische Robustheitsprüfung – keine Vorhersage',verdict,folds,positiveFolds,evaluatedTrades:trades,
  historicalWinRatePct:trades?round(wins/trades*100):null,
  winRateLower95Pct:trades?round(wilsonLowerBound(wins,trades)!*100):null,
  worstFoldReturnPct:folds.length?round(Math.min(...folds.map(f=>f.summary.returnPct))):null,
  worstFoldDrawdownPct:folds.length?round(Math.max(...folds.map(f=>f.summary.maxDrawdownPct))):null,
  doubleCostReturnPct:stressed.summary.returnPct,
  bootstrapP05Pct:bootstrap?.p05??null,bootstrapMedianPct:bootstrap?.median??null,
  missingBars,gapFractionPct,dataStart:candles[0]!.ts,dataEnd:candles.at(-1)!.ts,
  warnings,evaluationRules:[
   '3 chronologisch getrennte Prüfperioden (letzte 50 % der Kerzen), mit historischer Indikator-Aufwärmphase.',
   'Vorab festgelegte Regeln: Keine automatische Parameterwahl auf den Prüfperioden.',
   'Gebühren und Slippage pro Ausführung; zweiter Durchlauf mit doppelten Kosten.',
   'Gewinnquote mit Wilson-Untergrenze (95 %); statistische Stichprobengrösse zählt.',
   'Reproduzierbarer Trade-Bootstrap illustriert Reihenfolgerisiken, setzt Unabhängigkeit der Trades voraus.',
   'Mindestens 1600 Kerzen, 30 Trades und höchstens 1 % Kerzenlücken für das Label historisch robust.',
   'Auch ein positives Prüfergebnis sagt nichts Verlässliches über zukünftige Gewinne aus.'
  ]};
}
