import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyCaptureConfig,loadHistoricalPeriod} from './historical-period-files.mjs';
import {canonicalJson} from '../apps/server/dist/research/dataset.js';
import {digest,inspectBuild} from '../apps/server/dist/provenance/build.js';
import {closedRelativeStrength} from '../apps/server/dist/context/relative-strength.js';
import {firstBarrierOutcome} from '../apps/server/dist/research/first-barrier-outcome.js';

const step=900000, stride=48*step, from=Date.UTC(2026,4,21), to=Date.UTC(2026,4,31);
const dataScope='df5ed748ced1b3730c976d79c1542adea04b8d46fb08b611468da75047e290e4';
const target={dataScope,horizonBars:32,stopLossPct:.02,takeProfitPct:.04,costs:{feeRate:.001,spreadBps:10,slippageBps:8}};
const protocolFile='docs/may-breadth-timing-protocol-v1.json';
const choicesFile='docs/may-breadth-timing-frozen-choices-v1.json';
const read=path=>JSON.parse(fs.readFileSync(path,'utf8'));
function write(path,value){
    const bytes=JSON.stringify(value,null,2)+'\n';
    fs.writeFileSync(path,bytes,{flag:'wx'});
    return digest(bytes);
}
const fileHash=path=>digest(fs.readFileSync(path));
const runnerHash=digest(fs.readFileSync(new URL(import.meta.url)));
const build=inspectBuild(process.cwd());
assert.equal(build.verified,true);
globalThis.fetch=async()=>{throw Error('Offline timing diagnostic');};
function source(){
    const data=loadHistoricalPeriod(historyCaptureConfig(process.cwd(),true,'evidence-post-april'),'2026-05').markets;
    assert.equal(digest(canonicalJson(data)),dataScope);
    assert.equal(data.length,20);
    return data;
}
function freeze(){
    assert.ok(!fs.existsSync(choicesFile));
    const protocol={
        version:'may-breadth-timing-protocol-v1',registeredAt:new Date().toISOString(),
        buildId:build.buildId,runnerHash,from,to,stride,target,
        candidate:'Highest strict closed four-hour relative return among the nineteen non-BTC markets. Require positive absolute four-hour return and positive relative return. Resolve ties by pair.',
        gates:{ungated:'Use common candidate',btc:'Common candidate and BTC closed 24-hour return > 0',breadth:'BTC policy and more than half of nineteen altcoins have positive closed 24-hour return',cash:'Abstain'},
        missing:'All 20 aligned 97-bar source windows and 19 relative features required. Missing candidate or evidence produces no trade. Ambiguous/unavailable selected label remains null and invalidates full aggregate.',
        scoring:'Same candidate and costed first-barrier label across policies. Compare mean net label per scheduled clock including zero for abstentions. Report coverage and observed veto labels, not portfolio PnL.',
        dataScope,selection:'One fixed descriptive timing comparison. No refit, threshold search, or strategy activation.',
    };
    const protocolSha256=write(protocolFile,protocol);
    const markets=source(), btc=markets.find(m=>m.pair==='BTC/EUR');
    assert.ok(btc);
    const rows=[];
    for(let now=from;now<to;now+=stride){
        const closed=markets.map(({pair,candles})=>({
            pair,candles:candles.filter(c=>c.ts>=now-97*step&&c.ts+step<=now),
        }));
        const windowsComplete=closed.every(m=>m.candles.length===97&&m.candles.every((c,i)=>c.ts===now-(97-i)*step));
        const btcBars=closed.find(m=>m.pair===btc.pair).candles;
        const alts=closed.filter(m=>m.pair!==btc.pair);
        const relative=alts.map(m=>({pair:m.pair,...closedRelativeStrength(m.pair,m.candles,btcBars,now)}));
        const valid=windowsComplete&&relative.every(r=>r.complete&&r.closedAt===now);
        const change=bars=>bars.at(-1).close/bars[0].close-1;
        const btc24h=valid?change(btcBars):null;
        const advancing=valid?alts.filter(m=>change(m.candles)>0).length:null;
        const best=valid?relative.filter(r=>r.assetReturnPct>0&&r.relativeReturnPct>0).sort((a,b)=>b.relativeReturnPct-a.relativeReturnPct||a.pair.localeCompare(b.pair))[0]:null;
        const pair=best?.pair??null;
        rows.push({
            decisionAt:now,entryAt:now+step,labelEnd:now+(target.horizonBars+1)*step,
            valid,btc24h,advancing,selectedPair:pair,relative4h:best?.relativeReturnPct??null,
            actions:{ungated:!!pair,btc:!!pair&&btc24h>0,breadth:!!pair&&btc24h>0&&advancing>alts.length/2,cash:false},
        });
    }
    assert.equal(rows.length,20);
    assert.ok(rows.every(r=>r.labelEnd<to));
    const hash=write(choicesFile,{protocolSha256,buildId:build.buildId,runnerHash,rows,outcomesEvaluated:false});
    console.log(JSON.stringify({choicesFile,hash,clocks:rows.length,selected:rows.filter(r=>r.selectedPair).length}));
}
function score(){
    const protocol=read(protocolFile),frozen=read(choicesFile);
    assert.equal(frozen.protocolSha256,fileHash(protocolFile));
    assert.equal(frozen.runnerHash,runnerHash);
    assert.equal(protocol.runnerHash,runnerHash);
    assert.equal(frozen.buildId,build.buildId);
    assert.equal(frozen.outcomesEvaluated,false);
    assert.equal(frozen.rows.length,20);
    const markets=source();
    const rows=frozen.rows.map((r,i)=>{
        assert.equal(r.decisionAt,from+i*stride);
        assert.equal(r.entryAt,r.decisionAt+step);
        assert.equal(r.labelEnd,r.entryAt+target.horizonBars*step);
        const market=markets.find(m=>m.pair===r.selectedPair);
        const outcome=market?firstBarrierOutcome(market.pair,market.candles,r.entryAt,r.labelEnd,target):null;
        const net=Object.fromEntries(Object.entries(r.actions).map(([k,act])=>[k,act?outcome?.netReturn??null:0]));
        return {...r,outcome,net};
    });
    const policies=Object.fromEntries(['ungated','btc','breadth','cash'].map(name=>{
        const values=rows.map(r=>r.net[name]);
        return [name,{selected:rows.filter(r=>r.actions[name]).length,unknown:values.filter(v=>v===null).length,meanPerClock:values.some(v=>v===null)?null:values.reduce((s,v)=>s+v,0)/rows.length}];
    }));
    const veto=rows.filter(r=>r.actions.btc&&!r.actions.breadth).map(r=>({decisionAt:r.decisionAt,pair:r.selectedPair,net:r.net.btc}));
    const report={version:'may-breadth-timing-result-v1',generatedAt:new Date().toISOString(),protocolSha256:fileHash(protocolFile),choicesSha256:fileHash(choicesFile),runnerHash,buildId:build.buildId,rows,policies,veto,independentSamples:null,profitabilityEstablished:false,scope:'Fixed costed first-barrier labels at common candidate clocks. No fill, broker simulation or activation.'};
    const bytes=JSON.stringify(report,null,2)+'\n',hash=digest(bytes);
    const path='docs/may-breadth-timing-result-'+hash.slice(0,16)+'.json';
    fs.writeFileSync(path,bytes,{flag:'wx'});
    console.log(JSON.stringify({path,hash,policies,veto}));
}
if(process.argv.length===3&&process.argv[2]==='--freeze')freeze();
else if(process.argv.length===3&&process.argv[2]==='--score')score();
else throw Error('Use --freeze before --score');
