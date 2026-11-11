import type {CandleSource,Candle} from './candle-source.js';
import {validateCandles} from './candle-source.js';
import {TREND_RESEARCH_ASSUMPTIONS as a,researchQuality,researchHash} from './trend-research.js';
import {planTrendVolTargetV1,type TrendV1Input} from '../strategy/trend-vol-target-v1.js';
import {CONFIG} from '../forward/engine-v2.js';
import {configLots,lotDecimals,type LotRules} from '../forward/lots.js';
import {matchedCostBenchmarks} from './benchmark-costs.js';
import {runBacktest} from './runner.js';
import type {MarketConstraints} from './simulated-broker.js';

export const V2_RESEARCH=Object.freeze({hypothesis:'H-025',strategy:CONFIG.strategy,
 version:'H-025-research-binance-lots-v2',fromMs:a.fromMs,toMs:a.toMs,
 feeRate:a.feeRate,spreadBps:a.spreadBps,slippageBps:a.slippageBps,initialCash:a.initialCash,
 parameters:CONFIG.parameters,lotAssumption:'current-exchangeInfo-not-historical',
 missingLotPolicy:'no-entry-retain-historical-universe',historicalTradabilityVerified:false,pipelineEligible:false});
export function validateV2Inputs(from:string,to:string,intervals:string,symbols:string){
 if(from!=='2020-01'||to!=='2023-12'||intervals!=='1d,1h'||symbols!=='')
  throw Error('H-025 v2 requires fixed 2020-01..2023-12 and 1d,1h with empty symbols');
}
/** The underlying archive is never asked for validation/holdout or pre-2020 bars. */
export function developmentSource(source:CandleSource):CandleSource{
 return {listSymbols:()=>source.listSymbols(),getCandles:async(symbol,minutes,from,to)=>{
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>=to||to>a.toMs||to<=a.fromMs)
   throw Error('Only sealed development candles 2020–2023');
  const start=Math.max(from,a.fromMs),rows=await source.getCandles(symbol,minutes,start,to);
  validateCandles(rows,minutes,start,to);return rows;
 }};
}
export type V2RunOptions={source:CandleSource;lotRules:LotRules;lotSnapshotAt:string;codeBuild:string;
 universeAt:(day:number)=>readonly string[]|Promise<readonly string[]>};
