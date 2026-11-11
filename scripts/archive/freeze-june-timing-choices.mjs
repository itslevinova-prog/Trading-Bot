import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyCaptureConfig,loadHistoricalPeriod} from './historical-period-files.mjs';
import {canonicalJson} from '../apps/server/dist/research/dataset.js';
import {digest,inspectBuild} from '../apps/server/dist/provenance/build.js';
import {closedRelativeStrength} from '../apps/server/dist/context/relative-strength.js';

globalThis.fetch=async()=>{throw Error('Offline decision freeze');};
const config=historyCaptureConfig(process.cwd(),true,'june-timing-holdout');
assert.equal(config.protocolHash,'c8ea568bdbe08d320265d7aea5e4b5f7e9d57683e172bf0e75d7cab134e47e63');
const build=inspectBuild(process.cwd());
assert.equal(build.verified,true);
const {markets}=loadHistoricalPeriod(config,'2026-06');
const {fromTs,toExclusive}=config.protocol.periods[0];
const step=900000,stride=48*step;
const rows=[];
for(let now=fromTs;now<toExclusive;now+=stride){
    const closed=markets.map(({pair,candles})=>({
        pair,candles:candles.filter(c=>c.ts>=now-97*step&&c.ts+step<=now),
    }));
    const windowsComplete=closed.every(m=>m.candles.length===97&&m.candles.every((c,i)=>c.ts===now-(97-i)*step));
    const btc=closed.find(m=>m.pair==='BTC/EUR');
    assert.ok(btc);
    const alts=closed.filter(m=>m.pair!==btc.pair);
    assert.equal(alts.length,19);
    const relative=alts.map(m=>({pair:m.pair,...closedRelativeStrength(m.pair,m.candles,btc.candles,now)}));
    const valid=windowsComplete&&relative.every(r=>r.complete&&r.closedAt===now);
    const change=bars=>bars.at(-1).close/bars[0].close-1;
    const btc24h=valid?change(btc.candles):null;
    const advancing=valid?alts.filter(m=>change(m.candles)>0).length:null;
    const best=valid?relative.filter(r=>r.assetReturnPct>0&&r.relativeReturnPct>0).sort((a,b)=>b.relativeReturnPct-a.relativeReturnPct||a.pair.localeCompare(b.pair))[0]:null;
    const pair=best?.pair??null;
    rows.push({decisionAt:now,entryAt:now+step,valid,btc24h,advancing,selectedPair:pair,relative4h:best?.relativeReturnPct??null,
        actions:{ungated:!!pair,btc:!!pair&&btc24h>0,breadth:!!pair&&btc24h>0&&advancing>alts.length/2,cash:false}});
}
assert.equal(rows.length,60);
assert.ok(rows.every(r=>r.entryAt+32*step<toExclusive));
const facts={version:'june-timing-frozen-choices-v1',generatedAt:new Date().toISOString(),protocolSha:config.protocolHash,
    buildId:build.buildId,dataSha:digest(canonicalJson(markets)),runnerSha:digest(fs.readFileSync(new URL(import.meta.url))),
    rows,outcomesEvaluated:false};
const bytes=JSON.stringify(facts,null,2)+'\n',sha=digest(bytes);
const path='docs/june-timing-frozen-choices-v1.json';
fs.writeFileSync(path,bytes,{flag:'wx'});
console.log(JSON.stringify({path,sha,dataSha:facts.dataSha,clocks:rows.length,valid:rows.filter(r=>r.valid).length,candidates:rows.filter(r=>r.selectedPair).length}));
