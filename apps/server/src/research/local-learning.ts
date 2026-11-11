import type {Candle} from '@paper/shared';
import {feature} from '../market/indicators.js';
import {aggregate} from '../context/market-context.js';
import {vector} from '../memory/math.js';
const STEP=900000,DAY=86400000;
export type LearningObservation={pair:string;decisionAt:number;entryAt:number;labelEnd:number;x:number[];y:number;entryPrice:number;exitPrice:number};
export type Fold={trainStart:number;validationStart:number;testStart:number;testEnd:number};
const time=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const validX=(x:unknown):x is number[]=>Array.isArray(x)&&x.length===8&&Array.from(x).every(Number.isFinite);
/** Offline labels are earliest closed-bar availability, NOT observed arrival timestamps. */
export function learningObservations(pair:string,bars:Candle[],from:number,to:number):LearningObservation[]{
 if(!time(from)||!time(to)||to<=from)throw Error('Invalid learning window');
 const sorted=[...bars].sort((a,b)=>a.ts-b.ts);
 if(sorted.some((c,i)=>c.pair!==pair||c.interval!==15||!time(c.ts)||c.ts%STEP!==0||i>0&&c.ts===sorted[i-1]!.ts||![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)||c.low<=0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.volume<0))throw Error('Invalid or duplicate learning candle');
 const hourly=aggregate(sorted,60,Infinity),byTime=new Map(sorted.map(c=>[c.ts,c])),result:LearningObservation[]=[];
 for(const c of sorted){const decisionAt=c.ts+STEP,entryAt=decisionAt+STEP,labelEnd=entryAt+16*STEP;
  if(decisionAt<from||decisionAt>=to||decisionAt%(6*3600000)!==0||labelEnd>to)continue;
  const entry=byTime.get(entryAt),exit=byTime.get(labelEnd-STEP);
  if(!entry||!exit||Array.from({length:16},(_,i)=>entryAt+i*STEP).some(ts=>!byTime.has(ts)))continue;
  const f=feature(pair,sorted,hourly,{bid:c.close,ask:c.close},decisionAt);if(!f)continue;
  const x=vector(f),y=exit.close/entry.open-1;if(!validX(x)||!Number.isFinite(y))continue;
  result.push({pair,decisionAt,entryAt,labelEnd,x,y,entryPrice:entry.open,exitPrice:exit.close});
 }
 return result;
}
export function learningFolds(from:number,to:number):Fold[]{
 if(!time(from)||!time(to)||from%STEP!==0||to%STEP!==0||to<=from)throw Error('Invalid fold window');
 const folds:Fold[]=[];for(let start=from;start+22*DAY<=to;start+=4*DAY)folds.push({trainStart:start,validationStart:start+14*DAY,testStart:start+18*DAY,testEnd:start+22*DAY});return folds;
}
export function splitLearningFold(rows:LearningObservation[],f:Fold){
 return {train:rows.filter(r=>r.decisionAt>=f.trainStart&&r.decisionAt<f.validationStart&&r.labelEnd<f.validationStart),
 validation:rows.filter(r=>r.decisionAt>=f.validationStart&&r.decisionAt<f.testStart&&r.labelEnd<f.testStart),
 test:rows.filter(r=>r.decisionAt>=f.testStart&&r.decisionAt<f.testEnd&&r.labelEnd<=f.testEnd)};
}
export type RidgeModel={version:'local-ridge-v1';trainedAt:number;lastLabelEnd:number;rows:number;lambda:number;means:number[];stds:number[];weights:number[];intercept:number};
export function fitRidge(rows:LearningObservation[],trainedAt:number,lambda=10,minRows=200,sampleWeights?:readonly number[]):RidgeModel{
 if(!time(trainedAt)||!Number.isFinite(lambda)||lambda<=0||!Number.isSafeInteger(minRows)||minRows<2||rows.length<minRows)throw Error('Insufficient or invalid training configuration');
 if(rows.some(r=>!validX(r.x)||!Number.isFinite(r.y)||!time(r.decisionAt)||!time(r.labelEnd)||r.labelEnd<=r.decisionAt||r.labelEnd>=trainedAt))throw Error('Invalid or unavailable training labels');
 if(new Set(rows.map(r=>r.pair+':'+r.decisionAt)).size!==rows.length)throw Error('Duplicate training observation');
 if(sampleWeights!==undefined&&(!Array.isArray(sampleWeights)||sampleWeights.length!==rows.length||sampleWeights.some(w=>!Number.isFinite(w)||w<=0)))throw Error('Invalid training sample weights');
 const totalWeight=sampleWeights?.reduce((n,w)=>n+w,0)??rows.length;if(!Number.isFinite(totalWeight)||totalWeight<=0)throw Error('Invalid training weight sum');
 const n=rows.length,weight=(i:number)=>sampleWeights?.[i]??1,means=Array.from({length:8},(_,j)=>rows.reduce((s,r,i)=>s+weight(i)*r.x[j]!,0)/totalWeight),stds=means.map((m,j)=>Math.sqrt(rows.reduce((s,r,i)=>s+weight(i)*(r.x[j]!-m)**2,0)/totalWeight)||1),intercept=rows.reduce((s,r,i)=>s+weight(i)*r.y,0)/totalWeight;
 const a=Array.from({length:8},(_,j)=>Array.from({length:9},(_,k)=>k===j?lambda:0));
 for(let i=0;i<rows.length;i++){const r=rows[i]!,w=weight(i),z=r.x.map((v,j)=>(v-means[j]!)/stds[j]!);for(let j=0;j<8;j++){for(let k=0;k<8;k++)a[j]![k]!+=w*z[j]!*z[k]!;a[j]![8]!+=w*z[j]!*(r.y-intercept);}}
 // Small fixed eight-dimensional ridge system, partial-pivot Gaussian elimination.
 for(let col=0;col<8;col++){let pivot=col;for(let j=col+1;j<8;j++)if(Math.abs(a[j]![col]!)>Math.abs(a[pivot]![col]!))pivot=j;
  [a[col],a[pivot]]=[a[pivot]!,a[col]!];const div=a[col]![col]!;if(!Number.isFinite(div)||Math.abs(div)<1e-12)throw Error('Unstable ridge system');
  for(let k=col;k<=8;k++)a[col]![k]!/=div;
  for(let j=0;j<8;j++)if(j!==col){const factor=a[j]![col]!;for(let k=col;k<=8;k++)a[j]![k]!-=factor*a[col]![k]!;}
 }
 const weights=a.map(r=>r[8]!);if(![...means,...stds,...weights,intercept].every(Number.isFinite))throw Error('Nonfinite ridge fit');
 return {version:'local-ridge-v1',trainedAt,lastLabelEnd:Math.max(...rows.map(r=>r.labelEnd)),rows:n,lambda,means,stds,weights,intercept};
}
export function ridgeForecast(m:RidgeModel,x:number[],asOf:number):number|null{
 // Model snapshots are data: malformed dimensions/scales must never become a finite forecast.
 if(!m||typeof m!=='object'||Array.isArray(m)||!Number.isSafeInteger(m.rows)||m.rows<2||!Number.isFinite(m.lambda)||m.lambda<=0||!Number.isFinite(m.intercept)||!validX(m.means)||!validX(m.stds)||m.stds.some(s=>s<=0)||!validX(m.weights))return null;
 if(m.version!=='local-ridge-v1'||!time(asOf)||!time(m.trainedAt)||!time(m.lastLabelEnd)||m.lastLabelEnd>=m.trainedAt||asOf<m.trainedAt||asOf-m.trainedAt>10*DAY||asOf-m.lastLabelEnd>10*DAY||!validX(x))return null;
 const z=x.map((v,j)=>(v-m.means[j]!)/m.stds[j]!);if(z.some(v=>!Number.isFinite(v)||Math.abs(v)>6))return null;
 const forecast=m.intercept+z.reduce((s,v,j)=>s+v*m.weights[j]!,0);return Number.isFinite(forecast)?forecast:null;
}
export function forecastMetrics(rows:LearningObservation[],predictions:(number|null)[]){
 if(rows.length!==predictions.length||predictions.some(p=>p!==null&&!Number.isFinite(p)))throw Error('Invalid forecast metrics');
 const n=rows.length,errors=rows.map((r,i)=>(predictions[i]??0)-r.y),covered=predictions.filter(p=>p!==null).length;
 return {rows:n,uniqueDecisionTimes:new Set(rows.map(r=>r.decisionAt)).size,pairs:new Set(rows.map(r=>r.pair)).size,coverage:n?covered/n:null,mae:n?errors.reduce((s,e)=>s+Math.abs(e),0)/n:null,rmse:n?Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/n):null,abstentionsScoredAsZero:true,independentSamples:null};
}
export type DiagnosticCosts={feeRate:number;spreadBps:number;slippageBps:number};
export function diagnosticCostFactors(c:DiagnosticCosts){
 if(![c.feeRate,c.spreadBps,c.slippageBps].every(Number.isFinite)||c.feeRate<0||c.feeRate>.05||c.spreadBps<0||c.spreadBps>1000||c.slippageBps<0||c.slippageBps>1000)throw Error('Invalid diagnostic costs');
 const entry=(1+c.spreadBps/20000)*(1+c.slippageBps/10000)*(1+c.feeRate),exit=(1-c.spreadBps/20000)*(1-c.slippageBps/10000)*(1-c.feeRate);
 return {entry,exit,requiredGrossReturn:entry/exit-1};
}
/** Research-only fixed-horizon capital diagnostic; no broker, orders, stops or model activation. */
export function fixedHorizonDiagnostic(rows:LearningObservation[],predictions:(number|null)[],costs:DiagnosticCosts){
 if(rows.length!==predictions.length||predictions.some(p=>p!==null&&!Number.isFinite(p)))throw Error('Invalid diagnostic predictions');
 const factors=diagnosticCostFactors(costs),groups=new Map<number,{row:LearningObservation;forecast:number}[]>();
 if(new Set(rows.map(r=>r.pair+':'+r.decisionAt)).size!==rows.length||rows.some(r=>r.decisionAt%(6*3600000)!==0||r.entryAt!==r.decisionAt+STEP||r.labelEnd!==r.entryAt+16*STEP||![r.entryPrice,r.exitPrice].every(p=>Number.isFinite(p)&&p>0)))throw Error('Invalid fixed-horizon observations');
 rows.forEach((row,i)=>{const p=predictions[i];if(p!==null&&p!==undefined&&p>factors.requiredGrossReturn+.005){const group=groups.get(row.decisionAt)??[];group.push({row,forecast:p});groups.set(row.decisionAt,group);}});
 let equity=1,peak=1,worst=0,fees=0,trades=0;const curve:{decisionAt:number;equity:number}[]=[];
 for(const [ts,entries]of [...groups].sort(([a],[b])=>a-b)){
  let pnl=0;for(const {row}of entries.sort((a,b)=>b.forecast-a.forecast||a.row.pair.localeCompare(b.row.pair)).slice(0,3)){
   const budget=equity*.1,qty=budget/(row.entryPrice*factors.entry),proceeds=qty*row.exitPrice*factors.exit;
   pnl+=proceeds-budget;fees+=budget*costs.feeRate/(1+costs.feeRate)+qty*row.exitPrice*(1-costs.spreadBps/20000)*(1-costs.slippageBps/10000)*costs.feeRate;trades++;
  }
  equity+=pnl;peak=Math.max(peak,equity);worst=Math.max(worst,(peak-equity)/peak);curve.push({decisionAt:ts,equity});
 }
 return {returnPct:(equity-1)*100,exitSampledDrawdownPct:worst*100,feesPctStartingCapital:fees*100,trades,curve,execution:'assumed delayed open/4h close, no observed depth/queue/stops or intrahorizon marks',performanceValidated:false};
}

export function selectLearningModel(validation:LearningObservation[],predictions:Record<'zero'|'mean'|'ridge',(number|null)[]>){
 const metrics=Object.fromEntries((['zero','mean','ridge']as const).map(name=>[name,forecastMetrics(validation,predictions[name])]));
 let selected:'zero'|'mean'|'ridge'='zero',best=metrics.zero!.mae??Infinity;
 if(validation.length>=40)for(const name of ['mean','ridge']as const){const m=metrics[name]!;if(m.coverage!==null&&m.coverage>=.95&&m.mae!==null&&m.mae<best-1e-12){best=m.mae;selected=name;}}
 return {selected,metrics,reason:validation.length<40?'insufficient validation; default NO TRADE':'lowest validation MAE, coverage gate, conservative ties; no test labels used'};
}