export async function runTrendResearchV2(options:V2RunOptions){
 if(!Number.isFinite(Date.parse(options.lotSnapshotAt)))throw Error('Lot snapshot timestamp required');
 const rules=configLots(options.lotRules),sealed=developmentSource(options.source);
 const daily=new Map<string,Candle[]>();
 // Discover from the historical archive, never intersect with current exchange symbols.
 for(const symbol of (await sealed.listSymbols()).filter(s=>s.endsWith('USDT')).sort()){
  const rows=await sealed.getCandles(symbol,1440,a.fromMs,a.toMs);
  if(rows.length)daily.set(symbol,rows);
 }
 const imported=[...daily.keys()];if(!imported.length)throw Error('No historical USDT candles');
 const source:CandleSource={listSymbols:async()=>imported,getCandles:(s,m,f,t)=>sealed.getCandles(s,m,f,t)};
 const constraints=new Map<string,MarketConstraints>(imported.map(symbol=>{
  const rule=rules[symbol];
  // Unknown filters cannot authorize entries. Zeroes are blocked planner inputs, not assumed trading rules.
  return [symbol,rule?{symbol,ordermin:Number(rule.minQty),costmin:Number(rule.minNotional),lotDecimals:lotDecimals(rule),stepSize:rule.stepSize}:
   {symbol,ordermin:0,costmin:0,lotDecimals:0}];
 }));
 const missingRules=imported.filter(s=>!rules[s]);
 const result=await runBacktest({source,strategy:'trend-vol-target',fromMs:a.fromMs,toMs:a.toMs,intervalMinutes:1440,
  initialCash:a.initialCash,feeRate:a.feeRate,spreadBps:a.spreadBps,slippageBps:a.slippageBps,
  // Each pair still applies its actual assumed minimum; no additional fixed 10-USDT v1 floor.
  riskLimits:{minOrderEur:Math.min(...Object.values(rules).map(r=>Number(r.minNotional)))},
  provider:{decide:async context=>{
   const input=(context.execution as {trendV1?:TrendV1Input}|undefined)?.trendV1;
   if(!input)throw Error('Missing closed daily v2 context');
   const plan=planTrendVolTargetV1({...input,...CONFIG.parameters});
   return {marketView:CONFIG.strategy+': '+plan.reason,actions:plan.actions};
  }},
  constraints,universeAt:options.universeAt,quoteCurrency:'USDT',venue:'binance',enablePortfolioRisk:true,
  coinQuality:{check:async(symbol,asOf)=>{
   const quality=researchQuality(symbol,asOf,daily.get(symbol)??[]);
   return rules[symbol]?quality:{...quality,status:'unknown',reasons:['Keine aktuelle Mengenregel; historische Zugehörigkeit bleibt erhalten, Einstieg gesperrt']};
  }},buildId:options.codeBuild});
 const benchmarks=await matchedCostBenchmarks({source,fromMs:a.fromMs,toMs:a.toMs,quote:'USDT',costs:{initialCash:a.initialCash,feeRate:a.feeRate,spreadBps:a.spreadBps,slippageBps:a.slippageBps,minOrderEur:a.minNotional,fillModel:'conservative-ohlc'}});
 const snapshot={assumption:V2_RESEARCH.lotAssumption,fetchedAt:options.lotSnapshotAt,rules};
 return {label:'H-025 v2 – Forschungslauf mit aktuellen Mengenregeln als historischer Annahme',
  hypothesis:'H-025',strategy:CONFIG.strategy,pipelineEligible:false,paperApproved:false,
  assumptions:V2_RESEARCH,lotSnapshot:snapshot,lotSnapshotHash:researchHash(snapshot),benchmarks,
  importedCoins:imported.length,universeCoins:result.universe.length,tradedCoins:new Set(result.trades.map(t=>t.symbol)).size,
  missingRules,coveredRuleCoins:imported.length-missingRules.length,
  fingerprints:{configuration:researchHash({assumptions:V2_RESEARCH,lotSnapshot:snapshot}),codeBuild:options.codeBuild},backtest:result,
  caveats:[
   'Aktuelle exchangeInfo-Mengenregeln werden rückwirkend angenommen; keine kostenlos belegten historischen Börsenfilter.',
   'Coins ohne verwendbare aktuelle Filter (insbesondere delistete Coins) bleiben im historischen Universum, bekommen aber keine Einstiege. Das kann die Performanceauswahl verzerren; kein survivorship-freier Ausführungsnachweis.',
   'Handelbarkeit, Tags und Lots sind historisch nicht verifiziert. Keine Pipeline- oder Paper-Freigabe.',
   'Alter/Volumen und Universum stammen nur aus Entwicklungsdaten. Warm-up beginnt 2020; vorherige Kerzen werden nicht geladen.',
   'Der bestehende Backtest-Broker und seine Portfolio-RiskEngine bleiben aktiv. Vollständige Ausführungsparität mit dem Forward-Adapter ist damit nicht behauptet.',
   'BTC/DCA-Referenzen verwenden unverändert die synthetische Rundung des bestehenden Forschungslaufs, nicht die aktuellen v2-Lots. Gebühren/Spread/Slippage bleiben gleich; keine Behauptung identischer Mengenregeln für diese Vergleichsreihen.',
   'Offene Positionen nach Datenende blockieren den Lauf statt erfundener Liquidation. Negative Ergebnisse und Null-Trades werden unverändert ausgewiesen.'
  ]};
}
export function v2Markdown(report:Awaited<ReturnType<typeof runTrendResearchV2>>){
 const m=report.backtest.metrics,fmt=(n:number|null)=>n===null?'n/a':String(n);
 return ['# H-025 v2 – Forschungslauf mit Annahmen / Issue #3','',
  '**Keine Pipeline-Freigabe; keine Gewinnprognose. Nur 2020-01 bis 2023-12.**','',
  `Historisch importiert: ${report.importedCoins}; Universum: ${report.universeCoins}; gehandelt: ${report.tradedCoins}.`,
  `Ohne aktuelle Filter, Einstiege gesperrt: ${report.missingRules.length}. Snapshot-Hash: ${report.lotSnapshotHash}.`,'',
  '| Variante | Netto-Rendite | CAGR | Max-Drawdown | Sharpe | Calmar | Trades | Turnover | Kosten (USDT) |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  `| ${report.strategy} | ${fmt(m.netReturn)} | ${fmt(m.cagr)} | ${fmt(m.maxDrawdown)} | ${fmt(m.sharpe)} | ${fmt(m.calmar)} | ${m.tradeCount} | ${m.turnover} | ${report.backtest.trades.reduce((n,t)=>n+t.fee+t.spreadCost+t.slippageCost,0)} |`,'',
  'Kennzahlen als Dezimalwerte; n/a bedeutet nicht berechenbar. Vollständiger Ledger, Rejections, Snapshot und Fingerprints im JSON-Artefakt.','',
  '## Unveränderte synthetische Referenzen',...report.benchmarks.map(b=>`- ${b.name}: Nettorendite ${b.netReturn===null?'n/a':b.netReturn}; ${b.note}`),'',
  '## Annahmen und Grenzen',...report.caveats.map(s=>'- '+s),'',
  'Fehlende Regeln: '+(report.missingRules.join(', ')||'keine'),''
 ].join('\n');
}
