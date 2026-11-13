import {runTrendResearchV2,type V2RunOptions,type V4DiagnosticVariant} from './trend-research-v2.js';
import {TREND_RESEARCH_ASSUMPTIONS as a} from './trend-research.js';
import {calculateMetrics} from './metrics.js';
import {analyzeDiagnosticTrace} from './trend-diagnostics.js';

export type V4RunOptions=Omit<V2RunOptions,'researchV3'|'researchV4'> & {variant:V4DiagnosticVariant};
export type V4Report=Awaited<ReturnType<typeof runTrendResearchV2>>;
export const V4_ORDER=Object.freeze(['v4a','v4b'] as const);
export const V4_PROFILES=Object.freeze([null,'vorsichtig','normal','aggressiv'] as const);

/** One explicitly opted-in, preregistered diagnostic. Never called by Paper. */
export function runTrendResearchV4(options:V4RunOptions):Promise<V4Report>{
 const {variant,...base}=options;
 if(!V4_ORDER.includes(variant))throw Error('Unknown H-025 v4 diagnostic');
 return runTrendResearchV2({...base,researchV4:variant});
}

export type V4SpikeComparison={
 protocol:string;range:{fromInclusive:string;toExclusive:string};
 markets:readonly string[];windows:readonly number[];
 variants:readonly {window:number;cagr:number;maxDrawdown:number;
  sharpe:number|null;calmar:number|null;trades:number;exposure:number;
  costsPctOfInitial:number}[];
};

