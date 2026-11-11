import type {Candle} from '@paper/shared';
import {diagnosticCostFactors,type DiagnosticCosts} from './local-learning.js';
import {canonicalJson} from './dataset.js';
import {digest} from '../provenance/build.js';
const STEP=900000;
export type BarrierTarget={dataScope:string;horizonBars:number;stopLossPct:number;takeProfitPct:number;costs:DiagnosticCosts};
export type BarrierOutcome={version:'first-barrier-outcome-v1';targetHash:string;entryAt:number;availableAt:number;eventBarTs:number;outcome:'stop'|'target'|'timeout'|'ambiguous';execution:'gap-open'|'barrier'|'horizon-close'|'unknown-path';entryFill:number;entryBasis:number;stopPrice:number;targetPrice:number;exitReference:number|null;netReturn:number|null};
export function barrierTargetHash(t:BarrierTarget):string{
 diagnosticCostFactors(t.costs);
 if(!/^[a-f0-9]{64}$/.test(t.dataScope)||!Number.isSafeInteger(t.horizonBars)||t.horizonBars<1||t.horizonBars>96||!Number.isFinite(t.stopLossPct)||t.stopLossPct<.02||t.stopLossPct>.15||!Number.isFinite(t.takeProfitPct)||t.takeProfitPct<.03||t.takeProfitPct>.4)throw Error('Invalid barrier target');
 return digest(canonicalJson({version:'first-barrier-outcome-v1',...t,entry:'candle-open',stopBasis:'fee-inclusive',targetBasis:'fill',ambiguous:'unknown',gapTarget:'conservative-target',maturity:'full-horizon-close'}));
}
/** Offline labels only: no observed book/latency/depth, variable strategy exit or executable fill claim. */
export function firstBarrierOutcome(pair:string,bars:readonly Candle[],entryAt:number,asOf:number,t:BarrierTarget):BarrierOutcome|null{
 const targetHash=barrierTargetHash(t),end=entryAt+t.horizonBars*STEP;
 if(typeof pair!=='string'||!pair||![entryAt,asOf,end].every(n=>Number.isSafeInteger(n)&&n>=0)||entryAt%STEP)throw Error('Invalid barrier clock');
 if(asOf<end)return null;
 const path=bars.filter(b=>b.ts>=entryAt&&b.ts<end).sort((a,b)=>a.ts-b.ts);
 if(path.some((b,i)=>b.pair!==pair||b.interval!==15||b.ts%STEP||!Number.isSafeInteger(b.ts)||i>0&&b.ts===path[i-1]!.ts||![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.low<=0||b.volume<0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)))throw Error('Invalid barrier candle');
 if(path.length!==t.horizonBars||path.some((b,i)=>b.ts!==entryAt+i*STEP))return null;
 const factors=diagnosticCostFactors(t.costs),entryBasis=path[0]!.open*factors.entry,entryFill=entryBasis/(1+t.costs.feeRate),stopPrice=entryBasis*(1-t.stopLossPct),targetPrice=entryFill*(1+t.takeProfitPct);
 if(![entryBasis,entryFill,stopPrice,targetPrice].every(n=>Number.isFinite(n)&&n>0)||stopPrice>=targetPrice)throw Error('Unbounded barrier geometry');
 const result=(b:Candle,outcome:BarrierOutcome['outcome'],execution:BarrierOutcome['execution'],exitReference:number|null):BarrierOutcome=>{
  const netReturn=exitReference===null?null:exitReference*factors.exit/entryBasis-1;
  if(netReturn!==null&&!Number.isFinite(netReturn))throw Error('Unbounded barrier return');
  return {version:'first-barrier-outcome-v1',targetHash,entryAt,availableAt:end,eventBarTs:b.ts,outcome,execution,entryFill,entryBasis,stopPrice,targetPrice,exitReference,netReturn};
 };
 for(const b of path){
  if(b.open<=stopPrice)return result(b,'stop','gap-open',b.open);
  if(b.open>=targetPrice)return result(b,'target','barrier',targetPrice);
  const stop=b.low<=stopPrice,target=b.high>=targetPrice;
  if(stop&&target)return result(b,'ambiguous','unknown-path',null);
  if(stop)return result(b,'stop','barrier',stopPrice);
  if(target)return result(b,'target','barrier',targetPrice);
 }
 return result(path.at(-1)!,'timeout','horizon-close',path.at(-1)!.close);
}
