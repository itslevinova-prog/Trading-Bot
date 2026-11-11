import type {Candle} from '@paper/shared';
import {closedRangeRegime} from '../context/range-regime.js';
import {paperPayoff} from './paper-payoff.js';
export const RANGE_ENTRY_VERSION='range-reversion-setup-v1';
export type RangeEntryCosts={bid:number;ask:number;bookTs:number;feeRate:number;slippageBps:number;maxSpreadBps:number;maxStopLossPct:number};
/** Research SETUP only, not an Action/DecisionProvider: no portfolio, quantity or fill permission.
 * A future integration must retain covariance, account, depth, sizing and broker hard limits.
 * Neither a repeated range nor conditional positive payoff estimates a win probability. */
export function rangeReversionSetup(bars:Candle[],pair:string,now:number,costs:RangeEntryCosts){
 const regime=closedRangeRegime(bars,pair,now),reasons:string[]=[],result={version:RANGE_ENTRY_VERSION,regime,eligibleSetup:false,reasons,stopLossPct:null as number|null,takeProfitPct:null as number|null,payoff:null as ReturnType<typeof paperPayoff>|null,estimatedWinProbability:null,expectedValue:null,performanceValidated:false,requiresFullPaperBrokerValidation:true};
 if(!regime.complete||regime.strategyFamily!=='range-reversion-research'){reasons.push('no-confirmed-range-reversion-setup');return result;}
 const {bid,ask,bookTs,feeRate,slippageBps,maxSpreadBps,maxStopLossPct}=costs;
 if(![bid,ask,bookTs,feeRate,slippageBps,maxSpreadBps,maxStopLossPct].every(Number.isFinite)||bid<=0||ask<bid||!Number.isSafeInteger(bookTs)||bookTs>now||now-bookTs>5000||feeRate<0||feeRate>.05||slippageBps<0||slippageBps>1000||maxSpreadBps<0||maxStopLossPct<.02||maxStopLossPct>.15){reasons.push('unknown-invalid-or-stale-cost-and-book-inputs');return result;}
 if((ask/bid-1)*10000>maxSpreadBps)reasons.push('spread-over-hard-limit');
 const priorAtr=regime.priorAtr!,fill=ask*(1+slippageBps/10000),basis=fill*(1+feeRate);
 if(Math.abs(ask/regime.signalClose!-1)>Math.max(.02,2*priorAtr/regime.signalClose!))reasons.push('price-dislocated-from-closed-setup');
 // Stop must lie at least one preceding-window ATR below support; never clip it upward
 // to manufacture affordable risk. Target is the observed preceding resistance, not 2R.
 const stop=Math.max(.02,2*priorAtr/basis,1-(regime.priorSupport!-priorAtr)/basis),target=regime.priorResistance!/fill-1;
 if(!Number.isFinite(stop)||stop>maxStopLossPct)reasons.push('structural-or-volatility-stop-exceeds-selected-limit');
 if(!Number.isFinite(target)||target<.03||target>.4)reasons.push('observed-range-target-outside-supported-distance');
 if(reasons.length)return result;
 result.stopLossPct=stop;result.takeProfitPct=target;
 try{result.payoff=paperPayoff({bid,ask,feeRate,slippageBps,stopLossPct:stop,takeProfitPct:target});}catch{reasons.push('invalid-payoff-scenario');return result;}
 if(!result.payoff.positiveNetReward||result.payoff.netRewardRisk<1.5){reasons.push('range-reward-insufficient-after-costs');return result;}
 result.eligibleSetup=true;reasons.push('conditional-range-payoff-clears-research-floor-not-an-order');return result;
}
