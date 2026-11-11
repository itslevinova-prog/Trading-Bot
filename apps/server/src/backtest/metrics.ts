import {mean,deviation,deflatedSharpe,probabilityOfBacktestOverfitting,maxDrawdown} from './stats.js';
import type {SimulatedTrade} from './simulated-broker.js';
export type EquityPoint={ts:number;equity:number;exposed:boolean};
export type DailyPoint={day:string;ts:number;equity:number;drawdown:number};
export function dailyEquity(points:readonly EquityPoint[]):DailyPoint[] {
  const last=new Map<string,EquityPoint>();
  for(const p of [...points].sort((a,b)=>a.ts-b.ts)){
    if(!Number.isFinite(p.equity)||p.equity<=0)throw Error('Invalid equity point');
    last.set(new Date(p.ts).toISOString().slice(0,10),p);
  }
  let peak=0;
  return [...last.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([day,p])=>{
    peak=Math.max(peak,p.equity);return {day,ts:p.ts,equity:p.equity,drawdown:peak>0?(peak-p.equity)/peak:0};
  });
}
export const dailyReturns=(days:readonly DailyPoint[])=>days.slice(1).map((d,i)=>d.equity/days[i]!.equity-1);
export interface PerformanceMetrics {
  netReturn:number;cagr:number|null;volatility:number|null;sharpe:number|null;sortino:number|null;
  maxDrawdown:number;longestDrawdownDays:number;calmar:number|null;worstMonth:number|null;
  winRate:number|null;payoffRatio:number|null;turnover:number;costShare:number|null;exposureTime:number;tradesPerYear:number;
  deflatedSharpeProbability:number|null;pbo:number|null;tradeCount:number;rejectedOrders:number;
}
export function calculateMetrics(points:readonly EquityPoint[],trades:readonly SimulatedTrade[],start:number,end:number,trials=1,variants?:readonly (readonly number[])[],rejectedOrders=0):{metrics:PerformanceMetrics;daily:DailyPoint[];returns:number[]} {
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('Invalid backtest period');
  const daily=dailyEquity(points),returns=dailyReturns(daily),days=(end-start)/86400000;
  const initial=points[0]?.equity??0,final=points.at(-1)?.equity??initial;
  if(initial<=0)throw Error('Missing initial equity');
  const netReturn=final/initial-1,cagr=days>0?Math.pow(final/initial,365/days)-1:null;
  const vol=deviation(returns,true),downside=Math.sqrt(mean(returns.map(r=>Math.min(0,r)**2)));
  const sharpe=returns.length>1&&vol>0?mean(returns)/vol*Math.sqrt(365):null;
  const sortino=returns.length>1&&downside>0?mean(returns)/downside*Math.sqrt(365):null;
  const drawdown=maxDrawdown(points.map(p=>p.equity));
  let lastPeakDay=0,longest=0,peak=0;
  daily.forEach((d,i)=>{if(d.equity>=peak){peak=d.equity;lastPeakDay=i;}else longest=Math.max(longest,(d.ts-daily[lastPeakDay]!.ts)/86400000);});
  const months=new Map<string,{first:number;last:number}>();
  for(const d of daily){const key=d.day.slice(0,7),m=months.get(key);if(!m)months.set(key,{first:d.equity,last:d.equity});else m.last=d.equity;}
  const worstMonth=months.size?Math.min(...[...months.values()].map(m=>m.last/m.first-1)):null;
  const closed=trades.filter(t=>t.side==='sell'&&t.realizedPnl!==null);
  const winning=closed.filter(t=>t.realizedPnl!>0).map(t=>t.realizedPnl!);
  const losing=closed.filter(t=>t.realizedPnl!<0).map(t=>-t.realizedPnl!);
  const fees=trades.reduce((s,t)=>s+t.fee,0),executionCosts=trades.reduce((s,t)=>s+t.spreadCost+t.slippageCost,0);
  const grossPnL=(final-initial)+fees+executionCosts;
  const turnover=trades.reduce((s,t)=>s+t.notional,0)/Math.max(1,mean(points.map(p=>p.equity)));
  const exposureTime=points.length>1?points.slice(1).filter(p=>p.exposed).length/(points.length-1):0;
  return {daily,returns,metrics:{
    netReturn,cagr,volatility:returns.length>1?vol*Math.sqrt(365):null,sharpe,sortino,maxDrawdown:drawdown,longestDrawdownDays:longest,
    calmar:cagr!==null&&drawdown>0?cagr/drawdown:null,worstMonth,
    winRate:closed.length?winning.length/closed.length:null,
    payoffRatio:winning.length&&losing.length?mean(winning)/mean(losing):null,
    turnover,costShare:grossPnL>0?(fees+executionCosts)/grossPnL:null,
    exposureTime,tradesPerYear:trades.length/days*365,
    deflatedSharpeProbability:deflatedSharpe(returns,trials),
    pbo:variants?probabilityOfBacktestOverfitting(variants):null,
    tradeCount:trades.length,rejectedOrders
  }};
}
