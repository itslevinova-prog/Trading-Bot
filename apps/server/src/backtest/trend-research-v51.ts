import {calculateMetrics} from './metrics.js';
import {TREND_RESEARCH_ASSUMPTIONS as a} from './trend-research.js';
import {runTrendResearchV2,V51_RESEARCH,type V2RunOptions} from './trend-research-v2.js';
import {V5_PROFILES,v5Markdown,type V5Report} from './trend-research-v5.js';
import type {V5PassiveComparison} from './research-v5-benchmark.js';
import type {V4SpikeComparison} from './trend-research-v4.js';

export type V51RunOptions=Omit<V2RunOptions,'researchV3'|'researchV4'|'researchV5'|'researchV51'>;
export const V51_PROFILES=V5_PROFILES;
/** Explicit manual dispatch only; the v5 implementation stays independent. */
export function runTrendResearchV51(options:V51RunOptions):Promise<V5Report>{
 return runTrendResearchV2({...options,researchV51:true});
}

export function v51Markdown(
 reports:readonly V5Report[],baseline:readonly V5Report[],
 passive:V5PassiveComparison,spike:V4SpikeComparison
):string{
 // Also validates that the comparison is the unchanged sealed v5 variant and
 // that the same pre-registered SMA200 benchmark is being used.
 v5Markdown(baseline,passive,spike);
 if(reports.length!==4||reports.some((r,i)=>
  r.researchVariant!=='v5.1'||r.assumptions.version!==V51_RESEARCH.version||
  (r.profile?.name??null)!==V51_PROFILES[i]||r.paperApproved!==false||
  r.pipelineEligible!==false||r.backtest.researchV51===undefined||
  r.backtest.researchV5===undefined||r.backtest.researchV3!==undefined||
  r.backtest.trades.some(t=>t.ts<a.fromMs||t.ts>=a.toMs||t.decisionTs<a.fromMs)||
  r.backtest.equity.some(p=>p.ts<a.fromMs||p.ts>a.toMs)))
  throw Error('H-025 v5.1 requires four separate sealed research reports');
 const fmt=(n:number|null|undefined,pct=false)=>n==null||!Number.isFinite(n)?'n/a':
  (pct?n*100:n).toFixed(pct?2:3)+(pct?' %':'');
 const row=(name:string,net:number|null,cagr:number|null,dd:number|null,
  sharpe:number|null,calmar:number|null,trades:number|null,
  invested:number|null,costs:number|null)=>
  '| '+name+' | '+fmt(net,true)+' | '+fmt(cagr,true)+' | '+fmt(dd,true)+' | '+
  fmt(sharpe)+' | '+fmt(calmar)+' | '+(trades??'n/a')+' | '+fmt(invested,true)+
  ' | '+fmt(costs)+' |';
 const metrics=(name:string,r:V5Report)=>{
  const m=r.backtest.metrics,d=r.backtest.diagnostics!;
  const invested=d.days.length?d.days.reduce((sum,day)=>sum+day.investedPct,0)/d.days.length:null;
  const costs=r.backtest.trades.reduce((sum,t)=>sum+t.fee+t.spreadCost+t.slippageCost,0);
  return row(name,m.netReturn,m.cagr,m.maxDrawdown,m.sharpe,m.calmar,m.tradeCount,invested,costs);
 };
 const lines=[
  '# H-025 v5.1 – BTC/ETH Wiedereinstieg nach Höchststand-Sperre (Issue #46)','',
  '**Nur Entwicklung 2020–2023, ausschliesslich Tageskerzen; 2019 nur Indikator-Warm-up. Kein Paper-/Forward-/Pipeline-Rollout, keine Optimierung und kein Holdout.**','',
  'Einziger Unterschied zu v5: Nach mindestens 30 vollen UTC-Kalendertagen ohne Positionen und geschlossenem BTC-200d-risk-on bei 0 % Einstiegsfaktor wird der **Forschungs-Referenzhöchststand** auf die aktuelle Equity gesetzt. Der historische Broker-Peak bleibt erhalten. Equity ≤ 70 % des ursprünglichen Startkapitals sperrt Einstiege dauerhaft.','',
  '| Variante | Netto-Rendite | CAGR | Max-Drawdown | Sharpe | Calmar | Trades | Ø investiert | Kosten USDT |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|'
 ];
 reports.forEach((r,i)=>lines.push(metrics('v5.1 / '+(V51_PROFILES[i]??'Basis'),r)));
 baseline.forEach((r,i)=>lines.push(metrics('v5 / '+(V5_PROFILES[i]??'Basis'),r)));
 for(const b of baseline[0]!.benchmarks){
  const available=b.netReturn!==null&&b.equity.length>0;
  const points=available?[{ts:a.fromMs,equity:b.cashflows.length?1:a.initialCash,exposed:false},
   ...b.equity.map(p=>({...p,exposed:true}))]:[];
  const m=available?calculateMetrics(points,[],a.fromMs,a.toMs).metrics:null;
  const costs=b.feesPaid!==null&&b.spreadPaid!==null&&b.slippagePaid!==null&&
   b.cashflows.length===0?b.feesPaid+b.spreadPaid+b.slippagePaid:null;
  lines.push(row(b.name,b.netReturn,m?.cagr??null,m?.maxDrawdown??null,
   m?.sharpe??null,m?.calmar??null,b.netReturn===null?null:b.cashflows.length?b.cashflows.length*2:1,
   null,costs));
 }
 lines.push(row(passive.name,passive.netReturn,passive.cagr,passive.maxDrawdown,
  passive.sharpe,passive.calmar,passive.trades,passive.netReturn===null?null:1,passive.costs));
 const sma=spike.variants.find(v=>v.window===200)!;
 lines.push(row('SMA200 BTC/ETH 50/50 (Issue #18)',null,sma.cagr,sma.maxDrawdown,
  sma.sharpe,sma.calmar,sma.trades,sma.exposure,sma.costsPctOfInitial/100*a.initialCash));
 lines.push('',
  'BTC-Halten und Sparplan sind die bestehenden v2-Referenzen. Der Sparplan ist cashflow-neutral (TWR), keine Einmalanlage. SMA200 basiert auf anderen Fills, Kosten-/Mengenregeln und Anfangskapital; der Kosten-USDT-Wert ist auf das v5-Kapital normiert, kein echter v5-Trade-Ledger. Dessen separat nicht belegte Nettorendite bleibt n/a.',
  '50/50-Halten: '+passive.reason+'.','',
  '## Diagnose v5.1 gegen unverändertes v5','',
  '| Variante | Cash-Tage | Ø investiert | Tage Faktor 0 | Resets | Dauerpause ab | Tages-Risikoprüfungen | P99-Schock abgelehnt | Tagesdaten fehlen |',
  '|---|---:|---:|---:|---:|---|---:|---:|---:|');
 for(let i=0;i<4;i++){
  const name=V51_PROFILES[i]??'Basis',n=reports[i]!,b=baseline[i]!;
  for(const [label,r] of [['v5.1',n],['v5',b]] as const){
   const days=r.backtest.diagnostics!.days,d=r.backtest.researchV5!;
   const zero=label==='v5.1'?r.backtest.researchV51!.zeroEntryDays:
    days.filter(day=>day.riskStatus==='exit-only'||day.riskStatus==='halted').length;
   const invested=days.length?days.reduce((sum,day)=>sum+day.investedPct,0)/days.length:null;
   lines.push('| '+label+' / '+name+' | '+days.filter(day=>day.allCash).length+
    ' | '+fmt(invested,true)+' | '+zero+
    ' | '+(label==='v5.1'?r.backtest.researchV51!.resetEvents.length:0)+
    ' | '+(d.pausedAt===null?'keine':new Date(d.pausedAt).toISOString().slice(0,10))+
    ' | '+d.dailyRiskChecks+' | '+d.dailyShockBlocked+' | '+d.missingDailyBlocked+' |');
  }
 }
 for(let i=0;i<4;i++){
  const r=reports[i]!,resets=r.backtest.researchV51!.resetEvents;
  lines.push('','### v5.1 / '+(V51_PROFILES[i]??'Basis')+': '+resets.length+' Resets','');
  if(!resets.length)lines.push('Kein Reset.');
  else for(const reset of resets)
   lines.push('- '+reset.date+': Equity '+fmt(reset.equity)+
    ' USDT; alter Peak '+fmt(reset.oldPeak)+' USDT; neuer Peak '+
    fmt(reset.newPeak)+' USDT; Grund: '+reset.reason);
  const reasons=r.backtest.diagnostics!.reasons;
  for(const source of ['portfolioRisk','broker','coinQuality','missingLot','planner'] as const){
   lines.push('','**'+source+'**');
   const top=Object.entries(reasons[source]).sort((x,y)=>y[1]-x[1]).slice(0,5);
   lines.push(...top.map(([reason,n])=>'- '+reason.replace(/[\r\n|]/g,' ')+': '+n));
  }
 }
 lines.push('','## Studiengrenzen','',
  'Kein Parameter wurde nach den Resultaten angepasst. Aktuelle Spot-Lots sind historisch nicht bewiesen; fehlende tägliche Archive und Delistings können Resultate verfälschen. Gebühren 0,1 %, Spread 10 bps, Slippage 5 bps pro Ausführung. 60 lückenlose geschlossene BTC-/Coin-Tagesrenditen bleiben zwingend.',
  'Die unveränderte v5-Referenz wird mit derselben Datenbasis und demselben Mengenregel-Snapshot separat neu gerechnet. Die Mindesthürde von 2× Roundtrip-Kosten und sämtliche späteren unabhängigen Pipeline-Gates bleiben bestehen.','');
 return lines.join('\n');
}
