import type {Action,DecisionContext,DecisionProvider,DecisionResult} from '@paper/shared';
import {structureExitPaperDecision} from './structure-exit-paper.js';
import {POSITION_ENTRY_VERSION} from '../context/position-entry.js';
export const ENTRY_SUPPORT_VERSION='entry-support-paper-v1';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
/** New exit hypothesis using an actual original context fact, NOT a claim that the old
 * strategy explicitly promised this support as its exit. Baseline exits retain priority. */
export function entrySupportPaperDecision(c:DecisionContext){
 const base=structureExitPaperDecision(c),assessments=structuredClone(base.evidence.assessments),optional:Extract<Action,{type:'sell'}>[]=[],checks:Record<string,string>={};
 let validatedOriginalEntries=0;
 const now=Date.parse(c.timeUTC),scope=object(c.execution)?c.execution.evaluationVersion:null,accountId=object(c.account)?c.account.id:null;
 for(const a of assessments){
  const held=c.positions.filter(p=>object(p)&&p.pair===a.pair);if(!held.length||a.action==='sell')continue;
  const p=held[0] as Record<string,any>,f=c.features.find(f=>f.pair===a.pair),e=p.entryEvidence,initial=e?.initialEntry,s=initial?.recordedStructure;
  const deny=(reason:string)=>{checks[a.pair]=reason;};
  if(held.length!==1||!f||!a.support.includes('fresh-matching-closed-candle-and-book')){deny('fresh-unique-held-exit-evidence-unavailable');continue;}
  if(!object(e)||e.version!==POSITION_ENTRY_VERSION||e.eligibleForThesisPolicy!==true||e.recordedEntries!==1||e.scaleInCount!==0||!object(initial)||initial.version!==POSITION_ENTRY_VERSION||initial.sourceObserved!==true||initial.originalStrategyAssessmentObserved!==true||initial.scopeMatched!==true||initial.entryKind!=='open'){deny('original-single-entry-assessment-unavailable');continue;}
  if(typeof scope!=='string'||!scope||initial.evaluationVersion!==scope||initial.sourceExecution?.evaluationVersion!==scope||initial.sourceExecution?.mode!=='paper'||typeof accountId!=='string'||p.accountId!==accountId||p.id!==initial.positionId||initial.fill?.accountId!==accountId||initial.fill?.pair!==a.pair||!finite(p.qty)||p.qty<=0||!finite(initial.fill?.qty)||p.qty>initial.fill.qty+Math.max(1e-12,initial.fill.qty*1e-10)){deny('entry-identity-quantity-or-evaluation-scope-mismatch');continue;}
  if(!Number.isSafeInteger(p.openedAt)||!Number.isSafeInteger(initial.fill.ts)||!Number.isSafeInteger(initial.sourceTime)||initial.sourceTime>initial.fill.ts||initial.fill.ts>p.openedAt||p.openedAt>=f.ts+900000||!finite(now)||p.openedAt>now){deny('no-causal-post-entry-closed-observation');continue;}
  if(initial.structuredAssessment?.strategy!=='trend-continuation'||!object(s)||s.version!=='closed-structure-v1'||s.complete!==true||!Number.isSafeInteger(s.signalClosedAt)||s.signalClosedAt>initial.sourceTime||!finite(s.priorSupport)||s.priorSupport<=0||!finite(s.priorResistance)||s.priorResistance<s.priorSupport){deny('original-trend-support-unavailable');continue;}
  validatedOriginalEntries++;
  if(f.price>=s.priorSupport||f.price>=f.ema20||f.change1h>=0){deny('no-confirmed-original-support-loss');continue;}
  a.action='sell';a.support.push('post-entry-close-below-recorded-original-support-and-ema20-with-negative1h');checks[a.pair]='new-rule-using-recorded-original-support-not-invented-original-exit-intent';
  optional.push({type:'sell',pair:a.pair,sellFraction:1,confidence:.8,reasoning:'ENTRY-SUPPORT: Neue Forschungsregel: Unter beim Einstieg gespeichertem Support geschlossen, unter EMA20 und1hMomentum negativ. Alte Strategie hatte diesen Exit nicht ausdrücklich festgelegt. Schutz-Stops bleiben unabhängig.'});
 }
 const actions:Action[]=[...base.answer.actions.filter(a=>a.type==='sell'),...optional.sort((a,b)=>a.pair.localeCompare(b.pair))].slice(0,3);
 if(actions.length<3)actions.push(...base.answer.actions.filter(a=>a.type==='buy').slice(0,3-actions.length));
 if(!actions.length)actions.push({type:'hold',confidence:0,reasoning:'NO TRADE: Kein zulässiger Einstieg oder bestätigter zusätzlicher Ausstieg am ursprünglich gespeicherten Support.'});
 return {answer:{marketView:`PAPER-MOCK ${ENTRY_SUPPORT_VERSION}: zusätzliche unvalidierte Ausstiegshypothese aus kausal gespeichertem Einstiegskontext.`,actions},evidence:{...base.evidence,version:ENTRY_SUPPORT_VERSION,baseVersion:base.evidence.version,assessments,entrySupportChecks:checks,additionalOriginalSupportExitProposals:optional.length,validatedOriginalEntries,originalEntryThesisObserved:validatedOriginalEntries>0,originalExitIntentInferred:false}};
}
export class EntrySupportPaperProvider implements DecisionProvider{
 private evidence:ReturnType<typeof entrySupportPaperDecision>['evidence']|null=null;
 getEvidence(){return this.evidence?structuredClone(this.evidence):null;}
 async decide(c:DecisionContext):Promise<DecisionResult>{const r=entrySupportPaperDecision(c);this.evidence=r.evidence;return r.answer;}
}
