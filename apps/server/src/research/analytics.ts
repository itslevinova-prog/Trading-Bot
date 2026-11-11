/** Metrics for the read-only paper-trading dashboard; never changes strategy or orders. */
export type AnalyticsTrade={side:string;feeEur:number;realizedPnlEur:number|null;slippageBps:number;costEur:number;ts:number};
export type AnalyticsEquity={ts:number;equity:number};
export type AccountAnalytics={trades:number;closedTrades:number;winRatePct:number|null;profitFactor:number|null;realizedPnlEur:number;feesEur:number;turnoverEur:number;avgSlippageBps:number|null;maxDrawdownPct:number|null;currentDrawdownPct:number|null;largestLossEur:number|null;dataPoints:number;insufficientSample:boolean;};
const round=(value:number)=>Math.round(value*1e6)/1e6;
export function computeAccountAnalytics(trades:AnalyticsTrade[],snapshots:AnalyticsEquity[],currentEquity?:number|null):AccountAnalytics{
 const sells=trades.filter(t=>t.side==='sell'&&t.realizedPnlEur!==null);
 const wins=sells.filter(t=>t.realizedPnlEur!>0),losses=sells.filter(t=>t.realizedPnlEur!<0);
 const sumWins=wins.reduce((s,t)=>s+t.realizedPnlEur!,0),sumLosses=-losses.reduce((s,t)=>s+t.realizedPnlEur!,0);
 const curve=[...snapshots].sort((a,b)=>a.ts-b.ts).map(s=>s.equity).filter(v=>Number.isFinite(v)&&v>=0);
 if(typeof currentEquity==='number'&&Number.isFinite(currentEquity)&&currentEquity>=0)curve.push(currentEquity);
 let peak=0,maxDrawdown=0;for(const value of curve){peak=Math.max(peak,value);maxDrawdown=Math.max(maxDrawdown,peak?(peak-value)/peak*100:0);}
 const allSells=trades.filter(t=>t.side==='sell');
 return {trades:trades.length,closedTrades:sells.length,winRatePct:sells.length?round(wins.length/sells.length*100):null,
 profitFactor:sumLosses>0?round(sumWins/sumLosses):null,realizedPnlEur:round(sells.reduce((s,t)=>s+(t.realizedPnlEur??0),0)),
 feesEur:round(trades.reduce((s,t)=>s+t.feeEur,0)),turnoverEur:round(trades.reduce((s,t)=>s+t.costEur,0)),
 avgSlippageBps:trades.length?round(trades.reduce((s,t)=>s+t.slippageBps,0)/trades.length):null,
 maxDrawdownPct:curve.length?round(maxDrawdown):null,currentDrawdownPct:currentEquity===null?null:curve.length?round(peak>0?(peak-curve[curve.length-1]!)/peak*100:0):null,
 largestLossEur:losses.length?round(Math.min(...losses.map(t=>t.realizedPnlEur!))):null,
 dataPoints:curve.length,insufficientSample:allSells.length<20};
}
