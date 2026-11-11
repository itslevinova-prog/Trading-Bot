import {createHash} from 'node:crypto';
import type Database from 'better-sqlite3';
import type {BrokerOrder} from '@paper/shared';
export const POSITION_ENTRY_VERSION='position-entry-evidence-v1';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const parse=(s:unknown)=>{try{return typeof s==='string'?JSON.parse(s):null;}catch{return null;}};
type Fill={id:string;accountId:string;pair:string;decisionId:string;qty:number;fillPrice:number;costEur:number;feeEur:number;ts:number};
type Position={id:string;accountId:string;pair:string;qty:number;openedAt:number};
export function initPositionEntries(sql:Database.Database){sql.exec(`CREATE TABLE IF NOT EXISTS position_entry_evidence (
 trade_id TEXT PRIMARY KEY REFERENCES trades(id) ON DELETE CASCADE, position_id TEXT NOT NULL,
 account_id TEXT NOT NULL, pair TEXT NOT NULL, entry_kind TEXT NOT NULL CHECK(entry_kind IN ('open','scale-in')),
 fill_ts INTEGER NOT NULL, captured_at INTEGER NOT NULL, snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS ix_position_entry_position ON position_entry_evidence(position_id,fill_ts);`);}
/** Called inside the SAME SQLite transaction as the simulated buy and position mutation.
 * Copy the currently durable pre-fill decision; never recover entry reasons from later markets.
 * Missing legacy/manual/hold decisions remain explicitly unknown and do not block protective exits. */
