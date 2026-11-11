import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {inspectBuild,digest} from '../apps/server/dist/provenance/build.js';
import {defaultDataset,datasetReplay,datasetDataHash,canonicalJson} from '../apps/server/dist/research/dataset.js';
import {replayRulesPortfolio} from '../apps/server/dist/research/portfolio.js';
import {mockReplayStudy} from '../apps/server/dist/research/mock-replay-context.js';
import {rangeReversionSetup} from '../apps/server/dist/strategy/range-entry.js';
const read=p=>JSON.parse(readFileSync(p,'utf8')),build=inspectBuild(process.cwd());assert.equal(build.verified,true);
const protocolFile='docs/range-regime-protocol-v1.json',protocol=read(protocolFile),protocolHash=digest(readFileSync(protocolFile));
for(const [file,hash]of Object.entries(protocol.sourceFiles))assert.equal(digest(readFileSync(file)),hash,'Research changed after registration');
const source=read('docs/structure-exit-study-5e7a4bf0170e6610.json'),dataset=defaultDataset(process.cwd(),'binance','EUR');assert.equal(dataset.datasetId,source.datasetId);assert.equal(datasetDataHash(dataset),source.dataHash);
const originalProtocol=read('docs/mock-structure-study-protocol-v1.json'),markets=datasetReplay(dataset),scenarios=[];
for(const s of source.scenarios){
 const counts={regimes:{},families:{},reasons:{},assets:{}},snapshots=[],rangeSetupDetails=[];let observations=0,eligible=0;
 const inc=(o,k)=>o[k]=(o[k]??0)+1;
 const provider={decide:async c=>{const now=Date.parse(c.timeUTC);for(const f of c.features){const frames=c.marketContext.markets.filter(m=>m.pair===f.pair);assert.equal(frames.length,1);const m=frames[0];
 // Replay enrichment intentionally exposes compact metrics, not raw candles. Use its causal source
 // below, captured by the wrapper at the identical clock, rather than an invented compact reconstruction.
 const raw=causal.find(m=>m.pair===f.pair);assert.ok(raw);
 const setup=rangeReversionSetup(raw.candles,f.pair,now,{bid:raw.bid,ask:raw.ask,bookTs:m.asOf,feeRate:c.limits.TAKER_FEE_RATE,slippageBps:c.limits.MAX_ENTRY_SLIPPAGE_BPS,maxSpreadBps:c.limits.MAX_ENTRY_SPREAD_BPS,maxStopLossPct:c.tradingPolicy.stopLossPct});
 observations++;inc(counts.regimes,setup.regime.regime);inc(counts.families,setup.regime.strategyFamily);for(const reason of setup.reasons)inc(counts.reasons,reason);
 const a=counts.assets[f.pair]??={observations:0,rangeSetups:0,eligibleSetups:0};a.observations++;if(setup.regime.strategyFamily==='range-reversion-research'){a.rangeSetups++;rangeSetupDetails.push({timeUTC:c.timeUTC,pair:f.pair,regime:setup.regime,reasons:setup.reasons,eligibleSetup:setup.eligibleSetup,syntheticBid:raw.bid,syntheticAsk:raw.ask,feeRate:c.limits.TAKER_FEE_RATE,slippageBps:c.limits.MAX_ENTRY_SLIPPAGE_BPS,observedResistanceTargetPct:setup.regime.priorResistance/(raw.ask*(1+c.limits.MAX_ENTRY_SLIPPAGE_BPS/10000))-1});}if(setup.eligibleSetup){eligible++;a.eligibleSetups++;}
 snapshots.push([c.timeUTC,f.pair,setup.regime.sourceHash,setup.eligibleSetup,setup.reasons]);
 }return {marketView:'Range descriptor/setup audit only; no executable strategy.',actions:[{type:'hold',confidence:0,reasoning:'Research observer; no trade.'}]};}};
 let causal=[];const base=mockReplayStudy(s.options,{venue:'binance',quoteCurrency:'EUR',visibleDepthQuote:originalProtocol.visibleDepthQuotePerSide,stopLossPct:originalProtocol.stopLossPct}),study={...base,enrich:(c,m)=>{causal=m;return base.enrich(c,m);}};
 const result=await replayRulesPortfolio(markets,s.options,provider,study);assert.equal(result.fills.length,0);assert.equal(result.returnPct,0);
 scenarios.push({scenario:s.scenario,options:s.options,decisionTimes:result.decisions,observations,eligibleConditionalSetups:eligible,counts,rangeSetupDetails,snapshotHash:digest(canonicalJson(snapshots)),executedTrades:0,observerCashReturnPct:0,observerReturnIsNotStrategyPerformance:true});console.log(JSON.stringify(scenarios.at(-1)));
}
const previous=read('docs/range-setup-audit-1aa536bb2d3faea1.json');for(let i=0;i<scenarios.length;i++){assert.deepEqual(scenarios[i].counts,previous.scenarios[i].counts);assert.equal(scenarios[i].snapshotHash,previous.scenarios[i].snapshotHash);}
const facts={version:'range-setup-audit-v2',protocolHash,buildId:build.buildId,datasetId:dataset.datasetId,dataHash:datasetDataHash(dataset),runnerHash:digest(readFileSync(new URL(import.meta.url))),scenarios,independentOutOfSample:false,profitabilityEstablished:false,calibratedProbability:null,limitations:['Consumed history and selected surviving universe; overlapping windows/assets are dependent.','OHLC next-open synthetic quotes/costs; historical books/latency/receipt times unobserved.','A setup is not a complete strategy: account status/slots/sizing/correlation/depth, entry provenance and causal exits still need integration and independent evaluation.','No executable range policy enabled or performance result inferred.']};
const hash=digest(canonicalJson(facts)),path='docs/range-setup-audit-'+hash.slice(0,16)+'.json';if(existsSync(path)){const {reportHash,generatedAt,...saved}=read(path);assert.equal(reportHash,hash);assert.equal(digest(canonicalJson(saved)),hash);}else writeFileSync(path,JSON.stringify({...facts,reportHash:hash,generatedAt:new Date().toISOString()},null,2),{flag:'wx'});
writeFileSync('docs/range-setup-latest.json',JSON.stringify({path,hash,protocolHash,buildId:build.buildId},null,2));console.log(JSON.stringify({path,hash}));