/** Eight separate v4 runs plus immutable cost-comparison references. */
export function v4Markdown(reports:readonly V4Report[],spike:V4SpikeComparison):string{
 if(reports.length!==8||reports.some((r,i)=>
  r.diagnosticVariant!==V4_ORDER[Math.floor(i/4)]||
  (r.profile?.name??null)!==V4_PROFILES[i%4]||
  r.pipelineEligible!==false||r.paperApproved!==false||
  r.backtest.researchV3!==undefined||!r.backtest.diagnostics))
  throw Error('H-025 v4 requires exactly eight research-only reports in fixed order');
 if(spike.protocol!=='trend-1d-spike-v1'||
  spike.range.fromInclusive!=='2020-01-01'||spike.range.toExclusive!=='2024-01-01'||
  spike.markets.join(',')!=='BTCUSDT,ETHUSDT'||spike.windows.join(',')!=='50,100,200'||
  spike.variants.length!==3||spike.variants.filter(v=>v.window===200).length!==1)
  throw Error('SMA200 must come from the fixed Issue #18 development spike');
 const sma=spike.variants.find(v=>v.window===200)!;
 if(!Number.isFinite(sma.cagr)||!Number.isFinite(sma.maxDrawdown)||
  !Number.isFinite(sma.costsPctOfInitial)||!Number.isSafeInteger(sma.trades))
  throw Error('Invalid SMA200 comparison');
 const fmt=(x:number|null|undefined,pct=false)=>x==null||!Number.isFinite(x)?
  'n/a':(pct?x*100:x).toFixed(pct?2:3)+(pct?' %':'');
 const row=(name:string,net:number|null|undefined,cagr:number|null|undefined,
  dd:number|null|undefined,sharpe:number|null|undefined,calmar:number|null|undefined,
  trades:number|null|undefined,investedDays:number|null|undefined,costPct:number|null|undefined)=>
  '| '+name+' | '+fmt(net,true)+' | '+fmt(cagr,true)+' | '+fmt(dd,true)+
  ' | '+fmt(sharpe)+' | '+fmt(calmar)+' | '+(trades??'n/a')+' | '+
  (investedDays??'n/a')+' | '+fmt(costPct,true)+' |';
 const lines=[
  '# H-025 v4 – Ursachen-Trennung: acht Diagnosevarianten / Issue #3','',
  '**Ausschliesslich Entwicklung 2020–2023, kein 2024-/Holdout-Zugriff und keine Freigabe fuer Paper, Forward oder Pipeline.**','',
  'v4a = v2-Strategie und volles historisches USDT-Universum; v4b = identische Strategie, Universum nur BTC/ETH mit historischer Tageszugehoerigkeit.',
  'Beide: nur Drawdown-Schwellen 97/98/99 % in der Portfolio-RiskEngine; alle anderen Risikopruefungen, Coin-Qualitaet und aktuelle Lots bleiben aktiv. Kein v3-Reset und keine Optimierung.',
  'Profile: effektiv gekappte Standardprofile, ohne Paper-Konfigurationsaenderungen; nur die drei Drawdown-Schwellen sind fuer diese Diagnose ueberschrieben.','',
  '| Lauf | Netto-Rendite | CAGR | Max-Drawdown | Sharpe | Calmar | Trades | Investierte Tage | Kosten / Start |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|'
 ];
 for(const r of reports){
  const m=r.backtest.metrics,trace=r.backtest.diagnostics!;
  const costs=r.backtest.trades.reduce((n,t)=>n+t.fee+t.spreadCost+t.slippageCost,0);
  lines.push(row(r.diagnosticVariant+' / '+(r.profile?.name??'Basis'),m.netReturn,
   m.cagr,m.maxDrawdown,m.sharpe,m.calmar,m.tradeCount,
   trace.days.filter(x=>!x.allCash).length,costs/a.initialCash));
 }
 for(const b of reports[0]!.benchmarks){
  const available=b.netReturn!==null&&b.equity.length>0;
  const equity=available?[{ts:a.fromMs,equity:b.cashflows.length?1:a.initialCash,exposed:false},
   ...b.equity.map(p=>({...p,exposed:true}))]:[];
  const m=available?calculateMetrics(equity,[],a.fromMs,a.toMs).metrics:null;
  const costShare=b.feesPaid!==null&&b.spreadPaid!==null&&b.slippagePaid!==null&&
    b.cashflows.length===0?(b.feesPaid+b.spreadPaid+b.slippagePaid)/a.initialCash:null;
  lines.push(row(b.name,b.netReturn,m?.cagr,m?.maxDrawdown,m?.sharpe,m?.calmar,
   b.netReturn===null?null:b.cashflows.length?b.cashflows.length*2:1,null,costShare));
 }
 lines.push(row('SMA200 (Issue #18, 50/50 BTC/ETH)',null,sma.cagr,sma.maxDrawdown,
  sma.sharpe,sma.calmar,sma.trades,null,sma.costsPctOfInitial/100));
 lines.push('',
  'Investierte Tage = Anzahl Tagesbewertungen mit offenen Positionen; fuer die Referenzen nicht vergleichbar ausgewiesen.',
  'SMA200 stammt aus dem bestehenden vorregistrierten Issue-#18-Schnelltest auf BTC/ETH: 1 000 Startkapital, 10 bps Gebuehr und 5 bps Slippage je Seite, OHNE die v2-Spread- und Mengenregeln. Nettorendite und Tage mit Position sind im Spike-Beleg nicht separat erfasst (n/a).',
  'BTC-Halten und monatlicher 70/30-BTC/ETH-Sparplan stammen aus dem bisherigen v2-Benchmark. Der Sparplan ist eine Cashflow-neutrale TWR-Serie mit Nachzahlungen, kein direkt vergleichbares Endvermoegen. Kosten/Start beim Sparplan deshalb n/a.','',
  '## Diagnose: Marktteilnahme und Schwellenstatus','',
  'Status ist eine passive Tagesbeobachtung. Ablehnungen zaehlen Orders; fehlende Regeln/Qualitaet dagegen auch Markt-Tage; diese Werte duerfen nicht summiert werden.','',
  '| Lauf | Tage | Tage mit Position | Cash-Tage | Mittel investiert | ok | caution | exit-only | halted | Planer-Kaufsignaltage | Ausgefuehrte Kauftage |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
 for(const r of reports){
  const t=r.backtest.diagnostics!,d=analyzeDiagnosticTrace(t,a.initialCash);
  lines.push('| '+r.diagnosticVariant+' / '+(r.profile?.name??'Basis')+
   ' | '+t.days.length+' | '+t.days.filter(x=>!x.allCash).length+
   ' | '+d.allCashDays+' | '+fmt(d.averageInvestedPct,true)+' | '+
   d.statusDays.ok+' | '+d.statusDays.caution+' | '+d.statusDays['exit-only']+
   ' | '+d.statusDays.halted+' | '+d.plannerBuyDays+' | '+d.executedBuyDays+' |');
 }
 for(const r of reports){
  const t=r.backtest.diagnostics!;
  lines.push('','### '+r.diagnosticVariant+' / '+(r.profile?.name??'Basis'),'',
   'Profil-Kappungen: '+(r.profile?.cappedFields.join(', ')||'keine / Basis')+
   '; importiert: '+r.importedCoins+' Coins; gehandelt: '+r.tradedCoins+
   '; Coins ohne aktuelle Mengenregel: '+r.missingRules.length+'.');
  for(const source of ['portfolioRisk','broker','coinQuality','missingLot','planner'] as const){
   const names={portfolioRisk:'Portfolio-RiskEngine',broker:'Broker',coinQuality:'Coin-Qualitaet',
    missingLot:'Mengenregeln',planner:'Planer'};
   const top=Object.entries(t.reasons[source]).sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0])).slice(0,5);
   lines.push('','**'+names[source]+' – Top 5**','','| Grund | Anzahl |','|---|---:|',
    ...(top.length?top.map(([reason,n])=>
      '| '+reason.replace(/\|/g,'/').replace(/[\r\n]/g,' ')+' | '+n+' |'):
     ['| Keine erfassten Gruende | 0 |']));
  }
 }
 lines.push('','## Grenzen','',
  'Keine Parametersuche, kein nachtraegliches Aussortieren negativer Resultate, kein Zugriff auf Daten aus 2024 oder dem Holdout.',
  'Gegenwartige exchangeInfo-Mengenregeln werden rueckwirkend angenommen. Coins ohne diese Regeln bleiben im v4a-Universum, koennen aber nicht gekauft werden; das ist kein vollstaendiger Survivorship-Bias-Ausschluss.',
  'Der Vergleich isoliert die Drawdown-Bremse und die BTC/ETH-Auswahl, nicht die historische Handelbarkeit. Kein Entwicklungsergebnis allein genuegt fuer eine Freigabe.','');
 return lines.join('\n');
}
