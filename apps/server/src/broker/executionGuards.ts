export type EntryLimits={maxSpreadBps:number;maxSlippageBps:number};
/** Applies to entries only. Protective exits must not wait for favourable costs. */
export function entryQuoteGuard(bid:number,ask:number,limits:EntryLimits){
 if(![bid,ask,limits.maxSpreadBps,limits.maxSlippageBps].every(Number.isFinite)||bid<=0||ask<bid||limits.maxSpreadBps<0||limits.maxSlippageBps<0)return {allowed:false,reason:'Ungültiger Einstiegskurs oder Kostenlimit',spreadBps:null};
 const spreadBps=(ask-bid)/((ask+bid)/2)*10000;
 return {allowed:spreadBps<=limits.maxSpreadBps+1e-8,reason:spreadBps>limits.maxSpreadBps+1e-8?'Einstiegsspread überschreitet hartes Kostenlimit':'Spread freigegeben',spreadBps};
}
export function entryFillGuard(fill:number,decisionMid:number,limits:EntryLimits){
 if(!Number.isFinite(fill)||!Number.isFinite(decisionMid)||fill<=0||decisionMid<=0||!Number.isFinite(limits.maxSlippageBps)||limits.maxSlippageBps<0)return {allowed:false,reason:'Ungültiger Ausführungskurs oder Slippage-Limit',slippageBps:null};
 const slippageBps=(fill/decisionMid-1)*10000;
 return {allowed:slippageBps<=limits.maxSlippageBps+1e-8,reason:slippageBps>limits.maxSlippageBps+1e-8?'Ausführung überschreitet hartes Slippage-Limit':'Slippage freigegeben',slippageBps};
}
