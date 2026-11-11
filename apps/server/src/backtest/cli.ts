import type {FillModelName} from './fill-models.js';
import {beginResearchVariant,finishResearchVariant} from '../pipeline/variants-audit.js';
import Database from 'better-sqlite3';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {digest} from '../provenance/build.js';
import {config,projectRoot} from '../config.js';
import {inspectBuild} from '../provenance/build.js';
import {SqliteCandleSource,type IntervalMinutes,type CandleSource} from './candle-source.js';
import {ArchiveCandleSource} from '../archive/candle-source.js';
import {ArchiveUniverse} from '../archive/universe.js';
import {ARCHIVE_DB} from '../archive/paths.js';
import {runBacktest,ResearchCoverageBlocked,type BacktestOptions} from './runner.js';
import {stationaryBootstrap} from './bootstrap.js';
import {runStressTests,runCostStressMatrix,robustnessLight} from './stress.js';
import {benchmarks,writeReport,writeCoverageFailureReport} from './report.js';
import {compareSqlitePaper,comparePaper} from './parity.js';
import type {MarketConstraints} from './simulated-broker.js';
function parseArgs(argv:string[]) {
  const values=new Map<string,string>();
  for(let i=0;i<argv.length;i++){
    const arg=argv[i]!;
    if(!arg.startsWith('--')||i+1>=argv.length||argv[i+1]!.startsWith('--'))throw Error('Expected --key value');
    if(values.has(arg))throw Error('Duplicate option '+arg);
    values.set(arg,argv[++i]!);
  }
  for(const k of values.keys())if(!['--strategy','--from','--to','--interval','--fill-model','--trials','--profile','--seed','--source','--top','--quote','--hypothesis','--candidate'].includes(k))throw Error('Unknown option '+k);
  const strategy=values.get('--strategy')??'rules';
  if(strategy!=='rules'&&strategy!=='hold')throw Error('Strategy must be rules or hold');
  const from=values.get('--from'),to=values.get('--to');
  if(!from||!to||! /^\d{4}-\d{2}-\d{2}$/.test(from)||! /^\d{4}-\d{2}-\d{2}$/.test(to))throw Error('Supply --from and --to as YYYY-MM-DD (UTC)');
  const fromMs=Date.parse(from+'T00:00:00Z'),toMs=Date.parse(to+'T00:00:00Z');
  if(!Number.isSafeInteger(fromMs)||!Number.isSafeInteger(toMs)||fromMs>=toMs)throw Error('Invalid dates');
  const interval=Number(values.get('--interval')??15);
  if(![15,60,240,1440].includes(interval))throw Error('Unsupported candle interval');
  const fillModel=values.get('--fill-model')??'conservative-ohlc';
  if(fillModel!=='conservative-ohlc'&&fillModel!=='synthetic-bid'&&fillModel!=='maker-queue')throw Error('Unsupported fill model');
  const trials=Number(values.get('--trials')??1),seed=Number(values.get('--seed')??1);
  if(!Number.isSafeInteger(trials)||trials<1||!Number.isSafeInteger(seed))throw Error('Invalid trials/seed');
  const source=values.get('--source')??'archive';
  if(source!=='archive'&&source!=='paper')throw Error('--source must be archive or paper');
  const quote=(values.get('--quote')??'USDT') as 'USDT'|'EUR';
  if(quote!=='USDT'&&quote!=='EUR')throw Error('--quote must be USDT or EUR');
  const topN=Number(values.get('--top')??'20');
  if(!Number.isSafeInteger(topN)||topN<1||topN>100)throw Error('--top must be an integer from 1 to 100');
  return {strategy:strategy as 'rules'|'hold',fromMs,toMs,intervalMinutes:interval as IntervalMinutes,fillModel:fillModel as FillModelName,trials,seed,profile:values.get('--profile')??null,
   source:source as 'archive'|'paper',quote,topN,
   hypothesis:values.get('--hypothesis')??null,candidate:values.get('--candidate')??null};
}
export async function main(argv=process.argv.slice(2)) {
  const options=parseArgs(argv);
  const paperMode=options.source==='paper';
  if(!paperMode&&(!options.hypothesis||!options.candidate))
   throw Error('Development research needs --hypothesis H-xxx and --candidate ID for append-only trial audit');
  if(!paperMode && (options.fromMs<Date.UTC(2020,0,1) || options.toMs>Date.UTC(2024,0,1)))
   throw Error('Archive research is restricted to 2020-2023; 2024 validation and 2025+ holdout are sealed');
  if(paperMode&&options.intervalMinutes!==15&&options.intervalMinutes!==60)
   throw Error('Paper DB supports 15m/60m only; use --source archive for history');
  const file=paperMode?resolve(projectRoot,config.DATABASE_PATH):ARCHIVE_DB;
  if(!existsSync(file))throw Error('Backtest source missing: '+file+' (import free local archive or choose --source paper)');
  const sqlite=new Database(file,{readonly:true,fileMustExist:true});
  const archiveSource=paperMode?null:new ArchiveCandleSource({databasePath:file});
  try {
  const source:CandleSource=paperMode?new SqliteCandleSource(sqlite):archiveSource!;
  // ArchiveUniverse queries only the previous 30 complete UTC daily candles.
  const universeAt=paperMode?undefined:(dateMs:number)=>
   new ArchiveUniverse(sqlite).universeAt(dateMs,{quote:options.quote,topN:options.topN}).map(row=>row.symbol);
  const constraints=paperMode?new Map<string,MarketConstraints>():undefined;
  const top=paperMode?sqlite.prepare('SELECT symbol,ordermin,costmin,lot_decimals AS lotDecimals FROM pairs WHERE active=1 ORDER BY volume_24h_eur DESC, symbol ASC').all() as Array<MarketConstraints>:[];
  for(const p of top)constraints!.set(p.symbol,p);
  if(paperMode&&!constraints!.size)throw Error('No active pairs in Paper DB');
  const paperAccount=paperMode?sqlite.prepare('SELECT starting_balance AS startingBalance FROM accounts WHERE id=?').get(options.strategy) as {startingBalance:number}|undefined:undefined;
  const startingBalance=paperAccount?.startingBalance??config.STARTING_BALANCE_EUR;
  if(!Number.isFinite(startingBalance)||startingBalance<=0)throw Error('Invalid initial account balance');
  const build=inspectBuild(projectRoot);
  // A verified build ID is preferred; otherwise a deterministic fingerprint of the
  // exact execution/strategy source files replaces "unknown code" without claiming a verified build.
  const sourceFiles=[
    'apps/server/src/backtest/bootstrap.ts','apps/server/src/backtest/benchmark-costs.ts','apps/server/src/backtest/candle-source.ts',
    'apps/server/src/backtest/cli.ts','apps/server/src/backtest/fill-models.ts',
    'apps/server/src/backtest/metrics.ts','apps/server/src/backtest/parity.ts',
    'apps/server/src/backtest/report.ts','apps/server/src/backtest/runner.ts',
    'apps/server/src/backtest/historical-top10.ts',
    'apps/server/src/backtest/simulated-broker.ts','apps/server/src/backtest/ledger-invariant.ts','apps/server/src/backtest/stats.ts',
    'apps/server/src/archive/universe.ts','apps/server/src/archive/candle-source.ts',
    'apps/server/src/archive/report.ts','apps/server/src/coin-quality/archive-contract.ts',
    'apps/server/src/backtest/stress.ts','apps/server/src/strategy/providers.ts',
    'apps/server/src/strategy/quality.ts','apps/server/src/market/indicators.ts',
    'apps/server/src/broker/risk.ts','apps/server/src/broker/executionGuards.ts',
    'apps/server/src/context/paper-market-context.ts','apps/server/src/context/market-context.ts',
    'apps/server/src/config.ts'
  ];
  const codeFingerprint=digest(sourceFiles.map(path=>path+':'+digest(readFileSync(resolve(projectRoot,path)))).join('|'));
  const codeBuild=build.verified&&build.buildId?build.buildId:codeFingerprint;
  const runOptions:BacktestOptions={source,strategy:options.strategy,fromMs:options.fromMs,toMs:options.toMs,intervalMinutes:options.intervalMinutes,
    fillModel:options.fillModel,seed:options.seed,trials:options.trials,feeRate:config.TAKER_FEE_RATE,
    initialCash:startingBalance,constraints,universeAt,
    quoteCurrency:paperMode?config.QUOTE_CURRENCY:options.quote,venue:paperMode?config.EXCHANGE:'binance',
    riskLimits:{maxPositionPct:config.MAX_POSITION_PCT,maxOpenPositions:config.MAX_OPEN_POSITIONS,maxTradesPerDay:config.MAX_TRADES_PER_DAY,cooldownMinutes:config.COIN_COOLDOWN_MINUTES,maxPortfolioRiskPct:config.MAX_TOTAL_RISK_PCT,maxDrawdownPct:config.MAX_DRAWDOWN_PCT,maxSpreadBps:config.MAX_ENTRY_SPREAD_BPS,maxSlippageBps:config.MAX_ENTRY_SLIPPAGE_BPS,minOrderEur:config.MIN_ORDER_EUR},
    buildId:codeBuild,enforceResearchCoverage:!paperMode};
  const researchRunId=paperMode?null:beginResearchVariant(projectRoot,{
    hypothesisId:options.hypothesis!,candidate:options.candidate!,
    codeHash:codeFingerprint,configHash:digest(JSON.stringify({
      strategy:options.strategy,intervalMinutes:options.intervalMinutes,
      fillModel:options.fillModel,trials:options.trials,seed:options.seed,
      quote:options.quote,topN:options.topN,startingBalance,
      feeRate:config.TAKER_FEE_RATE,riskLimits:runOptions.riskLimits
    })),fromMs:options.fromMs,toMs:options.toMs
  });
  let researchOutcome:'new-variant'|'deterministic-replay'|null=null;
  let backtest;
  try {
    backtest=await runBacktest(runOptions);
    if(researchRunId)researchOutcome=finishResearchVariant(
      projectRoot,researchRunId,backtest.fingerprints.data);
  }catch(error){
    if(error instanceof ResearchCoverageBlocked){
      const path=writeCoverageFailureReport(projectRoot,error.coverage);
      process.stderr.write('Research preflight blocked: '+error.message+'; evidence: '+path+'\n');
    }
    throw error;
  }
  const bands=stationaryBootstrap(backtest.daily.slice(1).map((p,i)=>p.equity/backtest.daily[i]!.equity-1),options.seed);
  const stress=await runStressTests(runOptions);
  // Fixed offline matrix: the date gate runs before any research data is read.
  const costStressMatrix=paperMode?undefined:await runCostStressMatrix(runOptions);
  const historicalTop10=paperMode?undefined:{
    universeAt:(monthMs:number)=>new ArchiveUniverse(sqlite)
      .universeAt(monthMs,{quote:options.quote,topN:10}).map(x=>x.symbol),
    fillModel:runOptions.fillModel??'conservative-ohlc',
    feeRate:runOptions.feeRate??config.TAKER_FEE_RATE,
    spreadBps:runOptions.spreadBps??10,slippageBps:runOptions.slippageBps??8,
    initialCash:startingBalance,
    minOrderEur:runOptions.riskLimits?.minOrderEur??10,
    constraints:runOptions.constraints
  };
  const benchmark=await benchmarks(source,options.intervalMinutes,options.fromMs,options.toMs,
    paperMode?top.map(p=>p.symbol):backtest.universe,paperMode?config.QUOTE_CURRENCY:options.quote,
    !paperMode,historicalTop10,{
      initialCash:startingBalance,fillModel:runOptions.fillModel??'conservative-ohlc',
      feeRate:runOptions.feeRate??config.TAKER_FEE_RATE,
      spreadBps:runOptions.spreadBps??10,slippageBps:runOptions.slippageBps??8,
      minOrderEur:runOptions.riskLimits?.minOrderEur??10
    });
  const parity=paperMode?compareSqlitePaper(sqlite,backtest):comparePaper(backtest,[],[]);
  const report={runId:backtest.fingerprints.combined.slice(0,16),backtest,benchmarks:benchmark,bootstrap:bands,stress,
    costStressMatrix,robustness:robustnessLight(backtest,stress,costStressMatrix),parity};
  const paths=writeReport(projectRoot,report);
  process.stdout.write(JSON.stringify({runId:report.runId,robustness:report.robustness,return:backtest.metrics.netReturn,paths,
    researchVariant:{hypothesisId:options.hypothesis,candidate:options.candidate,
      runId:researchRunId,outcome:researchOutcome,
      auditStatus:researchRunId?'recorded-not-yet-gate-verified':'paper-no-research-audit'},
    historicalTradability:{unknownMarketDays:backtest.historicalTradability.unknownMarketDays,
      unknownTrades:backtest.historicalTradability.unknownTrades,
      restrictedMarketDays:backtest.historicalTradability.restrictedMarketDays,
      restrictedTrades:backtest.historicalTradability.restrictedTrades},
    parityAgreementPct:parity.decisionAgreementPct,profile:options.profile===null?'not-specified':'accepted-but-inactive-until-issue-10',buildVerified:build.verified,codeFingerprintKind:build.verified?'verified-build':'unverified-source-hash'},null,2)+'\n');
  } finally {archiveSource?.close();sqlite.close();}
}
if(process.argv[1]&&import.meta.url.startsWith('file:')&&process.argv[1].replaceAll('\\','/').endsWith('/backtest/cli.ts')){
  main().catch(error=>{console.error(error);process.exitCode=1;});
}
