import {digest} from '../provenance/build.js';
import {canonicalJson} from './dataset.js';
import type {PortfolioFill} from './portfolio.js';
export const POLICY_LABEL_VERSION='policy-labels-v1';
export type PolicyLabelScope={datasetId:string;replayBuildId:string;decisionModuleHash:string;scenarioHash:string};
export type PolicyLabel={version:typeof POLICY_LABEL_VERSION;id:string;scopeId:string;pair:string;entryBarTs:number;entryFeatureClosedAt:number;exitBarTs:number|null;modeledAvailableAt:number|null;materializedAt:number;netPnl:number|null;netReturnPct:number|null;label:'profit'|'loss'|'break-even'|null;censoredReason:'evaluation-end'|'still-open'|null;availability:'simulated-bar-close-plus5s-not-observed-receipt'};
const timestamp=(v:number)=>Number.isSafeInteger(v)&&v>=0;
export function policyScopeId(scope:PolicyLabelScope){
 if(Object.keys(scope).sort().join(',')!=='datasetId,decisionModuleHash,replayBuildId,scenarioHash'||Object.values(scope).some(v=>typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))throw Error('Invalid policy label scope');
 return digest(canonicalJson({version:POLICY_LABEL_VERSION,...scope}));
}
/** Labels only complete simulated roundtrips; future targets never masquerade as observations. */
export function buildPolicyLabels(fills:PortfolioFill[],scope:PolicyLabelScope,materializedAt:number):PolicyLabel[]{
 const scopeId=policyScopeId(scope);if(!timestamp(materializedAt))throw Error('Invalid label materialization clock');
 const pending=new Map<string,{fill:PortfolioFill;index:number}>(),labels:PolicyLabel[]=[];let previous=-1;
 const make=(entry:PortfolioFill,index:number,exit:PortfolioFill|null,exitIndex:number|null):PolicyLabel=>{
  const censoredReason=exit?.reason==='evaluation end liquidation'?'evaluation-end':exit?null:'still-open',available=exit?exit.barTs+905000:null;
  if(available!==null&&available>materializedAt)throw Error('Label materialized before assumed outcome availability');
  const basis=entry.qty*entry.price+entry.fee,pnl=exit?.realizedPnl??null;
  if(!Number.isFinite(basis)||basis<=0)throw Error('Invalid label basis');
  return {version:POLICY_LABEL_VERSION,id:digest(canonicalJson({scopeId,index,entry,exitIndex,exit})),scopeId,pair:entry.pair,entryBarTs:entry.barTs,entryFeatureClosedAt:entry.signalBarTs!+900000,exitBarTs:exit?.barTs??null,modeledAvailableAt:available,materializedAt,netPnl:censoredReason?null:pnl,netReturnPct:censoredReason||pnl===null?null:pnl/basis*100,label:censoredReason||pnl===null?null:pnl>0?'profit':pnl<0?'loss':'break-even',censoredReason,availability:'simulated-bar-close-plus5s-not-observed-receipt'};
 };
 fills.forEach((f,index)=>{
  if(typeof f.pair!=='string'||!f.pair||!timestamp(f.barTs)||f.barTs%900000||f.barTs<previous||f.barTs+900000>materializedAt||![f.qty,f.price,f.fee].every(Number.isFinite)||f.qty<=0||f.price<=0||f.fee<0||!['buy','sell'].includes(f.side)||f.signalBarTs!==null&&(!timestamp(f.signalBarTs)||f.signalBarTs%900000||f.signalBarTs+900000>f.barTs))throw Error('Invalid or noncausal label ledger');
  previous=f.barTs;
  if(f.side==='buy'){
   if(pending.has(f.pair)||f.signalBarTs===null||f.realizedPnl!==null)throw Error('Unsupported scale-in or invalid entry provenance');
   pending.set(f.pair,{fill:{...f},index});return;
  }
  const entry=pending.get(f.pair);if(!entry||entry.fill.qty!==f.qty||!Number.isFinite(f.realizedPnl))throw Error('Unmatched or partial policy exit');
  const expected=f.qty*f.price-f.fee-entry.fill.qty*entry.fill.price-entry.fill.fee;
  if(!Number.isFinite(expected)||Math.abs(expected-f.realizedPnl!)>Math.max(1,Math.abs(expected))*1e-9)throw Error('Policy outcome contradicts paid fill ledger');
  labels.push(make(entry.fill,entry.index,{...f},index));pending.delete(f.pair);
 });
 for(const {fill,index}of pending.values())labels.push(make(fill,index,null,null));
 return labels.sort((a,b)=>a.entryBarTs-b.entryBarTs||a.pair.localeCompare(b.pair));
}
/** Only explicitly modelled historical availability; never writes live memory or estimates probability. */
export function eligiblePolicyLabels(labels:PolicyLabel[],lookup:{mode:'historical-simulation';scopeId:string;asOf:number}){
 const {scopeId,asOf}=lookup;if(lookup.mode!=='historical-simulation')throw Error('Historical simulation mode required');
 if(!/^[a-f0-9]{64}$/.test(scopeId)||!timestamp(asOf))throw Error('Invalid policy label lookup');
 const unique=new Map<string,PolicyLabel>();
 for(const row of labels){
  if(row.scopeId!==scopeId)continue;
  if(timestamp(row.entryBarTs)&&row.entryBarTs>=asOf||row.modeledAvailableAt!==null&&timestamp(row.modeledAvailableAt)&&row.modeledAvailableAt>asOf)continue;
  if(row.version!==POLICY_LABEL_VERSION||row.availability!=='simulated-bar-close-plus5s-not-observed-receipt'||!timestamp(row.entryBarTs)||!timestamp(row.entryFeatureClosedAt)||row.entryFeatureClosedAt>row.entryBarTs||!timestamp(row.materializedAt)||row.exitBarTs!==null&&(!timestamp(row.exitBarTs)||row.exitBarTs<row.entryBarTs)||row.modeledAvailableAt!==null&&(!timestamp(row.modeledAvailableAt)||row.exitBarTs===null||row.modeledAvailableAt!==row.exitBarTs+905000)||row.modeledAvailableAt!==null&&row.materializedAt<row.modeledAvailableAt)throw Error('Invalid policy label availability');
  if(!/^[a-f0-9]{64}$/.test(row.id)||row.censoredReason===null&&(row.exitBarTs===null||row.modeledAvailableAt===null||!Number.isFinite(row.netPnl)||!Number.isFinite(row.netReturnPct)||row.label!==(row.netPnl!>0?'profit':row.netPnl!<0?'loss':'break-even')||Math.sign(row.netPnl!)!==Math.sign(row.netReturnPct!))||row.censoredReason!==null&&(!['evaluation-end','still-open'].includes(row.censoredReason)||row.netPnl!==null||row.netReturnPct!==null||row.label!==null))throw Error('Invalid or mislabeled policy outcome');
  const old=unique.get(row.id);if(old){const {materializedAt:oldTime,...oldFacts}=old,{materializedAt:newTime,...newFacts}=row;if(canonicalJson(oldFacts)!==canonicalJson(newFacts))throw Error('Conflicting duplicate policy label');if(newTime<oldTime)unique.set(row.id,row);}else unique.set(row.id,row);
 }
 return [...unique.values()].filter(r=>r.censoredReason===null&&r.modeledAvailableAt!==null&&r.modeledAvailableAt<=asOf&&r.exitBarTs!==null&&r.entryBarTs<asOf&&Number.isFinite(r.netPnl)&&Number.isFinite(r.netReturnPct)&&['profit','loss','break-even'].includes(r.label??'')).sort((a,b)=>a.modeledAvailableAt!-b.modeledAvailableAt!||a.id.localeCompare(b.id));
}
