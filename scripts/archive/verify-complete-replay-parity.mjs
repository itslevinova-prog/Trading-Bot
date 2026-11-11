import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyCaptureConfig,loadHistoricalPeriod} from './historical-period-files.mjs';
import {canonicalJson} from '../apps/server/dist/research/dataset.js';
import {digest,inspectBuild} from '../apps/server/dist/provenance/build.js';
import {replayRulesPortfolio} from '../apps/server/dist/research/portfolio.js';
import {mockReplayStudy} from '../apps/server/dist/research/mock-replay-context.js';

globalThis.fetch=async()=>{throw Error('Offline parity check');};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const cases=[
    {month:'2026-05',study:'evidence-post-april',reference:'docs/may-frozen-portfolio-f53b0d90fa77fffc.json',sha:'f53b0d90fa77fffc406b9e0399c8c3920958cdf7bda42311cd51a5a71122878d'},
    {month:'2026-06',study:'june-timing-holdout',reference:'docs/june-frozen-portfolio-13ca4ea0ac9938e5.json',sha:'13ca4ea0ac9938e59717972a4fae74a4fd7ca37d311f815ff9d15c3793f23b77'},
];
const build=inspectBuild(process.cwd());
assert.equal(build.verified,true);
const checked=[];
const testBid=process.argv.includes('--bid-sensitivity');
for(const c of cases){
    assert.equal(digest(fs.readFileSync(c.reference)),c.sha);
    const old=read(c.reference), registration=read(old.registered);
    assert.equal(digest(fs.readFileSync(old.registered)),old.protocolSha);
    assert.equal(digest(fs.readFileSync(registration.choicesPath)),registration.choicesSha);
    const choices=read(registration.choicesPath);
    // The reference pins the old replay. Only the input archive and existing
    // choices carry over. This comparison deliberately executes the new build.
    const config=historyCaptureConfig(process.cwd(),false,c.study);
    const {markets}=loadHistoricalPeriod(config,c.month);
    assert.equal(digest(canonicalJson(markets)),registration.dataSha);
    const step=900000,options=registration.options;
    for(const prior of old.results){
        const multiplier=prior.multiplier, fees=options.feeRate*multiplier;
        const replay={...options,feeRate:fees,spreadBps:options.spreadBps*multiplier,slippageBps:options.slippageBps*multiplier,risk:{...options.risk,feeRate:fees}};
        const entries=new Map(choices.rows.filter(r=>r.actions[prior.name]).map(r=>[r.entryAt,r.selectedPair]));
        const provider={decide:async ctx=>{
            const clock=Date.parse(ctx.timeUTC)-5000;
            const position=ctx.positions[0];
            if(position&&clock>=position.openedAt+32*step)
                return {marketView:'Fixed holding period reached',actions:[{type:'sell',pair:position.pair,sellFraction:1,confidence:.8,reasoning:'Fixed 32-bar timeout'}]};
            const pair=entries.get(clock);
            if(position||!pair)return {marketView:'No scheduled entry',actions:[]};
            const month=c.month==='2026-05'?'May':'June';
            return {marketView:'Frozen scheduled entry',actions:[{type:'buy',pair,amountEur:Math.min(ctx.account.cash,ctx.account.equity*.15),stopLossPct:.02,takeProfitPct:.04,confidence:.8,reasoning:'Frozen '+month+' timing candidate'}]};
        }};
        const study=mockReplayStudy(replay,{venue:'binance',quoteCurrency:'EUR',visibleDepthQuote:1000,stopLossPct:.05});
        const result=prior.name==='rules'?await replayRulesPortfolio(markets,replay):await replayRulesPortfolio(markets,replay,provider,{...study,enrich:ctx=>ctx});
        const ambiguousFills=result.fills.filter(fill=>fill.intrabarOrderAmbiguous===true);
        for(const fill of ambiguousFills){
            assert.equal(fill.side,'sell');
            assert.equal(fill.reason,'intrabar stop-first');
        }
        const comparable={...result,fills:result.fills.map(({intrabarOrderAmbiguous,...fill})=>fill)};
        assert.deepEqual(comparable,prior.result);
        const item={month:c.month,name:prior.name,multiplier,bars:result.bars,fills:result.fills.length,ambiguousFills:ambiguousFills.length,resultSha:digest(canonicalJson(comparable))};
        if(testBid){
            const bidOptions={...replay,protectionTrigger:'synthetic-bid'};
            const bid=prior.name==='rules'
                ?await replayRulesPortfolio(markets,bidOptions)
                :await replayRulesPortfolio(markets,bidOptions,provider,{...study,enrich:ctx=>ctx});
            assert.equal(bid.fromTs,result.fromTs);
            assert.equal(bid.toTs,result.toTs);
            assert.equal(bid.bars,result.bars);
            const metrics=r=>({returnPct:r.returnPct,drawdownPct:r.maxDrawdownPct,fees:r.fees,
                fills:r.fills.length,closedTrades:r.closedTrades,missingValuationBars:r.missingValuationBars,
                unliquidatedPositions:r.unliquidatedPositions,ambiguousFills:r.fills.filter(f=>f.intrabarOrderAmbiguous).length});
            const schedule=r=>r.fills.map(({pair,side,barTs,reason})=>({pair,side,barTs,reason}));
            const onlyIn=(left,right)=>{
                const counts=new Map();
                for(const item of right){
                    const key=canonicalJson(item);
                    counts.set(key,(counts.get(key)??0)+1);
                }
                return left.filter(item=>{
                    const key=canonicalJson(item),count=counts.get(key)??0;
                    if(count===0)return true;
                    counts.set(key,count-1);
                    return false;
                });
            };
            const baseSchedule=schedule(result),bidSchedule=schedule(bid);
            const scheduleChanges={baselineOnly:onlyIn(baseSchedule,bidSchedule),syntheticBidOnly:onlyIn(bidSchedule,baseSchedule)};
            item.sensitivity={spreadBps:replay.spreadBps,baseline:metrics(result),syntheticBid:metrics(bid),
                returnDeltaPp:bid.returnPct-result.returnPct,
                sameFillSchedule:canonicalJson(baseSchedule)===canonicalJson(bidSchedule),scheduleChanges,
                syntheticBidSha:digest(canonicalJson(bid))};
        }
        checked.push(item);
        console.log(JSON.stringify(item));
    }
}
const facts={version:testBid?'replay-bid-sensitivity-v2':'replay-complete-data-parity-v2',verifiedAt:new Date().toISOString(),build,referenceCases:cases,checked,runnerSha:digest(fs.readFileSync(new URL(import.meta.url))),scope:'Complete data parity on consumed windows. Full results including fill and drawdown paths match after removing only the new ambiguity annotation. No new strategy evaluation.'+(testBid?' Synthetic-bid sensitivity only, with the same frozen choices and costs. Constant spread proxy, not observed historical quotes.':'')};
const bytes=JSON.stringify(facts,null,2)+'\n',sha=digest(bytes),path='docs/replay-complete-parity-'+sha.slice(0,16)+'.json';
fs.writeFileSync(path,bytes,{flag:'wx'});
console.log(JSON.stringify({path,sha,variants:checked.length,bars:checked.reduce((s,r)=>s+r.bars,0),fills:checked.reduce((s,r)=>s+r.fills,0),ambiguousFills:checked.reduce((s,r)=>s+r.ambiguousFills,0)}));
