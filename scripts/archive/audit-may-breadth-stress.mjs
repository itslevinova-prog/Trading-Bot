import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyCaptureConfig,loadHistoricalPeriod} from './historical-period-files.mjs';
import {canonicalJson} from '../apps/server/dist/research/dataset.js';
import {digest,inspectBuild} from '../apps/server/dist/provenance/build.js';
import {firstBarrierOutcome} from '../apps/server/dist/research/first-barrier-outcome.js';

const baselineFile='docs/may-breadth-timing-result-cbed1f1786e6f1ee.json';
const baselineSha='cbed1f1786e6f1eec4e2d30eddce6c9a829d0f7b1818ca1ede0646376bb785cb';
const bytes=fs.readFileSync(baselineFile);
assert.equal(digest(bytes),baselineSha);
const baseline=JSON.parse(bytes);
const protocolFile='docs/may-breadth-timing-protocol-v1.json';
const protocolBytes=fs.readFileSync(protocolFile);
assert.equal(digest(protocolBytes),baseline.protocolSha256);
const protocol=JSON.parse(protocolBytes),step=900000;
const frozen=fs.readFileSync('docs/may-breadth-timing-frozen-choices-v1.json');
assert.equal(digest(frozen),baseline.choicesSha256);
assert.deepEqual(baseline.rows.map(({outcome,net,...choice})=>choice),JSON.parse(frozen).rows);
assert.equal(baseline.rows.length,20);

globalThis.fetch=async()=>{throw Error('Offline stress check');};
const {markets}=loadHistoricalPeriod(historyCaptureConfig(process.cwd(),true,'evidence-post-april'),'2026-05');
assert.equal(digest(canonicalJson(markets)),protocol.dataScope);
const build=inspectBuild(process.cwd());
assert.equal(build.verified,true);
const scenarios=[
    {name:'baseline',costMultiplier:1,extraDelayBars:0},
    {name:'double-cost',costMultiplier:2,extraDelayBars:0},
    {name:'quadruple-cost',costMultiplier:4,extraDelayBars:0},
    {name:'one-more-bar',costMultiplier:1,extraDelayBars:1},
    {name:'double-cost-and-one-more-bar',costMultiplier:2,extraDelayBars:1},
];
const byPair=new Map(markets.map(m=>[m.pair,m.candles]));
const results=scenarios.map(scenario=>{
    const target={...protocol.target,costs:Object.fromEntries(Object.entries(protocol.target.costs).map(([key,value])=>[key,value*scenario.costMultiplier]))};
    const rows=baseline.rows.map(row=>{
        const entryAt=row.entryAt+scenario.extraDelayBars*step;
        const end=entryAt+target.horizonBars*step;
        assert.ok(end<protocol.to);
        const outcome=row.selectedPair?firstBarrierOutcome(row.selectedPair,byPair.get(row.selectedPair),entryAt,end,target):null;
        if(scenario.name==='baseline')assert.deepEqual(outcome,row.outcome);
        return {decisionAt:row.decisionAt,pair:row.selectedPair,entryAt,end,actions:row.actions,outcome};
    });
    const policies=Object.fromEntries(Object.keys(baseline.policies).map(policy=>{
        const selected=rows.filter(r=>r.actions[policy]);
        const returns=selected.map(r=>r.outcome?.netReturn??null);
        const unknown=returns.filter(v=>v===null).length;
        const meanPerClock=unknown?null:returns.reduce((sum,v)=>sum+v,0)/rows.length;
        if(scenario.name==='baseline')assert.ok(Math.abs(meanPerClock-baseline.policies[policy].meanPerClock)<1e-14);
        return [policy,{selected:selected.length,unknown,meanPerClock}];
    }));
    return {...scenario,target,rows,policies,changedBarrierOutcomes:rows.filter((r,i)=>r.outcome?.outcome!==baseline.rows[i].outcome?.outcome).length};
});
const facts={version:'may-breadth-cost-delay-sensitivity-v1',generatedAt:new Date().toISOString(),build,baselineFile,baselineSha,runnerSha:digest(fs.readFileSync(new URL(import.meta.url))),results,scope:'Descriptive stress on consumed May labels. Delay scenarios shift entry and its full 32-bar path by one 15-minute bar, not a latency estimate. All choices and gates are fixed. Spread, slippage and fee scale together. No portfolio execution, observed depth, new holdout or strategy selection.',profitabilityEstablished:false};
const data=JSON.stringify(facts,null,2)+'\n',sha=digest(data);
const path='docs/may-breadth-stress-'+sha.slice(0,16)+'.json';
fs.writeFileSync(path,data,{flag:'wx'});
console.log(JSON.stringify({path,sha,results:results.map(({name,policies,changedBarrierOutcomes})=>({name,policies,changedBarrierOutcomes}))}));
