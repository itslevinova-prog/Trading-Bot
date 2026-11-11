import {resolve,dirname} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {ArchiveCandleSource,type CandleSource} from '../archive/candle-source.js';
import {projectRoot} from '../config.js';
import {runBacktest,type BacktestOptions} from '../backtest/runner.js';
import {CORRELATION_STRESS_ASSUMPTION} from './correlation-stress.js';

/** Pre-registered offline regimes. Never open validation/holdout to select thresholds. */
const windows=[
 {label:'May 2021 crash',from:'2021-04-01',to:'2021-08-01'},
 {label:'June 2022 stress',from:'2022-05-01',to:'2022-08-01'},
 {label:'November 2022 stress',from:'2022-10-01',to:'2023-02-01'}
] as const;
async function main(){
 if(process.env.LIVE_ENABLED==='true')throw Error('Risk comparison must run with LIVE_ENABLED=false');
 const archive=new ArchiveCandleSource();
 try{
  // Fixed BTC/ETH universe; use Binance's archived public OHLC observations.
  const source:CandleSource={
   listSymbols:async()=>['BTC/USDT','ETH/USDT'],
   getCandles:(pair,interval,from,to)=>archive.getCandles(
    pair==='BTC/USDT'?'BTCUSDT':pair==='ETH/USDT'?'ETHUSDT':pair,interval,from,to)
  };
  const observations=[];
  for(const window of windows){
   const common:BacktestOptions={source,strategy:'rules',
    fromMs:Date.parse(window.from+'T00:00:00Z'),toMs:Date.parse(window.to+'T00:00:00Z'),
    intervalMinutes:60,venue:'binance',quoteCurrency:'USDT',
    initialCash:1000,feeRate:.001,spreadBps:10,slippageBps:8,seed:1,
    fillModel:'conservative-ohlc',riskHistoryWarmup:true};
   const baseline=await runBacktest({...common,enablePortfolioRisk:false});
   const protectedRun=await runBacktest({...common,enablePortfolioRisk:true});
   if(baseline.fingerprints.data!==protectedRun.fingerprints.data)
    throw Error('Risk and baseline used different candle observations');
   observations.push({
    ...window,dataHash:baseline.fingerprints.data,
    baseline:{netReturn:baseline.metrics.netReturn,maxDrawdown:baseline.metrics.maxDrawdown,
     sharpe:baseline.metrics.sharpe,calmar:baseline.metrics.calmar,trades:baseline.metrics.tradeCount},
    risk:{netReturn:protectedRun.metrics.netReturn,maxDrawdown:protectedRun.metrics.maxDrawdown,
     sharpe:protectedRun.metrics.sharpe,calmar:protectedRun.metrics.calmar,trades:protectedRun.metrics.tradeCount,
     rejected:protectedRun.metrics.rejectedOrders},
    // BacktestResult currently holds aggregate equity/trades, not point-in-time
    // per-asset portfolio weights with 60 aligned daily returns. Never infer them
    // from the final positions or fabricate a correlation stress result.
    correlationStress:{
     version:CORRELATION_STRESS_ASSUMPTION.version,
     status:'insufficient_evidence',
     reason:'Per-asset historical positions and 60 aligned closed daily return vectors were not supplied; no tail/correlation claim.'
    }
   });
  }
  const path=resolve(projectRoot,'data/backtests/portfolio-risk-regimes-2021-2022.json');
  mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,JSON.stringify({researchOnly:true,windows:observations,
   interpretation:'Historical replay, not independent validation, no profit claim',
   generatedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({path,regimes:observations},null,2)+'\n');
 }finally{archive.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
