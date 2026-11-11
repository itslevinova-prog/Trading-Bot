import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {inspectBuild,digest} from '../apps/server/dist/provenance/build.js';
import {canonicalJson} from '../apps/server/dist/research/dataset.js';
import {policyLearningFold} from '../apps/server/dist/research/policy-learning.js';
const read=p=>JSON.parse(readFileSync(p,'utf8')),build=inspectBuild(process.cwd());assert.equal(build.verified,true);
const pointer=read('docs/policy-inputs-latest.json'),input=read(pointer.path);assert.equal(digest(canonicalJson(input.groups)),input.factsHash);assert.equal(input.factsHash,pointer.factsHash);
const reportPointer=read('docs/mock-structure-study-latest.json'),report=read(reportPointer.path),{reportHash,generatedAt,...reportFacts}=report;assert.equal(digest(canonicalJson(reportFacts)),reportHash);assert.equal(reportHash,input.sourceReportHash);
const protocolPath='docs/policy-learning-protocol-v1.json',protocol=read(protocolPath),protocolHash=digest(readFileSync(protocolPath));assert.equal(protocol.sourceInputFactsHash,input.factsHash);
const groups=[];
for(const g of input.groups){
 const source=report.scenarios.find(s=>s.scenario.name===g.scenario)?.variants.find(v=>v.name===g.variant)?.result;assert.ok(source);
 const folds=protocol.folds.map(boundary=>{
  const origin=source.fromTs+5000,options={mode:'historical-simulation',scopeId:g.scopeId,trainStart:origin,validationStart:origin+boundary.validationDay*86400000,testStart:origin+boundary.testDay*86400000,testEnd:boundary.endDay===null?source.toTs+5000:origin+boundary.endDay*86400000,embargoMs:protocol.embargoMs};
  const f=policyLearningFold(g.rows,options);
  for(const r of f.train)assert.ok(r.modeledAvailableAt<options.validationStart);
  for(const r of f.validation)assert.ok(r.modeledAvailableAt<options.testStart);
  for(const r of f.test)assert.ok(r.modeledAvailableAt<options.testEnd);
  const trainIds=new Set(f.train.map(r=>r.id)),validationIds=new Set(f.validation.map(r=>r.id));assert.ok(f.validation.every(r=>!trainIds.has(r.id)));assert.ok(f.test.every(r=>!trainIds.has(r.id)&&!validationIds.has(r.id)));
  const stage=(name,from,to)=>({rows:f[name].length,entriesInWindow:g.rows.filter(r=>r.capture.decisionAt>=from&&r.capture.decisionAt<to).length,unsupportedCells:f[name].reduce((n,r)=>n+r.transformed.unsupported.filter(Boolean).length,0),ids:f[name].map(r=>r.id)});
  return {options,trainAsOf:f.trainAsOf,validationAsOf:f.validationAsOf,testAsOf:f.testAsOf,preprocessor:f.preprocessor,train:stage('train',options.trainStart,options.validationStart),validation:stage('validation',options.validationStart,options.testStart),test:stage('test',options.testStart,options.testEnd),modelTrained:false,independentSamples:null};
 });
 groups.push({scenario:g.scenario,variant:g.variant,scopeId:g.scopeId,folds});
}
const moduleHash=digest(readFileSync('apps/server/dist/research/policy-learning.js')),facts={protocolHash,moduleHash,sourceInputFactsHash:input.factsHash,groups},factsHash=digest(canonicalJson(facts)),path='docs/policy-learning-'+factsHash.slice(0,16)+'.json';
const artifact={version:'policy-learning-audit-v1',materializedAt:new Date().toISOString(),builderBuildId:build.buildId,...facts,factsHash,historicalDataAlreadyInspected:true,independentOutOfSample:false,modelTrained:false,forecastProbability:null,profitabilityEstablished:false};
if(existsSync(path)){const saved=read(path);assert.equal(saved.factsHash,factsHash);assert.equal(digest(canonicalJson({protocolHash:saved.protocolHash,moduleHash:saved.moduleHash,sourceInputFactsHash:saved.sourceInputFactsHash,groups:saved.groups})),factsHash);}else writeFileSync(path,JSON.stringify(artifact,null,2),{flag:'wx'});
const proof={path,factsHash,buildId:build.buildId,verifiedAt:new Date().toISOString(),modelTrained:false,independentOutOfSample:false};writeFileSync('docs/policy-learning-latest.json',JSON.stringify(proof,null,2));
console.log(JSON.stringify({...proof,groups:groups.map(g=>({scenario:g.scenario,variant:g.variant,folds:g.folds.map(f=>({counts:[f.train.rows,f.validation.rows,f.test.rows],entries:[f.train.entriesInWindow,f.validation.entriesInWindow,f.test.entriesInWindow],classes:f.preprocessor.classes,unsupportedTestCells:f.test.unsupportedCells,preprocessorHash:f.preprocessor.hash}))}))}));