export function recordPositionEntry(sql:Database.Database,fill:Fill,positionId:string,kind:'open'|'scale-in',order:BrokerOrder,evaluationVersion:string|null,appliedProtection:{stopLossPrice:number|null;takeProfitPrice:number|null;policyFingerprint:string|null}|null=null){
 const d=sql.prepare('SELECT * FROM decisions WHERE id=?').get(fill.decisionId) as Record<string,any>|undefined;
 const e=sql.prepare('SELECT * FROM decision_evidence WHERE decision_id=?').get(fill.decisionId) as Record<string,any>|undefined;
 const snapshot=buildPositionEntrySnapshot(fill,positionId,kind,order,evaluationVersion,d,e,appliedProtection);
 const json=JSON.stringify(snapshot);sql.prepare('INSERT INTO position_entry_evidence VALUES (?,?,?,?,?,?,?,?,?)').run(fill.id,positionId,fill.accountId,fill.pair,kind,fill.ts,Date.now(),json,hash(json));return snapshot;
}
/** Pure source interpretation shared with explicitly clocked historical simulations. */
export function buildPositionEntrySnapshot(fill:Fill,positionId:string,kind:'open'|'scale-in',order:BrokerOrder,evaluationVersion:string|null,d:Record<string,any>|undefined,e:Record<string,any>|undefined,appliedProtection:{stopLossPrice:number|null;takeProfitPrice:number|null;policyFingerprint:string|null}|null=null){
 const ctx=parse(d?.context_json),actions=parse(d?.actions_json),rawEvidence=parse(e?.evidence_json),reasons:string[]=[];
 const sourceTime=object(ctx)?Date.parse(ctx.timeUTC):NaN;
 if(order.accountId!==fill.accountId||order.pair!==fill.pair||order.decisionId!==fill.decisionId||order.side!=='buy')reasons.push('submitted-order-and-fill-identity-mismatch');
 if(!d||d.id!==fill.decisionId||d.account_id!==fill.accountId||d.status!=='validated'||!Number.isSafeInteger(d.ts)||d.ts<0||d.ts>fill.ts)reasons.push('pre-fill-validated-owned-decision-unavailable');
 if(!object(ctx)||!object(ctx.account)||ctx.account.id!==fill.accountId||ctx.execution?.mode!=='paper'||!Number.isSafeInteger(sourceTime)||sourceTime<0||sourceTime>fill.ts)reasons.push('original-owned-paper-context-unavailable');
 const matched=Array.isArray(actions)?actions.filter((a:unknown)=>object(a)&&a.type==='buy'&&a.pair===fill.pair):[];
 const action=matched.length===1?matched[0]:null;
 if(!action||action.amountEur!==order.amountEur||(action.stopLossPct??null)!==(order.stopLossPct??null)||(action.takeProfitPct??null)!==(order.takeProfitPct??null)||action.reasoning!==order.reason)reasons.push('unique-original-buy-action-does-not-match-submitted-order');
 const features=object(ctx)&&Array.isArray(ctx.features)?ctx.features.filter((f:unknown)=>object(f)&&f.pair===fill.pair):[],feature=features.length===1?features[0]:null;
 const frames=object(ctx?.marketContext)&&Array.isArray(ctx.marketContext.markets)?ctx.marketContext.markets.filter((m:any)=>m?.pair===fill.pair):[],frame=frames.length===1?frames[0]:null;
 const assessments=object(rawEvidence)&&Array.isArray(rawEvidence.assessments)?rawEvidence.assessments.filter((a:unknown)=>object(a)&&a.pair===fill.pair):[],assessment=assessments.length===1?assessments[0]:null;
 const structured=!!(e&&e.decision_id===fill.decisionId&&Number.isSafeInteger(e.recorded_at)&&e.recorded_at>=d?.ts&&e.recorded_at<=fill.ts&&object(assessment)&&assessment.action==='buy'&&typeof assessment.strategy==='string'&&typeof assessment.invalidation==='string'&&Array.isArray(assessment.support)&&assessment.support.every((x:unknown)=>typeof x==='string')&&Array.isArray(assessment.contradictions)&&assessment.contradictions.length===0);
 const s=frame?.regime?.structure;
 const structureValid=!!(feature&&Number.isFinite(feature.price)&&feature.price>0&&object(frame?.feature)&&Object.keys(feature).every(k=>frame.feature[k]===feature[k])&&object(frame.quality)&&frame.quality.stale===false&&frame.quality.bookUsable===true&&Number.isFinite(frame.asOf)&&frame.asOf<=sourceTime&&Number.isFinite(frame.quality.bookAgeMs)&&frame.quality.bookAgeMs>=0&&sourceTime-frame.asOf+frame.quality.bookAgeMs<=5000&&frame.quality.lastClosedAt===feature.ts+900000&&Number.isSafeInteger(feature.ts)&&feature.ts%900000===0&&feature.ts+900000<=sourceTime&&sourceTime-feature.ts-900000<=1200000&&object(s)&&s.version==='closed-structure-v1'&&s.complete===true&&s.signalClosedAt===feature.ts+900000&&Number.isFinite(s.priorSupport)&&s.priorSupport>0&&Number.isFinite(s.priorResistance)&&s.priorResistance>=s.priorSupport);
 const observed=reasons.length===0,scopeMatched=!!(typeof evaluationVersion==='string'&&evaluationVersion&&ctx?.execution?.evaluationVersion===evaluationVersion);
 const snapshot={version:POSITION_ENTRY_VERSION,positionId,entryKind:kind,fill:{...fill},sourceObserved:observed,reasons,provider:d?.provider??null,sourceTime:Number.isFinite(sourceTime)?sourceTime:null,sourceContextHash:typeof d?.context_json==='string'?hash(d.context_json):null,sourceEvidenceHash:typeof e?.evidence_json==='string'?hash(e.evidence_json):null,sourceEvidenceRecordedAt:e?.recorded_at??null,evaluationVersion,scopeMatched,
  contextDomain:observed?(ctx.execution.simulation?.kind?'historical-simulation':'runtime-paper'):'unavailable',sourceExecution:observed?{mode:'paper',buildId:ctx.execution.buildId??null,runId:ctx.execution.runId??null,evaluationVersion:ctx.execution.evaluationVersion??null,simulation:ctx.execution.simulation??null}:null,entryPolicy:observed&&object(ctx.tradingPolicy)?ctx.tradingPolicy:null,appliedProtection,
  actionExplanation:observed?action.reasoning:null,feature:observed?feature:null,recordedStructure:observed&&structureValid?s:null,structuredAssessment:observed&&structured?assessment:null,structuredAssessmentVersion:observed&&structured?rawEvidence.version??null:null,
  originalStrategyAssessmentObserved:observed&&structured,eligibleForThesisPolicy:observed&&structured&&structureValid&&scopeMatched,estimatedWinProbability:null};
 return snapshot;
}
/** Position identity survives partial sells; reentries get a new ID. Scale-ins are compound theses.
 * No time-nearest join or legacy backfill: a missing opening link means unknown original origin. */
