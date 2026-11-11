import {simulateDca} from '../dca/simulator.js';
import {matchedCostBenchmarks,type MatchedBenchmarkCosts} from './benchmark-costs.js';
import {simulateHistoricalTop10,type HistoricalTop10Options,type Top10Fill} from './historical-top10.js';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {CandleSource,IntervalMinutes} from './candle-source.js';
import type {BacktestResult} from './runner.js';
import type {CoveragePreflight} from '../archive/report.js';
import type {BootstrapBands} from './bootstrap.js';
import type {StressResult,Robustness,CostStressMatrix} from './stress.js';
import type {ParityReport} from './parity.js';
import type {QuoteValuation} from './quote-valuation.js';
import type {WalkForwardReport} from './walk-forward.js';
import type {PairedComparison} from './paired-comparison.js';
import type {EvidenceDensity} from './evidence-density.js';
import type {SynchronizedBootstrapReport} from './synchronized-bootstrap.js';
import type {IntrabarUncertainty} from './intrabar-uncertainty.js';
import type {RegimeAttribution} from './regime-attribution.js';
export type Benchmark={
 name:string;netReturn:number|null;equity:Array<{ts:number;equity:number}>;
 coverageDays:number;note:string;
 fingerprints?:{universe:string;costs:string;data:string|null};
 universeHistory?:Array<{monthMs:number;symbols:string[]}>;
 trades?:Top10Fill[];feesPaid?:number|null;
 reportVersion?:string;quoteCurrency?:string;initialCapital?:number;
 costs?:Omit<MatchedBenchmarkCosts,'initialCash'> & {initialCash?:number};cashflows?:Array<{ts:number;amount:number}>;
 spreadPaid?:number|null;slippagePaid?:number|null;
};
export type BacktestReport={runId:string;backtest:BacktestResult;benchmarks:Benchmark[];bootstrap:BootstrapBands|null;stress:StressResult[];robustness:Robustness;parity:ParityReport;quoteValuation?:QuoteValuation;costStressMatrix?:CostStressMatrix;walkForward?:WalkForwardReport;pairedComparison?:PairedComparison;evidenceDensity?:EvidenceDensity;synchronizedBootstrap?:SynchronizedBootstrapReport;intrabarUncertainty?:IntrabarUncertainty;regimeAttribution?:RegimeAttribution};
const day=(ts:number)=>new Date(ts).toISOString().slice(0,10);
/** Benchmarks use the same CandleSource and closed-bar cutoff; missing days are never invented. */
export async function benchmarks(source:CandleSource,interval:IntervalMinutes,fromMs:number,toMs:number,symbols:string[],quote='EUR',pointInTime=false,
 historicalTop10?:Omit<HistoricalTop10Options,'source'|'fromMs'|'toMs'>,
 matchedCosts?:MatchedBenchmarkCosts):Promise<Benchmark[]> {
  const universe=[...new Set(symbols)].slice(0,10);
  const available=new Set(await source.listSymbols());
  const symbolFor=(base:string)=>[base+'/'+quote,base+quote].find(symbol=>available.has(symbol))??base+'/'+quote;
  const btc=symbolFor('BTC');
  const collect=async(symbol:string)=>{
    const rows=await source.getCandles(symbol,interval,fromMs,toMs);
    const d=new Map<string,{ts:number;price:number}>();
    for(const c of rows)d.set(day(c.ts+interval*60000),{ts:c.ts+interval*60000,price:c.close});
    return d;
  };
  const btcDays=await collect(btc),first=[...btcDays.values()][0],last=[...btcDays.values()].at(-1);
  const benchmark:Benchmark[]=[{name:'BTC Buy & Hold',netReturn:first&&last?last.price/first.price-1:null,
    equity:first?[...btcDays.values()].map(v=>({ts:v.ts,equity:v.price/first.price})):[],
    coverageDays:btcDays.size,note:'Idealized close-to-close benchmark; no fees or historic order book'}];
  // The DCA result is cash-flow neutral (TWR). If daily source data is
  // unavailable, retain an explicit N/A benchmark instead of inventing returns.
  const dcaName='DCA 70/30 BTC/ETH (monthly, TWR)';
  if(fromMs>=Date.UTC(2020,0,1)&&toMs<=Date.UTC(2024,0,1)){
   try {
    const mapped:CandleSource={
     listSymbols:async()=>['BTCUSDT','ETHUSDT'],
     getCandles:(symbol,minutes,from,to)=>source.getCandles(
      symbol==='BTCUSDT'?symbolFor('BTC'):symbol==='ETHUSDT'?symbolFor('ETH'):symbol,minutes,from,to)
    };
    const dca=await simulateDca(mapped,{fromMs,toMs,amount:100,interval:'monthly',variant:'classic',
     allocation:{BTCUSDT:.7,ETHUSDT:.3}});
    benchmark.push({name:dcaName,netReturn:dca.twr,
     equity:dca.daily.map(x=>({ts:x.ts,equity:x.twrIndex})),
     coverageDays:dca.daily.length,note:'Simulated equal-period deposits, cash-flow-neutral TWR. Not comparable to lump sum without matched cashflows.'});
   } catch {
    benchmark.push({name:dcaName,netReturn:null,equity:[],coverageDays:0,
     note:'Daily archive or contiguous BTC/ETH history unavailable; cannot produce a defensible DCA benchmark.'});
   }
  }else benchmark.push({name:dcaName,netReturn:null,equity:[],coverageDays:0,
    note:'DCA development benchmark sealed to 2020-2023; outside period not evaluated.'});
  // Preserve legacy idealized references and append cost-matched variants with explicit versioning.
  if(matchedCosts) benchmark.push(...await matchedCostBenchmarks({source,fromMs,toMs,quote,costs:matchedCosts}));
  if(pointInTime){
   if(historicalTop10){
    benchmark.push(await simulateHistoricalTop10({source,fromMs,toMs,...historicalTop10}));
   }else{
    benchmark.push({name:'Equal-weight historical Top 10 (monthly rebalanced, net)',
     netReturn:null,equity:[],coverageDays:0,
     note:'Unavailable: point-in-time monthly membership and shared cost configuration were not supplied.'});
   }
   return benchmark;
  }
  const all=await Promise.all(universe.map(collect));
  if(!all.length||all.some(d=>d.size<2)){
    benchmark.push({name:'Equal-weight Top 10 Buy & Hold (monthly rebalance)',netReturn:null,equity:[],coverageDays:0,note:'Insufficient complete same-day closes'});
    return benchmark;
  }
  const shared=[...all[0]!.keys()].filter(d=>all.every(m=>m.has(d))).sort();
  if(shared.length<2){
    benchmark.push({name:'Equal-weight Top 10 Buy & Hold (monthly rebalance)',netReturn:null,equity:[],coverageDays:shared.length,note:'No sufficient common trading days; no missing candles filled'});
    return benchmark;
  }
  let shares:number[] = [],cash=1,month='';
  const curve:Array<{ts:number;equity:number}>=[];
  for(const d of shared){
    const prices=all.map(m=>m.get(d)!.price);
    const equity=shares.length?shares.reduce((sum,s,i)=>sum+s*prices[i]!,cash):cash;
    const currentMonth=d.slice(0,7);
    if(month!==currentMonth){
      cash=0;shares=prices.map(p=>equity/universe.length/p);month=currentMonth;
    }
    curve.push({ts:all[0]!.get(d)!.ts,equity});
  }
  benchmark.push({name:'Equal-weight Top 10 Buy & Hold (monthly rebalance)',netReturn:curve.at(-1)!.equity/curve[0]!.equity-1,
    equity:curve,coverageDays:shared.length,
    note:'Monthly equal-weight close rebalance, available top-volume universe, no fees; intersection of observed days only'});
  return benchmark;
}
const escape=(x:unknown)=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const fmt=(x:number|null,percent=false)=>x===null||!Number.isFinite(x)?'n/a':(percent?(x*100).toFixed(2)+'%':x.toFixed(4));
function curveSvg(values:readonly number[],width=720,height=175):string {
  if(!values.length)return '<p>No points</p>';
  const min=Math.min(...values),max=Math.max(...values),range=Math.max(max-min,1e-10);
  const path=values.map((v,i)=>((i?'L':'M')+(10+i*Math.max(1,width-20)/Math.max(values.length-1,1)).toFixed(2)+','+(height-10-(v-min)/range*(height-20)).toFixed(2))).join(' ');
  return '<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Historic backtest chart" xmlns="http://www.w3.org/2000/svg"><path d="'+path+'" fill="none" stroke="#2563eb" stroke-width="2"/></svg>';
}
export function reportHtml(report:BacktestReport):string {
  const {backtest:b}=report,rows=Object.entries(b.metrics).map(([key,value])=>'<tr><th>'+escape(key)+'</th><td>'+escape(typeof value==='number'?fmt(value):value)+'</td></tr>').join('');
  const trafficLight={robust:'🟢 robust',questionable:'🟡 fraglich',fragile:'🔴 zerbrechlich',insufficient_evidence:'⚪ unzureichende Evidenz'}[report.robustness];
  const bench=report.benchmarks.map(x=>'<tr><td>'+escape(x.name)+'</td><td>'+fmt(x.netReturn,true)+
    '</td><td>'+escape(x.note)+'</td><td>'+ (x.fingerprints?
    'Universe: <code>'+escape(x.fingerprints.universe)+'</code> · Costs: <code>'+
    escape(x.fingerprints.costs)+'</code> · Data: <code>'+escape(x.fingerprints.data??'n/a')+'</code> · Trades: '+
    String(x.trades?.length??0)+' · Fees: '+fmt(x.feesPaid??null):'not separately hashed')+
    (x.reportVersion?'<p>Version: <code>'+escape(x.reportVersion)+'</code> · Quote: '+escape(x.quoteCurrency??'n/a')+
      ' · Kapital: '+fmt(x.initialCapital??null)+' · Gebühren: '+fmt(x.feesPaid??null)+
      ' · Spread: '+fmt(x.spreadPaid??null)+' · Slippage: '+fmt(x.slippagePaid??null)+
      ' · Einzahlungen: '+escape(JSON.stringify(x.cashflows??[]))+
      ' · Kostenmodell: <code>'+escape(JSON.stringify(x.costs??null))+'</code></p>':'')+
    '</td></tr>').join('');
  const coverage=b.coverage;
  const coverageRows=coverage?.rows.map(row=>'<tr><td>'+escape(row.symbol)+'</td><td>'+row.intervalMin+'</td><td>'+escape(row.month)+'</td><td>'+row.observed+'/'+row.expected+'</td><td>'+row.warmupObserved+'/'+row.warmupExpected+'</td><td>'+escape(row.firstTradableCloseMs===null?'unavailable':new Date(row.firstTradableCloseMs).toISOString())+'</td></tr>').join('')??'';
  const coverageSection=coverage?'<h2>Historische Datenabdeckung (Research-Preflight)</h2><p>Status: '+escape(coverage.status)+' · Fingerprint: <code>'+escape(coverage.fingerprint)+'</code></p><table><tr><th>Markt</th><th>Minuten</th><th>Monat (UTC)</th><th>Kerzen</th><th>Warm-up</th><th>Erster handelbarer Schluss</th></tr>'+coverageRows+'</table>':
   '<h2>Historische Datenabdeckung</h2><p>Kein strenger Research-Preflight ausgeführt; fehlende Evidenz darf nicht als bestanden gelten.</p>';
  const historic=b.historicalTradability;
  const historicRows=historic.evidenceSources.slice(0,100).map(source=>
    '<tr><td>'+escape(source.symbol)+'</td><td>'+escape(source.status)+'</td><td>'+
    escape(source.name)+'</td><td>'+escape(new Date(source.fetchedAt).toISOString())+
    '</td><td>'+escape(new Date(source.observedAt).toISOString())+'</td></tr>').join('');
  const histValue=(value:number|null)=>value===null?'nicht belegbar':String(value);
  const historicalSection='<h2>Historische Handelbarkeit – unabhängig vom Coin-Universum</h2>'+
    '<p>Unbekannte Markt-Tage: <strong>'+histValue(historic.unknownMarketDays)+'</strong> / '+
    histValue(historic.totalMarketDays)+' · belegte Einschränkungen: '+
    histValue(historic.restrictedMarketDays)+' · belegte Handelbarkeit: '+
    histValue(historic.evidencedTradableMarketDays)+'</p>'+
    '<p>Unbekannte Trades: <strong>'+historic.unknownTrades+'</strong> / '+historic.totalTrades+
    ' · Trades mit belegter Einschränkung: '+historic.restrictedTrades+
    ' · Trades mit belegter Handelbarkeit: '+historic.evidencedTradableTrades+'</p>'+
    '<p>Kein Handelsbarkeitsnachweis aus Kurskerzen. Zeitlich spätere Tags werden nicht rückdatiert. '+
    'Nur damals bekannte, zeitnahe offizielle Beobachtungen zählen als belegt. '+
    (historic.evidenceSources.length>100?'Quellenliste auf 100 Einträge gekürzt (vollständig im JSON).':'')+'</p>'+
    '<table><tr><th>Markt</th><th>Beobachtung</th><th>Quelle</th><th>Abgerufen (UTC)</th><th>Beobachtet (UTC)</th></tr>'+
    historicRows+'</table>';
  const valuation=report.quoteValuation;
  const quoteSection=valuation?
   '<h2>Quote-Bewertung in EUR (historisch, Point-in-Time)</h2><p>Quote: '+escape(valuation.quote)+
   ' · Status: '+escape(valuation.status)+' · '+escape(valuation.reason??'vollständig belegt')+'</p>'+
   '<table><tr><th>Effekt</th><th>Rendite</th><th>Beitrag zur EUR-Gesamtrendite</th></tr>'+
   '<tr><td>Handelsrendite in Quote</td><td>'+fmt(valuation.tradingReturn,true)+'</td><td>'+fmt(valuation.tradingContribution,true)+'</td></tr>'+
   '<tr><td>Quote-FX (USD/EUR)</td><td>'+fmt(valuation.quoteFxReturn,true)+'</td><td>'+fmt(valuation.quoteFxContribution,true)+'</td></tr>'+
   '<tr><td>Stablecoin-Abweichung</td><td>'+fmt(valuation.stablecoinReturn,true)+'</td><td>'+fmt(valuation.stablecoinContribution,true)+'</td></tr>'+
   '<tr><td>EUR-Gesamtrendite</td><td>'+fmt(valuation.totalEurReturn,true)+'</td><td>'+fmt(valuation.totalEurReturn,true)+'</td></tr></table>'+
   '<p>EUR-Eigenkapital: '+fmt(valuation.initialEurEquity)+' → '+fmt(valuation.finalEurEquity)+
   ' · Peg-Abweichung Start/Ende: '+(valuation.stablecoinPegDeviation?
   fmt(valuation.stablecoinPegDeviation.initial,true)+' / '+fmt(valuation.stablecoinPegDeviation.final,true):'n/a')+
   ' · Historische Quellen: '+escape(valuation.sources.join(', ')||'n/a')+
   '. Ohne historische FX- und Cross-Daten keine unterstellte 1:1-Parität.</p>':
   '<h2>Quote-Bewertung in EUR</h2><p>n/a – keine historischen FX-/Spot-Cross-Belege übergeben.</p>';
  const walkForward=report.walkForward;
  const walkForwardSection=walkForward?
    '<h2>Rollierender Walk-Forward (rein diagnostisch)</h2>'+
    '<p>Version: '+escape(walkForward.version)+' · Daten-Split: '+escape(walkForward.dataSplitId)+
    ' · Split-Hash: <code>'+escape(walkForward.splitFingerprint)+'</code> · Provider: '+escape(walkForward.providerId)+
    ' · Konfiguration: <code>'+escape(walkForward.frozenConfigurationHash)+'</code> · Status: '+escape(walkForward.status)+'</p>'+
    '<p>'+escape(walkForward.note)+'</p>'+
    '<table><tr><th>Fold (Testzeit)</th><th>Netto Strategie</th><th>Netto BTC</th><th>Netto-Überschuss</th><th>Fills</th><th>Verworfen</th><th>Kosten</th><th>Coverage</th><th>Daten-Hash</th></tr>'+
    walkForward.folds.map(fold=>
      '<tr><td>'+fold.index+': '+escape(new Date(fold.testFromMs).toISOString())+' – '+
      escape(new Date(fold.testToMs).toISOString())+'</td><td>'+fmt(fold.candidateNetReturn,true)+
      '</td><td>'+fmt(fold.btcNetReturn,true)+'</td><td>'+fmt(fold.netExcess,true)+
      '</td><td>'+escape(fold.candidateTrades??'n/a')+'</td><td>'+escape(fold.candidateRejections??'n/a')+
      '</td><td>'+fmt(fold.costs?.total??null)+'</td><td>'+escape(fold.coverage?.status??'n/a')+
      '</td><td><code>'+escape(fold.inputHash??'n/a')+'</code> · '+escape(fold.reason??'Purge/Embargo belegt')+
      '</td></tr>').join('')+'</table>':
    '<h2>Rollierender Walk-Forward</h2><p>n/a – keine Entwicklungs-Fold-Diagnose übergeben.</p>';
  const paired=report.pairedComparison;
  const pairedSection=paired?
    '<h2>Gepaarter Block-Bootstrap gegen kostenbehaftete Referenz</h2>'+
    '<p>Status: '+escape(paired.status)+' · Gemeinsame Tage: '+paired.pairedDays+
    ' · Ohne Vergleich: '+paired.unmatchedDays+
    ' · Fehlend Strategie: '+paired.missingStrategyDays+
    ' · Fehlend Benchmark: '+paired.missingBenchmarkDays+
    ' · Beobachtungslücken: '+paired.gapsBetweenPairedDays+'</p>'+
    '<table><tr><th>Beobachteter Nettoüberschuss</th><th>P10</th><th>P50</th><th>P90</th><th>Anteil der Bootstrap-Pfade mit positivem Überschuss</th></tr>'+
    '<tr><td>'+fmt(paired.observedExcess,true)+'</td><td>'+fmt(paired.differenceBand?.p10??null,true)+
    '</td><td>'+fmt(paired.differenceBand?.p50??null,true)+'</td><td>'+fmt(paired.differenceBand?.p90??null,true)+
    '</td><td>'+fmt(paired.probabilityPositive,true)+'</td></tr></table>'+
    '<p>Version: '+escape(paired.version)+' · Seed: '+paired.seed+' · Pfade: '+paired.paths+
    ' · Blocklänge: '+paired.blockLength+' · Input-Hash: <code>'+escape(paired.sharedInputHash??'n/a')+
    '</code> · '+escape(paired.reason??'n/a')+'</p>':
    '<h2>Gepaarter Block-Bootstrap</h2><p>n/a – keine gemeinsame kostenbehaftete Benchmark-Tagesreihe übergeben.</p>';
  const density=report.evidenceDensity;
  const densitySection=density?
    '<h2>Abhängige Trades und Evidenzdichte (Diagnose)</h2>'+
    '<p>Version: '+escape(density.version)+' · Status: '+escape(density.status)+
    ' · Trades: '+density.totalTrades+' · UTC-Entscheidungstage: '+escape(density.decisionDays??'n/a')+
    ' · Ereigniscluster: '+escape(density.eventClusters??'n/a')+
    ' · Max. Trades/Cluster: '+escape(density.maxTradesPerCluster??'n/a')+
    ' · Cluster-Bandstatus: '+escape(density.confidenceStatus)+'</p>'+
    '<p>Fingerabdruck: <code>'+escape(density.dataFingerprint??'n/a')+'</code> · '+escape(density.reason??'n/a')+
    '. Gleichzeitige/überlappende Trades sind keine unabhängigen Beobachtungen; Clustercount ist keine exakte Zahl statistischer Freiheitsgrade.</p>'+
    '<table><tr><th>Regime</th><th>Trades</th><th>Cluster</th></tr>'+
    Object.entries(density.regimeCounts).map(([regime,row])=>'<tr><td>'+escape(regime)+
      '</td><td>'+row.trades+'</td><td>'+row.clusters+'</td></tr>').join('')+'</table>'+
    '<p>Cluster-resampelte Netto-PnL (nur Diagnose): P10 '+fmt(density.confidenceBand?.p10??null)+
    ', P50 '+fmt(density.confidenceBand?.p50??null)+', P90 '+fmt(density.confidenceBand?.p90??null)+'</p>':
    '<h2>Evidenzdichte der Trades</h2><p>n/a – keine Zeitstempel-/Clusterdiagnose übergeben.</p>';
  const joint=report.synchronizedBootstrap;
  const jointSection=joint?
    '<h2>Synchronisierte Portfolio-Tagesblöcke</h2>'+
    '<p>Version: '+escape(joint.version)+' · Status: '+escape(joint.status)+
    ' · Tage: '+joint.days+' · Märkte: '+escape(joint.symbols.join(', '))+
    ' · Seed: '+joint.seed+' · Pfade: '+joint.paths+' · Blocklänge: '+joint.blockLength+'</p>'+
    '<table><tr><th>Synthetische Diagnose</th><th>P10</th><th>P50</th><th>P90</th></tr>'+
    '<tr><td>Endrendite</td><td>'+fmt(joint.endReturn?.p10??null,true)+'</td><td>'+
    fmt(joint.endReturn?.p50??null,true)+'</td><td>'+fmt(joint.endReturn?.p90??null,true)+'</td></tr>'+
    '<tr><td>Maximaler Drawdown</td><td>'+fmt(joint.maxDrawdown?.p10??null,true)+'</td><td>'+
    fmt(joint.maxDrawdown?.p50??null,true)+'</td><td>'+fmt(joint.maxDrawdown?.p90??null,true)+'</td></tr>'+
    '<tr><td>Schlechtester Tagesertrag</td><td>'+fmt(joint.worstDailyReturn?.p10??null,true)+'</td><td>'+
    fmt(joint.worstDailyReturn?.p50??null,true)+'</td><td>'+fmt(joint.worstDailyReturn?.p90??null,true)+'</td></tr>'+
    '<tr><td>Maximales Cluster-Exposure</td><td>'+fmt(joint.maxClusterExposure?.p10??null,true)+'</td><td>'+
    fmt(joint.maxClusterExposure?.p50??null,true)+'</td><td>'+fmt(joint.maxClusterExposure?.p90??null,true)+'</td></tr></table>'+
    '<p>'+escape(joint.reason??'Vollständig beobachtete gemeinsame Entwicklungstage')+
    ' · '+escape(joint.note)+' · Beispielpfad-Quellindizes: <code>'+
    escape(JSON.stringify(joint.firstPathSourceIndices??'n/a'))+'</code></p>':
    '<h2>Synchronisierte Portfolio-Tagesblöcke</h2><p>n/a – keine zeitgleichen, vollständigen Positions- und Marktvektoren übergeben. Keine synthetische Risikoschätzung freigeschaltet.</p>';
  const intrabar=report.intrabarUncertainty;
  const intrabarSection=intrabar?
    '<h2>Intrabar Stop/Ziel – OHLC-Ergebnisband (nur Szenario)</h2>'+
    '<p>Version: '+escape(intrabar.version)+' · Status: '+escape(intrabar.status)+
    ' · Positionskerzen beobachtet/erwartet: '+intrabar.observedPositionBars+'/'+intrabar.expectedPositionBars+
    ' · Doppeltrigger: '+escape(intrabar.doubleTriggerBars??'n/a')+
    ' · Durch Open geklärt: '+escape(intrabar.openResolvedBars??'n/a')+
    ' · Reihenfolge unbekannt: '+escape(intrabar.ambiguousBars??'n/a')+'</p>'+
    '<p>Konservativer Netto-PnL (nur mehrdeutige Positionsexits): '+fmt(intrabar.resultBand?.conservativeNetPnl??null)+
    ' · Ziel-zuerst-Szenario: '+fmt(intrabar.resultBand?.targetFirstNetPnl??null)+
    ' · Differenz: '+fmt(intrabar.resultBand?.deltaNetPnl??null)+
    ' · Eingangsbeleg: <code>'+escape(intrabar.inputHash??'n/a')+'</code></p>'+
    '<p>'+escape(intrabar.note)+' '+escape(intrabar.reason??'')+'</p>'+
    '<table><tr><th>Markt</th><th>Geschlossene Kerze (UTC)</th><th>Stop</th><th>Ziel</th><th>Stop-zuerst PnL</th><th>Ziel-zuerst PnL</th></tr>'+
    intrabar.rows.map(row=>'<tr><td>'+escape(row.pair)+'</td><td>'+
      escape(new Date(row.observedAtMs).toISOString())+'</td><td>'+fmt(row.stopPrice)+
      '</td><td>'+fmt(row.targetPrice)+'</td><td>'+fmt(row.conservativeNetPnl)+
      '</td><td>'+fmt(row.targetFirstNetPnl)+'</td></tr>').join('')+'</table>':
    '<h2>Intrabar Stop/Ziel – OHLC-Ergebnisband</h2><p>n/a – keine beobachtete vollständige Positionskerzenfolge oder Tick-Evidenz geliefert.</p>';
  const attribution=report.regimeAttribution;
  const regimeSection=attribution?
    '<h2>Regime-Attribution (historisch, rein diagnostisch)</h2>'+
    '<p>Version: '+escape(attribution.version)+' · Status: '+escape(attribution.status)+
    ' · unbekannte Entscheidungsregime: '+attribution.unknownRegimeDecisions+
    ' · Beleg-Fingerprint: <code>'+escape(attribution.inputHash??'n/a')+'</code></p>'+
    '<table><tr><th>Regime bei Entscheidung</th><th>Entscheidungen</th><th>Fill-Zuordnungen</th><th>Geschlossene Trades</th><th>Netto realisiert</th><th>Gebühren (separat, nicht doppelt abgezogen)</th><th>Exposure (beobachtete Punkte)</th><th>Beobachtete UTC-Tage</th></tr>'+
    attribution.rows.map(row=>'<tr><td>'+escape(row.regime)+'</td><td>'+row.decisions+
      '</td><td>'+row.tradeFills+'</td><td>'+row.closedTrades+'</td><td>'+
      fmt(row.netRealizedPnl)+'</td><td>'+fmt(row.fees)+'</td><td>'+
      row.exposedObservations+'/'+row.observedObservations+' ('+
      fmt(row.exposureFraction,true)+')</td><td>'+row.observedUtcDays+'</td></tr>').join('')+
    '</table><p>'+escape(attribution.note)+' '+escape(attribution.reason??'')+'</p>':
    '<h2>Regime-Attribution</h2><p>n/a – kein vollständig geschlossener Entwicklungs-Research-Beleg übergeben.</p>';
  const stress=report.stress.map(x=>'<tr><td>'+escape(x.name)+'</td><td>'+fmt(x.netReturn,true)+'</td></tr>').join('');
  const matrix=report.costStressMatrix;
  const costMatrixSection=matrix?
    '<h2>Kombinierte Kosten-Stressmatrix ('+escape(matrix.version)+')</h2>'+
    '<p>Status: '+escape(matrix.status)+' · Gleicher Daten-Fingerprint: <code>'+escape(matrix.inputHash??'n/a')+'</code></p>'+
    '<table><tr><th>Szenario</th><th>Netto</th><th>Fills</th><th>Verworfen</th><th>Gebühren</th><th>Spread</th><th>Slippage</th><th>Kosten gesamt</th><th>Input-Hash / Beleg</th></tr>'+
    matrix.cells.map(cell=>'<tr><td>'+escape(cell.name)+'</td><td>'+fmt(cell.netReturn,true)+'</td>'+
      '<td>'+escape(cell.fills??'n/a')+'</td><td>'+escape(cell.rejectedOrders??'n/a')+'</td>'+
      '<td>'+fmt(cell.costs?.fees??null)+'</td><td>'+fmt(cell.costs?.spread??null)+'</td>'+
      '<td>'+fmt(cell.costs?.slippage??null)+'</td><td>'+fmt(cell.costs?.total??null)+'</td>'+
      '<td><code>'+escape(cell.inputHash??'n/a')+'</code> · '+escape(cell.reason??'Broker-Replay vollständig')+'</td></tr>').join('')+
    '</table><p>Fixe Szenarien: Basis, Gebühren×2, Spread×2, Slippage×2, alles×2. Keine nachträglichen PnL-Abzüge; jede Zelle ist ein eigener Broker-Replay. Fehlende Zellen sind unzureichende Evidenz.</p>':
    '<h2>Kombinierte Kosten-Stressmatrix</h2><p>n/a – keine vollständige Matrix ausgeführt, keine Robustheitsfreigabe daraus.</p>';
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Backtest '+escape(report.runId)+'</title>'+
    '<style>body{font:15px system-ui,sans-serif;margin:2rem auto;max-width:900px;line-height:1.5;color:#17212c;padding:0 1rem}table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border-bottom:1px solid #ddd;text-align:left;padding:.5rem}svg{max-width:100%;background:#f7f9fc;border:1px solid #e3e8f0}h2{margin-top:2rem}code{word-break:break-all}</style>'+
    '<h1>Unified backtest – '+escape(b.configuration.strategy)+'</h1><p><strong>Robustness: '+escape(trafficLight)+'</strong> · '+escape(new Date(b.configuration.fromMs).toISOString())+' to '+escape(new Date(b.configuration.toMs).toISOString())+'</p>'+
    '<p>Fill model: '+escape(b.configuration.fillModel)+', synthetic spread '+b.configuration.spreadBps+' bps, slippage '+b.configuration.slippageBps+' bps, taker fee '+b.configuration.feeRate+'</p>'+
    '<h2>Equity</h2>'+curveSvg(b.equity.map(e=>e.equity))+'<h2>Drawdown</h2>'+curveSvg(b.daily.map(d=>d.drawdown))+
    coverageSection+historicalSection+quoteSection+'<h2>Statistics</h2><table>'+rows+'</table><h2>Benchmarks</h2><table><tr><th>Benchmark</th><th>Net return</th><th>Qualification</th><th>Evidence hashes and modeled costs</th></tr>'+bench+'</table>'+
    '<h2>Stress</h2><table>'+stress+'</table>'+costMatrixSection+walkForwardSection+pairedSection+densitySection+intrabarSection+regimeSection+'<h2>Parity</h2><p>'+escape(JSON.stringify(report.parity))+'</p>'+
    jointSection+'<h2>Bootstrap (1000 paths)</h2><pre>'+escape(JSON.stringify(report.bootstrap,null,2))+'</pre>'+
    '<h2>Provenance</h2><p>Input: <code>'+escape(b.fingerprints.data)+'</code> · Configuration: <code>'+escape(b.fingerprints.configuration)+'</code> · Build: <code>'+escape(b.fingerprints.codeBuild??'unverified')+'</code></p>'+
    '<p>'+b.limitations.map(escape).join(' · ')+'</p></html>';
}
export function writeReport(root:string,report:BacktestReport) {
  if(!/^[a-f0-9]{16}$/.test(report.runId))throw Error('Invalid report run ID');
  const folder=resolve(root,'data','backtests',report.runId);
  mkdirSync(folder,{recursive:true});
  const json=resolve(folder,'report.json'),html=resolve(folder,'report.html');
  writeFileSync(json,JSON.stringify(report,null,2)+'\n');
  writeFileSync(html,reportHtml(report));
  return {json,html};
}

/** Only records a blocked run. It never writes a successful backtest result. */
export function writeCoverageFailureReport(root:string,coverage:CoveragePreflight):string {
  if(coverage.status!=='blocked' || !/^[a-f0-9]{64}$/.test(coverage.fingerprint))
    throw Error('Expected a blocked coverage preflight with SHA256 fingerprint');
  const folder=resolve(root,'data','backtests','coverage-failures');
  mkdirSync(folder,{recursive:true});
  const path=resolve(folder,coverage.fingerprint+'.json');
  writeFileSync(path,JSON.stringify({
    kind:'research-coverage-preflight',status:'blocked',reason:coverage.reason,
    coverageFingerprint:coverage.fingerprint,coverage
  },null,2)+'\n');
  return path;
}
