import type {ReplayStudy,ReplayCausalMarket} from './portfolio.js';
import {parseClosedPublicActivity} from './public-activity.js';
import {publicActivityAtDecision} from './executed-activity-availability.js';
import {digest} from '../provenance/build.js';import {canonicalJson} from './dataset.js';
export type ActivityCaptureBody={version:'public-activity-envelope-v1';source:'binance-public-spot-klines';pair:string;closedAt:number;capturedAt:number;requestUrl:string;captureFactsHash:string;raw:unknown};
export type ActivityCapture=ActivityCaptureBody&{hash:string};
function validBody(b:ActivityCaptureBody){
 if(!b||b.version!=='public-activity-envelope-v1'||b.source!=='binance-public-spot-klines'||!(/^[a-f0-9]{64}$/).test(b.captureFactsHash))return false;
 try{const u=new URL(b.requestUrl),params={symbol:b.pair.replace('/',''),interval:'15m',startTime:String(b.closedAt-96*900000),endTime:String(b.closedAt-1),limit:'96'};
  return u.protocol==='https:'&&u.hostname==='data-api.binance.vision'&&!u.port&&!u.username&&!u.password&&!u.hash&&u.pathname==='/api/v3/klines'&&[...u.searchParams].length===5&&Object.entries(params).every(([k,v])=>u.searchParams.get(k)===v)&&parseClosedPublicActivity(b.pair,b.raw,b.closedAt,b.capturedAt).complete;
 }catch{return false;}
}
/** Hash binds caller-verified capture provenance to exact raw payload and clocks; no network access. */
export function sealActivityCapture(body:ActivityCaptureBody):ActivityCapture{
 const copy=structuredClone(body);if(!validBody(copy))throw Error('Invalid public activity capture envelope');return {...copy,hash:digest(canonicalJson(copy))};
}
function evidence(capture:ActivityCapture,pair:string,markets:ReplayCausalMarket[],asOf:number){
 const deny=(reason:string)=>({available:false as const,reason,asOf,summary:null});
 try{
  const {hash,...body}=capture;if(body.pair!==pair||!validBody(body)||digest(canonicalJson(body))!==hash)return deny('invalid-or-modified-capture-envelope');
  const result=publicActivityAtDecision(pair,body.raw,body.closedAt,body.capturedAt,asOf);if(!result.available)return {...result,asOf};
  const routes=markets.filter(m=>m.pair===pair);if(routes.length!==1)return deny('missing-or-conflicting-causal-market');
  const rows=routes[0]!.candles.filter(b=>b.ts>=body.closedAt-96*900000&&b.ts<body.closedAt).sort((a,b)=>a.ts-b.ts),parsed=parseClosedPublicActivity(pair,body.raw,body.closedAt,body.capturedAt);
  if(!parsed.complete||canonicalJson(rows)!==canonicalJson(parsed.bars.map(b=>b.candle)))return deny('capture-and-causal-ohlcv-disagree');
  return {...result,asOf,captureHash:hash,captureFactsHash:body.captureFactsHash,source:body.source};
 }catch{return deny('invalid-or-modified-capture-envelope');}
}
/** Opt-in only. Existing frames/features/policy/callbacks stay intact; uncaptured pairs remain explicit unknown. */
export function executedActivityReplayStudy(base:ReplayStudy,captures:readonly ActivityCapture[]):ReplayStudy{
 return {...base,enrich:(context,markets)=>{
  const c=base.enrich(context,markets),asOf=Date.parse(c.timeUTC),mc=c.marketContext as {markets?:Record<string,any>[]} | undefined,execution=c.execution as {mode?:string;venue?:string} | undefined;
  if(!mc||!Array.isArray(mc.markets))throw Error('Research market context unavailable');
  return {...c,marketContext:{...mc,markets:mc.markets.map(frame=>{
   const deny=(reason:string)=>({available:false,reason,asOf,summary:null});const matches=captures.filter(x=>x?.pair===frame.pair);
   const value=!Number.isSafeInteger(asOf)?deny('invalid-decision-clock'):execution?.mode!=='paper'||execution.venue!=='binance'||frame.source!=='synthetic-binance'?deny('incompatible-research-venue'):mc.markets!.filter(f=>f.pair===frame.pair).length!==1?deny('conflicting-market-frames'):matches.length!==1?deny(matches.length?'conflicting-capture-envelopes':'public-capture-unavailable'):evidence(matches[0]!,frame.pair,markets,asOf);
   return {...frame,executedActivity:value};
  })}};
 }};
}
