import type {BrokerOrder} from '@paper/shared';
export interface RiskState{equity:number;cash:number;status:string;positions:{pair:string;value:number;stopRisk?:number}[];tradesToday:number;lastSellAt?:number;now:number;special?:boolean;}
export interface RiskLimits{maxPositionPct:number;maxOpenPositions:number;maxTradesPerDay:number;cooldownMinutes:number;maxPortfolioRiskPct?:number;feeRate?:number;}
export function positionStopRisk(qty:number,bid:number,stopPrice:number|null,feeRate:number,minExitQuote=0):number{
 if(![qty,bid,feeRate,minExitQuote].every(Number.isFinite)||qty<0||bid<=0||feeRate<0||minExitQuote<0)return Infinity;
 const value=qty*bid;
 // A breached or non-executable stop is not a remaining loss guarantee.
 if(stopPrice===null||!Number.isFinite(stopPrice)||stopPrice<=0||bid<=stopPrice||qty*stopPrice<minExitQuote)return value*(1+feeRate);
 return Math.max(0,value-qty*stopPrice)+value*feeRate;
}
export function validateRisk(order:BrokerOrder,state:RiskState,limits:RiskLimits):{allowed:boolean;amountEur?:number;reason:string}{
 if(order.side==='sell')return {allowed:true,reason:'Verkauf freigegeben'};
 // Deterministic entry limits must not be bypassed by malformed replay/account/config state.
 const integer=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
 const fraction=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;
 const validPositions=Array.isArray(state.positions)&&state.positions.every(p=>p&&typeof p.pair==='string'&&p.pair.length>0&&Number.isFinite(p.value)&&p.value>=0);
 if(order.side!=='buy'||!validPositions||new Set(state.positions.map(p=>p.pair)).size!==state.positions.length||
  !integer(state.tradesToday)||!integer(state.now)||
  (state.lastSellAt!==undefined&&(!integer(state.lastSellAt)||state.lastSellAt>state.now))||
  !fraction(limits.maxPositionPct)||!integer(limits.maxOpenPositions)||!integer(limits.maxTradesPerDay)||
  !Number.isFinite(limits.cooldownMinutes)||limits.cooldownMinutes<0||
  (limits.maxPortfolioRiskPct!==undefined&&!fraction(limits.maxPortfolioRiskPct))||
  (limits.feeRate!==undefined&&(!fraction(limits.feeRate)||limits.feeRate===1)))
  return {allowed:false,reason:'Ungültiger Risiko-, Positions- oder Zeitvertrag'};

 if(![state.equity,state.cash,state.tradesToday,state.now,limits.maxPositionPct,limits.maxOpenPositions,limits.maxTradesPerDay,limits.cooldownMinutes,order.amountEur].every(n=>typeof n==='number'&&Number.isFinite(n))||state.equity<=0||state.cash<0||(order.amountEur??0)<=0||state.positions.some(p=>!Number.isFinite(p.value)||p.value<0))return {allowed:false,reason:'Ungültige Konto-, Order- oder Risikodaten'};
 if(state.status!=='active')return {allowed:false,reason:'Konto pausiert oder inaktiv'};
 if(state.tradesToday>=limits.maxTradesPerDay)return {allowed:false,reason:'Tageslimit erreicht'};
 const old=state.positions.find(p=>p.pair===order.pair);if(!old&&state.positions.length>=limits.maxOpenPositions)return {allowed:false,reason:'Positionslimit erreicht'};
 if(state.lastSellAt!==undefined&&state.now-state.lastSellAt<limits.cooldownMinutes*60000)return {allowed:false,reason:'Cooldown nach Verkauf'};
 const cap=Math.max(0,state.equity*limits.maxPositionPct-(old?.value??0));
 let riskCap=Infinity;
 if(limits.maxPortfolioRiskPct!==undefined){
  const stop=order.stopLossPct??.05,fee=limits.feeRate??0;
  if(!Number.isFinite(stop)||stop<.02||stop>.15||!Number.isFinite(fee)||fee<0)return {allowed:false,reason:'Ungültiges Stop-/Kostenrisiko'};
  // Unprotected or unvalued positions consume their full value. Never assume zero risk.
  const used=state.positions.reduce((sum,p)=>sum+(typeof p.stopRisk==='number'&&Number.isFinite(p.stopRisk)&&p.stopRisk>=0?p.stopRisk:p.value),0);
  const remaining=state.equity*limits.maxPortfolioRiskPct-used;
  riskCap=Math.max(0,remaining)/(stop+2*fee);
  if(!Number.isFinite(riskCap)||riskCap<=0)return {allowed:false,reason:'Gesamtes Stop-Risikobudget erreicht'};
 }
 const proposed=Math.min(order.amountEur??0,state.cash,cap,riskCap);
 if(proposed<=0)return {allowed:false,reason:'Kein Positionsbudget verfügbar'};
 return {allowed:true,amountEur:proposed,reason:proposed<(order.amountEur??0)?'Kaufbetrag auf Positions-/Gesamtrisikobudget gekürzt':'Freigegeben'};
}
export function drawdown(equity:number,peak:number):number{return peak>0?Math.max(0,(peak-equity)/peak):0;}

/** Entry-only persisted high-water guard; exits remain authorized independently. */
export function entryDrawdownGuard(equity:number,peak:number,maxDrawdownPct:number):string|null{
 if(![equity,peak,maxDrawdownPct].every(Number.isFinite)||equity<0||peak<=0||maxDrawdownPct<0||maxDrawdownPct>1)return 'Drawdown-Bewertung oder Grenze ungültig; neue Einstiege gesperrt';
 return drawdown(equity,Math.max(equity,peak))>=maxDrawdownPct?'Drawdown-Grenze erreicht; neue Einstiege gesperrt':null;
}
