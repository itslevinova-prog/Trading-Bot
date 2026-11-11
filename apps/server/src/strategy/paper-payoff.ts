/** Scenario arithmetic mirrors fee-inclusive paper stops and fill-based targets.
 * This gives the win rate REQUIRED to break even, never an estimated win probability. */
export function paperPayoff(input:{bid:number;ask:number;feeRate:number;slippageBps:number;stopLossPct:number;takeProfitPct:number}){
 const {bid,ask,feeRate:f,slippageBps,stopLossPct,takeProfitPct}=input;
 if(!Object.values(input).every(Number.isFinite)||bid<=0||ask<bid||f<0||f>.05||slippageBps<0||slippageBps>1000||stopLossPct<.02||stopLossPct>.15||takeProfitPct<.03||takeProfitPct>.4)throw Error('Invalid paper payoff inputs');
 const s=slippageBps/10000,entryFill=ask*(1+s),entryBasis=entryFill*(1+f),stopPrice=entryBasis*(1-stopLossPct),targetPrice=entryFill*(1+takeProfitPct),stopProceeds=stopPrice*(1-s)*(1-f),targetProceeds=targetPrice*(1-s)*(1-f),netReward=(targetProceeds-entryBasis)/entryBasis,netRisk=(entryBasis-stopProceeds)/entryBasis,markedExitProceeds=bid*(1-s)*(1-f),markedExitLoss=(entryBasis-markedExitProceeds)/entryBasis;
 if(![entryFill,entryBasis,stopPrice,targetPrice,netReward,netRisk,markedExitLoss].every(Number.isFinite)||netRisk<=0)throw Error('Unbounded paper payoff');
 return {version:'paper-payoff-v1',entryFill,entryBasis,stopPrice,targetPrice,netReward,netRisk,netRewardRisk:netReward/netRisk,markedExitLoss,breakEvenRequiredWinRate:netReward>0?netRisk/(netRisk+netReward):null,positiveNetReward:netReward>0,estimatedWinProbability:null,expectedValue:null,scope:'Conditional target/stop scenarios; costs/slippage are assumptions, no edge or calibrated probability established. Gaps can exceed the stop scenario.'};
}
