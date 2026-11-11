import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {inspectBuild,digest} from '../apps/server/dist/provenance/build.js';
import {defaultDataset,datasetReplay,canonicalJson,datasetDataHash} from '../apps/server/dist/research/dataset.js';
import {replayRulesPortfolio} from '../apps/server/dist/research/portfolio.js';
import {mockReplayStudy} from '../apps/server/dist/research/mock-replay-context.js';
import {MockAiProvider} from '../apps/server/dist/strategy/providers.js';
import {PAPER_INTELLIGENCE_VERSION} from '../apps/server/dist/strategy/paper-intelligence.js';
import {inspectMockExperiment} from './mock-experiment-files.mjs';
const root=process.cwd(),read=p=>JSON.parse(readFileSync(p,'utf8'));
const protocolFile='docs/mock-structure-study-protocol-v1.json',protocol=read(protocolFile),protocolHash=digest(readFileSync(protocolFile));
assert.equal(protocol.version,'mock-structure-retrospective-v1');assert.equal(protocol.historyAlreadyInspected,true);
const build=inspectBuild(root);assert.equal(build.verified,true);assert.equal(PAPER_INTELLIGENCE_VERSION,protocol.candidateMockVersion);
const frozen=inspectMockExperiment(root,'v2');assert.equal(frozen.record.buildId,protocol.baselineBuildId);
const baselinePath=join(frozen.root,'apps/server/dist/strategy/providers.js');
const baseline=await import(pathToFileURL(baselinePath).href),baselineVersion=await import(pathToFileURL(join(frozen.root,'apps/server/dist/strategy/paper-intelligence.js')).href);
assert.equal(baselineVersion.PAPER_INTELLIGENCE_VERSION,protocol.baselineMockVersion);
const dataset=defaultDataset(root,'binance','EUR');assert.equal(dataset.datasetId,protocol.datasetId);
const markets=datasetReplay(dataset),hard=protocol.hardLimits;
const assumptions={venue:'binance',quoteCurrency:'EUR',visibleDepthQuote:protocol.visibleDepthQuotePerSide,stopLossPct:protocol.stopLossPct};
function summary(r){const sales=r.fills.filter(f=>f.side==='sell'),positive=sales.reduce((s,f)=>s+Math.max(0,f.realizedPnl),0),negative=sales.reduce((s,f)=>s+Math.max(0,-f.realizedPnl),0),entries=r.fills.filter(f=>f.side==='buy').length;
 const slices=[];for(let from=r.fromTs;from<r.toTs;from+=7*86400000){const to=Math.min(r.toTs,from+7*86400000),before=r.curve.filter(x=>x.ts<=from).at(-1)?.equity??r.startingBalance,end=r.curve.filter(x=>x.ts<=to).at(-1)?.equity??before;slices.push({from,to,returnPct:(end/before-1)*100,entries:r.fills.filter(f=>f.side==='buy'&&f.barTs>=from&&f.barTs<to).length,positionsCarryAcrossBoundaries:true});}
 return {returnPct:r.returnPct,maxDrawdownPct:r.maxDrawdownPct,returnToDrawdown:r.maxDrawdownPct>0?r.returnPct/r.maxDrawdownPct:null,fees:r.fees,entries,closedTrades:r.closedTrades,winRatePct:r.winRatePct,profitFactor:negative>0?positive/negative:null,profitFactorUndefinedReason:negative===0?'No observed closed losses or no trades':null,meanRealizedPnlPerClosedTrade:sales.length?sales.reduce((s,f)=>s+f.realizedPnl,0)/sales.length:null,entriesPerDay:entries/((r.toTs-r.fromTs)/86400000),paused:r.paused,missingValuationBars:r.missingValuationBars,unliquidatedPositions:r.unliquidatedPositions,terminalBtcReturnPct:r.benchmarkReturnPct,sameFillDoubleFeeReturnPct:r.returnPct-r.fees/r.startingBalance*100,sameFillFeeStressIsAlgebraOnly:true,chronologicalSlices:slices};}
