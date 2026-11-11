import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyCaptureConfig,loadHistoricalPeriod} from './historical-period-files.mjs';
import {closedRelativeStrength} from '../apps/server/dist/context/relative-strength.js';
import {digest,inspectBuild} from '../apps/server/dist/provenance/build.js';

globalThis.fetch=async()=>{throw Error('Offline diagnostic');};
const file='docs/paper-market-breadth-april-13230c4ddf25e182.json';
const bytes=fs.readFileSync(file);
assert.equal(digest(bytes),'13230c4ddf25e18286c5cf3916c7cd1f91efd7ae26d9cba67584492854fcbfcc');
const previous=JSON.parse(bytes);
const {markets}=loadHistoricalPeriod(historyCaptureConfig(process.cwd(),false),'2026-04');
const btc=markets.find(m=>m.pair==='BTC/EUR');
assert.ok(btc);
const step=900000;
const rows=previous.scope.map(({now,next})=>{
    assert.equal(next.closedAt,now);
    assert.equal(next.complete,true);
    const returns24h=markets.map(({pair,candles})=>{
        const bars=candles.filter(c=>c.ts>=now-97*step&&c.ts<now);
        assert.equal(bars.length,97);
        assert.ok(bars.every((c,i)=>c.ts===now-(97-i)*step));
        return {pair,change:(bars.at(-1).close/bars[0].close-1)*100};
    });
    const btc24h=returns24h.find(r=>r.pair===btc.pair).change;
    const alts=returns24h.filter(r=>r.pair!==btc.pair);
    assert.equal(returns24h.length,next.return24hKnown);
    assert.equal(returns24h.filter(r=>r.change>0).length,next.positive24h);
    const relative=markets.filter(m=>m.pair!==btc.pair).map(m=>closedRelativeStrength(m.pair,m.candles,btc.candles,now));
    assert.ok(relative.every(r=>r.complete&&r.closedAt===now));
    const breadthExcludingBtc=(next.positive24h-Number(btc24h>0))/(next.return24hKnown-1);
    return {
        now, btc24h, btc4h:relative[0].btcReturnPct, breadthExcludingBtc,
        medianMarket24h:next.medianChange24h,
        fractionOutperformingBtc24h:alts.filter(r=>r.change>btc24h).length/alts.length,
        fractionOutperformingBtc4h:relative.filter(r=>r.relativeReturnPct>0).length/relative.length,
    };
});
assert.equal(rows.length,30);
assert.equal(new Set(rows.map(r=>r.now)).size,30);
function correlation(left,right){
    const x=rows.map(r=>r[left]),y=rows.map(r=>r[right]);
    assert.ok([...x,...y].every(Number.isFinite));
    const mean=a=>a.reduce((sum,v)=>sum+v,0)/a.length;
    const mx=mean(x),my=mean(y);
    const dx=x.map(v=>v-mx),dy=y.map(v=>v-my);
    const sumSquares=a=>a.reduce((sum,v)=>sum+v*v,0);
    const norm=Math.sqrt(sumSquares(dx)*sumSquares(dy));
    return norm?dx.reduce((sum,v,i)=>sum+v*dy[i],0)/norm:null;
}
const stats={
    breadthVsBtc24h:correlation('breadthExcludingBtc','btc24h'),
    medianVsBtc24h:correlation('medianMarket24h','btc24h'),
    breadthVsBtc4h:correlation('breadthExcludingBtc','btc4h'),
    breadthVsRelative24h:correlation('breadthExcludingBtc','fractionOutperformingBtc24h'),
    breadthVsRelative4h:correlation('breadthExcludingBtc','fractionOutperformingBtc4h'),
    btcUpButMostAltsFlatOrDown:rows.filter(r=>r.btc24h>0&&r.breadthExcludingBtc<.5).length,
    btcFlatOrDownButMostAltsUp:rows.filter(r=>r.btc24h<=0&&r.breadthExcludingBtc>.5).length,
};
const build=inspectBuild(process.cwd());
assert.equal(build.verified,true);
const facts={version:'consumed-april-breadth-redundancy-v1',generatedAt:new Date().toISOString(),build,source:{file,sha256:digest(bytes)},runnerSha256:digest(fs.readFileSync(new URL(import.meta.url))),rows,stats,scope:'Contemporaneous descriptive analysis, 30 fixed daily clocks in inspected April. BTC excluded from breadth count. No outcome, fit or execution evaluated.',independentSamples:null,profitabilityEstablished:false};
const data=JSON.stringify(facts,null,2)+'\n',hash=digest(data);
const path='docs/april-breadth-redundancy-'+hash.slice(0,16)+'.json';
fs.writeFileSync(path,data,{flag:'wx'});
console.log(JSON.stringify({path,hash,stats}));
