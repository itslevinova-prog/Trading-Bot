import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyCaptureConfig,loadHistoricalPeriod} from './historical-period-files.mjs';
import {canonicalJson} from '../apps/server/dist/research/dataset.js';
import {digest,inspectBuild} from '../apps/server/dist/provenance/build.js';
import {closedMoveConcentration} from '../apps/server/dist/context/move-concentration.js';
import {closedMarketStructure} from '../apps/server/dist/context/market-structure.js';

globalThis.fetch=async()=>{throw Error('Offline concentration audit');};
const source='docs/momentum-peer-labels-0a61eb690de932be.json';
const ledgerSource='docs/momentum-attribution-c8e9b23bfaac42b3.json';
const read=(path,sha)=>{const bytes=fs.readFileSync(path);assert.equal(digest(bytes),sha);return JSON.parse(bytes);};
const peers=read(source,'0a61eb690de932be7ed83c5fb39582d6f2033fa809b214bb060774192e0f9070');
const ledger=read(ledgerSource,'c8e9b23bfaac42b3f22272f3935e38512af560b2e7a648353445551de232f51c');
const build=inspectBuild(process.cwd());
assert.equal(build.verified,true);
const results=[];
for(const period of peers.periods){
    const spec=period.spec;
    const key=spec.period==='2026-05'?'may':'june';
    assert.ok(['2026-05','2026-06'].includes(spec.period));
    const {markets}=loadHistoricalPeriod(historyCaptureConfig(process.cwd(),true,spec.study),spec.period);
    assert.equal(digest(canonicalJson(markets)),spec.dataSha);
    const tradeByEntry=new Map(ledger.periods[key].trades.map(t=>[t.entryAt,t]));
    const rows=period.rows.filter(r=>r.selectedPair).map(r=>{
        const m=markets.find(m=>m.pair===r.selectedPair);
        const t=tradeByEntry.get(r.decisionAt+900000);
        assert.equal(t.pair,r.selectedPair);
        const concentration=closedMoveConcentration(m.candles,m.pair,r.decisionAt);
        const structure=closedMarketStructure(m.candles,m.pair,r.decisionAt);
        assert.ok(concentration.complete&&structure.complete);
        return {decisionAt:r.decisionAt,pair:r.selectedPair,concentration,efficiency:structure.directionalEfficiency,exitClass:t.exitClass,netEur:t.netEur};
    });
    assert.equal(rows.length,tradeByEntry.size);
    const summaries=Object.fromEntries(['all','stop','target','timeout'].map(group=>{
        const subset=rows.filter(r=>group==='all'||r.exitClass===group);
        const mean=f=>subset.length?subset.reduce((sum,r)=>sum+f(r),0)/subset.length:null;
        assert.ok(subset.every(r=>r.concentration.largestMoveShare!==null));
        return [group,{trades:subset.length,meanLargestMoveShare:mean(r=>r.concentration.largestMoveShare),meanUpMoves:mean(r=>r.concentration.upMoves),meanEfficiency:mean(r=>r.efficiency)}];
    }));
    results.push({key,rows,summaries});
}
const facts={version:'consumed-momentum-concentration-v1',generatedAt:new Date().toISOString(),build,source,ledgerSource,
    runnerSha:digest(fs.readFileSync(new URL(import.meta.url))),results,
    scope:'Post-hoc descriptive summaries of closed path concentration. Exit classes come from already consumed portfolios. No threshold fitted, no causal prediction or new holdout.',
    profitabilityEstablished:false};
const bytes=JSON.stringify(facts,null,2)+'\n',sha=digest(bytes),path='docs/momentum-concentration-'+sha.slice(0,16)+'.json';
fs.writeFileSync(path,bytes,{flag:'wx'});
console.log(JSON.stringify({path,sha,results:results.map(({key,summaries})=>({key,summaries}))}));
