import type {ReplayStudy} from './portfolio.js';
import {closedDirectionalStrength} from '../context/directional-strength.js';

/** Opt-in research descriptor only. Keeps base policy, callbacks and existing features intact. */
export function directionalStrengthReplayStudy(base:ReplayStudy):ReplayStudy {
 return {...base,enrich:(context,markets)=>{
  const enriched=base.enrich(context,markets),asOf=Date.parse(enriched.timeUTC);
  const mc=enriched.marketContext as {markets?:Record<string,any>[]} | undefined;
  if(!mc||!Array.isArray(mc.markets))throw Error('Research market context unavailable');
  return {...enriched,marketContext:{...mc,markets:mc.markets.map(frame=>{
   const sources=markets.filter(m=>m.pair===frame.pair);
   // Conflicting routes must not silently pick the first available source.
   const candles=sources.length===1?sources[0]!.candles:[];
   return {...frame,regime:{...frame.regime,directionalStrength:closedDirectionalStrength(frame.pair,candles,asOf)}};
  })}};
 }};
}
