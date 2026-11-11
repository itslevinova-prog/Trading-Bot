import fs from 'node:fs';import assert from 'node:assert/strict';
import {historyCaptureConfig,loadHistoricalPeriod} from './historical-period-files.mjs';
import {digest} from '../apps/server/dist/provenance/build.js';import {canonicalJson} from '../apps/server/dist/research/dataset.js';
// Independent numeric oracle: raw price units and closed-form powers, no DMI/enricher import.
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),pointer=read('docs/directional-clock-corpus-latest.json'),{factsHash,generatedAt,...report}=read(pointer.path),p=read('docs/directional-clock-corpus-protocol-v1.json');
assert.equal(factsHash,pointer.hash);assert.equal(digest(canonicalJson(report)),factsHash);assert.equal(report.protocolHash,digest(fs.readFileSync('docs/directional-clock-corpus-protocol-v1.json')));assert.equal(report.runnerHash,p.runnerHash);
for(const[path,h]of Object.entries(p.sources))assert.equal(digest(fs.readFileSync(path)),h);
const {factsHash:originalHash,generatedAt:oldAt,...original}=read(p.originalCorpus);assert.equal(originalHash,p.originalCorpusHash);assert.equal(digest(canonicalJson(original)),originalHash);assert.equal(digest(fs.readFileSync(p.originalCorpus)),report.originalFileHash);assert.deepEqual(report.originalFeatureFields,original.featureFields);assert.equal(report.originalTargetHash,original.targetHash);
const feature=read(original.featureCorpus),{factsHash:featureHash,generatedAt:featureAt,...featureFacts}=feature;assert.equal(featureHash,original.featureCorpusHash);assert.equal(digest(canonicalJson(featureFacts)),featureHash);
const config=historyCaptureConfig(process.cwd(),false),training=historyCaptureConfig(process.cwd(),false,'training-pre-april'),maps=new Map();
assert.deepEqual(p.periods,['2025-10','2025-11','2025-12','2026-01','2026-02','2026-03']);
let rawBars=0,duplicates=0;
for(const period of p.periods){const data=loadHistoricalPeriod(period==='2026-01'?config:training,period);assert.equal(digest(canonicalJson(data.markets)),feature.scopeFacts.sources.find(s=>s.period===period).dataHash);for(const market of data.markets){if(!maps.has(market.pair))maps.set(market.pair,new Map());const map=maps.get(market.pair);for(const bar of market.candles){rawBars++;if(map.has(bar.ts)){assert.deepEqual(map.get(bar.ts),bar);duplicates++;}else map.set(bar.ts,bar);}}}
assert.equal(report.rawBars,rawBars);assert.equal(report.duplicateWarmupBars,duplicates);
const powers=Array.from({length:194},(_,n)=>(13/14)**n);
const sumState=(v,n)=>{let s=v.slice(0,14).reduce((a,b)=>a+b,0)*powers[n-14];for(let j=14;j<n;j++)s+=v[j]*powers[n-1-j];return s;};
const meanState=(v,n)=>{let s=v.slice(0,14).reduce((a,b)=>a+b,0)/14*powers[n-14];for(let j=14;j<n;j++)s+=v[j]/14*powers[n-1-j];return s;};
function reference(bars){const tr=[],pos=[],neg=[];for(let i=1;i<bars.length;i++){const a=bars[i-1],b=bars[i],up=b.high-a.high,down=a.low-b.low;tr.push(Math.max(b.high-b.low,Math.abs(b.high-a.close),Math.abs(b.low-a.close)));pos.push(up>0&&up>down?up:0);neg.push(down>0&&down>up?down:0);}
 const dx=[];let plus,minus;for(let n=14;n<=tr.length;n++){const t=sumState(tr,n);plus=t?100*sumState(pos,n)/t:0;minus=t?100*sumState(neg,n)/t:0;dx.push(plus+minus?100*Math.abs(plus-minus)/(plus+minus):0);}
 const adx=meanState(dx,dx.length),previousAdx=meanState(dx,dx.length-1);return {adx,previousAdx,adxChange:adx-previousAdx,plusDI:plus,minusDI:minus,movementBalance:plus+minus?(plus-minus)/(plus+minus):0};
}
assert.equal(report.observations.length,original.observations.length);let complete=0,unknown=0,maxError=0;const keys=new Set(),reasons={};
for(let i=0;i<original.observations.length;i++){const old=original.observations[i],r=report.observations[i],map=maps.get(old.pair);assert.equal(r.pair,old.pair);assert.equal(r.decisionAt,old.decisionAt);assert.equal(r.asOf,old.decisionAt+5000);assert.ok(!keys.has(r.pair+':'+r.decisionAt));keys.add(r.pair+':'+r.decisionAt);
 const tail=[...map.values()].filter(b=>b.ts<r.decisionAt).sort((a,b)=>a.ts-b.ts).slice(-193);assert.equal(digest(canonicalJson(tail)),r.sourceCandlesHash);
 const valid=tail.length===193&&tail.every((b,j)=>b.ts===r.decisionAt-(193-j)*900000&&b.pair===r.pair&&b.interval===15&&[b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)&&b.low>0&&b.volume>=0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close));
 const d=r.descriptor;assert.equal(d.complete,valid);assert.equal(d.closedAt,r.decisionAt);assert.equal(d.version,p.descriptorVersion);assert.equal(d.observedCandles,tail.length);assert.equal(d.sourceCandles,193);assert.equal(d.period,14);
 if(!valid){unknown++;assert.equal(d.adx,null);assert.equal(d.movementBalance,null);reasons[d.reason]=(reasons[d.reason]??0)+1;continue;}
 complete++;assert.equal(d.reason,null);const expected=reference(tail);for(const[k,v]of Object.entries(expected)){assert.ok(Number.isFinite(d[k]));const error=Math.abs(d[k]-v);assert.ok(error<1e-9,`${r.pair} ${r.decisionAt} ${k} ${error}`);maxError=Math.max(maxError,error);}
 for(const k of ['adx','previousAdx','plusDI','minusDI'])assert.ok(d[k]>=0&&d[k]<=100);assert.ok(Math.abs(d.movementBalance)<=1);
}
assert.deepEqual(report.summary,{rows:keys.size,clocks:new Set(report.observations.map(r=>r.decisionAt)).size,complete,unknown,reasons,fullRawReplayParity:keys.size});assert.equal(report.julyLoaded,false);assert.equal(report.modelFitted,false);assert.equal(report.activeContextChanged,false);
const proof={version:'directional-clock-verification-v1',verifiedAt:new Date().toISOString(),report:pointer.path,reportHash:factsHash,verifierHash:digest(fs.readFileSync(new URL(import.meta.url))),originalCorpusHash:originalHash,originalFileUnchanged:true,originalEightFeatureSchemaUnchanged:true,originalCostedTargetUnchanged:true,rows:keys.size,complete,unknown,explicitMissingReasons:reasons,independentFieldsChecked:complete*6,maximumAbsoluteDifference:maxError,method:'Raw price units; closed-form power sums independently reconstruct all six values, not runtime recurrence. Source hashes/window/order/clocks checked for every row.',newModelFitted:false,activeContextChanged:false,julyLoaded:false,independentSamples:null,profitabilityEstablished:false};
fs.writeFileSync('docs/directional-clock-verification.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
