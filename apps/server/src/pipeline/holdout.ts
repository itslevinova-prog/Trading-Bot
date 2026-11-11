import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {ArchiveCandleSource,type CandleSource} from '../archive/candle-source.js';
import {runBacktest} from '../backtest/runner.js';
import {loadRegistry,readStage,versionOf,stageFile,rootPath} from './registry.js';
import type {Evidence} from './gates.js';
import {projectRoot} from '../config.js';

const FROM='2025-01-01',TO='2026-01-01';
const PAIRS=['BTC/USDT','ETH/USDT'] as const;
const makeUtc=(date:string)=>Date.parse(date+'T00:00:00Z');
/** This module is executable only after a durable Stage-3 attempt reservation. */
export async function runRegisteredHoldout(root:string,strategyId:string,version:string) {
 if(process.env.LIVE_ENABLED==='true'||process.env.AI_ALLOW_REMOTE==='true')
  throw Error('Pipeline holdout is offline-only; live and remote AI are forbidden');
 if(strategyId!=='rules')throw Error('No independent rules provider for this registered strategy; holdout forbidden');
 const {strategy,entry}=versionOf(loadRegistry(root),strategyId,version);
 if(strategy.benchmark||entry.stage!==3||!entry.consumedStages.includes(3)||entry.status==='failed'||existsSync(stageFile(root,strategyId,version,3)))
  throw Error('Stage 3 must be reserved exactly once before running holdout');
 const previous=readStage(root,strategyId,version,2),development=readStage(root,strategyId,version,1);
 if(previous?.status!=='passed'||development?.status!=='passed'||previous.codeHash!==entry.codeHash||
  development.codeHash!==entry.codeHash)throw Error('Passed Stage 1/2 required for holdout');
 // Same predeclared universe; no sneaking in a different quote or selected winners.
 const expectedUniverse=development.metrics.universe;
 if(!Array.isArray(expectedUniverse)||expectedUniverse.length!==2||
  expectedUniverse[0]!==PAIRS[0]||expectedUniverse[1]!==PAIRS[1])
  throw Error('Development run must pre-register the exact BTC/ETH USDT universe');
 const out=rootPath(root,`data/pipeline-holdout/${strategyId}/${version}/evidence.json`);
 if(existsSync(out))throw Error('Holdout evidence already exists; no repeat read');
 const archive=new ArchiveCandleSource({
  allowHoldout:{reason:'pipeline stage 3'},
  accessLogPath:rootPath(root,'data/archive/holdout-access.jsonl')
 });
 try{
  const source:CandleSource={
   listSymbols:async()=>[...PAIRS],
   getCandles:(name,interval,from,to)=>{
    if(!PAIRS.includes(name as typeof PAIRS[number]))throw Error('Unregistered holdout pair');
    return archive.getCandles(name.replace('/',''),interval,from,to);
   }
  };
  // No trials, model-selection, DCA tuning or stress threshold changes on holdout.
  const backtest=await runBacktest({source,strategy:'rules',fromMs:makeUtc(FROM),toMs:makeUtc(TO),
   intervalMinutes:60,initialCash:1000,feeRate:.001,spreadBps:10,slippageBps:8,
   fillModel:'conservative-ohlc',seed:1,trials:1,quoteCurrency:'USDT',venue:'binance'});
  if(backtest.universe.join(',')!==PAIRS.join(',')||!Number.isFinite(backtest.metrics.netReturn))
   throw Error('Unverified holdout backtest coverage or net return');
  const evidence:Evidence={stage:3,strategyId,version,codeHash:entry.codeHash,configHash:entry.configHash,
   periodFrom:FROM,periodToExclusive:TO,source:'local:archive-holdout-guard',
   dataHashes:{archiveCandles:backtest.fingerprints.data,backtestConfiguration:backtest.fingerprints.configuration},
   metrics:{netReturnPct:backtest.metrics.netReturn*100,universe:[...PAIRS],
    tradeCount:backtest.metrics.tradeCount,runFingerprint:backtest.fingerprints.combined}};
  mkdirSync(dirname(out),{recursive:true});
  writeFileSync(out,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  return {evidence,path:out};
 }finally{archive.close();}
}
async function main(args:string[]){
 if(args.length!==4||args[0]!=='--strategy'||args[2]!=='--version')throw Error('Internal holdout runner requires --strategy ID --version VN');
 if(resolve(projectRoot)!==resolve(process.cwd())&&resolve(projectRoot)!==resolve(process.cwd(),'../..'))
  throw Error('Holdout runner must execute from the repository workspace');
 const result=await runRegisteredHoldout(projectRoot,args[1]!,args[3]!);
 process.stdout.write(JSON.stringify({evidencePath:result.path})+'\n');
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/pipeline/holdout.ts'))
 main(process.argv.slice(2)).catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
