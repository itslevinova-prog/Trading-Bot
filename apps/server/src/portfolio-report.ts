import {compareResearchReports} from './research/comparison.js';
import {inspectBuild,createRuntimeProvenance,digest,evaluationFingerprint} from './provenance/build.js';
import {registerForwardVersion} from './research/registration.js';
import {createDataset,defaultDataset,selectDefaultDataset,readDataset,datasetReplay,datasetUniverseHash,datasetDataHash,canonicalJson,sameReplayOptions,type FrozenDataset} from './research/dataset.js';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';import {createHash} from 'node:crypto';import {and,eq,lte,desc} from 'drizzle-orm';
import {candles,pairs} from './schema.js';import {config,projectRoot} from './config.js';import {replayRulesPortfolio,type PortfolioOptions} from './research/portfolio.js';
const now=Date.now(),args=process.argv.slice(2).filter(arg=>arg!=='--'),refresh=args.includes('--refresh-dataset'),specified=args.find(arg=>arg.startsWith('--dataset='))?.slice('--dataset='.length);
if(args.some(arg=>arg!=='--refresh-dataset'&&!/^--dataset=[a-f0-9]{64}$/.test(arg))||args.filter(arg=>arg.startsWith('--dataset=')).length>1||refresh&&specified)throw Error('Use --refresh-dataset OR --dataset=<64-char checksum>; no arbitrary file paths');
function runtimeOptions(fromTs:number,toTs:number):PortfolioOptions{return {startingBalance:config.STARTING_BALANCE_EUR,feeRate:config.TAKER_FEE_RATE,spreadBps:10,slippageBps:8,fromTs,toTs,decisionIntervalMinutes:config.DECISION_INTERVAL_MINUTES,maxDrawdownPct:config.MAX_DRAWDOWN_PCT,minOrderQuote:config.MIN_ORDER_EUR,risk:{maxPositionPct:config.MAX_POSITION_PCT,maxOpenPositions:config.MAX_OPEN_POSITIONS,maxTradesPerDay:config.MAX_TRADES_PER_DAY,cooldownMinutes:config.COIN_COOLDOWN_MINUTES,maxPortfolioRiskPct:config.MAX_TOTAL_RISK_PCT,feeRate:config.TAKER_FEE_RATE},entry:{maxSpreadBps:config.MAX_ENTRY_SPREAD_BPS,maxSlippageBps:config.MAX_ENTRY_SLIPPAGE_BPS}};}
async function capture(){
 const {db,sqlite}=await import('./db.js');try{return db.transaction(tx=>{
  const active=tx.select().from(pairs).where(eq(pairs.active,true)).all();
  const universe=active.map(p=>({pair:p.symbol,lotDecimals:p.lotDecimals,minQty:p.ordermin,minOrderQuote:p.costmin,candles:tx.select().from(candles).where(and(eq(candles.pair,p.symbol),eq(candles.interval,15),lte(candles.ts,now-900000))).orderBy(desc(candles.ts)).limit(35040).all().reverse()}));
  if(!universe.length||universe.some(m=>m.candles.length<300))throw Error('Every frozen market needs at least 300 closed bars');
  const start=Math.max(...universe.map(m=>m.candles[0]!.ts)),end=Math.min(...universe.map(m=>m.candles.at(-1)!.ts)),from=Math.floor((start+(end-start)*.7)/900000)*900000;
  return createDataset({venue:config.EXCHANGE,quoteCurrency:config.QUOTE_CURRENCY,metadata:active,universe,options:runtimeOptions(from,end)},now);
 });}finally{sqlite.close();}
}
let dataset:FrozenDataset;
if(specified)dataset=readDataset(projectRoot,specified);
else{const previous=defaultDataset(projectRoot,config.EXCHANGE,config.QUOTE_CURRENCY);dataset=previous&&!refresh?previous:await capture();if(!previous||refresh)selectDefaultDataset(projectRoot,dataset,refresh,now);}
if(dataset.venue!==config.EXCHANGE||dataset.quoteCurrency!==config.QUOTE_CURRENCY)throw Error('Frozen dataset belongs to another exchange/quote');
const universe=datasetReplay(dataset),options=dataset.options,universeHash=datasetUniverseHash(dataset),dataHash=datasetDataHash(dataset),optionsHash=digest(canonicalJson(options));
const sourceFiles=['strategy/providers.ts','strategy/quality.ts','market/indicators.ts','broker/risk.ts','broker/executionGuards.ts','research/portfolio.ts','broker/PaperExecutionAdapter.ts','research/registration.ts','research/dataset.ts','research/comparison.ts','strategy/scheduler.ts','config.ts'];
const hash=createHash('sha256');for(const file of sourceFiles)hash.update(file).update(readFileSync(resolve(projectRoot,'apps/server/src',file)));hash.update(canonicalJson({...options,fromTs:undefined,toTs:undefined}));hash.update(universeHash);const strategyHash=hash.digest('hex');
const registration=registerForwardVersion(projectRoot,{strategyHash,sourceFiles,options:{...options,fromTs:undefined,toTs:undefined},universe:universe.map(m=>m.pair)});
console.log(JSON.stringify({message:'Fixed retrospective dataset; no parameter search or model API',datasetId:dataset.datasetId,capturedAt:dataset.capturedAt,markets:universe.length,fromTs:options.fromTs,toTs:options.toTs}));
const base=await replayRulesPortfolio(universe,options),stressOptions={...options,feeRate:options.feeRate*2,slippageBps:options.slippageBps*2,risk:{...options.risk,feeRate:options.feeRate*2}},stress=await replayRulesPortfolio(universe,stressOptions);
const runtimeIdentity=createRuntimeProvenance(inspectBuild(projectRoot),config),runtimeConfigurationMatches=sameReplayOptions(options,runtimeOptions(options.fromTs,options.toTs));
const fixedDataset={datasetId:dataset.datasetId,capturedAt:dataset.capturedAt,dataHash,optionsHash,selectionMethod:dataset.selectionMethod,windowFrozen:true,costsFrozen:true,marketOrderFrozen:true,historicalDataAlreadyInspected:true};
const previousFile=resolve(projectRoot,specified?'docs/portfolio-comparison-latest.json':'docs/portfolio-latest.json');let previousReport:unknown;try{if(existsSync(previousFile))previousReport=JSON.parse(readFileSync(previousFile,'utf8'));}catch{/* Keep corrupt prior bytes archived; never invent comparable metrics. */}
const comparison=compareResearchReports({fixedDataset,strategyVersion:runtimeIdentity.strategyVersion,dataHash,universeHash,base,stress},previousReport);
const report={comparison,fixedDataset,runtimeConfigurationMatches,universeHash,evaluationVersion:evaluationFingerprint(runtimeIdentity.strategyVersion,universeHash),buildId:runtimeIdentity.build.buildId,buildVerified:runtimeIdentity.verified,strategyVersion:runtimeIdentity.strategyVersion,generatedAt:new Date(now).toISOString(),venue:config.EXCHANGE,quoteCurrency:config.QUOTE_CURRENCY,strategyHash,dataHash,sourceFiles,options,universe:universe.map(m=>({pair:m.pair,bars:m.candles.length})),retrospectiveHoldoutAlreadyInspected:true,profitabilityEstablished:false,independentForwardRegistration:registration,base,stress};
const archive=resolve(projectRoot,'docs/research-runs');mkdirSync(archive,{recursive:true});
const latest=resolve(projectRoot,specified?'docs/portfolio-comparison-latest.json':'docs/portfolio-latest.json');if(existsSync(latest)){const previous=readFileSync(latest),saved=resolve(archive,`previous-${digest(previous).slice(0,24)}-portfolio.json`);if(!existsSync(saved))writeFileSync(saved,previous,{flag:'wx'});}
writeFileSync(resolve(archive,`${now}-${dataset.datasetId.slice(0,16)}-portfolio.json`),JSON.stringify(report,null,2),{flag:'wx'});
writeFileSync(latest+'.tmp',JSON.stringify(report,null,2));const {renameSync}=await import('node:fs');renameSync(latest+'.tmp',latest);
console.log(JSON.stringify({datasetId:dataset.datasetId,dataHash,optionsHash,markets:universe.length,runtimeConfigurationMatches,baseReturnPct:base.returnPct,stressReturnPct:stress.returnPct,closedTrades:base.closedTrades,reportFile:latest}));
