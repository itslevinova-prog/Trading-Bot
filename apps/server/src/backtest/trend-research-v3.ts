import {runTrendResearchV2,type V2RunOptions} from './trend-research-v2.js';
import {TREND_RESEARCH_ASSUMPTIONS as a} from './trend-research.js';
import {H025_V3_DRAWDOWN} from '../risk-engine/research-drawdown-v3.js';
import type {Regime} from '../regime/types.js';

export type V3RunOptions=Omit<V2RunOptions,'researchV3'> & {
 regimeAt:(asOf:number)=>Regime|Promise<Regime>;
};
export type V3Report=Awaited<ReturnType<typeof runTrendResearchV2>>;

/** One separately registered H-025 v3 candidate; unmodified strategy and v2 lots. */
export function runTrendResearchV3(options:V3RunOptions){
 const {regimeAt,...base}=options;
 return runTrendResearchV2({...base,researchV3:{regimeAt}});
}
export function v3Markdown(reports:readonly V3Report[]):string{
 if(reports.length!==4||reports[0]!.profile!==null||
  reports.slice(1).some((r,i)=>r.profile?.name!==(['vorsichtig','normal','aggressiv'] as const)[i]||
   !r.backtest.researchV3)||!reports[0]!.backtest.researchV3)
  throw Error('H-025 v3 requires the baseline and the three risk profiles in fixed order');
 const fmt=(v:number|null|undefined,pct=false)=>v===null||v===undefined||!Number.isFinite(v)?
  'n/a':(pct?v*100:v).toFixed(3)+(pct?' %':'');
 const names=['Basis (ohne Profil)','vorsichtig','normal','aggressiv'];
 const header=['# H-025 v3 – vorregistrierter Drawdown-Reentry / Issue #7','',
  '**Entwicklung ausschliesslich 2020–2023. Keine Paper-, Forward- oder Pipeline-Freigabe.**','',
  'Feste Annahmen: 20 % relatives Rebalancing-Toleranzband im Trendplaner, lineare Einstiegsgrössen zwischen Caution und Exit-only je effektivem Risikoprofil, 30 volle Cash-Tage, bestehende Marktregime-Ampel nur bei risk-on, permanente Notbremse bei 30 % Verlust gegenüber Startkapital.','',
  '| Variante | Netto-Rendite | CAGR | Max-Drawdown | Sharpe | Calmar | Trades | Kosten USDT | Resets | Notbremse |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|'];
 const rows=reports.map((r,i)=>{
  const m=r.backtest.metrics,d=r.backtest.researchV3!;
  const costs=r.backtest.trades.reduce((n,t)=>n+t.fee+t.spreadCost+t.slippageCost,0);
  return '| '+names[i]+' | '+fmt(m.netReturn,true)+' | '+fmt(m.cagr,true)+
   ' | '+fmt(m.maxDrawdown,true)+' | '+fmt(m.sharpe)+' | '+fmt(m.calmar)+
   ' | '+m.tradeCount+' | '+fmt(costs)+' | '+d.resetEvents.length+
   ' | '+(d.permanentStopAt===null?'nicht ausgelöst':new Date(d.permanentStopAt).toISOString().slice(0,10))+' |';
 });
 const lines=[...header,...rows,'','## RiskEngine-Status und Reset-Ereignisse je Variante','',
  '| Variante | ok | caution | exit-only | halted | Tage gesamt | Resets |',
  '|---|---:|---:|---:|---:|---:|---:|'];
 for(let i=0;i<reports.length;i++){
  const d=reports[i]!.backtest.researchV3!,s=d.statusDays;
  lines.push('| '+names[i]+' | '+s.ok+' | '+s.caution+' | '+s['exit-only']+' | '+
   s.halted+' | '+Object.values(s).reduce((a,b)=>a+b,0)+' | '+d.resetEvents.length+' |');
 }
 for(let i=0;i<reports.length;i++){
  const r=reports[i]!,d=r.backtest.researchV3!;
  lines.push('','### '+names[i],'',
   'Profil-Kappungen: '+(r.profile?.cappedFields.join(', ')||'keine / Standardlimits')+'.',
   'Reset-Log: Datum (UTC), Equity, vorheriger Peak, neuer Peak, Grund.','',
   '| Datum | Equity USDT | alter Peak | neuer Peak | Grund |',
   '|---|---:|---:|---:|---|');
  if(!d.resetEvents.length)lines.push('| Kein Reset | – | – | – | – |');
  else for(const event of d.resetEvents)
   lines.push('| '+event.date+' | '+fmt(event.equity)+' | '+fmt(event.oldPeak)+
    ' | '+fmt(event.newPeak)+' | '+event.reason+' |');
  lines.push('',
   'Fehlende Mengenregeln: '+r.missingRules.length+
   '; importierte Coins: '+r.importedCoins+'; tatsächlich gehandelt: '+r.tradedCoins+'.');
 }
 lines.push('','## Vergleich und Grenzen','',
  ...reports[0]!.benchmarks.map(b=>'- '+b.name+': Netto-Rendite '+fmt(b.netReturn,true)),
  '',
  'Keine Kostenoptimierung, keine Selektion anhand dieses Entwicklungszeitraums. Rundung und Lots sind aktuelle exchangeInfo-Annahmen, nicht historisch belegte Filter.',
  'Bei fehlender dreiteiliger Regime-Bewertung bleibt der Status neutral und es gibt keinen Wiedereinstieg.',
  'Die drei Risikoprofile werden weiterhin durch bestehende absolute Paper-Caps gekappt; v3 lockert diese Caps nicht.',
  'Die 30-%-Notbremse ist gegen das ursprüngliche Startkapital definiert und kann durch keinen Peak-Reset gelöscht werden.',
  'Kein Zugriff auf 2024-Tageskerzen oder den Holdout; letzte 2023-Kerze wird erst am exklusiven Endzeitpunkt bewertet.',
  'Dies ist ein Forschungsergebnis mit historischen Annahmen, keine Renditeprognose.','');
 return lines.join('\n');
}