const scenarios=[];
for(const scenario of protocol.scenarios){
 const options={...dataset.options,startingBalance:protocol.capital,feeRate:scenario.feeRate,spreadBps:protocol.spreadBps,slippageBps:protocol.slippageBps,risk:{maxPositionPct:hard.maxPositionPct,maxOpenPositions:hard.maxOpenPositions,maxTradesPerDay:hard.maxTradesPerDay,cooldownMinutes:hard.cooldownMinutes,maxPortfolioRiskPct:hard.maxPortfolioRiskPct,feeRate:scenario.feeRate},entry:{maxSpreadBps:hard.maxSpreadBps,maxSlippageBps:hard.maxSlippageBps}};
 const variants=[],inputs=[];
 for(const[name,create]of [['mock-v1',()=>new baseline.MockAiProvider()],['mock-v2',()=>new MockAiProvider()]]){
  const delegate=create(),fingerprints=new Map(),codes={};let assessments=0;
  const provider={decide:async c=>{const markets=c.marketContext.markets.map(m=>({pair:m.pair,asOf:m.asOf,feature:m.feature,quality:m.quality,regime:m.regime,microstructure:m.microstructure}));fingerprints.set(c.timeUTC,digest(canonicalJson({features:c.features,limits:c.limits,markets})));const answer=await delegate.decide(c),e=delegate.getEvidence();assert.equal(e.simulated,true);assert.equal(e.estimatedWinProbability,null);for(const a of e.assessments){assessments++;for(const code of a.contradictions)codes[code]=(codes[code]??0)+1;}return answer;}};
  const result=await replayRulesPortfolio(markets,options,provider,mockReplayStudy(options,assumptions));
  variants.push({name,summary:summary(result),assessments,refusalCodes:codes,result});inputs.push(fingerprints);
  console.log(JSON.stringify({scenario:scenario.name,variant:name,summary:summary(result)}));
 }
 let shared=0;for(const[time,hash]of inputs[0])if(inputs[1].has(time)){shared++;assert.equal(inputs[1].get(time),hash,'Exogenous input mismatch at '+time);}
 const rule=await replayRulesPortfolio(markets,options);
 scenarios.push({scenario,options,variants,ruleReference:{semantics:'Actual unchanged Rule provider/default replay role; confidence/global-entry/exit semantics intentionally differ from AI policy',summary:summary(rule)},cashReturnPct:0,inputProof:{sharedDecisionTimes:shared,v1DecisionTimes:inputs[0].size,v2DecisionTimes:inputs[1].size,sharedTimeExogenousMismatches:0,independentSamples:null},candidateMinusBaselineReturnPct:variants[1].summary.returnPct-variants[0].summary.returnPct});
}
const body={formatVersion:1,protocolHash,buildId:build.buildId,datasetId:dataset.datasetId,dataHash:datasetDataHash(dataset),baseline:{buildId:frozen.record.buildId,providerHash:digest(readFileSync(baselinePath)),decisionModuleHash:digest(readFileSync(join(frozen.root,'apps/server/dist/strategy/paper-intelligence.js')))},candidate:{version:PAPER_INTELLIGENCE_VERSION,decisionModuleHash:digest(readFileSync('apps/server/dist/strategy/paper-intelligence.js'))},runnerHash:digest(readFileSync(new URL(import.meta.url))),historicalDataAlreadyInspected:true,independentSamples:null,profitabilityEstablished:false,calibratedProbabilityAvailable:false,scenarios,limitations:['Current surviving universe/current exchange metadata; no historical constituent selection.','OHLC synthetic depth/quotes; no observed queue/impact/5second price path or first receipt time.','Unannualized descriptive risk ratios and chronological carry-position slices, not independent walk-forward folds.','No fitting or threshold selection. Existing history was consumed before this hypothesis.','Adaptive double-fee policy path differs; same-fill fee algebra is separate and not an executable portfolio replay.','No real AI, financial accounts, private exchange calls, orders or paid services.']};
const reportHash=digest(canonicalJson(body)),report={...body,reportHash,generatedAt:new Date().toISOString()},path='docs/mock-structure-study-'+protocolHash.slice(0,12)+'-'+reportHash.slice(0,12)+'.json';
if(existsSync(path)){const saved=read(path),{reportHash:savedHash,generatedAt,...savedBody}=saved;assert.equal(savedHash,digest(canonicalJson(savedBody)));assert.equal(savedHash,reportHash,'Existing report differs');}else writeFileSync(path,JSON.stringify(report,null,2),{flag:'wx'});writeFileSync('docs/mock-structure-study-latest.json',JSON.stringify({path,reportHash,protocolHash,buildId:build.buildId},null,2));
console.log(JSON.stringify({path,reportHash,results:scenarios.map(s=>({scenario:s.scenario.name,variants:s.variants.map(v=>({name:v.name,summary:v.summary})),delta:s.candidateMinusBaselineReturnPct})),profitabilityEstablished:false}));
