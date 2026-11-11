import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import type {MarketFeed} from '../market/types.js';
import type {PaperExecutionAdapter} from '../broker/PaperExecutionAdapter.js';
import {dcaPeriod,depositPaperCash,finalisePaperDcaDecision,initPaperDcaLedger,
 loadPaperDcaSettings,paperDcaBudget,paperSma200,reservePaperDcaDecision} from './paper.js';

export async function runPaperDca(sqlite:Database.Database,broker:PaperExecutionAdapter,market:MarketFeed,
 quoteCurrency:string,now=Date.now(),env:NodeJS.ProcessEnv=process.env) {
 if(env.LIVE_ENABLED==='true')throw Error('DCA is paper-only: LIVE_ENABLED must not be true');
 const config=loadPaperDcaSettings(env),period=dcaPeriod(now,config.interval);
 initPaperDcaLedger(sqlite);
 const wasDeposited=depositPaperCash(sqlite,'dca',period,config.amount,now);
 if(!reservePaperDcaDecision(sqlite,period,config.variant,now))
  return {period,deposited:wasDeposited,status:'already-processed' as const};
 const pairs={btc:'BTC/'+quoteCurrency,eth:'ETH/'+quoteCurrency};
 try{
  const account=sqlite.prepare('SELECT cash FROM accounts WHERE id=?').get('dca') as {cash:number}|undefined;
  if(!account)throw Error('DCA paper account missing');
  const history=config.variant==='classic'?null:paperSma200(sqlite,pairs.btc,now);
  const trend=history?history.previousClose>history.sma:null;
  const budget=paperDcaBudget(config,wasDeposited?config.amount:0,account.cash,trend);
  if(budget===null){
   finalisePaperDcaDecision(sqlite,period,'history-missing','200 fully closed daily BTC candles unavailable; cash parked');
   return {period,deposited:wasDeposited,status:'history-missing' as const};
  }
  if(budget<=0){
   finalisePaperDcaDecision(sqlite,period,'parked','Trend variant intentionally retains simulated cash');
   return {period,deposited:wasDeposited,status:'parked' as const};
  }
  let successful=0,attempted=0;
  const reasons:string[]=[];
  for(const [pair,fraction] of [[pairs.btc,config.allocation.btc],[pairs.eth,config.allocation.eth]] as const){
   if(fraction===0)continue;
   attempted++;
   const amount=budget*fraction;
   if(!market.books.get(pair)?.valid||!market.connected){
    reasons.push(pair+': market data missing');continue;
   }
   const result=await broker.placeMarketOrder({
    accountId:'dca',pair,side:'buy',amountEur:amount,stopLossPct:.05,
    reason:'DCA '+config.variant+' paper-only '+period,
    decisionId:randomUUID()
   });
   if(result.ok)successful++;else reasons.push(pair+': '+result.reason);
  }
  const status=successful===attempted&&successful>0?'filled':successful>0?'partial':'not-filled';
  finalisePaperDcaDecision(sqlite,period,status,reasons.join('; ')||'Paper fills recorded by broker');
  return {period,deposited:wasDeposited,status};
 }catch(error){
  finalisePaperDcaDecision(sqlite,period,'not-filled',error instanceof Error?error.message.slice(0,1000):'Unexpected error');
  throw error;
 }
}
