import type {CandleSource,Candle} from './candle-source.js';
import {validateCandles} from './candle-source.js';
import {TREND_RESEARCH_ASSUMPTIONS as a,researchQuality,researchHash} from './trend-research.js';
import {planTrendVolTargetV1,type TrendV1Input} from '../strategy/trend-vol-target-v1.js';
import {CONFIG} from '../forward/engine-v2.js';
import {configLots,lotDecimals,type LotRules} from '../forward/lots.js';
import {matchedCostBenchmarks} from './benchmark-costs.js';
import {runBacktest} from './runner.js';
import {calculateMetrics,type EquityPoint} from './metrics.js';
import {resolvePaperRiskProfile,type RiskProfileName} from '../risk-engine/profiles.js';
import {DEFAULT_RISK_LIMITS} from '../risk-engine/engine.js';
import {H025_V3_DRAWDOWN} from '../risk-engine/research-drawdown-v3.js';
import type {Regime} from '../regime/types.js';
import {diagnosticsMarkdown} from './trend-diagnostics.js';
import type {MarketConstraints} from './simulated-broker.js';

export const V2_RESEARCH=Object.freeze({hypothesis:'H-025',strategy:CONFIG.strategy,
 version:'H-025-research-binance-lots-v2',fromMs:a.fromMs,toMs:a.toMs,
 feeRate:a.feeRate,spreadBps:a.spreadBps,slippageBps:a.slippageBps,initialCash:a.initialCash,
 parameters:CONFIG.parameters,lotAssumption:'current-exchangeInfo-not-historical',
 missingLotPolicy:'no-entry-retain-historical-universe',historicalTradabilityVerified:false,pipelineEligible:false});
export const V3_RESEARCH=Object.freeze({...V2_RESEARCH,
 version:'H-025-research-drawdown-reentry-v3',
 drawdown:H025_V3_DRAWDOWN,regimeProvider:'ArchiveRegimeProvider-risk-on-only',
 historicalRunStatus:'not-executed'});
