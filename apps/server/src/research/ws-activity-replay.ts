import type {ReplayStudy,ReplayCausalMarket} from './portfolio.js';
import type {WsActivityJournal} from '../market/ws-activity-journal.js';
import {actualWsActivityAtDecision} from '../market/ws-activity-window.js';

/** Research enrichment only: no model, prediction, entry permission or source backfill. */
export function nativeWsActivityReplayStudy(base:ReplayStudy,journal:WsActivityJournal):ReplayStudy{
 return {...base,enrich:(context,markets)=>{
  const c=base.enrich(context,markets),asOf=Date.parse(c.timeUTC);
  const mc=c.marketContext as {markets?:Record<string,any>[]} | undefined;
  const execution=c.execution as {mode?:string;venue?:string} | undefined;
  if(!mc||!Array.isArray(mc.markets))throw Error('Research market context unavailable');
  if(mc.markets.some(frame=>Object.hasOwn(frame,'executedActivity')))throw Error('Existing executed activity must not be overwritten');
  const frames=mc.markets;
  return journal.withSnapshot(()=>({...c,marketContext:{...mc,markets:frames.map(frame=>{
   const deny=(reason:string)=>({available:false as const,reason,asOf,summary:null});
   let value;
   if(!Number.isSafeInteger(asOf)||asOf<0)value=deny('invalid-decision-clock');
   else if(execution?.mode!=='paper'||execution.venue!=='binance'||frame.source!=='synthetic-binance')value=deny('incompatible-research-venue');
   else if(frames.filter(f=>f.pair===frame.pair).length!==1)value=deny('conflicting-market-frames');
   else value=nativeEvidence(journal,frame.pair,markets,asOf);
   return {...frame,executedActivity:value};
  })}}));
 }};
}
function nativeEvidence(journal:WsActivityJournal,pair:string,markets:ReplayCausalMarket[],asOf:number){
 const deny=(reason:string)=>({available:false as const,reason,asOf,summary:null});
 const matches=markets.filter(m=>m.pair===pair);
 if(matches.length!==1)return deny('missing-or-conflicting-causal-market');
 const candles=matches[0]!.candles;
 const h1=actualWsActivityAtDecision(journal,pair,asOf,4,candles);
 if(!h1.available)return deny(h1.reason);
 const h4=actualWsActivityAtDecision(journal,pair,asOf,16,candles);
 if(!h4.available)return deny(h4.reason);
 const h24=actualWsActivityAtDecision(journal,pair,asOf,96,candles);
 if(!h24.available)return deny(h24.reason);
 const windows={h1:h1.window,h4:h4.window,h24:h24.window};
 return {available:true as const,reason:null,asOf,source:'binance-public-native-ws' as const,
  summary:{version:'native-ws-executed-activity-v1',pair,closedAt:h24.window.closedAt,sourceComplete:true,
   windows:Object.fromEntries(Object.entries(windows).map(([key,w])=>[key,{...w.summary,expectedBars:w.expectedBars,complete:true,reason:null}])),
   scope:h24.window.scope},
  provenance:{firstCompleteAfter:h24.window.firstCompleteAfter,sourceHashes:Object.fromEntries(Object.entries(windows).map(([key,w])=>[key,w.sourceHash])),sessions:h24.window.sessions,sourceRows:h24.window.sourceRows},
  scope:'Research-only actual receipt-qualified evidence; complete96bar support required. Shared clocks are not independent samples. No REST/modelled activity substitution, inference or trading permission.'};
}
