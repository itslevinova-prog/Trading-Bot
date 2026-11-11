import type {Action,DecisionContext,DecisionProvider,DecisionResult} from '@paper/shared';
import {paperMockDecision} from './paper-intelligence.js';
import {covarianceBudget,type CovariancePanel} from '../context/portfolio-covariance.js';
export const COVARIANCE_PAPER_VERSION='covariance-paper-v1';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export function covariancePaperDecision(c:DecisionContext){
 const base=paperMockDecision(c),assessments=structuredClone(base.evidence.assessments),markets=object(c.marketContext)&&Array.isArray(c.marketContext.markets)?c.marketContext.markets:[],panel=object(c.portfolioEvidence)?c.portfolioEvidence.covariance:null,now=Date.parse(c.timeUTC),risk:Record<string,ReturnType<typeof covarianceBudget>>={};
 const marked=(pair:string)=>{const index=object(panel)&&Array.isArray(panel.pairs)?panel.pairs.indexOf(pair):-1;const matches=markets.filter(m=>m?.pair===pair),m=matches[0],bid=Number(m?.microstructure?.bids?.[0]?.price);if(matches.length!==1||index<0||m?.feature?.ts+900000!==panel.lastClosedAt||m.feature.price!==panel.lastCloses?.[index]||!finite(bid)||bid<=0||!finite(m?.asOf)||m.asOf>now||m.quality?.stale!==false||m.quality?.bookUsable!==true||!finite(m.quality.bookAgeMs)||m.quality.bookAgeMs<0||now-m.asOf+m.quality.bookAgeMs>5000)throw Error('Unknown held mark');return bid;};
 for(const a of assessments){if(a.action!=='buy')continue;
  try{
   if(!object(panel)||!finite(now))throw Error('Missing covariance');
   const f=c.features.find(f=>f.pair===a.pair)!;if(f.ts+900000!==panel.lastClosedAt)throw Error('Mixed covariance clock');
   const frame=markets.find(m=>m?.pair===a.pair),ask=Number(frame.microstructure.asks[0].price),fee=c.limits.TAKER_FEE_RATE!,slip=c.limits.MAX_ENTRY_SLIPPAGE_BPS!,qty=a.amount/(ask*(1+slip/10000)*(1+fee)),newExposure=qty*marked(a.pair);
   const holdings=c.positions.map(p=>{if(!object(p)||typeof p.pair!=='string'||!finite(p.qty)||p.qty<=0)throw Error('Unknown position quantity');return {pair:p.pair,value:p.qty*marked(p.pair)};});
   const budget=covarianceBudget(panel as CovariancePanel,now,a.pair,newExposure,holdings);risk[a.pair]=budget;a.amount*=budget.factor;
   if(a.amount<(c.limits.MIN_ORDER_EUR??Infinity)){a.action='hold';a.contradictions.push('covariance-adjusted-budget-below-minimum');}else a.support.push('aligned-sample-covariance-increment-budget');
  }catch{a.action='hold';a.contradictions.push('required-portfolio-covariance-or-mark-unknown');}
 }
 const actions:Action[]=base.answer.actions.filter(a=>a.type==='sell');
 if(actions.length<3){const a=assessments.filter(a=>a.action==='buy').sort((a,b)=>b.payoff!.netRewardRisk-a.payoff!.netRewardRisk||a.pair.localeCompare(b.pair))[0];if(a)actions.push({type:'buy',pair:a.pair,amountEur:a.amount,stopLossPct:a.stop,takeProfitPct:a.target,confidence:.8,reasoning:`PAPER-COV: unveränderte Trend-/Kostenlimits; zusätzlicher Varianzfaktor ${risk[a.pair]!.factor.toFixed(4)} aus zeitgleichen historischen Renditen. Kein kalibriertes Gewinn- oder Verlustversprechen.`});}
 if(!actions.length)actions.push({type:'hold',confidence:0,reasoning:('NO TRADE: '+[...new Set(assessments.flatMap(a=>a.contradictions))].slice(0,6).join(', ')).slice(0,400)});
 return {answer:{marketView:`PAPER-MOCK ${COVARIANCE_PAPER_VERSION}, historisches Risikomodell unvalidiert.`,actions},evidence:{...base.evidence,version:COVARIANCE_PAPER_VERSION,baseVersion:base.evidence.version,assessments,covarianceRisk:risk}};
}
export class CovariancePaperProvider implements DecisionProvider{
 private evidence:ReturnType<typeof covariancePaperDecision>['evidence']|null=null;
 getEvidence(){return this.evidence?structuredClone(this.evidence):null;}
 async decide(c:DecisionContext):Promise<DecisionResult>{const r=covariancePaperDecision(c);this.evidence=r.evidence;return r.answer;}
}
