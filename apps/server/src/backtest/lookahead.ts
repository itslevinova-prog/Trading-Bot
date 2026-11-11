import type {DecisionProvider} from '@paper/shared';
import {runBacktest,type BacktestOptions,type RecordedDecision} from './runner.js';
import type {CandleSource} from './candle-source.js';

/** A cut source cannot disclose bars closing after the decision cutoff, even if queried by a strategy. */
export function cutCandleSource(source:CandleSource,cutoff:number):CandleSource {
 if(!Number.isSafeInteger(cutoff)||cutoff<0)throw Error('Invalid look-ahead cutoff');
 return {
  listSymbols:()=>source.listSymbols(),
  getCandles:async(symbol,interval,from,to)=>{
   const capped=Math.min(to,cutoff);
   return from>=capped?[]:source.getCandles(symbol,interval,from,capped);
  }
 };
}
export type PerturbationOptions=Omit<BacktestOptions,'provider'> & {
 providerFactory:(source:CandleSource)=>DecisionProvider;
 cutoffs:readonly number[];
};
function signals(decisions:readonly RecordedDecision[]):string {
 // Only actions at identical closed-bar timestamps are evidence; ignore equity and profitability.
 return JSON.stringify(decisions.map(d=>({ts:d.ts,symbol:d.symbol,actions:d.actions})));
}
/** Fail on any decision that changes when future candles are removed. */
export async function verifyNoLookahead(options:PerturbationOptions):Promise<void> {
 const {providerFactory,cutoffs,...settings}=options;
 if(!cutoffs.length)throw Error('At least one look-ahead cutoff required');
 const full=await runBacktest({...settings,provider:providerFactory(settings.source)});
 for(const cutoff of cutoffs){
  if(!Number.isSafeInteger(cutoff)||cutoff<=settings.fromMs||cutoff>=settings.toMs||
    (cutoff-settings.fromMs)%(settings.intervalMinutes*60000)!==0)
   throw Error('Invalid look-ahead cutoff alignment');
  const source=cutCandleSource(settings.source,cutoff);
  const truncated=await runBacktest({...settings,source,toMs:cutoff,provider:providerFactory(source)});
  const expected=full.decisions.filter(d=>d.ts<=cutoff);
  if(signals(expected)!==signals(truncated.decisions))
   throw Error('Look-ahead perturbation failed at '+new Date(cutoff).toISOString()+
    ': strategy decisions changed when future bars were removed');
 }
}
/** Explicitly rejects a survivor-only/current-symbol selection used in a historical period. */
export function assertHistoricalUniverse(actual:readonly string[],expected:readonly string[]):void {
 if(new Set(actual).size!==actual.length||new Set(expected).size!==expected.length||
  JSON.stringify([...actual].sort())!==JSON.stringify([...expected].sort()))
  throw Error('Survivorship bias: selection differs from point-in-time universe');
}
