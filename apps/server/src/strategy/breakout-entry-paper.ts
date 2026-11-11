import type {Action,DecisionContext,DecisionProvider,DecisionResult} from '@paper/shared';
import {structureExitPaperDecision} from './structure-exit-paper.js';
export const BREAKOUT_ENTRY_VERSION='closed-breakout-entry-v1';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
/** Research-only entry filter. A closed range breakout is evidence of structure, never a win probability. */
export function breakoutEntryPaperDecision(c:DecisionContext){
 const base=structureExitPaperDecision(c),assessments=structuredClone(base.evidence.assessments),markets=object(c.marketContext)&&Array.isArray(c.marketContext.markets)?c.marketContext.markets:[],entryChecks:Record<string,string>={};
 for(const a of assessments){if(a.action!=='buy')continue;const frames=markets.filter(m=>m?.pair===a.pair),f=c.features.find(f=>f.pair===a.pair),s=frames[0]?.regime?.structure;let reason:string|null=null;
  if(!f||frames.length!==1||!object(s)||s.version!=='closed-structure-v1'||s.complete!==true||s.priorCandles!==20||s.signalClosedAt!==f.ts+900000||!finite(s.priorSupport)||s.priorSupport<=0||!finite(s.priorResistance)||s.priorResistance<s.priorSupport||typeof s.upsideBreakout!=='boolean'||s.upsideBreakout!==(f.price>s.priorResistance))reason='closed-breakout-structure-unavailable-or-inconsistent';
  else if(!s.upsideBreakout)reason='no-close-above-prior20-resistance';
  if(reason){a.action='hold';a.contradictions.push(reason);entryChecks[a.pair]=reason;}else{a.support.push('confirmed-close-above-excluding-signal-prior20-high');entryChecks[a.pair]='closed-upside-breakout-confirmed';}
 }
 // Gate every already risk-qualified assessment before original deterministic selection.
 // Existing exits have priority and never require entry confirmation.
 const actions:Action[]=base.answer.actions.filter(a=>a.type==='sell');
 if(actions.length<3){const a=assessments.filter(a=>a.action==='buy').sort((a,b)=>b.payoff!.netRewardRisk-a.payoff!.netRewardRisk||a.pair.localeCompare(b.pair))[0];if(a)actions.push({type:'buy',pair:a.pair,amountEur:a.amount,stopLossPct:a.stop,takeProfitPct:a.target,confidence:.8,reasoning:'BREAKOUT-ENTRY: Schlusskurs über Hoch der vorherigen20abgeschlossenen Kerzen; bestehende Trend-, Kosten-, Kovarianz- und Portfoliolimits erfüllt.0.8 ist ein unkalibrierter Entscheidungsscore, keine Gewinnwahrscheinlichkeit.'});}
 if(!actions.length)actions.push({type:'hold',confidence:0,reasoning:('NO TRADE: '+[...new Set(assessments.flatMap(a=>a.contradictions))].slice(0,6).join(', ')).slice(0,400)});
 return {answer:{marketView:`PAPER-MOCK ${BREAKOUT_ENTRY_VERSION}: geschlossene Ausbruchsbestätigung; Forschungshypothese ohne Gewinnnachweis.`,actions},evidence:{...base.evidence,version:BREAKOUT_ENTRY_VERSION,baseVersion:base.evidence.version,assessments,entryChecks}};
}
export class BreakoutEntryPaperProvider implements DecisionProvider{
 private evidence:ReturnType<typeof breakoutEntryPaperDecision>['evidence']|null=null;
 getEvidence(){return this.evidence?structuredClone(this.evidence):null;}
 async decide(c:DecisionContext):Promise<DecisionResult>{const r=breakoutEntryPaperDecision(c);this.evidence=r.evidence;return r.answer;}
}
