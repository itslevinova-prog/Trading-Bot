import {createHash} from 'node:crypto';
import type {Action,Candle,DecisionContext,DecisionProvider,DecisionResult} from '@paper/shared';
import {structureExitPaperDecision} from './structure-exit-paper.js';
import {POSITION_ENTRY_VERSION} from '../context/position-entry.js';
export const GAIN_PROTECTION_VERSION='closed-gain-protection-v1';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v),finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function origin(c:DecisionContext,p:Record<string,any>){
 if(!object(c.execution)||c.execution.mode!=='paper')return null;
 const e=p.entryEvidence,i=e?.initialEntry,scope=object(c.execution)?c.execution.evaluationVersion:null,id=object(c.account)?c.account.id:null;
 if(!object(e)||e.version!==POSITION_ENTRY_VERSION||e.eligibleForThesisPolicy!==true||e.recordedEntries!==1||e.scaleInCount!==0||!object(i)||i.version!==POSITION_ENTRY_VERSION||i.sourceObserved!==true||i.originalStrategyAssessmentObserved!==true||i.scopeMatched!==true||i.entryKind!=='open'||i.structuredAssessment?.strategy!=='trend-continuation')return null;
 if(typeof scope!=='string'||!scope||i.evaluationVersion!==scope||i.sourceExecution?.evaluationVersion!==scope||i.sourceExecution?.mode!=='paper'||typeof id!=='string'||p.accountId!==id||p.id!==i.positionId||i.fill?.accountId!==id||i.fill?.pair!==p.pair||!finite(p.qty)||p.qty<=0||!finite(i.fill?.qty)||i.fill.qty<p.qty-Math.max(1e-12,p.qty*1e-10)||!Number.isSafeInteger(p.openedAt)||!Number.isSafeInteger(i.fill.ts)||!Number.isSafeInteger(i.sourceTime)||i.sourceTime>i.fill.ts||i.fill.ts>p.openedAt)return null;
 return i;
}
function terms(c:DecisionContext,i:Record<string,any>){
 const fee=c.limits.TAKER_FEE_RATE,spread=c.limits.MAX_ENTRY_SPREAD_BPS,slip=c.limits.MAX_ENTRY_SLIPPAGE_BPS,fill=i.fill,stop=i.appliedProtection?.stopLossPrice;
 if(![fee,spread,slip,fill.qty,fill.fillPrice,fill.feeEur,stop].every(finite)||fee!<0||fee!>.05||spread!<0||spread!>1000||slip!<0||slip!>1000||fill.qty<=0||fill.fillPrice<=0||fill.feeEur<0||stop<=0)return null;
 const basis=fill.fillPrice+fill.feeEur/fill.qty;
 if(stop>=basis||Math.abs(fill.feeEur/(fill.qty*fill.fillPrice)-fee!)>1e-10)return null;
 const exitMultiplier=(1-slip!/10000)*(1-fee!),risk=1-stop*exitMultiplier/basis,closeMultiplier=(1-spread!/20000)*exitMultiplier;
 return finite(risk)&&risk>0&&risk<1?{basis,exitMultiplier,closeMultiplier,risk,fee,spread,slip}:null;
}
/** Exists-witness from at most48h of already CLOSED prices. No tick/high/low watermark.
 * Cost caps are explicit hypothetical marks, not guarantees of historical/executable fills. */
export function closedGainWitness(c:DecisionContext,p:Record<string,any>,candles:Candle[]){
 const now=Date.parse(c.timeUTC),features=c.features.filter(f=>f.pair===p.pair),f=features[0],i=origin(c,p),t=i?terms(c,i):null;
 const base={version:GAIN_PROTECTION_VERSION,asOf:now,positionId:p.id??null,entryFillId:i?.fill.id??null,signalClosedAt:f?f.ts+900000:null,signalClose:f?.price??null,complete:false,observedBars:0,fullSinceEntryCovered:false,referenceRiskPct:t?t.risk*100:null,witness:null as {closedAt:number;close:number;hypotheticalNetMarkPct:number}|null,sourceHash:null as string|null};
 if(!i||!t||features.length!==1||!f||!Number.isSafeInteger(now)||!Number.isSafeInteger(f.ts)||f.ts%900000||f.ts+900000>now||now-f.ts-900000>1200000||p.openedAt>=f.ts+900000)return base;
 const end=f.ts+900000,start=Math.max(Math.floor(p.openedAt/900000)*900000,end-48*3600000),rows=candles.filter(x=>x.pair===p.pair&&x.interval===15&&x.ts>=start&&x.ts<end).sort((a,b)=>a.ts-b.ts),expected=(end-start)/900000;
 const valid=rows.length===expected&&rows.every((x,j)=>x.ts===start+j*900000&&[x.open,x.high,x.low,x.close,x.volume].every(finite)&&x.low>0&&x.volume>=0&&x.low<=Math.min(x.open,x.close)&&x.high>=Math.max(x.open,x.close))&&rows.at(-1)?.close===f.price;
 if(!valid)return {...base,observedBars:rows.length};
 const earlier=rows.filter(x=>x.ts+900000>p.openedAt&&x.ts+900000<end),best=earlier.map(x=>({closedAt:x.ts+900000,close:x.close,hypotheticalNetMarkPct:(x.close*t.closeMultiplier/t.basis-1)*100})).sort((a,b)=>b.hypotheticalNetMarkPct-a.hypotheticalNetMarkPct||a.closedAt-b.closedAt)[0];
 return {...base,complete:true,observedBars:rows.length,fullSinceEntryCovered:start<=p.openedAt,witness:best&&best.hypotheticalNetMarkPct>=t.risk*100?best:null,sourceHash:createHash('sha256').update(JSON.stringify({scope:i.evaluationVersion,entry:i.fill.id,openedAt:p.openedAt,end,terms:t,closes:rows.map(x=>[x.ts,x.close])})).digest('hex')};
}
/** Discrete new SELL hypothesis: after a witnessed >=1R conservative closed-price mark,
 * current fresh bid net mark <=0 permits an extra exit. Existing exits remain first. */
