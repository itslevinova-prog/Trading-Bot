import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readDataset,canonicalJson} from '../apps/server/src/research/dataset.js';
import {learningObservations,learningFolds,splitLearningFold,fitRidge,ridgeForecast,selectLearningModel,forecastMetrics,fixedHorizonDiagnostic,diagnosticCostFactors,type LearningObservation,type DiagnosticCosts} from '../apps/server/src/research/local-learning.js';
const root=fileURLToPath(new URL('../',import.meta.url)),hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex'),STEP=900000,DAY=86400000,SIX=21600000;
const protocolBytes=readFileSync(resolve(root,'docs/learning-protocol-v2-expanded.json')),protocol=JSON.parse(protocolBytes.toString('utf8'));
assert.equal(protocol.version,'local-ridge-expanded-v2');assert.equal(protocol.ridgeLambda,10);assert.equal(protocol.stressCostMultiplier,2);
assert.deepEqual([protocol.strideHours,protocol.horizonHours,protocol.entryLagMinutes],[6,4,15]);
assert.deepEqual([protocol.folds.trainDays,protocol.folds.validationDays,protocol.folds.testDays,protocol.folds.stepDays],[14,4,4,4]);
assert.deepEqual([protocol.minimumTrainingRows,protocol.minimumValidationRows,protocol.oodMaxAbsTrainZ,protocol.maxModelAgeDays,protocol.entryAllocationPct,protocol.maxConcurrentDiagnosticPositions,protocol.forecastMargin],[200,40,6,10,.1,3,.005]);
const d=readDataset(root,protocol.datasetId),from=Math.ceil((Math.max(...d.markets.map(m=>m.bars[0]![0]))+3*DAY)/SIX)*SIX,to=Math.min(...d.markets.map(m=>m.bars.at(-1)![0]+STEP));
const observations=d.markets.flatMap(m=>learningObservations(m.symbol,m.bars.map(([ts,open,high,low,close,volume])=>({pair:m.symbol,interval:15,ts,open,high,low,close,volume})),from,to)).sort((a,b)=>a.decisionAt-b.decisionAt||a.pair.localeCompare(b.pair));
const costs={feeRate:d.options.feeRate,spreadBps:d.options.spreadBps,slippageBps:d.options.slippageBps},stressCosts={feeRate:2*costs.feeRate,spreadBps:2*costs.spreadBps,slippageBps:2*costs.slippageBps};
function pairedReprice(rows:LearningObservation[],predictions:(number|null)[],base:DiagnosticCosts,stress:DiagnosticCosts){
 const a=diagnosticCostFactors(base),b=diagnosticCostFactors(stress),groups=new Map<number,{row:LearningObservation;forecast:number}[]>();
 rows.forEach((row,i)=>{const p=predictions[i];if(p!==undefined&&p!==null&&p>a.requiredGrossReturn+.005){const g=groups.get(row.decisionAt)??[];g.push({row,forecast:p});groups.set(row.decisionAt,g);}});
 let baseEquity=1,stressEquity=1;const positions:{pair:string;decisionAt:number;entryAt:number;labelEnd:number;forecast:number;grossReturn:number;baseNetReturn:number;stressNetReturn:number}[]=[];
 for(const [ts,group]of [...groups].sort(([a],[b])=>a-b)){
  let baseChange=0,stressChange=0;
  for(const {row,forecast}of group.sort((a,b)=>b.forecast-a.forecast||a.row.pair.localeCompare(b.row.pair)).slice(0,3)){
   const gross=row.exitPrice/row.entryPrice-1,baseNet=(1+gross)*a.exit/a.entry-1,stressNet=(1+gross)*b.exit/b.entry-1;
   assert.ok(stressNet<=baseNet+1e-12);baseChange+=.1*baseNet;stressChange+=.1*stressNet;
   positions.push({pair:row.pair,decisionAt:ts,entryAt:row.entryAt,labelEnd:row.labelEnd,forecast,grossReturn:gross,baseNetReturn:baseNet,stressNetReturn:stressNet});
  }
  baseEquity*=1+baseChange;stressEquity*=1+stressChange;
 }
 assert.ok(stressEquity<=baseEquity+1e-12);
 return {baseReturnPct:(baseEquity-1)*100,stressReturnPct:(stressEquity-1)*100,positions,trades:positions.length,monotonicForSamePositions:true};
}
const folds=learningFolds(from,to).map(f=>{
 const split=splitLearningFold(observations,f),counts={train:split.train.length,validation:split.validation.length,test:split.test.length};
 if(counts.train<200||counts.validation<40||!counts.test)return {window:f,counts,status:'insufficient-data' as const};
 const model=fitRidge(split.train,f.validationStart),predict=(rows:typeof observations)=>({zero:rows.map(()=>0),mean:rows.map(()=>model.intercept),ridge:rows.map(r=>ridgeForecast(model,r.x,r.decisionAt))});
 const validation=predict(split.validation),choice=selectLearningModel(split.validation,validation),test=predict(split.test);
 const models=Object.fromEntries((['zero','mean','ridge']as const).map(name=>{
  const base=fixedHorizonDiagnostic(split.test,test[name],costs),stressAdaptive=fixedHorizonDiagnostic(split.test,test[name],stressCosts),paired=pairedReprice(split.test,test[name],costs,stressCosts);
  assert.ok(Math.abs(base.returnPct-paired.baseReturnPct)<1e-10);
  assert.equal(base.trades,paired.trades);
  return [name,{forecastMetrics:forecastMetrics(split.test,test[name]),base,stressAdaptive,paired}];
 }));
 return {window:f,counts,status:'evaluated' as const,training:model,validationChoice:choice,test:models,selectedModel:choice.selected,selectedTest:models[choice.selected],predictionAudit:split.test.map((r,i)=>({pair:r.pair,decisionAt:r.decisionAt,entryAt:r.entryAt,labelEnd:r.labelEnd,y:r.y,predictions:{zero:0,mean:test.mean[i],ridge:test.ridge[i]}}))};
});
const evaluated=folds.filter(f=>f.status==='evaluated');
for(let i=1;i<evaluated.length;i++)assert.ok(evaluated[i]!.window.testStart>=evaluated[i-1]!.window.testEnd,'Cannot compound overlapping test windows');
const aggregate=Object.fromEntries((['zero','mean','ridge','selected']as const).map(name=>{
 const ms=evaluated.map(f=>name==='selected'?f.selectedTest!:f.test![name]!);const n=ms.reduce((s,m)=>s+m.forecastMetrics.rows,0);
 return [name,{testRows:n,mae:n?ms.reduce((s,m)=>s+m.forecastMetrics.mae!*m.forecastMetrics.rows,0)/n:null,coverage:n?ms.reduce((s,m)=>s+m.forecastMetrics.coverage!*m.forecastMetrics.rows,0)/n:null,
 baseReturnPct:(ms.reduce((e,m)=>e*(1+m.base.returnPct/100),1)-1)*100,stressAdaptiveReturnPct:(ms.reduce((e,m)=>e*(1+m.stressAdaptive.returnPct/100),1)-1)*100,pairedStressReturnPct:(ms.reduce((e,m)=>e*(1+m.paired.stressReturnPct/100),1)-1)*100,
 baseTrades:ms.reduce((s,m)=>s+m.base.trades,0),stressAdaptiveTrades:ms.reduce((s,m)=>s+m.stressAdaptive.trades,0),independentSamples:null}];
}));
const sources=['apps/server/src/research/local-learning.ts','apps/server/src/market/indicators.ts','apps/server/src/context/market-context.ts','apps/server/src/memory/math.ts','scripts/run-local-learning-extended.ts'];
const report={version:protocol.version,protocolHash:hash(protocolBytes),datasetId:d.datasetId,capturedAt:d.capturedAt,window:{from,to},costs,stressCosts,observations:observations.length,uniqueDecisionTimes:new Set(observations.map(r=>r.decisionAt)).size,pairs:d.markets.length,
 sourceHashes:Object.fromEntries(sources.map(p=>[p,hash(readFileSync(resolve(root,p)))])),aggregate,folds,ridgeBeatsZeroMaeFolds:evaluated.filter(f=>f.test!.ridge!.forecastMetrics.mae!<f.test!.zero!.forecastMetrics.mae!).length,
 scope:'Broader retrospective temporal holdouts, same previously inspected90-day survivor archive; no new independent/prospective evidence. Fixed-horizon diagnostic is not broker or actual rule/mock performance.',
 caveats:['Cross-market rows/adjacent model fits remain dependent.','Actual arrival times, depth, queue, lot minima, stops, intrahorizon marks and outages unknown/unmodeled.','Adaptive cost stress changes eligibility and can remove losing trades; paired repricing isolates worse execution costs with unchanged positions.','No tuning on expanded test results; no model activated.'],profitabilityEstablished:false,modelActivated:false,externalAiCalls:0,privateExchangeCalls:0,paidCalls:0,realOrders:0};
const reportId=hash(canonicalJson(report)),artifact=resolve(root,'data/learning-reports',reportId+'.json');mkdirSync(resolve(root,'data/learning-reports'),{recursive:true});
if(existsSync(artifact))assert.deepEqual(JSON.parse(readFileSync(artifact,'utf8')).report,report);else writeFileSync(artifact,JSON.stringify({generatedAt:new Date().toISOString(),reportId,report},null,2),{flag:'wx'});
console.log(JSON.stringify({reportId,artifact,window:report.window,observations:report.observations,decisionTimes:report.uniqueDecisionTimes,folds:folds.length,evaluatedFolds:evaluated.length,ridgeBeatsZeroMaeFolds:report.ridgeBeatsZeroMaeFolds,aggregate,selected:evaluated.map(f=>f.selectedModel),profitabilityEstablished:false,modelActivated:false}));
