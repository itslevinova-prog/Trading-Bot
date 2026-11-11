import fs from 'node:fs';import assert from 'node:assert/strict';
import {historyCaptureConfig,loadHistoricalPeriod} from './historical-period-files.mjs';
import {closedDirectionalStrength,DIRECTIONAL_STRENGTH_VERSION} from '../apps/server/dist/context/directional-strength.js';
import {directionalStrengthReplayStudy} from '../apps/server/dist/research/directional-strength-replay.js';
import {digest,inspectBuild} from '../apps/server/dist/provenance/build.js';import {canonicalJson} from '../apps/server/dist/research/dataset.js';
assert.equal(process.argv.length,2);const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),protocolPath='docs/directional-clock-corpus-protocol-v1.json',p=read(protocolPath),build=inspectBuild(process.cwd());
assert.equal(build.verified,true);assert.equal(digest(fs.readFileSync(new URL(import.meta.url))),p.runnerHash);for(const[path,h]of Object.entries(p.sources))assert.equal(digest(fs.readFileSync(path)),h);
const {factsHash,generatedAt,...original}=read(p.originalCorpus);assert.equal(factsHash,p.originalCorpusHash);assert.equal(digest(canonicalJson(original)),factsHash);
const feature=read(original.featureCorpus);assert.equal(feature.factsHash,original.featureCorpusHash);assert.deepEqual(p.periods,feature.scopeFacts.periods);assert.equal(DIRECTIONAL_STRENGTH_VERSION,p.descriptorVersion);
const originalBefore=digest(fs.readFileSync(p.originalCorpus)),defaultConfig=historyCaptureConfig(process.cwd(),false),training=historyCaptureConfig(process.cwd(),false,'training-pre-april'),pairs=new Map();
let rawBars=0,duplicateWarmupBars=0;
for(const period of p.periods){assert.notEqual(period,'2026-07');const data=loadHistoricalPeriod(period==='2026-01'?defaultConfig:training,period);assert.equal(digest(canonicalJson(data.markets)),feature.scopeFacts.sources.find(s=>s.period===period).dataHash);
 for(const market of data.markets){if(!pairs.has(market.pair))pairs.set(market.pair,new Map());const map=pairs.get(market.pair);for(const b of market.candles){rawBars++;if(map.has(b.ts)){assert.equal(canonicalJson(map.get(b.ts)),canonicalJson(b));duplicateWarmupBars++;}else map.set(b.ts,b);}}
}
const rowsByPair=new Map([...pairs].map(([pair,map])=>[pair,[...map.values()].sort((a,b)=>a.ts-b.ts)]));
const study=directionalStrengthReplayStudy({kind:'paper-mock-study',policy:{},enrich:c=>c}),observations=[];
for(const r of original.observations){
 assert.equal(r.decisionAt%900000,0);const rows=rowsByPair.get(r.pair),closed=rows.filter(b=>b.ts+900000<=r.decisionAt),tail=closed.slice(-193),asOf=r.decisionAt+5000;
 // Neither old input vector nor label is supplied to the enrichment.
 const c={timeUTC:new Date(asOf).toISOString(),marketContext:{markets:[{pair:r.pair,regime:{}}]}},m={pair:r.pair,candles:tail,hourly:[],bid:0,ask:0};
 const descriptor=study.enrich(c,[m]).marketContext.markets[0].regime.directionalStrength;
 assert.deepEqual(descriptor,closedDirectionalStrength(r.pair,rows,asOf),'Full raw source differs from causal replay tail');
 observations.push({pair:r.pair,decisionAt:r.decisionAt,asOf,sourceCandlesHash:digest(canonicalJson(tail)),descriptor});
}
assert.equal(original.observations.length,7280);assert.equal(digest(fs.readFileSync(p.originalCorpus)),originalBefore);assert.equal(inspectBuild(process.cwd()).buildId,build.buildId);
const complete=observations.filter(r=>r.descriptor.complete),unknown=observations.filter(r=>!r.descriptor.complete),reasons={};for(const r of unknown)reasons[r.descriptor.reason]=(reasons[r.descriptor.reason]??0)+1;
const facts={version:'directional-clock-corpus-v1',protocolHash:digest(fs.readFileSync(protocolPath)),runnerHash:p.runnerHash,buildId:build.buildId,originalCorpus:p.originalCorpus,originalCorpusHash:factsHash,originalFileHash:originalBefore,originalFeatureFields:original.featureFields,originalTargetHash:original.targetHash,descriptorVersion:DIRECTIONAL_STRENGTH_VERSION,rawBars,duplicateWarmupBars,observations,summary:{rows:observations.length,clocks:new Set(observations.map(r=>r.decisionAt)).size,complete:complete.length,unknown:unknown.length,reasons,fullRawReplayParity:observations.length},modelFitted:false,newTradingRule:false,activeContextChanged:false,julyLoaded:false,independentSamples:null,profitabilityEstablished:false,scope:'Separate descriptor sidecar on all unchanged original clocks. Exact causal193bar source, no label/feature supplied to descriptor. Existing8Dmodel schema and original costed targets untouched. Known survivor data, not new independent evidence; no threshold/model selection.'};
const hash=digest(canonicalJson(facts)),path='docs/directional-clock-corpus-'+hash.slice(0,16)+'.json';fs.writeFileSync(path,JSON.stringify({...facts,factsHash:hash,generatedAt:new Date().toISOString()},null,2),{flag:'wx'});fs.writeFileSync('docs/directional-clock-corpus-latest.json',JSON.stringify({path,hash},null,2));console.log(JSON.stringify({path,hash,summary:facts.summary}));
