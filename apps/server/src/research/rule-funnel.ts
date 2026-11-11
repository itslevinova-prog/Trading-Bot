import {FeatureSnapshotSchema} from '@paper/shared';
import type {Action,DecisionContext,DecisionProvider,DecisionResult,FeatureSnapshot} from '@paper/shared';
import {RuleBasedProvider,buySignal,sellSignal} from '../strategy/providers.js';
import {assessSignalQuality,safePositionBudget,type QualityAssessment} from '../strategy/quality.js';
const SIGNAL_NAMES=['EMA20 crosses above EMA50','Price above hourly EMA50','RSI45..70','Volume ratio at least1.2','Spread at most0.3 percent'];
export const FUNNEL_CONTRACT={version:2,signalOrder:SIGNAL_NAMES,qualityVolatilityPct:{min:.8,max:5},qualityRsi:{min:48,max:68},nominalStopLossPct:.05,nominalTakeProfitPct:.10,featureTimePolicy:'At most execution boundary; nominal replay decision is boundary+5000ms',statisticsPolicy:'Descriptive gate counts on already inspected history; no alternate threshold or strategy evaluation'};
type Gate={name:string;entered:number;passed:number;failed:number;independentPopulation:number;independentFailures:number};
type Bucket={features:number;heldFeatures:number;unheldFeatures:number;buySignalMatches:number;qualityPassed:number;budgetRejected:number;slotOmitted:number;emittedBuys:number;emittedSells:number;signal:Gate[];quality:Gate[];atrAll:number[];atrMatches:number[];rsiMatches:number[];volumeMatches:number[]};
const gate=(name:string):Gate=>({name,entered:0,passed:0,failed:0,independentPopulation:0,independentFailures:0});
const bucket=():Bucket=>({features:0,heldFeatures:0,unheldFeatures:0,buySignalMatches:0,qualityPassed:0,budgetRejected:0,slotOmitted:0,emittedBuys:0,emittedSells:0,signal:SIGNAL_NAMES.map(gate),quality:[],atrAll:[],atrMatches:[],rsiMatches:[],volumeMatches:[]});
function advance(gates:Gate[],flags:boolean[]){let entered=true;for(let i=0;i<gates.length;i++){const g=gates[i]!;g.independentPopulation++;if(!flags[i])g.independentFailures++;if(entered){g.entered++;if(flags[i])g.passed++;else{g.failed++;entered=false;}}}}
function distribution(values:number[]){if(!values.length)return {samples:0,min:null,p10:null,median:null,p90:null,max:null};const sorted=[...values].sort((a,b)=>a-b),at=(p:number)=>sorted[Math.floor((sorted.length-1)*p)]!;return {samples:sorted.length,min:at(0),p10:at(.1),median:at(.5),p90:at(.9),max:at(1)};}
function summarize(b:Bucket){const {atrAll,atrMatches,rsiMatches,volumeMatches,...counts}=b;return {...counts,distributions:{atrPctAllUnheldFeatures:distribution(atrAll),atrPctBuySignalMatches:distribution(atrMatches),rsiBuySignalMatches:distribution(rsiMatches),volumeRatioBuySignalMatches:distribution(volumeMatches)}};}
function flags(f:FeatureSnapshot){return [f.prevEma20<=f.prevEma50&&f.ema20>f.ema50,f.price>f.ema50_60m,f.rsi14>=45&&f.rsi14<=70,f.volumeRatio>=1.2,f.spreadPct<=.3];}
function qualityFlags(f:FeatureSnapshot,fee:number){const cost=fee*200+f.spreadPct;return [f.price>f.ema50_60m&&f.change4h>0,f.ema20>f.ema50&&f.distanceEma50Pct>=0&&f.distanceEma50Pct<=5,f.rsi14>=48&&f.rsi14<=68,f.volumeRatio>=1.2,f.atrPct>=.8&&f.atrPct<=5,f.spreadPct>=0&&f.spreadPct<=.20&&10>=cost*3];}
type Evaluation={f:FeatureSnapshot;held:boolean;signal:boolean[];q:QualityAssessment|null};
/** Observes the stock rule provider only. No strategy, risk or execution parameter is changed. */
export class RuleFunnelProvider implements DecisionProvider{
 private inner=new RuleBasedProvider();private total=bucket();private perPair=new Map<string,Bucket>();private perDay=new Map<string,Bucket>();
 private decisions=0;private holds=0;private decisionsOverThreeActions=0;private firstAt:number|null=null;private lastAt:number|null=null;private lastBoundary=-1;private featureCount=0;
 constructor(private universe:readonly string[],private maximumFeatureEvaluations=4000000){if(!universe.length||universe.length>100||new Set(universe).size!==universe.length||!Number.isSafeInteger(maximumFeatureEvaluations)||maximumFeatureEvaluations<1||maximumFeatureEvaluations>4000000)throw Error('Invalid rule funnel universe or resource bound');this.universe=[...universe];for(const pair of universe)this.perPair.set(pair,bucket());}
 async decide(context:DecisionContext):Promise<DecisionResult>{
  const features=context.features.map(f=>({...f})),positions=context.positions.map(p=>({pair:(p as {pair:string}).pair})),limits={...context.limits},equity=(context.account as {equity:number}).equity;
  const at=Date.parse(context.timeUTC),boundary=at-5000,fee=limits.TAKER_FEE_RATE??.008,minimum=limits.MIN_ORDER_EUR??10;
  if(!Number.isSafeInteger(boundary)||boundary<0||boundary%900000!==0||boundary<=this.lastBoundary||!Number.isFinite(equity)||equity<=0||!Number.isFinite(fee)||fee<0||fee>.05||!Number.isFinite(minimum)||minimum<=0||positions.some(p=>!this.perPair.has(p.pair))||new Set(positions.map(p=>p.pair)).size!==positions.length||new Set(features.map(f=>f.pair)).size!==features.length)throw Error('Invalid chronological rule observation');
  if(this.featureCount+features.length>this.maximumFeatureEvaluations)throw Error('Rule diagnostic resource bound exceeded; no truncated report');
  const held=new Set(positions.map(p=>p.pair)),evaluations:Evaluation[]=features.map(f=>{
   if(!FeatureSnapshotSchema.safeParse(f).success||!this.perPair.has(f.pair)||!Number.isSafeInteger(f.ts)||f.ts<0||f.ts%900000!==0||f.ts+900000>boundary||Object.entries(f).some(([key,value])=>key!=='pair'&&(typeof value!=='number'||!Number.isFinite(value))))throw Error('Invalid or future closed rule feature');
   const signal=flags(f);if(signal.every(Boolean)!==buySignal(f))throw Error('Rule diagnostic signal contract changed');let q:QualityAssessment|null=null;
   if(!held.has(f.pair)&&signal.every(Boolean)){q=assessSignalQuality(f,fee);const expected=qualityFlags(f,fee);if(q.maximum!==6||q.checks.length!==6||q.checks.some((c,i)=>c.passed!==expected[i])||q.passed!==expected.every(Boolean))throw Error('Rule diagnostic quality contract changed');}
   return {f,held:held.has(f.pair),signal,q};
  });
  const sells=features.filter(f=>held.has(f.pair)&&sellSignal(f)),candidates=evaluations.filter(e=>e.q?.passed).sort((a,b)=>b.f.volumeRatio-a.f.volumeRatio),slots=Math.max(0,3-sells.length),budget=safePositionBudget(equity,.05),selected=budget>=minimum?candidates.slice(0,slots):[];
  const answer=await this.inner.decide(context),actualBuys=answer.actions.filter((a):a is Extract<Action,{type:'buy'}>=>a.type==='buy'),actualSells=answer.actions.filter(a=>a.type==='sell');
  if(JSON.stringify(actualBuys.map(a=>[a.pair,a.amountEur]))!==JSON.stringify(selected.map(e=>[e.f.pair,budget]))||JSON.stringify(actualSells.map(a=>a.pair))!==JSON.stringify(sells.map(f=>f.pair))||answer.actions.some(a=>a.type==='hold')!==(actualBuys.length+actualSells.length===0))throw Error('Actual rule actions disagree with descriptive funnel; report refused');
  this.lastBoundary=boundary;this.firstAt??=at;this.lastAt=at;this.decisions++;this.featureCount+=features.length;if(answer.actions.some(a=>a.type==='hold'))this.holds++;if(answer.actions.length>3)this.decisionsOverThreeActions++;
  const day=new Date(boundary).toISOString().slice(0,10),daily=this.perDay.get(day)??bucket();this.perDay.set(day,daily);const selectedPairs=new Set(selected.map(e=>e.f.pair)),sellPairs=new Set(sells.map(f=>f.pair));
  for(const e of evaluations)for(const b of [this.total,this.perPair.get(e.f.pair)!,daily]){
   b.features++;if(e.held){b.heldFeatures++;if(sellPairs.has(e.f.pair))b.emittedSells++;continue;}b.unheldFeatures++;b.atrAll.push(e.f.atrPct);advance(b.signal,e.signal);
   if(!e.q)continue;b.buySignalMatches++;b.atrMatches.push(e.f.atrPct);b.rsiMatches.push(e.f.rsi14);b.volumeMatches.push(e.f.volumeRatio);
   if(!b.quality.length)b.quality=e.q.checks.map(c=>gate(c.name));if(b.quality.some((g,i)=>g.name!==e.q!.checks[i]!.name))throw Error('Quality diagnostic names changed');advance(b.quality,e.q.checks.map(c=>c.passed));
   if(e.q.passed){b.qualityPassed++;if(budget<minimum)b.budgetRejected++;else if(selectedPairs.has(e.f.pair))b.emittedBuys++;else b.slotOmitted++;}
  }
  return answer;
 }
 snapshot(){
  const totals=summarize(this.total);return structuredClone({contract:FUNNEL_CONTRACT,decisions:this.decisions,holdDecisions:this.holds,firstDecisionAt:this.firstAt,lastDecisionAt:this.lastAt,expectedFeatureSlots:this.decisions*this.universe.length,observedFeatureSlots:this.featureCount,unavailableFeatureSlots:this.decisions*this.universe.length-this.featureCount,decisionsOverThreeActions:this.decisionsOverThreeActions,totals,perPair:this.universe.map(pair=>({pair,...summarize(this.perPair.get(pair)!)})),perDay:[...this.perDay].map(([day,b])=>({day,...summarize(b)})),profitabilityEstablished:false,thresholdsChanged:false,alternateStrategiesEvaluated:0,warnings:['Counts and distributions describe the already inspected frozen window. No causal or profit probability interpretation.','Sequential first-failure counts depend on the stated order. Independent failures overlap and cannot be added as unique rejected candidates.','Unavailable feature slots combine absent current bars and feature warmup/gap/staleness gates; causes are not silently inferred.','Rule sell exits are preserved even if more than three; the AI JSON action limit is a separate contract.','Prior experiments remain inspected; zero additional variants here does not reset trial history.','Provider actions precede broker gates. Portfolio rejections may also include protective retries; these labels are not all provider buy rejections.','Feature evaluations across time and markets are correlated, not independent trade or win-probability trials.','Percentiles use nearest lower rank with index floor((n-1)*p); empty samples remain null.']});
 }
}
