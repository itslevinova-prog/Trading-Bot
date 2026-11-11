import Database from 'better-sqlite3';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {ArchiveCandleSource} from '../archive/candle-source.js';
import {ArchiveUniverse} from '../archive/universe.js';
import {ARCHIVE_DB,PROJECT_ROOT} from '../archive/paths.js';
import {runBacktest} from './runner.js';
import {calculateMetrics,type EquityPoint} from './metrics.js';
import {matchedCostBenchmarks} from './benchmark-costs.js';
import {TREND_RESEARCH_ASSUMPTIONS as a,researchQuality,researchHash} from './trend-research.js';
import type {Candle,CandleSource} from './candle-source.js';

async function main(){
 const registration=JSON.parse(readFileSync(PROJECT_ROOT+'/docs/research/hypotheses.json','utf8')).find((x:{id:string})=>x.id==='H-025');
 if(researchHash(registration.researchAssumptions)!==researchHash(a))throw Error('Assumptions differ from preregistration');
 const db=new Database(ARCHIVE_DB,{readonly:true,fileMustExist:true});
 const archive=new ArchiveCandleSource({databasePath:ARCHIVE_DB});
 const source:CandleSource={listSymbols:()=>archive.listSymbols(),getCandles:(s,m,f,t)=>{
  if(t>a.toMs)throw Error('Validation and holdout are sealed');
  return archive.getCandles(s,m,Math.max(a.fromMs,f),t);
 }};
 try{
  const imported=(await source.listSymbols()).filter(s=>s.endsWith('USDT'));
  const daily=new Map<string,Candle[]>();
  for(const s of imported)daily.set(s,await source.getCandles(s,1440,a.fromMs,a.toMs));
  const universe=new ArchiveUniverse(db);
  const constraints=new Map(imported.map(symbol=>[symbol,{symbol,ordermin:10**-a.lotDecimals,costmin:a.minNotional,lotDecimals:a.lotDecimals}]));
  const universeAt=(now:number)=>universe.universeAt(now,{quote:'USDT',topN:imported.length})
   .map(x=>x.symbol); // All historical candidates, no current-symbol list or top-N truncation.
  const costs={initialCash:a.initialCash,feeRate:a.feeRate,spreadBps:a.spreadBps,slippageBps:a.slippageBps,minOrderEur:a.minNotional,fillModel:'conservative-ohlc' as const};
  const result=await runBacktest({source,strategy:'trend-vol-target',fromMs:a.fromMs,toMs:a.toMs,intervalMinutes:1440,
   initialCash:a.initialCash,feeRate:a.feeRate,spreadBps:a.spreadBps,slippageBps:a.slippageBps,
   constraints,universeAt,coinQuality:{check:async(symbol,asOf)=>researchQuality(symbol,asOf,daily.get(symbol)??[])},
   quoteCurrency:'USDT',venue:'binance',enablePortfolioRisk:true,
   buildId:execFileSync('git',['rev-parse','HEAD'],{cwd:PROJECT_ROOT,encoding:'utf8'}).trim()});
  const benchmarks=await matchedCostBenchmarks({source,fromMs:a.fromMs,toMs:a.toMs,quote:'USDT',costs});
  const strategyCosts=result.trades.reduce((sum,t)=>sum+t.fee+t.spreadCost+t.slippageCost,0);
  const summary=[{name:'trend-vol-target-v1',...result.metrics,trades:result.trades.length,costs:strategyCosts},
   ...benchmarks.map(b=>{
    const points:EquityPoint[]=[{ts:a.fromMs,equity:b.name.startsWith('DCA')?1:a.initialCash,exposed:false},...b.equity.map(p=>({...p,exposed:true}))];
    const metrics=b.netReturn===null?null:calculateMetrics(points,[],a.fromMs,a.toMs).metrics;
    return {name:b.name,cagr:metrics?.cagr??null,maxDrawdown:metrics?.maxDrawdown??null,sharpe:metrics?.sharpe??null,calmar:metrics?.calmar??null,
     trades:b.netReturn===null?null:b.name.startsWith('DCA')?b.cashflows.length*2:1,
     costs:b.feesPaid===null?null:(b.feesPaid??0)+(b.spreadPaid??0)+(b.slippagePaid??0),note:b.note};
   })];
  const report={label:a.label,hypothesis:'H-025',pipelineEligible:false,paperApproved:false,assumptions:a,
   importedCoins:imported.length,universeCoins:result.universe.length,tradedCoins:new Set(result.trades.map(t=>t.symbol)).size,
   summary,backtest:result,benchmarks,archiveManifestHash:researchHash(db.prepare('SELECT path,sha256 FROM files ORDER BY path').all()),
   caveats:['Keine Pipeline- oder Paper-Freigabe. Historische Handelbarkeit nicht belegt.',
    'Alter seit erster importierter Kerze ist konservativer Listing-Proxy; keine Daten vor 2020.',
    'DCA: monatlich 10.000 USDT, 70/30 BTC/ETH; Kennzahlen auf cashflow-neutralem TWR, Kosten absolut; kein direkter Endvermögensvergleich.',
    'Konservative synthetische Lot-Annahme: nur ganze Coin-Einheiten (kann teure Coins bei 10.000 USDT Kapital ausschließen); BTC/DCA-Referenzen verwenden vorhandene Simulator-Rundung (8 Stellen).',
    'Fehlende Tageskerzen sperren Signale; fehlende Stunden sperren Portfolio-Risiko. Offene Position nach Datenende blockiert den Lauf statt erfundener Liquidation.']};
  mkdirSync(PROJECT_ROOT+'/data/trend-research',{recursive:true});
  writeFileSync(PROJECT_ROOT+'/data/trend-research/report.json',JSON.stringify(report,null,2));
  const fmt=(n:number|null|undefined,pct=false)=>n==null?'n/a':(pct?n*100:n).toFixed(3)+(pct?' %':'');
  const md=['# Forschungslauf mit Annahmen – H-025 / Issue #4','',
   '**Keine bestandene Pipeline-Stufe #21; keine Paper-Freigabe.**',
   `Entwicklung: 2020–2023. Importierte Coins: ${report.importedCoins}; PIT-Universum: ${report.universeCoins}; gehandelt: ${report.tradedCoins}.`,
   '', '| Variante | CAGR | Max-Drawdown | Sharpe | Calmar | Trades | Kosten (USDT) |',
   '|---|---:|---:|---:|---:|---:|---:|',
   ...summary.map(s=>`| ${s.name} | ${fmt(s.cagr,true)} | ${fmt(s.maxDrawdown,true)} | ${fmt(s.sharpe)} | ${fmt(s.calmar)} | ${s.trades??'n/a'} | ${fmt(s.costs)} |`),
   '', '## Vorab festgelegte Annahmen','```json',JSON.stringify(a,null,2),'```','',...report.caveats.map(x=>'- '+x),
   '', 'Negative Ergebnisse und Null-Trades sind Ergebnisse dieses Forschungsmodells, keine bestätigte Ausführung oder Profitabilität.'];
  writeFileSync(PROJECT_ROOT+'/data/trend-research/summary.md',md.join('\n')+'\n');
  console.log(md.join('\n'));
 }finally{archive.close();db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