/** Explicit H-025 v4 development diagnostic; absent from Paper and Forward. */
export const V4_DRAWDOWN_THRESHOLDS=Object.freeze({cautionDrawdown:.97,exitOnlyDrawdown:.98,hardStopDrawdown:.99});
export type V4DiagnosticVariant='v4a'|'v4b';
export const V4_RESEARCH=Object.freeze({
 v4a:Object.freeze({...V2_RESEARCH,version:'H-025-diagnostic-no-drawdown-v4a',
  diagnosticOnly:true,drawdownThresholds:V4_DRAWDOWN_THRESHOLDS,universe:'full-point-in-time-USDT'}),
 v4b:Object.freeze({...V2_RESEARCH,version:'H-025-diagnostic-BTC-ETH-only-v4b',
  diagnosticOnly:true,drawdownThresholds:V4_DRAWDOWN_THRESHOLDS,universe:'point-in-time-BTCUSDT-ETHUSDT'})
});
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
 universeAt:(day:number)=>readonly string[]|Promise<readonly string[]>;
 /** Absent preserves the existing unprofiled v2 research baseline. */
 profileName?:RiskProfileName;
 /** Explicit research-only v3 switch; legacy v2 is unchanged without it. */
 researchV3?:{regimeAt:(asOf:number)=>Regime|Promise<Regime>};
 /** Only explicitly registered, non-operational H-025 v4 diagnostics. */
 researchV4?:V4DiagnosticVariant;
};
export async function runTrendResearchV2(options:V2RunOptions){
 if(!Number.isFinite(Date.parse(options.lotSnapshotAt)))throw Error('Lot snapshot timestamp required');
 const profile=options.profileName?resolvePaperRiskProfile(options.profileName):null;
 const v3=options.researchV3??null,v4=options.researchV4??null;
 if(v3&&v4)throw Error('H-025 v3 and v4 must not be combined');
 if(v4&&v4!=='v4a'&&v4!=='v4b')throw Error('Unknown H-025 v4 variant');
 const assumptions=v4?V4_RESEARCH[v4]:v3?V3_RESEARCH:V2_RESEARCH;
 const rules=configLots(options.lotRules),sealed=developmentSource(options.source);
 const daily=new Map<string,Candle[]>();
 // Discover from the historical archive, never intersect with current exchange symbols.
 for(const symbol of (await sealed.listSymbols()).filter(s=>s.endsWith('USDT')&&
  (v4!=='v4b'||s==='BTCUSDT'||s==='ETHUSDT')).sort()){
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
  riskLimits:{minOrderEur:Math.min(...Object.values(rules).map(r=>Number(r.minNotional))),
   ...(profile?{maxOpenPositions:profile.effective.maxOpenPositions,maxPositionPct:profile.effective.maxPositionPct}:{})},
  ...(v4?{portfolioRiskLimits:{...(profile?.engineLimits??DEFAULT_RISK_LIMITS),...V4_DRAWDOWN_THRESHOLDS}}:
   profile?{portfolioRiskLimits:profile.engineLimits}:{}),
  ...(v3?{researchDrawdownV3:v3}:{}),
  provider:{decide:async context=>{
   const input=(context.execution as {trendV1?:TrendV1Input}|undefined)?.trendV1;
   if(!input)throw Error('Missing closed daily v2 context');
   const plan=planTrendVolTargetV1({...input,...CONFIG.parameters,
    ...(profile?{targetAnnualVol:profile.effective.targetAnnualVol,
     topK:profile.effective.maxOpenPositions,maxPositionPct:profile.effective.maxPositionPct,
     maxInvestedPct:profile.effective.maxInvestedPct}:{}),
    ...(v3?{rebalanceTolerance:H025_V3_DRAWDOWN.rebalanceTolerance}:{})});
   return {marketView:CONFIG.strategy+': '+plan.reason,actions:plan.actions};
  }},
  constraints,universeAt:v4==='v4b'?async(day:number)=>(await options.universeAt(day)).filter(
   s=>s==='BTCUSDT'||s==='ETHUSDT'):options.universeAt,
  quoteCurrency:'USDT',venue:'binance',enablePortfolioRisk:true,
  collectResearchDiagnostics:true,missingLotSymbols:missingRules,
  coinQuality:{check:async(symbol,asOf)=>{
   const quality=researchQuality(symbol,asOf,daily.get(symbol)??[]);
   return rules[symbol]?quality:{...quality,status:'unknown',reasons:['Keine aktuelle Mengenregel; historische Zugehörigkeit bleibt erhalten, Einstieg gesperrt']};
  }},buildId:options.codeBuild});
 const benchmarks=await matchedCostBenchmarks({source,fromMs:a.fromMs,toMs:a.toMs,quote:'USDT',costs:{initialCash:a.initialCash,feeRate:a.feeRate,spreadBps:a.spreadBps,slippageBps:a.slippageBps,minOrderEur:a.minNotional,fillModel:'conservative-ohlc'}});
 const snapshot={assumption:V2_RESEARCH.lotAssumption,fetchedAt:options.lotSnapshotAt,rules};
 return {label:v4?'H-025 '+v4+' – isolierte Diagnose ohne Drawdown-Bremse':
  v3?'H-025 v3 – Drawdown-Reentry (separate Forschung)':
  'H-025 v2 – Forschungslauf mit aktuellen Mengenregeln als historischer Annahme',
  hypothesis:'H-025',strategy:CONFIG.strategy,pipelineEligible:false,paperApproved:false,
  profile,
  ...(v4?{diagnosticVariant:v4}:{}),
  assumptions,lotSnapshot:snapshot,lotSnapshotHash:researchHash(snapshot),benchmarks,
  importedCoins:imported.length,universeCoins:result.universe.length,tradedCoins:new Set(result.trades.map(t=>t.symbol)).size,
  missingRules,coveredRuleCoins:imported.length-missingRules.length,
  fingerprints:{configuration:researchHash({assumptions,lotSnapshot:snapshot,...(profile?{profile}:{})}),codeBuild:options.codeBuild},backtest:result,
  caveats:[
   ...(v4?[
    'H-025 '+v4+': Diagnoselauf, nie Paper-, Forward- oder Pipeline-Kandidat.',
    'Nur die drei Portfolio-RiskEngine-Drawdown-Schwellen 97/98/99 Prozent sind überschrieben; andere RiskEngine-Prüfungen, Coin-Qualität und aktuelle Mengenregeln bleiben aktiv.',
    'Keine v3-Reentry-/Reset-Logik, kein lineares v3-Sizing, kein v3-Toleranzband.',
    ...(v4==='v4b'?['BTC/ETH werden nur bei point-in-time belegter Universumszugehoerigkeit zugelassen.']:[])
   ]:[]),
   ...(v3?[
    'H-025 v3 verwendet nur eine explizit aktivierte Research-RiskEngine. Paper/Forward/v1/v2 bleiben unverändert.',
    'Die 20-%-Toleranz gilt im Planer für relative Zielgewichtsabweichungen. Der lineare Entry-Cap liquidiert keine gehaltenen Positionen.',
    'Reset nur nach 30 vollen UTC-Cash-Tagen im exit-only/halted-Zustand mit der bestehenden dreiteiligen Regime-Ampel risk-on. Neutral und unvollständige Daten erlauben keinen Reset.',
    'Die 30-%-Startkapital-Notbremse bleibt dauerhaft; Research-Reset verändert den Broker-Peak und die wirkliche Performancehistorie nicht.',
    'Die bestehenden absoluten Paper-Obergrenzen kappen auch die drei Profile; effektive Drawdown-Schwellen können deshalb identisch sein.'
   ]:[]),
   'Aktuelle exchangeInfo-Mengenregeln werden rückwirkend angenommen; keine kostenlos belegten historischen Börsenfilter.',
   'Coins ohne verwendbare aktuelle Filter (insbesondere delistete Coins) bleiben im historischen Universum, bekommen aber keine Einstiege. Das kann die Performanceauswahl verzerren; kein survivorship-freier Ausführungsnachweis.',
   'Handelbarkeit, Tags und Lots sind historisch nicht verifiziert. Keine Pipeline- oder Paper-Freigabe.',
   'Alter/Volumen und Universum stammen nur aus Entwicklungsdaten. Warm-up beginnt 2020; vorherige Kerzen werden nicht geladen.',
   'Der bestehende Backtest-Broker und seine Portfolio-RiskEngine bleiben aktiv. Vollständige Ausführungsparität mit dem Forward-Adapter ist damit nicht behauptet.',
   'BTC/DCA-Referenzen verwenden unverändert die synthetische Rundung des bestehenden Forschungslaufs, nicht die aktuellen v2-Lots. Gebühren/Spread/Slippage bleiben gleich; keine Behauptung identischer Mengenregeln für diese Vergleichsreihen.',
   'Offene Positionen nach Datenende blockieren den Lauf statt erfundener Liquidation. Negative Ergebnisse und Null-Trades werden unverändert ausgewiesen.',
   ...(profile?[
    'corePct ('+profile.requested.corePct+') ist nicht umgesetzt: kein separater BTC/ETH-Buy-and-Hold-Kern, keine Core-Umschichtung; das Profil ist nur ein aktiver Satellite-Proxy.',
    'maxInvestedPct und maxPositionPct begrenzen die vom Planer angezielten Einstiegsgewichte; zwischen Rebalancings können Marktbewegungen die tatsächliche Quote verändern.',
    'universeTopN, riskPerTradePct und minimumEdgeMultiple sind im v2-Planer nicht gesondert operationalisiert; sie werden nicht als erfüllt ausgegeben.'
   ]:[])
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
  ...(report.backtest.diagnostics?diagnosticsMarkdown(report.backtest.diagnostics,a.initialCash):
   ['## Diagnose nicht vorhanden','','Der historische Ergebnisbeleg enthält keine Tages- und Ursachendiagnose. Der Cash-Lock ist daraus nicht belegt.','']),
  '## Unveränderte synthetische Referenzen',...report.benchmarks.map(b=>`- ${b.name}: Nettorendite ${b.netReturn===null?'n/a':b.netReturn}; ${b.note}`),'',
  '## Annahmen und Grenzen',...report.caveats.map(s=>'- '+s),'',
  'Fehlende Regeln: '+(report.missingRules.join(', ')||'keine'),''
 ].join('\n');
}

