import type {Action,DecisionContext,DecisionProvider,DecisionResult} from '@paper/shared';
import {vector} from '../memory/math.js';import {forecastBarrierNet,type BarrierRidge} from './barrier-learning.js';
import {barrierTargetHash} from './first-barrier-outcome.js';
import {predictBarrierTree,type BarrierTree} from './barrier-tree.js';
import {entryQuoteGuard} from '../broker/executionGuards.js';
const STEP=900000,GRID=48*STEP;
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export type BarrierSchedule={testStart:number;testEnd:number;model:BarrierRidge;tree?:BarrierTree;selected:'zero'|'mean'|'ridge'|'tree'};
export type BarrierBrokerMode='zero'|'mean'|'ridge'|'tree'|'selected';
type Signal={pair:string;signalAt:number;entryAt:number;forecast:number|null;x:number[];modelHash:string;targetHash:string};
/** Research-only delayed-open adapter. It cannot read outcomes, a database or a financial account. */
export class BarrierBrokerProvider implements DecisionProvider{
 private schedule:BarrierSchedule[];private pending:Signal[]=[];private lastNow=-1;private evidence:unknown=null;private signals:Signal[]=[];
 constructor(schedule:readonly BarrierSchedule[],private mode:BarrierBrokerMode){
  if(!['zero','mean','ridge','tree','selected'].includes(mode)||!schedule.length)throw Error('Invalid barrier broker mode');
  this.schedule=structuredClone([...schedule]);
  for(let i=0;i<this.schedule.length;i++){const f=this.schedule[i]!;
   if(![f.testStart,f.testEnd].every(t=>Number.isSafeInteger(t)&&t>=0&&t%GRID===0)||f.testEnd<=f.testStart||i>0&&f.testStart<this.schedule[i-1]!.testEnd||!['zero','mean','ridge','tree'].includes(f.selected)||!f.model||f.model.ridge.trainedAt>f.testStart||forecastBarrierNet(f.model,f.model.ridge.means,f.testStart,f.model.target)===null||f.model.target.horizonBars!==32||f.model.target.stopLossPct!==.02||f.model.target.takeProfitPct!==.04)throw Error('Invalid, future or mismatched barrier schedule');
   if((mode==='tree'||f.selected==='tree')&&!f.tree)throw Error('Missing declared tree snapshot');
   if(f.tree&&(f.tree.trainedAt!==f.model.ridge.trainedAt||f.tree.lastLabelEnd!==f.model.ridge.lastLabelEnd||f.tree.knownLabels!==f.model.knownLabels||f.tree.ambiguousLabels!==f.model.ambiguousLabels||predictBarrierTree(f.tree,f.tree.means,f.testStart,f.model.target)===null))throw Error('Invalid, future or mismatched tree snapshot');
  }
 }
 getEvidence(){return this.evidence;}
 getSignalAudit(){return structuredClone(this.signals);}
 async decide(c:DecisionContext):Promise<DecisionResult>{
  const now=Date.parse(c.timeUTC),bar=now-5000,actions:Action[]=[],hold=(reason:string):DecisionResult=>({marketView:'Offline frozen costed-barrier research; no win probability or live model.',actions:[{type:'hold',confidence:0,reasoning:reason}]});
  if(!Number.isSafeInteger(bar)||bar<0||bar%STEP||!object(c.execution)||c.execution.mode!=='paper'||!object(c.execution.simulation)||c.execution.simulation.kind!=='ohlc-next-open-synthetic-book-v1'||c.execution.simulation.nominalDecisionDelayMs!==5000){this.pending=[];return hold('paper-replay-clock-required');}
  if(now<=this.lastNow){this.pending=[];return hold('duplicate-or-backward-clock');}this.lastNow=now;
  const held=c.positions.filter(object),account=object(c.account)?c.account:{},policy=object(c.tradingPolicy)?c.tradingPolicy:{};
  const markets=object(c.marketContext)&&Array.isArray(c.marketContext.markets)?c.marketContext.markets:[];
  const matching=(f:typeof c.features[number])=>{const matches=markets.filter((m:any)=>m?.pair===f.pair),m=matches[0];return matches.length===1&&object(m)&&m.asOf===now&&m.quality?.stale===false&&m.quality?.bookUsable===true&&m.quality?.bookAgeMs===0&&m.quality?.lastClosedAt===f.ts+STEP&&object(m.feature)&&Object.keys(f).every(k=>m.feature[k]===f[k as keyof typeof f]);};
  for(const p of held)if(typeof p.pair==='string'&&Number.isSafeInteger(p.openedAt)&&now>=p.openedAt+32*STEP)actions.push({type:'sell',pair:p.pair,sellFraction:1,confidence:.8,reasoning:'PAPER-RESEARCH fixed8h timeout; first available decision open, not guaranteed label-close price.'});
  const entrySignals=this.pending.filter(p=>p.entryAt===bar);this.pending=[];
  const fold=this.schedule.find(f=>bar>=f.testStart&&bar<f.testEnd);
  if(fold&&bar%GRID===0){
   const name=this.mode==='selected'?fold.selected:this.mode,dups=new Set(c.features.filter((f,i)=>c.features.findIndex(g=>g.pair===f.pair)!==i).map(f=>f.pair));
   for(const f of c.features){if(!matching(f)||dups.has(f.pair)||f.ts+STEP!==bar||!Number.isSafeInteger(f.ts)||f.price<=0||f.atrPct<=0||f.rsi14<0||f.rsi14>100)continue;const x=vector(f);if(x.length!==8||!Array.from(x).every(Number.isFinite))continue;
    const validModel=c.execution.simulation.spreadBps===fold.model.target.costs.spreadBps&&c.execution.simulation.slippageBps===fold.model.target.costs.slippageBps&&forecastBarrierNet(fold.model,fold.model.ridge.means,bar,fold.model.target)!==null;
    const forecast=!validModel?null:name==='zero'?0:name==='mean'?fold.model.ridge.intercept:name==='tree'?fold.tree?predictBarrierTree(fold.tree,x,bar,fold.model.target):null:forecastBarrierNet(fold.model,x,bar,fold.model.target);
    if(bar+STEP+32*STEP>fold.testEnd)continue;
    const row={pair:f.pair,signalAt:bar,entryAt:bar+STEP,forecast,x,modelHash:name==='tree'?fold.tree!.hash:fold.model.hash,targetHash:barrierTargetHash(fold.model.target)};this.pending.push(row);this.signals.push(structuredClone(row));
   }
  }
  this.evidence={version:'barrier-broker-provider-v1',mode:this.mode,asOf:now,entryCandidates:entrySignals.length,signalCount:this.signals.length,modelNotProbability:true};
  if(!entrySignals.length||held.length||account.status!=='active'||!Number.isFinite(account.equity)||account.equity<=0||!Number.isFinite(account.cash)||account.cash<=0||!object(account.valuation)||account.valuation.complete!==true||!Number.isFinite(policy.maxPositionPct)||policy.maxPositionPct<=0||!Number.isFinite(policy.stopLossPct)||policy.stopLossPct<.02)return actions.length?{marketView:'Offline timeout',actions}:hold('no-due-entry-or-portfolio-unavailable');
  for(const s of entrySignals.filter(s=>s.forecast!==null&&s.forecast>.005).sort((a,b)=>b.forecast!-a.forecast!||a.pair.localeCompare(b.pair))){
   const features=c.features.filter(f=>f.pair===s.pair),matches=markets.filter((m:any)=>m?.pair===s.pair),f=features[0],m=matches[0];
   if(features.length!==1||!f||f.ts+STEP!==bar||matches.length!==1||!object(m)||m.asOf!==now||m.quality?.stale!==false||m.quality?.bookUsable!==true||m.quality?.bookAgeMs!==0||m.quality?.lastClosedAt!==f.ts+STEP||!object(m.feature)||Object.keys(f).some(k=>m.feature[k]!==f[k as keyof typeof f]))continue;
   const bid=Number(m.microstructure?.bids?.[0]?.price),ask=Number(m.microstructure?.asks?.[0]?.price),fee=c.limits.TAKER_FEE_RATE;
   if(!Number.isFinite(fee)||!fold||fee!==fold.model.target.costs.feeRate||c.execution.simulation.spreadBps!==fold.model.target.costs.spreadBps||c.execution.simulation.slippageBps!==fold.model.target.costs.slippageBps||!entryQuoteGuard(bid,ask,{maxSpreadBps:c.limits.MAX_ENTRY_SPREAD_BPS!,maxSlippageBps:c.limits.MAX_ENTRY_SLIPPAGE_BPS!}).allowed)continue;
   const amountEur=Math.min(account.cash,account.equity*Math.min(.15,policy.maxPositionPct));if(!Number.isFinite(amountEur)||amountEur<=0||!Number.isFinite(Number(m.microstructure?.asks?.[0]?.qty))||Number(m.microstructure.asks[0].qty)*ask<amountEur||!Number.isFinite(Number(m.microstructure?.bids?.[0]?.qty))||Number(m.microstructure.bids[0].qty)*bid<amountEur)continue;
   actions.push({type:'buy',pair:s.pair,amountEur,stopLossPct:.02,takeProfitPct:.04,confidence:.8,reasoning:`PAPER-RESEARCH frozen net forecast ${s.forecast}; signal ${s.signalAt}, delayed15m entry; score0.8 uncalibrated, no profit established.`});break;
  }
  return actions.length?{marketView:'Frozen chronological costed-barrier research; deterministic broker limits remain authoritative.',actions}:hold('NO TRADE: no eligible positive net forecast');
 }
}
