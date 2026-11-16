import {CASH_YIELD_SENSITIVITIES,CASH_YIELD_WARNING} from './cash-yield.js';
import {V5_PROFILES,type V5Report} from './trend-research-v5.js';

/** Registered sensitivity, never a claim about historical attainable yield. */
export function cashYieldMarkdown(tiers:readonly (readonly V5Report[])[]):string {
 if(tiers.length!==CASH_YIELD_SENSITIVITIES.length||
  tiers.some(group=>group.length!==V5_PROFILES.length))
  throw Error('Expected 0/3/6% cash sensitivity for each of four sealed v5 profiles');
 const fmt=(n:number|null|undefined,percent=false)=>
  n==null||!Number.isFinite(n)?'n/a':(percent?n*100:n).toFixed(2)+(percent?' %':'');
 const lines=[
  '# H-025 v5 – Cash-Zins-Sensitivität (Issue #43)','',
  '**Nur simulierte Entwicklung 2020–2023 (2019 Warm-up). Keine Forward- oder Paper-Aktivierung, keine Zinsgeschichte, keine Pipeline-Freigabe.**','',
  CASH_YIELD_WARNING,
  'Die Rechnung gilt ausschliesslich für ungenutztes USDT-Cash mit täglicher Gutschrift Cash × APY / 365. Positionen bekommen keine Gutschrift. Kosten und Strategie bleiben unverändert.','',
  '| Profil | APY-Annahme | Netto-Rendite | CAGR | Max-Drawdown | Trades | Handelskosten USDT | Simulierte Zinsgutschrift USDT |',
  '|---|---:|---:|---:|---:|---:|---:|---:|'
 ];
 for(let i=0;i<V5_PROFILES.length;i++)for(let tier=0;tier<tiers.length;tier++){
  const apy=CASH_YIELD_SENSITIVITIES[tier]!;
  const report=tiers[tier]![i]!;
  if(report.researchVariant!=='v5'||report.paperApproved!==false||
     report.pipelineEligible!==false||
     (apy===0&&report.backtest.cashYield!==undefined)||
     (apy>0&&report.backtest.cashYield?.apy!==apy))
   throw Error('Unsealed H-025 v5 cash-yield sensitivity result');
  const m=report.backtest.metrics;
  const fees=report.backtest.trades.reduce((sum,t)=>sum+t.fee+t.spreadCost+t.slippageCost,0);
  lines.push('| '+(V5_PROFILES[i]??'Basis')+' | '+fmt(apy,true)+
    ' | '+fmt(m.netReturn,true)+' | '+fmt(m.cagr,true)+
    ' | '+fmt(m.maxDrawdown,true)+' | '+m.tradeCount+
    ' | '+fmt(fees)+' | '+fmt(report.backtest.cashYield?.total??0)+' |');
 }
 lines.push('','**Einordnung:** 0 % ist der unveränderte Vergleichslauf. 3 % und 6 % sind ausdrücklich hypothetische feste Sensitivitäten, keine nachgewiesenen historischen Spar- oder Stablecoin-Zinsen. Ein realer Stablecoin-Ertrag kann ausfallen; Gegenparteiausfall, Depeg, Sperrung und Steuerfolgen wurden nicht modelliert.','');
 return lines.join('\n');
}
