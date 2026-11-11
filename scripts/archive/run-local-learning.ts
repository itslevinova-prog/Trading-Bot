import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readDataset,canonicalJson} from '../apps/server/src/research/dataset.js';
import {learningObservations,learningFolds,splitLearningFold,fitRidge,ridgeForecast,selectLearningModel,forecastMetrics,fixedHorizonDiagnostic} from '../apps/server/src/research/local-learning.js';
const root=fileURLToPath(new URL('../',import.meta.url)),hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const protocolFile=resolve(root,'docs/learning-protocol-v1.json'),protocolBytes=readFileSync(protocolFile),protocol=JSON.parse(protocolBytes.toString('utf8'));
assert.equal(protocol.version,'local-ridge-research-v1');assert.equal(protocol.ridgeLambda,10);assert.equal(protocol.strideHours,6);assert.equal(protocol.horizonHours,4);assert.equal(protocol.entryLagMinutes,15);
assert.deepEqual([protocol.folds.trainDays,protocol.folds.validationDays,protocol.folds.testDays,protocol.folds.stepDays],[14,4,4,4]);
assert.equal(protocol.minimumTrainingRows,200);assert.equal(protocol.minimumValidationRows,40);assert.equal(protocol.oodMaxAbsTrainZ,6);assert.equal(protocol.maxModelAgeDays,10);
assert.equal(protocol.entryAllocationPct,.1);assert.equal(protocol.maxConcurrentDiagnosticPositions,3);assert.equal(protocol.forecastMargin,.005);
const d=readDataset(root,protocol.datasetId),from=d.options.fromTs,to=d.options.toTs+900000;
const observations=d.markets.flatMap(m=>learningObservations(m.symbol,m.bars.map(([ts,open,high,low,close,volume])=>({pair:m.symbol,interval:15,ts,open,high,low,close,volume})),from,to)).sort((a,b)=>a.decisionAt-b.decisionAt||a.pair.localeCompare(b.pair));
const costs={feeRate:d.options.feeRate,spreadBps:d.options.spreadBps,slippageBps:d.options.slippageBps};
const folds=learningFolds(from,to).map(f=>{
 const split=splitLearningFold(observations,f),counts={train:split.train.length,validation:split.validation.length,test:split.test.length};
 if(counts.train<200||counts.validation<40||!counts.test)return {window:f,counts,status:'insufficient-data'};
 const model=fitRidge(split.train,f.validationStart),predict=(rows:typeof observations)=>({zero:rows.map(()=>0),mean:rows.map(()=>model.intercept),ridge:rows.map(r=>ridgeForecast(model,r.x,r.decisionAt))});
 const validation=predict(split.validation),choice=selectLearningModel(split.validation,validation),test=predict(split.test);
 const models=Object.fromEntries((['zero','mean','ridge']as const).map(name=>[name,{forecastMetrics:forecastMetrics(split.test,test[name]),fixedHorizonDiagnostic:fixedHorizonDiagnostic(split.test,test[name],costs)}]));
 return {window:f,counts,status:'evaluated',training:model,validationChoice:choice,test:models,selectedModel:choice.selected,
 selectedTest:models[choice.selected],predictionAudit:split.test.map((r,i)=>({pair:r.pair,decisionAt:r.decisionAt,entryAt:r.entryAt,labelEnd:r.labelEnd,y:r.y,predictions:{zero:0,mean:test.mean[i],ridge:test.ridge[i]}}))};
});
const sourceFiles=['apps/server/src/research/local-learning.ts','apps/server/src/market/indicators.ts','apps/server/src/context/market-context.ts','apps/server/src/memory/math.ts','scripts/run-local-learning.ts'];
const report={version:protocol.version,protocolHash:hash(protocolBytes),datasetId:d.datasetId,capturedAt:d.capturedAt,window:{from,to},costs,
 sourceHashes:Object.fromEntries(sourceFiles.map(p=>[p,hash(readFileSync(resolve(root,p)))])),observations:observations.length,uniqueDecisionTimes:new Set(observations.map(r=>r.decisionAt)).size,pairs:d.markets.length,
 folds,scope:'Retrospective temporal holdout diagnostic on already-inspected, current-survivor universe; NOT independent prospective evidence or actual strategy/broker performance.',
 caveats:['Pooled simultaneous markets and adjacent folds are dependent; independent sample count unknown.','Labels assume earliest closed-bar availability; actual historical arrival times unknown.','Execution uses assumed spread/slippage and delayed OHLC open/close, no observed depth, queue, stops, intrahorizon marks or outages.','Model choice uses validation MAE/coverage, not future test returns; no model is activated.','Fixed-horizon forecasts/positions differ from existing rule/mock trading logic; original baseline retained separately.'],
 profitabilityEstablished:false,modelActivated:false,externalAiCalls:0,paidCalls:0,privateExchangeCalls:0,realOrders:0};
const reportId=hash(canonicalJson(report)),artifact=resolve(root,'data/learning-reports',reportId+'.json');mkdirSync(resolve(root,'data/learning-reports'),{recursive:true});
if(existsSync(artifact))assert.deepEqual(JSON.parse(readFileSync(artifact,'utf8')).report,report);else writeFileSync(artifact,JSON.stringify({generatedAt:new Date().toISOString(),reportId,report},null,2),{flag:'wx'});
console.log(JSON.stringify({reportId,artifact,observations:observations.length,decisionTimes:report.uniqueDecisionTimes,pairs:d.markets.length,costs,folds:folds.map(f=>({window:f.window,counts:f.counts,status:f.status,selected:'selectedModel'in f?f.selectedModel:null,models:'test'in f?Object.fromEntries(Object.entries(f.test!).map(([k,v])=>[k,{mae:v.forecastMetrics.mae,coverage:v.forecastMetrics.coverage,diagnosticReturnPct:v.fixedHorizonDiagnostic.returnPct,trades:v.fixedHorizonDiagnostic.trades}])):null})),profitabilityEstablished:false,modelActivated:false}));
