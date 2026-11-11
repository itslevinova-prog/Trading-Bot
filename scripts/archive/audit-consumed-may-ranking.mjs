import fs from 'node:fs';
import assert from 'node:assert/strict';
import {auditClockDiscrimination} from '../apps/server/dist/research/ranking-diagnostic.js';
import {digest} from '../apps/server/dist/provenance/build.js';
import {canonicalJson} from '../apps/server/dist/research/dataset.js';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
globalThis.fetch=async()=>{throw Error('No network in consumed-label diagnostic');};
const periods={};
for(const period of ['early','later']){
 const pointer=read(`docs/${period}-may-validation-latest.json`),bytes=fs.readFileSync(pointer.path),report=read(pointer.path),{factsHash,...facts}=report;
 assert.equal(factsHash,pointer.hash);assert.equal(digest(canonicalJson(facts)),pointer.hash);
 assert.equal(report.rows.length,400);assert.equal(report.sharedClocks,20);assert.equal(report.modelRefitted,false);assert.equal(report.activeModelChanged,false);
 const forecast=read(report.frozenForecasts.path),{factsHash:forecastHash,...forecastFacts}=forecast;
 assert.equal(forecastHash,report.frozenForecasts.hash);assert.equal(digest(canonicalJson(forecastFacts)),forecastHash);
 assert.equal(forecast.rows.length,report.rows.length);
 for(let i=0;i<report.rows.length;i++){
  const r=report.rows[i],f=forecast.rows[i];assert.equal(r.pair,f.pair);assert.equal(r.decisionAt,f.decisionAt);assert.deepEqual(r.predictions,f.predictions);
 }
 const scoring=read(report.scoringProtocol.path);assert.equal(scoring.rankingMargin,.005);
 const models=Object.fromEntries(Object.keys(report.metrics).map(name=>[name,auditClockDiscrimination(report.rows.map(r=>({pair:r.pair,decisionAt:r.decisionAt,forecast:r.predictions[name],netReturn:r.netReturn})),scoring.rankingMargin)]));
 for(const [name,audit] of Object.entries(models))assert.equal(audit.clocksWithForecastAboveMargin,report.opportunities[name].opportunityClocks);
 periods[period]={source:pointer,sourceFileSha256:digest(bytes),frozenForecasts:report.frozenForecasts,selectedByEarlierFixedValidation:report.selected,models};
}
const facts={version:'consumed-may-discrimination-v1',generatedAt:new Date().toISOString(),runnerHash:digest(fs.readFileSync(new URL(import.meta.url))),diagnosticSourceSha256:digest(fs.readFileSync('apps/server/src/research/ranking-diagnostic.ts')),fixedMargin:.005,periods,newLabelsRead:false,refitted:false,thresholdsChanged:false,activeStrategyChanged:false,independentSamples:null,profitabilityEstablished:false,scope:'Post-hoc diagnosis of already-consumed May labels. Equal-clock concordance is descriptive rank ordering, not a calibrated probability or executable PnL. Pair comparisons overlap; hindsight opportunities cannot authorize trades or margin relaxation.'};
const hash=digest(canonicalJson(facts)),file=`docs/consumed-may-discrimination-${hash.slice(0,16)}.json`;
fs.writeFileSync(file,JSON.stringify({...facts,factsHash:hash},null,2),{flag:'wx'});
fs.writeFileSync('docs/consumed-may-discrimination-latest.json',JSON.stringify({path:file,hash},null,2)+'\n');
console.log(JSON.stringify({path:file,hash,periods:Object.fromEntries(Object.entries(periods).map(([period,p])=>[period,Object.fromEntries(Object.entries(p.models).map(([name,a])=>[name,{concordance:a.equalClockMeanConcordance,clocks:a.sharedClocks,hindsightPositiveClocks:a.hindsightClocksWithPositiveLabel,forecastAboveMarginClocks:a.clocksWithForecastAboveMargin}]))]))}));