export function positionEntryEvidence(sql:Database.Database,p:Position,asOf:number,expectedEvaluationVersion:string|null=null){
 const rows=sql.prepare('SELECT * FROM position_entry_evidence WHERE position_id=? ORDER BY fill_ts,trade_id').all(p.id) as Record<string,any>[];
 return summarizePositionEntries(rows,p,asOf,expectedEvaluationVersion);
}
/** Availability is supplied in its domain: actual capture for runtime, explicitly modelled for replay. */
export function summarizePositionEntries(rows:Record<string,any>[],p:Position,asOf:number,expectedEvaluationVersion:string|null){
 const unknown=(reason:string)=>({version:POSITION_ENTRY_VERSION,originalStrategyAssessmentObserved:false,eligibleForThesisPolicy:false,reason,recordedEntries:rows.length,scaleInCount:rows.filter(r=>r.entry_kind==='scale-in').length,initialEntry:null as ReturnType<typeof recordPositionEntry>|null});
 if(!Number.isSafeInteger(asOf)||!Number.isFinite(p.qty)||p.qty<=0)return unknown('invalid-position-or-observation');
 const parsed:ReturnType<typeof recordPositionEntry>[]=[];
 for(const r of rows){const s=parse(r.snapshot_json);if(r.account_id!==p.accountId||r.pair!==p.pair||r.fill_ts>asOf||!Number.isSafeInteger(r.captured_at)||r.captured_at<r.fill_ts||r.captured_at>asOf||hash(r.snapshot_json)!==r.snapshot_hash||!object(s)||s.version!==POSITION_ENTRY_VERSION||s.positionId!==p.id||s.entryKind!==r.entry_kind||s.fill?.id!==r.trade_id||s.fill?.accountId!==p.accountId||s.fill?.pair!==p.pair||s.fill?.ts!==r.fill_ts)return unknown('entry-snapshot-invalid-mixed-or-not-yet-observed');parsed.push(s as ReturnType<typeof recordPositionEntry>);}
 const opens=parsed.filter(s=>s.entryKind==='open');if(!parsed.length||opens.length!==1||parsed[0]!==opens[0])return unknown('original-opening-link-unavailable');
 const initial=opens[0]!,quantity=parsed.reduce((sum,s)=>sum+s.fill.qty,0);
 if(!Number.isFinite(quantity)||quantity<=0||p.qty>quantity+Math.max(1e-12,quantity*1e-10)||initial.fill.ts>p.openedAt||p.openedAt>asOf)return unknown('position-quantity-or-opening-clock-inconsistent');
 return {version:POSITION_ENTRY_VERSION,originalStrategyAssessmentObserved:initial.originalStrategyAssessmentObserved,eligibleForThesisPolicy:parsed.length===1&&initial.eligibleForThesisPolicy&&!!expectedEvaluationVersion&&initial.evaluationVersion===expectedEvaluationVersion,reason:parsed.length>1?'compound-scale-in-theses-not-one-position-thesis':initial.eligibleForThesisPolicy?initial.evaluationVersion===expectedEvaluationVersion?'recorded-original-assessment-and-structure':'entry-scope-differs-from-current-policy':'original-assessment-or-structure-scope-unavailable',recordedEntries:parsed.length,scaleInCount:parsed.length-1,initialEntry:initial};
}
