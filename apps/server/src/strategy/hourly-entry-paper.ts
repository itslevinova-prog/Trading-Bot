import type {Action,DecisionContext,DecisionProvider,DecisionResult,FeatureSnapshot} from '@paper/shared';
import {breakoutEntryPaperDecision} from './breakout-entry-paper.js';
import {HOURLY_TREND_VERSION} from '../context/hourly-trend.js';
export const HOURLY_ENTRY_VERSION='rising-hourly-breakout-entry-v1';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
/** Descriptive direction from the shared validated producer, matched to this exact feature origin. */
function hourlyEntryCheck(e:unknown,f:FeatureSnapshot|undefined,now:number):string|null{
 if(!f||!object(e)||e.version!==HOURLY_TREND_VERSION||e.complete!==true||e.reason!==null||!Number.isSafeInteger(now)||!Number.isSafeInteger(f.ts)||f.ts%900000||f.ts+900000>now||now-f.ts-900000>1200000)return 'closed-hourly-direction-unavailable';
 const end=f.ema50_60mClosedAt,previous=f.prevEma50_60m,current=f.ema50_60m;
 if(!Number.isSafeInteger(end)||Number(end)%3600000||Number(end)>f.ts+900000||Number(end)<7200000||now-Number(end)>4500000||!positive(previous)||!positive(current)||e.closedAt!==end||e.previousEma50!==previous||e.currentEma50!==current)return 'hourly-direction-feature-origin-mismatch';
 const delta=current-previous,tolerance=1e-12*Math.max(current,previous),direction=Math.abs(delta)<=tolerance?'flat':delta>0?'rising':'falling',slope=(current/previous-1)*100;
 if(!Number.isFinite(slope)||e.slopePct!==slope||e.direction!==direction)return 'hourly-direction-numerical-mismatch';
 return direction==='rising'?null:'closed-hourly-mean-not-rising';
}
/** Research-only hypothesis. Never registered as an active provider. No learned or real AI involved. */
export function hourlyEntryPaperDecision(c:DecisionContext){
 const base=breakoutEntryPaperDecision(c),assessments=structuredClone(base.evidence.assessments),markets=object(c.marketContext)&&Array.isArray(c.marketContext.markets)?c.marketContext.markets:[],hourlyEntryChecks:Record<string,string>={},now=Date.parse(c.timeUTC);
 for(const a of assessments){if(a.action!=='buy')continue;const frames=markets.filter(m=>m?.pair===a.pair),reason=frames.length!==1?'hourly-direction-market-not-unique':hourlyEntryCheck(frames[0]?.regime?.hourlyTrend,c.features.find(f=>f.pair===a.pair),now);
  if(reason){a.action='hold';a.contradictions.push(reason);hourlyEntryChecks[a.pair]=reason;}else{a.support.push('fresh-matching-closed-hourly-ema50-rising');hourlyEntryChecks[a.pair]='closed-hourly-direction-rising';}
 }
 const actions:Action[]=base.answer.actions.filter(a=>a.type==='sell');
 if(actions.length<3){const a=assessments.filter(a=>a.action==='buy').sort((a,b)=>b.payoff!.netRewardRisk-a.payoff!.netRewardRisk||a.pair.localeCompare(b.pair))[0];if(a)actions.push({type:'buy',pair:a.pair,amountEur:a.amount,stopLossPct:a.stop,takeProfitPct:a.target,confidence:.8,reasoning:'HOURLY-ENTRY: Geschlossener Ausbruch und steigender abgeschlossener Stunden-EMA50; bestehende Kosten-, Kovarianz- und Positionslimits erfüllt. Forschungshypothese;0.8 ist kein kalibrierter Gewinnwert.'});}
 if(!actions.length)actions.push({type:'hold',confidence:0,reasoning:('NO TRADE: '+[...new Set(assessments.flatMap(a=>a.contradictions))].slice(0,6).join(', ')).slice(0,400)});
 return {answer:{marketView:`PAPER-MOCK ${HOURLY_ENTRY_VERSION}: zusätzliche Stundenrichtung; Forschung ohne Profitnachweis.`,actions},evidence:{...base.evidence,version:HOURLY_ENTRY_VERSION,baseVersion:base.evidence.version,assessments,hourlyEntryChecks}};
}
export class HourlyEntryPaperProvider implements DecisionProvider{
 private evidence:ReturnType<typeof hourlyEntryPaperDecision>['evidence']|null=null;
 getEvidence(){return this.evidence?structuredClone(this.evidence):null;}
 async decide(c:DecisionContext):Promise<DecisionResult>{const r=hourlyEntryPaperDecision(c);this.evidence=r.evidence;return r.answer;}
}
