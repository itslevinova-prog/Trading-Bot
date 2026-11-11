import type {Action,DecisionContext,DecisionProvider,DecisionResult} from '@paper/shared';
import {covariancePaperDecision} from './covariance-paper.js';
export const STRUCTURE_EXIT_VERSION='structure-exit-paper-v1';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
/** An exit from current structural deterioration, not a retrospectively invented original entry thesis. */
export function structureExitPaperDecision(c:DecisionContext){
 const base=covariancePaperDecision(c),assessments=structuredClone(base.evidence.assessments),markets=object(c.marketContext)&&Array.isArray(c.marketContext.markets)?c.marketContext.markets:[],optionalExits:Extract<Action,{type:'sell'}>[]=[],exitChecks:Record<string,string>={};
 for(const a of assessments){
  const positions=c.positions.filter(p=>object(p)&&p.pair===a.pair),f=c.features.find(f=>f.pair===a.pair),frames=markets.filter(m=>m?.pair===a.pair),s=frames[0]?.regime?.structure;
  if(!positions.length||a.action==='sell')continue;
  const p=positions[0] as Record<string,unknown>;
  const deny=(reason:string)=>{exitChecks[a.pair]=reason;};
  if(positions.length!==1||!finite(p.qty)||p.qty<=0||!Number.isSafeInteger(p.openedAt)||Number(p.openedAt)<0){deny('position-origin-or-quantity-unknown');continue;}
  if(!f||frames.length!==1||!a.support.includes('fresh-matching-closed-candle-and-book')){deny('fresh-closed-exit-evidence-unavailable');continue;}
  if(Number(p.openedAt)>=f.ts+900000){deny('no-new-closed-observation-since-entry');continue;}
  if(!object(s)||s.version!=='closed-structure-v1'||s.complete!==true||s.signalClosedAt!==f.ts+900000||s.priorCandles!==20||!finite(s.priorSupport)||!finite(s.priorResistance)||s.priorSupport<=0||s.priorResistance<s.priorSupport||typeof s.downsideBreakout!=='boolean'||s.downsideBreakout!==(f.price<s.priorSupport)){deny('closed-support-exit-structure-unavailable-or-inconsistent');continue;}
  if(!s.downsideBreakout||f.change1h>=0||f.price>=f.ema20){deny('no-confirmed-structural-trend-deterioration');continue;}
  a.action='sell';a.support.push('post-entry-close-below-prior20-support-and-ema20-with-negative1h');exitChecks[a.pair]='current-structure-break-not-recorded-entry-thesis';
  optionalExits.push({type:'sell',pair:a.pair,sellFraction:1,confidence:.8,reasoning:'STRUCTURE-EXIT: Nach Einstieg unter vorherigem20Kerzen-Support geschlossen, unter EMA20 und1hMomentum negativ. Aktuelle Struktur verletzt; ursprüngliche Einstiegsthese nicht gespeichert. Schutz-Stops bleiben unabhängig.'});
 }
 // Preserve pre-existing valid exits before optional ones; never let entry uncertainty block either kind.
 const actions:Action[]=[...base.answer.actions.filter(a=>a.type==='sell'),...optionalExits.sort((a,b)=>a.pair.localeCompare(b.pair))].slice(0,3);
 const buys=base.answer.actions.filter(a=>a.type==='buy');if(actions.length<3)actions.push(...buys.slice(0,3-actions.length));
 if(!actions.length)actions.push({type:'hold',confidence:0,reasoning:'NO TRADE: Kein zulässiger Einstieg oder bestätigter zusätzlicher Struktur-Ausstieg; Schutzüberwachung bleibt aktiv.'});
 return {answer:{marketView:`PAPER-MOCK ${STRUCTURE_EXIT_VERSION}: aktuelle Marktstruktur und bestehende Kovarianzlimits; unvalidierte Strategiehypothese.`,actions},evidence:{...base.evidence,version:STRUCTURE_EXIT_VERSION,baseVersion:base.evidence.version,assessments,exitChecks,additionalExitProposals:optionalExits.length,originalEntryThesisObserved:false}};
}
export class StructureExitPaperProvider implements DecisionProvider{
 private evidence:ReturnType<typeof structureExitPaperDecision>['evidence']|null=null;
 getEvidence(){return this.evidence?structuredClone(this.evidence):null;}
 async decide(c:DecisionContext):Promise<DecisionResult>{const r=structureExitPaperDecision(c);this.evidence=r.evidence;return r.answer;}
}
