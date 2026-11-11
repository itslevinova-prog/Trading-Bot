import {test,expect} from 'vitest';
import type {DecisionContext} from '@paper/shared';import type {PortfolioFill} from '../src/research/portfolio.js';
import {capturePolicyEntry,joinPolicyInputs,eligiblePolicyInputs,POLICY_INPUT_FIELDS} from '../src/research/policy-inputs.js';
import {buildPolicyLabels,policyScopeId} from '../src/research/policy-labels.js';
const at=Date.UTC(2026,0,1),scope={datasetId:'a'.repeat(64),replayBuildId:'b'.repeat(64),decisionModuleHash:'c'.repeat(64),scenarioHash:'d'.repeat(64)},id=policyScopeId(scope);
function context():DecisionContext{const f={pair:'BTC/EUR',ts:at-900000,price:100,ema20:99,ema50:98,ema50_60m:97,prevEma20:98,prevEma50:97,rsi14:55,atr14:.5,atrPct:.5,volumeRatio:1.5,change1h:1,change4h:2,change24h:3,spreadPct:.01,distanceEma50Pct:2};return {timeUTC:new Date(at+5000).toISOString(),timeZurich:'fixture',features:[f],positions:[],account:{},recentTrades:[],memory:[],lessons:[],limits:{TAKER_FEE_RATE:.001,MAX_ENTRY_SLIPPAGE_BPS:15},execution:{mode:'paper',simulation:{kind:'ohlc-next-open-synthetic-book-v1',historicalOrderBookObserved:false,slippageBps:5}},marketContext:{markets:[{pair:f.pair,asOf:at+5000,feature:{...f},quality:{lastClosedAt:at},microstructure:{bids:[{price:'100',qty:'10'}],asks:[{price:'100.01',qty:'10'}]},regime:{structure:{version:'closed-structure-v1',complete:true,signalClosedAt:at,directionalEfficiency:.8,priorSupport:90,priorResistance:110,upsideBreakout:false,downsideBreakout:false,upsideRejection:false,downsideRejection:false,twoSidedSweep:false},correlationBTC48h:{complete:true,value:.9}}}]}};}
const frames=(c:DecisionContext)=>(c.marketContext as any).markets;
const entry:PortfolioFill={pair:'BTC/EUR',side:'buy',barTs:at,signalBarTs:at-900000,qty:1,price:100,fee:1,realizedPnl:null,reason:'entry',protective:false};
const exit:PortfolioFill={...entry,side:'sell',barTs:at+900000,signalBarTs:null,price:110,fee:1.1,realizedPnl:7.9,reason:'target',protective:true};
const labels=()=>buildPolicyLabels([entry,exit],scope,at+10*900000),lookup=(asOf:number)=>({mode:'historical-simulation' as const,scopeId:id,asOf});
test('entry inputs use a fixed field whitelist and deterministic fee/indicator units',()=>{
 const c=context(),before=JSON.stringify(c),r=capturePolicyEntry(c,'BTC/EUR',id);expect(Object.keys(r.features)).toEqual([...POLICY_INPUT_FIELDS]);expect(r.features).toMatchObject({rsi14:55,feeBps:10,slippageCapBps:15,assumedSlippageBps:5,directionalEfficiency:.8,upsideBreakout:0});expect(r.features.emaGapPct).toBeCloseTo((99/98-1)*100);expect(JSON.stringify(c)).toBe(before);expect(capturePolicyEntry(c,'BTC/EUR',id)).toEqual(r);
});
test('unknown structure and correlation stay null while observed false stays zero',()=>{
 const c=context();frames(c)[0].regime.structure.complete=false;frames(c)[0].regime.correlationBTC48h.complete=false;const r=capturePolicyEntry(c,'BTC/EUR',id);expect(r.features.directionalEfficiency).toBeNull();expect(r.features.btcCorrelation48h).toBeNull();expect(r.features.upsideBreakout).toBeNull();
});
test('arbitrary future result and portfolio fields cannot become model features',()=>{
 const c=context(),before=capturePolicyEntry(c,'BTC/EUR',id);(c as any).futureResult=999;(c.account as any).futureProfit=1e9;frames(c)[0].nextReturnPct=-100;expect(capturePolicyEntry(c,'BTC/EUR',id)).toEqual(before);expect(POLICY_INPUT_FIELDS.join(',')).not.toMatch(/exit|target|pnl|available/i);
});
test.each(['future','mixed','live','missing'] as const)('%s entry context cannot masquerade as a causal synthetic recapture',kind=>{
 const c=context();if(kind==='future'){c.features[0]!.ts=at;frames(c)[0].feature={...c.features[0]};frames(c)[0].quality.lastClosedAt=at+900000;}if(kind==='mixed')frames(c)[0].feature.price=101;if(kind==='live')c.execution={mode:'paper'};if(kind==='missing')c.features=[];expect(()=>capturePolicyEntry(c,'BTC/EUR',id)).toThrow();
});
test('only matched executed entries produce rows and no outcome is eligible prematurely',()=>{
 const c=capturePolicyEntry(context(),'BTC/EUR',id),rows=joinPolicyInputs(labels(),[c],id);expect(rows).toHaveLength(1);expect(eligiblePolicyInputs(rows,lookup(at+1804999))).toHaveLength(0);const train=eligiblePolicyInputs(rows,lookup(at+1805000));expect(train).toHaveLength(1);expect(train[0]!.x).toHaveLength(POLICY_INPUT_FIELDS.length);expect(train[0]!.yNetReturnPct).toBeCloseTo(7.9/101*100);expect(()=>joinPolicyInputs(labels(),[],id)).toThrow('no matching');
});
test('repeated outcome/input rows count once and conflicting entry captures are rejected',()=>{
 const c=capturePolicyEntry(context(),'BTC/EUR',id),rows=joinPolicyInputs(labels(),[c,c],id);expect(eligiblePolicyInputs([...rows,...rows],lookup(at+1805000))).toHaveLength(1);
 const other=context();other.features[0]!.rsi14=56;frames(other)[0].feature={...other.features[0]};expect(()=>joinPolicyInputs(labels(),[c,capturePolicyEntry(other,'BTC/EUR',id)],id)).toThrow('Conflicting');
});
test('future input corruption is invisible to an earlier eligible prefix and rejected once mature',()=>{
 const first=joinPolicyInputs(labels(),[capturePolicyEntry(context(),'BTC/EUR',id)],id),laterContext=context(),laterAt=at+2700000;laterContext.timeUTC=new Date(laterAt+5000).toISOString();laterContext.features[0]!.ts=laterAt-900000;frames(laterContext)[0].asOf=laterAt+5000;frames(laterContext)[0].feature={...laterContext.features[0]};frames(laterContext)[0].quality.lastClosedAt=laterAt;frames(laterContext)[0].regime.structure.signalClosedAt=laterAt;
 const laterLabels=buildPolicyLabels([{...entry,barTs:laterAt,signalBarTs:laterAt-900000},{...exit,barTs:laterAt+900000}],scope,at+10*900000),later=joinPolicyInputs(laterLabels,[capturePolicyEntry(laterContext,'BTC/EUR',id)],id);later[0]!.capture.features.rsi14=NaN;
 expect(eligiblePolicyInputs([...first,...later],lookup(at+1805000))).toEqual(eligiblePolicyInputs(first,lookup(at+1805000)));expect(()=>eligiblePolicyInputs([...first,...later],lookup(at+10*900000))).toThrow('Invalid policy entry');
});


test.each(['rsi','atr','volume','correlation','efficiency'] as const)('invalid %s values never become numeric learning evidence',kind=>{
 const c=context();if(kind==='rsi')c.features[0]!.rsi14=101;if(kind==='atr')c.features[0]!.atrPct=0;if(kind==='volume')c.features[0]!.volumeRatio=-1;if(kind==='correlation')frames(c)[0].regime.correlationBTC48h.value=2;if(kind==='efficiency')frames(c)[0].regime.structure.directionalEfficiency=2;frames(c)[0].feature={...c.features[0]};expect(()=>capturePolicyEntry(c,'BTC/EUR',id)).toThrow('Invalid policy input');
});