export function gainProtectionPaperDecision(c:DecisionContext){
 const base=structureExitPaperDecision(c),assessments=structuredClone(base.evidence.assessments),checks:Record<string,string>={},optional:Extract<Action,{type:'sell'}>[]=[],now=Date.parse(c.timeUTC),markets=object(c.marketContext)&&Array.isArray(c.marketContext.markets)?c.marketContext.markets:[],panel=object(c.portfolioEvidence)?c.portfolioEvidence.gainProtection:null;
 for(const a of assessments){const held=c.positions.filter(p=>object(p)&&p.pair===a.pair);if(!held.length||a.action==='sell')continue;const p=held[0] as Record<string,any>,f=c.features.find(f=>f.pair===a.pair),i=origin(c,p),t=i?terms(c,i):null,frames=markets.filter(m=>m?.pair===a.pair),w=Array.isArray(panel)?panel.find(w=>w?.positionId===p.id):null;
  const deny=(s:string)=>{checks[a.pair]=s;};
  if(held.length!==1||!f||frames.length!==1||!a.support.includes('fresh-matching-closed-candle-and-book')){deny('fresh-unique-held-evidence-unavailable');continue;}
  if(!i||!t||p.openedAt>=f.ts+900000){deny('original-scoped-risk-or-new-observation-unavailable');continue;}
  if(!object(w)||w.version!==GAIN_PROTECTION_VERSION||w.complete!==true||w.asOf!==now||w.entryFillId!==i.fill.id||w.signalClosedAt!==f.ts+900000||w.signalClose!==f.price||typeof w.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(w.sourceHash)||!object(w.witness)||!Number.isSafeInteger(w.witness.closedAt)||w.witness.closedAt%900000!==0||w.witness.closedAt<f.ts+900000-48*3600000||!Number.isSafeInteger(w.observedBars)||w.observedBars<1||w.observedBars>192||w.witness.closedAt<=p.openedAt||w.witness.closedAt>=f.ts+900000||!finite(w.witness.close)||w.witness.close<=0||!finite(w.referenceRiskPct)||Math.abs(w.referenceRiskPct-t.risk*100)>1e-10){deny('causal-closed-one-risk-witness-unavailable');continue;}
  const priorMark=w.witness.close*t.closeMultiplier/t.basis-1,bid=Number(frames[0]?.microstructure?.bids?.[0]?.price),current=bid*t.exitMultiplier/t.basis-1;
  if(!finite(priorMark)||priorMark<t.risk||!finite(current)||bid<=0||current>0){deny('no-confirmed-giveback-to-cost-basis');continue;}
  a.action='sell';a.support.push('prior-closed-one-risk-mark-and-current-nonpositive-net-bid-mark');checks[a.pair]='new-closed-gain-protection-hypothesis-not-guaranteed-breakeven';optional.push({type:'sell',pair:a.pair,sellFraction:1,confidence:.8,reasoning:'GAIN-PROTECT: Frühere geschlossene Kursmarkierung mindestens1R unter Kostenannahmen, aktueller Netto-Bid-Merkwert wieder<=0. Neue diskrete Forschungsregel; kein garantierter Einstandspreis, Schutz-Stops bleiben unabhängig.'});
 }
 const actions:Action[]=[...base.answer.actions.filter(a=>a.type==='sell'),...optional.sort((a,b)=>a.pair.localeCompare(b.pair))].slice(0,3);if(actions.length<3)actions.push(...base.answer.actions.filter(a=>a.type==='buy').slice(0,3-actions.length));if(!actions.length)actions.push({type:'hold',confidence:0,reasoning:'NO TRADE: Kein zulässiger Einstieg oder bestätigter zusätzlicher geschlossener Gewinnschutz-Ausstieg.'});
 return {answer:{marketView:`PAPER-MOCK ${GAIN_PROTECTION_VERSION}: unvalidierte diskrete Gewinnschutz-Hypothese, keine KI-Prognose.`,actions},evidence:{...base.evidence,version:GAIN_PROTECTION_VERSION,baseVersion:base.evidence.version,assessments,gainProtectionChecks:checks,additionalGainProtectionExitProposals:optional.length,performanceValidated:false}};
}
export class GainProtectionPaperProvider implements DecisionProvider{private evidence:ReturnType<typeof gainProtectionPaperDecision>['evidence']|null=null;getEvidence(){return this.evidence?structuredClone(this.evidence):null;}async decide(c:DecisionContext):Promise<DecisionResult>{const r=gainProtectionPaperDecision(c);this.evidence=r.evidence;return r.answer;}}
