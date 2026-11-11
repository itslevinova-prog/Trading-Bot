import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyCaptureConfig,loadHistoricalPeriod} from './historical-period-files.mjs';
import {canonicalJson} from '../apps/server/dist/research/dataset.js';
import {digest} from '../apps/server/dist/provenance/build.js';
import {firstBarrierOutcome} from '../apps/server/dist/research/first-barrier-outcome.js';

globalThis.fetch=async()=>{throw Error('Offline attribution');};
const specs=[
    {period:'2026-05',study:'evidence-post-april',file:'docs/may-breadth-timing-frozen-choices-v1.json',sha:'1ae9c6dd2e3d342f98b60ade96d61dc1c47b668d79a708e7c35659839294472d',dataSha:'df5ed748ced1b3730c976d79c1542adea04b8d46fb08b611468da75047e290e4'},
    {period:'2026-06',study:'june-timing-holdout',file:'docs/june-timing-frozen-choices-v1.json',sha:'510b53842aef38d4b555469b87342d80cd605c9f542d1528c404f7f366858df6',dataSha:'f753430de897259ce28e44b394f6b63f5ab387a3cd0f8d1613a20f20fcd278b9'},
];
const step=900000;
const mean=values=>values.length?values.reduce((sum,v)=>sum+v,0)/values.length:null;
const periods=[];
for(const spec of specs){
    const bytes=fs.readFileSync(spec.file);
    assert.equal(digest(bytes),spec.sha);
    const {rows:choices}=JSON.parse(bytes);
    const config=historyCaptureConfig(process.cwd(),true,spec.study);
    const {markets}=loadHistoricalPeriod(config,spec.period);
    assert.equal(digest(canonicalJson(markets)),spec.dataSha);
    const alts=markets.filter(m=>m.pair!=='BTC/EUR');
    assert.equal(alts.length,19);
    const target={dataScope:spec.dataSha,horizonBars:32,stopLossPct:.02,takeProfitPct:.04,costs:{feeRate:.001,spreadBps:10,slippageBps:8}};
    const rows=choices.map(r=>{
        const end=r.entryAt+32*step;
        assert.equal(r.entryAt,r.decisionAt+step);
        assert.ok(end<config.protocol.periods[0].toExclusive);
        const labels=alts.map(m=>({pair:m.pair,net:firstBarrierOutcome(m.pair,m.candles,r.entryAt,end,target)?.netReturn??null}));
        const selected=labels.find(v=>v.pair===r.selectedPair);
        const fullyObserved=labels.every(l=>l.net!==null);
        const peers=fullyObserved?mean(labels.filter(l=>l.pair!==r.selectedPair).map(l=>l.net)):null;
        const selectedNet=selected?.net??null;
        return {decisionAt:r.decisionAt,selectedPair:r.selectedPair,labels,fullyObserved,selectedNet,peerMean:peers,selectedMinusPeers:peers!==null&&selectedNet!==null?selectedNet-peers:null};
    });
    const matched=rows.filter(r=>r.selectedMinusPeers!==null);
    periods.push({spec,rows,summary:{
        clocks:rows.length,clocksWithCandidate:rows.filter(r=>r.selectedPair).length,
        clocksWithMissingLabel:rows.filter(r=>!r.fullyObserved).length,matchedClocks:matched.length,
        selectedMean:mean(matched.map(r=>r.selectedNet)),peerMean:mean(matched.map(r=>r.peerMean)),
        selectedMinusPeersMean:mean(matched.map(r=>r.selectedMinusPeers)),
        positiveDifferentialClocks:matched.filter(r=>r.selectedMinusPeers>0).length,
    }});
}
const facts={version:'consumed-momentum-peer-labels-v1',generatedAt:new Date().toISOString(),
    runnerSha:digest(fs.readFileSync(new URL(import.meta.url))),periods,
    scope:'Post-hoc fixed barrier labels for same-clock altcoin peers. Equal-weight reference is descriptive. Incomplete clocks retained and excluded from paired means. No simulated portfolio, no new dates or independent trials.',
    profitabilityEstablished:false};
const bytes=JSON.stringify(facts,null,2)+'\n',sha=digest(bytes),path='docs/momentum-peer-labels-'+sha.slice(0,16)+'.json';
fs.writeFileSync(path,bytes,{flag:'wx'});
console.log(JSON.stringify({path,sha,periods:periods.map(p=>p.summary)}));
