import {createHash} from 'node:crypto';
import type {DecisionContext,DecisionProvider} from '@paper/shared';
import {buildPositionEntrySnapshot,summarizePositionEntries} from '../context/position-entry.js';
import {covarianceReplayStudy} from './covariance-replay.js';
import type {MockReplayAssumptions} from './mock-replay-context.js';
import type {PortfolioOptions,ReplayStudy} from './portfolio.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
/** All receipt/capture clocks below are MODELLED historical clocks, not actual first observations.
 * Only confirmed fills create snapshots; rejected proposals never create a position origin. */
export function entrySupportReplayStudy(options:PortfolioOptions,assumptions:MockReplayAssumptions,provider:DecisionProvider,scope:string){
 if(!scope)throw Error('Explicit historical evaluation scope required');
 const base=covarianceReplayStudy(options,assumptions),entries=new Map<string,Record<string,any>[]>(),materializedAt=new Date().toISOString();
 const key=(pair:string,openedAt:number)=>JSON.stringify([pair,openedAt]);
 const study:ReplayStudy={...base,enrich:(context,markets)=>{
  const c=base.enrich(context,markets),now=Date.parse(c.timeUTC),accountId='replay-mock';
  return {...c,account:{...(c.account as Record<string,unknown>),id:accountId},execution:{...(c.execution as Record<string,unknown>),evaluationVersion:scope,runId:'historical-simulation:'+scope},positions:c.positions.map(raw=>{
   const p=raw as Record<string,any>,id=key(p.pair,p.openedAt),position={...p,id,accountId,pair:String(p.pair),qty:Number(p.qty),openedAt:p.openedAt+5000};
   return {...position,entryEvidence:summarizePositionEntries(entries.get(id)??[],position,now,scope)};
  })};
 },onBuyFill:event=>{
  const {context:c,action,position:p,fill:f,fillIndex}=event,asOf=Date.parse(c.timeUTC),accountId='replay-mock',id=key(p.pair,p.openedAt),rows=entries.get(id)??[],tradeId=hash(JSON.stringify([scope,f.barTs,f.pair,fillIndex])),decisionId='replay-decision:'+asOf;
  const order={accountId,pair:action.pair,side:'buy' as const,amountEur:action.amountEur,stopLossPct:action.stopLossPct,takeProfitPct:action.takeProfitPct,reason:action.reasoning,decisionId},fill={id:tradeId,accountId,pair:f.pair,decisionId,qty:f.qty,fillPrice:f.price,costEur:f.qty*f.price,feeEur:f.fee,ts:asOf};
  const evidence=provider.getEvidence?.(),d={id:decisionId,account_id:accountId,provider:'historical-mock',status:'validated',ts:asOf,context_json:JSON.stringify(c),actions_json:JSON.stringify(event.actions)},e=evidence?{decision_id:decisionId,recorded_at:asOf,evidence_json:JSON.stringify(evidence)}:undefined;
  const snapshot=buildPositionEntrySnapshot(fill,id,rows.length?'scale-in':'open',order,scope,d,e,{stopLossPrice:p.stop,takeProfitPrice:p.target??null,policyFingerprint:base.policy.fingerprint}),json=JSON.stringify(snapshot);
  rows.push({trade_id:tradeId,position_id:id,account_id:accountId,pair:f.pair,entry_kind:rows.length?'scale-in':'open',fill_ts:asOf,captured_at:asOf,snapshot_json:json,snapshot_hash:hash(json)});entries.set(id,rows);
 }};
 return {study,records:()=>({availabilityDomain:'modelled-historical-only',actualMaterializedAt:materializedAt,scope,entries:[...entries.values()].flat().map(row=>({...row,snapshot:JSON.parse(row.snapshot_json)}))})};
}