/** Fixed three-profile comparison: the same archive, cost assumptions and strategy. */
export function v2ProfilesMarkdown(reports:readonly Awaited<ReturnType<typeof runTrendResearchV2>>[]){
 const order=['vorsichtig','normal','aggressiv'] as const;
 if(reports.length!==order.length||reports.some((r,i)=>r.profile?.name!==order[i]))
  throw Error('The three pre-registered profiles must be reported in fixed order');
 const fmt=(n:number|null|undefined,percent=false)=>n==null||!Number.isFinite(n)?'n/a':
  (percent?n*100:n).toFixed(3)+(percent?' %':'');
 const row=(name:string,m:ReturnType<typeof calculateMetrics>['metrics']|null,trades:number|null,
  costShare:number|null,exposure:number|null)=>
  `| ${name} | ${fmt(m?.cagr,true)} | ${fmt(m?.maxDrawdown,true)} | ${fmt(m?.sharpe)} | ${fmt(m?.calmar)} | ${trades??'n/a'} | ${fmt(costShare,true)} | ${fmt(exposure,true)} |`;
 const rows=reports.map(r=>row(r.profile!.name,r.backtest.metrics,
  r.backtest.metrics.tradeCount,r.backtest.metrics.costShare,r.backtest.metrics.exposureTime));
 const first=reports[0]!;
 for(const b of first.benchmarks){
  if(b.netReturn===null){rows.push(row(b.name,null,null,null,null));continue;}
  const points:EquityPoint[]=[{ts:a.fromMs,equity:b.name.startsWith('DCA')?1:a.initialCash,exposed:false},
   ...b.equity.map(p=>({...p,exposed:true}))];
  const metrics=calculateMetrics(points,[],a.fromMs,a.toMs).metrics;
  // Benchmarks report absolute costs, not the strategy's gross-PnL cost share.
  rows.push(row(b.name,metrics,b.name.startsWith('DCA')?b.cashflows.length*2:1,null,
   b.name.startsWith('DCA')?null:metrics.exposureTime));
 }
 return ['# H-025 v2 – drei vorregistrierte Risikoprofile / Issue #7','',
  '**Nur Entwicklung 2020-01 bis 2023-12; kein 2024/kein Holdout, keine Pipeline-/Paper-Freigabe.**','',
  '| Profil | CAGR | Max-Drawdown | Sharpe | Calmar | Trades | Kostenanteil | Exposure |',
  '|---|---:|---:|---:|---:|---:|---:|',...rows,'',
  'Kostenanteil = Anteil der Ausführungskosten am positiven Brutto-PnL der Strategie (bei nicht positivem Brutto-PnL n/a). Für Benchmarks ist dieser Nenner nicht separat belegt: n/a.',
  'DCA-Renditen sind Cashflow-neutral (TWR), monatliche Einzahlungen; kein direkter Endvermögensvergleich mit einer Einmalanlage.',
  'Exposure = Anteil der Bewertungstage mit mindestens einer Position, nicht durchschnittlich investierter Kapitalanteil.',
  'Benchmark-Exposure für DCA nicht ermittelt; BTC Buy & Hold nach einmaligem Einstieg näherungsweise vollständig investiert.','',
  '## Diagnose je Profil','',
  ...reports.flatMap(r=>['### Profil '+r.profile!.name,'',
   ...(r.backtest.diagnostics?diagnosticsMarkdown(r.backtest.diagnostics,a.initialCash)
    .map(line=>line.replace(/^(#{2,3})(?= )/,x=>'#'+x)):
    ['Keine Tagesdiagnose im vorhandenen Ergebnis.']),'']),
  '## Absolute Kappungen je Profil',
  ...reports.map(r=>`- ${r.profile!.name}: cappedFields = ${r.profile!.cappedFields.join(', ')||'keine'}; `+
   `effektive Volatilität ${fmt(r.profile!.effective.targetAnnualVol,true)}, `+
   `Top-K ${r.profile!.effective.maxOpenPositions}, maximale Position ${fmt(r.profile!.effective.maxPositionPct,true)}, `+
   `maximal investiert ${fmt(r.profile!.effective.maxInvestedPct,true)}.`),'',
  '## Grenzen',
  'Die Parameter corePct (BTC/ETH-Buy-and-Hold-Kern) sind in diesem Backtest **nicht abbildbar und nicht implementiert**; nur der aktive Teil wird verglichen.',
  'universeTopN, riskPerTradePct und minimumEdgeMultiple sind keine separat durchgesetzten Profilregeln dieses H-025-v2-Laufs.',
  'Die Planer-Gewichte sind Zielgrössen; Kursveränderungen und ausstehende Orders können die tatsächliche Exposure von der Investitionsquote abweichen lassen.',
  'Mengenregeln sind aktuelle Börsenregeln als rückwirkende Annahme. Historische Handelbarkeit ist nicht bestätigt.',
  'Fehlende Coins/Filter sperren Eintritte statt fiktiver Ausführungen; unveränderte Gebühren, Spread und Slippage.','',
  `Importierte Coins: ${first.importedCoins}; historisches Universum: ${first.universeCoins}; `+
   `fehlende aktuelle Filter: ${first.missingRules.length}.`,
  'Ergebnisse aus drei separaten Backtests, identischer Archivstand und Lot-Snapshot; vollständige JSON-Belege enthalten Trades und Fingerprints.',
  '' ].join('\n');
}
