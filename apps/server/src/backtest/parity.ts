import type Database from 'better-sqlite3';
import type {Action} from '@paper/shared';
import type {BacktestResult} from './runner.js';
export type ParityReport={
  status:'compared'|'unavailable';reason?:string;paperDecisions:number;matchedDecisions:number;identicalDecisions:number;decisionAgreementPct:number|null;
  comparedFills:number;averageAbsoluteFillBps:number|null;maxAbsoluteFillBps:number|null;
  paperRealizedPnl:number;backtestRealizedPnl:number;pnlDifference:number;
  causes:Record<'orderbook-vs-synthetic-spread'|'latency'|'data-gap',number>;
  targetMet:boolean|null;
};
const actionType=(actions:Action[],symbol:string)=>actions.find(a=>a.type!=='hold'&&a.pair===symbol)?.type??'hold';
export type PaperDecision={ts:number;actions:Action[]};
export type PaperTrade={symbol:string;side:'buy'|'sell';decisionTs:number;fillPrice:number;realizedPnl:number|null;latencyMs:number};
/** Compare exactly the same symbol/closed-candle clock, including hold decisions and missing clocks. */
export function comparePaper(result:BacktestResult,paperDecisions:readonly PaperDecision[],paperTrades:readonly PaperTrade[]):ParityReport {
  const step=result.configuration.intervalMinutes*60000;
  const align=(ts:number)=>Math.floor(ts/step)*step;
  const simByTime=new Map(result.decisions.map(d=>[d.ts,d]));
  let matched=0,identical=0;
  const causes:ParityReport['causes']={'orderbook-vs-synthetic-spread':0,latency:0,'data-gap':0};
  for(const p of paperDecisions){
    const sim=simByTime.get(align(p.ts));
    if(!sim){causes['data-gap']++;continue;}
    for(const symbol of result.universe){
      matched++;
      if(actionType(p.actions,symbol)===actionType(sim.actions,symbol))identical++;
    }
  }
  const simulated=new Map<string,typeof result.trades[number][]>();
  for(const trade of result.trades){
    const key=[trade.symbol,trade.side,trade.decisionTs].join('|');
    const list=simulated.get(key)??[];list.push(trade);simulated.set(key,list);
  }
  const differences:number[]=[];
  for(const p of paperTrades){
    const key=[p.symbol,p.side,align(p.decisionTs)].join('|');
    const sim=simulated.get(key)?.shift();
    if(!sim){causes['data-gap']++;continue;}
    const bps=(p.fillPrice/sim.price-1)*10000;
    differences.push(Math.abs(bps));
    if(Math.abs(bps)>.01)causes['orderbook-vs-synthetic-spread']++;
    if(p.latencyMs>0)causes.latency++;
  }
  const realPaper=paperTrades.reduce((s,t)=>s+(t.realizedPnl??0),0);
  const realSim=result.trades.reduce((s,t)=>s+(t.realizedPnl??0),0);
  const total=paperDecisions.length*result.universe.length;
  const agreement=total?identical/total*100:null;
  return {status:total?'compared':'unavailable',reason:total?undefined:'No locally recorded Paper decisions for this period/account',
    paperDecisions:total,matchedDecisions:matched,identicalDecisions:identical,decisionAgreementPct:agreement,
    comparedFills:differences.length,averageAbsoluteFillBps:differences.length?differences.reduce((s,n)=>s+n,0)/differences.length:null,
    maxAbsoluteFillBps:differences.length?Math.max(...differences):null,
    paperRealizedPnl:realPaper,backtestRealizedPnl:realSim,pnlDifference:realSim-realPaper,causes,targetMet:agreement===null?null:agreement>=95};
}
export function compareSqlitePaper(db:Database.Database,result:BacktestResult):ParityReport {
  const strategy=result.configuration.strategy;
  const raws=db.prepare('SELECT ts,actions_json FROM decisions WHERE account_id=? AND ts>=? AND ts<=? ORDER BY ts')
    .all(strategy,result.configuration.fromMs,result.configuration.toMs) as Array<{ts:number;actions_json:string|null}>;
  const decisions:PaperDecision[]=raws.map(row=>{
    let actions:Action[]=[];try{const parsed=JSON.parse(row.actions_json??'[]') as unknown;if(Array.isArray(parsed))actions=parsed as Action[];}catch{/* invalid decisions count as holds and appear as mismatch */}
    return {ts:row.ts,actions};
  });
  const trades=db.prepare('SELECT t.pair as symbol,t.side,t.fill_price as fillPrice,t.realized_pnl_eur as realizedPnl,t.latency_ms as latencyMs,d.ts as decisionTs FROM trades t LEFT JOIN decisions d ON d.id=t.decision_id WHERE t.account_id=? AND t.ts>=? AND t.ts<=? ORDER BY t.ts')
    .all(strategy,result.configuration.fromMs,result.configuration.toMs) as Array<{symbol:string;side:'buy'|'sell';fillPrice:number;realizedPnl:number|null;latencyMs:number;decisionTs:number|null}>;
  return comparePaper(result,decisions,trades.map(t=>({...t,decisionTs:t.decisionTs??result.configuration.fromMs})));
}
