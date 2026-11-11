import type {Action,DecisionContext,DecisionProvider,DecisionResult} from '@paper/shared';
import {paperMockDecision} from './paper-intelligence.js';
export const REGIME_PAPER_VERSION='btc-regime-paper-v1';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
/** Opt-in simulated candidate. Shared BTC exposure is a proxy, never pairwise covariance or calibrated edge. */
export function regimePaperDecision(context:DecisionContext){
 const base=paperMockDecision(context),assessments=structuredClone(base.evidence.assessments),markets=object(context.marketContext)&&Array.isArray(context.marketContext.markets)?context.marketContext.markets:[],held=context.positions.filter(object);
 const frame=(pair:string)=>{const all=markets.filter(m=>m?.pair===pair);return all.length===1?all[0]:null;};
 const feature=(pair:string)=>{const all=context.features.filter(f=>f.pair===pair);return all.length===1?all[0]:null;};
 const correlation=(pair:string)=>{const c=frame(pair)?.regime?.correlationBTC48h;return object(c)&&c.complete===true&&finite(c.value)&&Math.abs(c.value)<=1?c.value:null;};
 const state=(pair:string,ts:number)=>{const f=feature(pair),a=assessments.find(a=>a.pair===pair),ask=Number(frame(pair)?.microstructure?.asks?.[0]?.price);
  if(!f||!finite(ask)||ask<=0||Math.abs(ask/f.price-1)>Math.max(.02,2*f.atrPct/100))return 'unavailable';
  return f.ts===ts&&a&&['bullish-trend','bearish-trend','mixed-or-ranging'].includes(a.regime)?a.regime:'unavailable';};
 const relationships:Record<string,{btcPair:string;correlation:number|null;btcRegime:string;sharedFactorHoldings:string[];budgetFactor:number;proxyOnly:true}>={};
 for(const a of assessments){
  if(a.action!=='buy'||a.pair.startsWith('BTC/'))continue;
  const f=feature(a.pair)!,btcPair='BTC/'+a.pair.split('/')[1],corr=correlation(a.pair),deny=(code:string)=>{a.contradictions.push(code);a.action='hold';};
  const evidence={btcPair,correlation:corr,btcRegime:'not-required-for-low-positive-correlation',sharedFactorHoldings:[] as string[],budgetFactor:1,proxyOnly:true as const};relationships[a.pair]=evidence;
  if(corr===null){deny('btc-regime-correlation-unknown');continue;}
  if(corr<.8)continue;
  const btcRegime=state(btcPair,f.ts);evidence.btcRegime=btcRegime;
  if(btcRegime==='unavailable'){deny('btc-market-regime-unavailable');continue;}
  if(btcRegime==='bearish-trend'){deny('high-btc-correlation-conflicts-with-bearish-reference');continue;}
  if(btcRegime==='mixed-or-ranging')a.support.push('btc-reference-mixed-no-bullish-confirmation-claimed');
  else a.support.push('same-window-btc-trend-not-opposing-correlated-long');
  // Existing base logic already halves a positively correlated alt when BTC is held.
  if(held.some(p=>p.pair===btcPair))continue;
  let unknown=false;
  for(const p of held){
   if(typeof p.pair!=='string'||!p.pair.includes('/')){unknown=true;continue;}
   if(p.pair===a.pair||p.pair.split('/')[1]!==a.pair.split('/')[1])continue;
   const corrHeld=correlation(p.pair);
   if(corrHeld===null||state(p.pair,f.ts)==='unavailable'){unknown=true;continue;}
   if(corrHeld>=.8)evidence.sharedFactorHoldings.push(p.pair);
  }
  evidence.sharedFactorHoldings.sort();
  if(unknown){deny('held-alt-common-factor-risk-unknown');continue;}
  if(evidence.sharedFactorHoldings.length){
   a.amount*=.5;a.correlationAdjustment*=.5;evidence.budgetFactor=.5;a.support.push('shared-btc-factor-proxy-halves-additional-alt-budget');
   if(a.amount<(context.limits.MIN_ORDER_EUR??Infinity))deny('shared-factor-risk-budget-below-minimum-order');
  }
 }
 const actions:Action[]=base.answer.actions.filter(a=>a.type==='sell');
 if(actions.length<3){
  const selected=assessments.filter(a=>a.action==='buy').sort((a,b)=>b.payoff!.netRewardRisk-a.payoff!.netRewardRisk||a.pair.localeCompare(b.pair))[0];
  if(selected)actions.push({type:'buy',pair:selected.pair,amountEur:selected.amount,stopLossPct:selected.stop,takeProfitPct:selected.target,confidence:.8,reasoning:`PAPER-REGIME: ${selected.strategy}; ursprÃƒÂ¼ngliche Kosten-/Risikolimits erfÃƒÂ¼llt, BTC-Regime und gemeinsamer Faktor geprÃƒÂ¼ft. Zusätzlicher Faktor ${relationships[selected.pair]?.budgetFactor??1}, Gesamtfaktor ${selected.correlationAdjustment}.0.8 ist ein ungeprÃƒÂ¼fter Entscheidungsscore, keine Wahrscheinlichkeit.`});
 }
 if(!actions.length)actions.push({type:'hold',confidence:0,reasoning:('NO TRADE: '+[...new Set(assessments.flatMap(a=>a.contradictions))].slice(0,6).join(', ')).slice(0,400)});
 return {answer:{marketView:`PAPER-MOCK ${REGIME_PAPER_VERSION}: versionierte Markt-/Portfoliohypothese, Vorteil unvalidiert.`,actions},evidence:{...base.evidence,version:REGIME_PAPER_VERSION,baseVersion:base.evidence.version,assessments,relationships}};
}
export class RegimePaperProvider implements DecisionProvider{
 private evidence:ReturnType<typeof regimePaperDecision>['evidence']|null=null;
 getEvidence(){return this.evidence?structuredClone(this.evidence):null;}
 async decide(context:DecisionContext):Promise<DecisionResult>{const result=regimePaperDecision(context);this.evidence=result.evidence;return result.answer;}
}
