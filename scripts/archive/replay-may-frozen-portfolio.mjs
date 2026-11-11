import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyCaptureConfig,loadHistoricalPeriod} from './historical-period-files.mjs';
import {canonicalJson} from '../apps/server/dist/research/dataset.js';
import {digest,inspectBuild} from '../apps/server/dist/provenance/build.js';
import {replayRulesPortfolio} from '../apps/server/dist/research/portfolio.js';
import {mockReplayStudy} from '../apps/server/dist/research/mock-replay-context.js';

globalThis.fetch=async()=>{throw Error('Offline replay');};
const choicesPath='docs/may-breadth-timing-frozen-choices-v1.json';
const choicesBytes=fs.readFileSync(choicesPath);
const choicesSha=digest(choicesBytes);
assert.equal(choicesSha,'1ae9c6dd2e3d342f98b60ade96d61dc1c47b668d79a708e7c35659839294472d');
const choices=JSON.parse(choicesBytes);
const input=historyCaptureConfig(process.cwd(),true,'evidence-post-april');
const {markets}=loadHistoricalPeriod(input,'2026-05');
const dataSha=digest(canonicalJson(markets));
assert.equal(dataSha,'df5ed748ced1b3730c976d79c1542adea04b8d46fb08b611468da75047e290e4');
const build=inspectBuild(process.cwd());
assert.equal(build.verified,true);
const step=900000,from=Date.UTC(2026,4,21),to=Date.UTC(2026,4,31);
const options={...input.protocol.baselineOptions,fromTs:from,toTs:to-step};
assert.deepEqual([options.startingBalance,options.feeRate,options.spreadBps,options.slippageBps,options.decisionIntervalMinutes],[100,.001,10,8,15]);
const variants=[
    {name:'rules',multiplier:1},
    {name:'ungated',multiplier:1},
    {name:'btc',multiplier:1},
    {name:'breadth',multiplier:1},
    {name:'ungated',multiplier:2},
];
const protocol={
    version:'may-frozen-portfolio-replay-v1',registeredAt:new Date().toISOString(),
    runnerSha:digest(fs.readFileSync(new URL(import.meta.url))),choicesPath,choicesSha,dataSha,buildId:build.buildId,options,variants,
    candidate:'Original frozen pair and entry clock. One open position at a time. Safe 15% sizing cap and original 2% stop, 4% target. Timeout sell at first eligible open after 32 bars.',
    assumptions:'Consumed May replay. Inferred OHLC spread and slippage, exchange minima, fees, cash and broker guards. Same caps at double costs. No historical depth or queue reconstruction.',
};
const registration='docs/may-frozen-portfolio-protocol-v1.json';
fs.writeFileSync(registration,JSON.stringify(protocol,null,2)+'\n',{flag:'wx'});
const results=[];
for(const variant of variants){
    const multiplier=variant.multiplier;
    const fees=options.feeRate*multiplier;
    const replay={...options,feeRate:fees,spreadBps:options.spreadBps*multiplier,slippageBps:options.slippageBps*multiplier,risk:{...options.risk,feeRate:fees}};
    const entries=new Map(choices.rows.filter(r=>r.actions[variant.name]).map(r=>[r.entryAt,r.selectedPair]));
    const provider={decide:async c=>{
        const clock=Date.parse(c.timeUTC)-5000;
        const position=c.positions[0];
        if(position&&clock>=position.openedAt+32*step)
            return {marketView:'Fixed holding period reached',actions:[{type:'sell',pair:position.pair,sellFraction:1,confidence:.8,reasoning:'Fixed 32-bar timeout'}]};
        const pair=entries.get(clock);
        if(position||!pair)return {marketView:'No scheduled entry',actions:[]};
        return {marketView:'Frozen scheduled entry',actions:[{type:'buy',pair,amountEur:Math.min(c.account.cash,c.account.equity*.15),stopLossPct:.02,takeProfitPct:.04,confidence:.8,reasoning:'Frozen May timing candidate'}]};
    }};
    const study=mockReplayStudy(replay,{venue:'binance',quoteCurrency:'EUR',visibleDepthQuote:1000,stopLossPct:.05});
    // The frozen provider consumes account and clock only. The replay keeps its full
    // policy, execution and risk checks without constructing unused model context.
    const result=variant.name==='rules'?await replayRulesPortfolio(markets,replay):await replayRulesPortfolio(markets,replay,provider,{...study,enrich:c=>c});
    const buys=result.fills.filter(f=>f.side==='buy');
    if(variant.name!=='rules')for(const f of buys)assert.equal(entries.get(f.barTs),f.pair);
    const balance=result.fills.reduce((cash,f)=>cash+(f.side==='buy'?-1:1)*f.qty*f.price-f.fee,replay.startingBalance);
    assert.ok(Math.abs(balance-result.curve.at(-1).cash)<1e-9);
    assert.ok(Math.abs(result.fills.reduce((sum,f)=>sum+f.fee,0)-result.fees)<1e-9);
    if(result.unliquidatedPositions===0)assert.ok(Math.abs(balance-result.finalEquity)<1e-9);
    results.push({...variant,scheduledEntries:variant.name==='rules'?null:entries.size,acceptedEntries:buys.length,result});
    console.log(JSON.stringify({variant,returnPct:result.returnPct,closed:result.closedTrades,accepted:buys.length,rejections:result.rejections,unliquidated:result.unliquidatedPositions}));
}
const facts={version:'may-frozen-portfolio-result-v1',registered:registration,protocolSha:digest(fs.readFileSync(registration)),generatedAt:new Date().toISOString(),results,profitabilityEstablished:false,independentSamples:null};
const bytes=JSON.stringify(facts,null,2)+'\n',sha=digest(bytes),file='docs/may-frozen-portfolio-'+sha.slice(0,16)+'.json';
fs.writeFileSync(file,bytes,{flag:'wx'});
console.log(JSON.stringify({file,sha}));
