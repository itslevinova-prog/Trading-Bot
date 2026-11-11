import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {inspectBuild,digest} from '../apps/server/dist/provenance/build.js';
import {canonicalJson} from '../apps/server/dist/research/dataset.js';
import {buildPolicyLabels,eligiblePolicyLabels,policyScopeId} from '../apps/server/dist/research/policy-labels.js';
const read=p=>JSON.parse(readFileSync(p,'utf8')),build=inspectBuild(process.cwd());assert.equal(build.verified,true);
const pointer=read('docs/mock-structure-study-latest.json'),report=read(pointer.path),{reportHash,generatedAt,...body}=report;assert.equal(digest(canonicalJson(body)),reportHash);assert.equal(reportHash,pointer.reportHash);assert.equal(report.historicalDataAlreadyInspected,true);
const contractHash=digest(readFileSync('docs/policy-label-contract-v1.json')),builderHash=digest(readFileSync('apps/server/dist/research/policy-labels.js')),key=digest(canonicalJson({reportHash,contractHash,builderHash})),path='docs/policy-labels-'+key.slice(0,16)+'.json',made=Date.now(),groups=[];
for(const scenario of report.scenarios)for(const variant of scenario.variants){
 const scope={datasetId:report.datasetId,replayBuildId:report.buildId,decisionModuleHash:variant.name==='mock-v1'?report.baseline.decisionModuleHash:report.candidate.decisionModuleHash,scenarioHash:digest(canonicalJson({options:scenario.options,protocolHash:report.protocolHash}))};
 const labels=buildPolicyLabels(variant.result.fills,scope,made),scopeId=policyScopeId(scope),cutoffs=[];
 for(let asOf=variant.result.fromTs+7*86400000;asOf<variant.result.toTs;asOf+=7*86400000)cutoffs.push(asOf);cutoffs.push(variant.result.toTs);
 const maturity=cutoffs.map(asOf=>({asOf,eligible:eligiblePolicyLabels(labels,{mode:'historical-simulation',scopeId,asOf}).length}));
 const usable=eligiblePolicyLabels(labels,{mode:'historical-simulation',scopeId,asOf:made}),classes={profit:0,loss:0,'break-even':0};for(const l of usable)classes[l.label]++;
 groups.push({scenario:scenario.scenario.name,variant:variant.name,scope,scopeId,labels,counts:{total:labels.length,censored:labels.filter(l=>l.censoredReason!==null).length,usable:usable.length,classes},maturity,majorityClassInSampleAccuracy:usable.length?Math.max(...Object.values(classes))/usable.length:null,independentSamples:null});
}
const facts=groups.map(g=>({...g,labels:g.labels.map(({materializedAt,...rest})=>rest)})),factsHash=digest(canonicalJson(facts));
const artifact={version:'policy-label-dataset-v1',materializedAt:new Date(made).toISOString(),builderBuildId:build.buildId,builderHash,contractHash,sourceReportHash:reportHash,sourceReportPath:pointer.path,factsHash,historicalSimulationOnly:true,assumedAvailabilityNotObservedReceipt:true,liveMemoryUpdated:false,modelTrained:false,independentSamples:null,forecastProbability:null,groups};
if(existsSync(path)){const saved=read(path),savedFacts=saved.groups.map(g=>({...g,labels:g.labels.map(({materializedAt,...rest})=>rest)}));assert.equal(saved.factsHash,digest(canonicalJson(savedFacts)));assert.equal(saved.factsHash,factsHash,'Policy label facts changed');}else writeFileSync(path,JSON.stringify(artifact,null,2),{flag:'wx'});
const proof={path,key,factsHash,sourceReportHash:reportHash,contractHash,builderHash,verifiedAt:new Date().toISOString(),historicalSimulationOnly:true,modelTrained:false};writeFileSync('docs/policy-labels-latest.json',JSON.stringify(proof,null,2));
console.log(JSON.stringify({...proof,groups:groups.map(g=>({scenario:g.scenario,variant:g.variant,counts:g.counts,maturity:g.maturity,majorityClassInSampleAccuracy:g.majorityClassInSampleAccuracy})),independentSamples:null}));
