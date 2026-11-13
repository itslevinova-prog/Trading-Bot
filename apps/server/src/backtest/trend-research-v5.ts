import {runTrendResearchV2,V5_RESEARCH,type V2RunOptions} from './trend-research-v2.js';
import {TREND_RESEARCH_ASSUMPTIONS as a} from './trend-research.js';
import {calculateMetrics} from './metrics.js';
import type {V4SpikeComparison} from './trend-research-v4.js';
import type {V5PassiveComparison} from './research-v5-benchmark.js';

export type V5RunOptions=Omit<V2RunOptions,'researchV3'|'researchV4'|'researchV5'>;
export type V5Report=Awaited<ReturnType<typeof runTrendResearchV2>>;
export const V5_PROFILES=Object.freeze([null,'vorsichtig','normal','aggressiv'] as const);
/** Manual-only, explicitly registered candidate; not reachable by Paper or Forward. */
export function runTrendResearchV5(options:V5RunOptions):Promise<V5Report>{
 return runTrendResearchV2({...options,researchV5:true});
}
export function v5Markdown(
 reports:readonly V5Report[],passive:V5PassiveComparison,spike:V4SpikeComparison
):string{
 if(reports.length!==4||reports.some((r,i)=>
   r.researchVariant!=='v5'||r.assumptions.version!==V5_RESEARCH.version||
   (r.profile?.name??null)!==V5_PROFILES[i]||r.paperApproved!==false||
   r.pipelineEligible!==false||!r.backtest.researchV5||
   r.backtest.researchV3!==undefined||r.diagnosticVariant!==undefined||
   r.backtest.trades.some(t=>t.ts<a.fromMs||t.ts>=a.toMs||t.decisionTs<a.fromMs)||
   r.backtest.equity.some(p=>p.ts<a.fromMs||p.ts>a.toMs)))
  throw Error('H-025 v5 requires exactly four sealed, independent research-only reports');
 if(spike.protocol!=='trend-1d-spike-v1'||
   spike.range.fromInclusive!=='2020-01-01'||spike.range.toExclusive!=='2024-01-01'||
   spike.markets.join(',')!=='BTCUSDT,ETHUSDT'||spike.windows.join(',')!=='50,100,200'||
   spike.variants.filter(v=>v.window===200).length!==1)
  throw Error('SMA200 comparison must use the existing fixed Issue #18 development spike');
 const sma=spike.variants.find(v=>v.window===200)!;
 const fmt=(n:number|null|undefined,pct=false)=>n==null||!Number.isFinite(n)?'n/a':
  (pct?n*100:n).toFixed(pct?2:3)+(pct?' %':'');
 const row=(name:string,net:number|null,cagr:number|null,dd:number|null,
  sharpe:number|null,calmar:number|null,trades:number|null,invest:number|null,costs:number|null)=>
  '| '+name+' | '+fmt(net,true)+' | '+fmt(cagr,true)+' | '+fmt(dd,true)+' | '+
  fmt(sharpe)+' | '+fmt(calmar)+' | '+(trades??'n/a')+' | '+fmt(invest,true)+
  ' | '+fmt(costs)+' |';
 const lines=[
  '# H-025 v5 – BTC/ETH voll investierte Trendfolge (Issue #42)','',
  '**Nur Entwicklung 2020-01-01 bis 2023-12-31. 2019 dient ausschliesslich als Indikator-Warm-up. Keine historischen Orders, Bewertungen oder Tests nach 2023 und keine Freigabe für Paper, Forward oder Pipeline.**','',
  'Fest vor dem Lauf: unverändertes EMA-Ensemble und BTC-200-Tage-Regime, Trendstärke × Profil-Maximum (Basis 100 %, vorsichtig 50 %, normal 80 %, aggressiv 100 %), inverse Tagesvolatilität, 20 % relatives Rebalancing-Toleranzband.',
  'Peak-Drawdown 0–10 %: Faktor 1; 10–30 %: linear bis 0; bei Equity <= 70 % des Startkapitals permanente Einstiegspause. Keine Legacy-Exit-only-Sperre, kein Broker-Stop-Risikobudget, keine Stundenhistorien-Sperre.',
  '60 lückenlos geschlossene Tagesrenditen für BTC-P99-Schock und BTC-/Coin-Volatilität; fehlende Tagesdaten bleiben fail-closed. Kosten pro Ausführung: 0,1 % Gebühr, 10 bps Spread, 5 bps Slippage, aktuelle exchangeInfo-Mengenregeln als historische Annahme.','',
  '| Variante | Netto-Rendite | CAGR | Max-Drawdown | Sharpe | Calmar | Trades | Ø investiert | Kosten USDT |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|'
 ];
 for(const r of reports){
  const m=r.backtest.metrics,t=r.backtest.diagnostics!;
  const costs=r.backtest.trades.reduce((sum,trade)=>sum+trade.fee+trade.spreadCost+trade.slippageCost,0);
  const exposure=t.days.length?t.days.reduce((sum,d)=>sum+d.investedPct,0)/t.days.length:null;
  lines.push(row(r.profile?.name??'Basis',m.netReturn,m.cagr,m.maxDrawdown,
   m.sharpe,m.calmar,m.tradeCount,exposure,costs));
 }
 for(const b of reports[0]!.benchmarks){
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
 lines.push(row('SMA200 BTC/ETH 50/50 (Issue #18)',null,sma.cagr,sma.maxDrawdown,
  sma.sharpe,sma.calmar,sma.trades,sma.exposure,sma.costsPctOfInitial/100*a.initialCash));
 lines.push('',
  'Vergleichsgrenzen: BTC-Halten und Sparplan stammen aus den bestehenden v2-Referenzen. Der monatliche DCA-Wert ist eine cashflow-neutrale TWR-Serie, keine Einmalanlage. SMA200 hat eine eigene Anfangssumme und andere Kosten-/Mengenregeln; sein Kosten-USDT-Wert wurde deshalb nur auf das v5-Startkapital normiert und ist kein tatsächlicher v5-Trade-Ledger. SMA200-Nettorendite ist im Beleg nicht separat vorhanden (n/a).',
  '50/50-Halten: '+passive.reason+'. Kein Schlussverkauf auf einer unbeobachteten Kerze.','',
  '## Diagnose: Investition, tägliche Risikoprüfung, Pausen','',
  '| Profil | Tage | Cash-Tage | Ø investiert | Caution-Tage | 30%-Peak-Null-Tage | Pausen-Tage | Tagesprüfungen | P99-Schock abgelehnt | Tageshistorie fehlt | BTC-Vol/Jahr Ø | Asset-Vol/Jahr Ø | erste Dauerpause |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
 for(const r of reports){
  const t=r.backtest.diagnostics!,d=r.backtest.researchV5!;
  const status=(name:'caution'|'exit-only'|'halted')=>t.days.filter(x=>x.riskStatus===name).length;
  const avg=t.days.length?t.days.reduce((sum,x)=>sum+x.investedPct,0)/t.days.length:null;
  lines.push('| '+(r.profile?.name??'Basis')+' | '+t.days.length+' | '+
   t.days.filter(x=>x.allCash).length+' | '+fmt(avg,true)+' | '+
   status('caution')+' | '+status('exit-only')+' | '+status('halted')+' | '+
   d.dailyRiskChecks+' | '+d.dailyShockBlocked+' | '+d.missingDailyBlocked+
   ' | '+fmt(d.averageBtcAnnualVol,true)+' | '+fmt(d.averageAssetAnnualVol,true)+
   ' | '+(d.pausedAt===null?'nicht ausgelöst':new Date(d.pausedAt).toISOString().slice(0,10))+' |');
 }
 for(const r of reports){
  const name=r.profile?.name??'Basis',reasons=r.backtest.diagnostics!.reasons;
  lines.push('','### '+name,'',
   'Profil-Kappungen aus alter Paper-Engine sind NICHT v5-Sizing; nur maxInvestedPct wirkt. Gehandelte Coins: '+
    r.tradedCoins+'; aktuelle Lots fehlen: '+r.missingRules.length+'.',
   'Orderablehnungen (Portfolio-RiskEngine-Rubrik enthält hier ausschliesslich v5-Tagesrisiko):','');
  for(const source of ['portfolioRisk','broker','coinQuality','missingLot','planner'] as const){
   const top=Object.entries(reasons[source]).sort((a,b)=>b[1]-a[1]).slice(0,5);
   lines.push('**'+source+'**',...top.map(([key,n])=>'- '+key.replace(/[\r\n|]/g,' ')+': '+n),'');
  }
 }
 lines.push('## Studiengrenzen','',
  '2019-01-01 bis 2019-12-31 sind allein Indikator-Warm-up, keine Erträge. Alle vier Resultate sind Entwicklungsresultate ohne nachträgliche Optimierung, auch bei Verlust oder Null-Trades.',
  'Heutige Spot-Lots sind historisch nicht nachgewiesen; fehlende tägliche Archive, Delistings und hypothetische OHLC-Fills begrenzen die Aussage.',
  'Der Strategie-ATR-Exit basiert auf geschlossenen Tagesdaten; Broker-Stop-Szenarien werden nur gemäss vorhandenem konservativem Fill-Modell simuliert.',
  'Die 2×-Roundtrip-Kostenhürde für spätere Freigaben bleibt bestehen. Kein Echtgeldbetrieb, kein Paper-Rollout, kein Holdout.','');
 return lines.join('\n');
}
