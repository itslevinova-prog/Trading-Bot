import {test,expect} from 'vitest';
import {buildPolicyLabels,eligiblePolicyLabels,policyScopeId,type PolicyLabelScope} from '../src/research/policy-labels.js';
import type {PortfolioFill} from '../src/research/portfolio.js';
const at=Date.UTC(2026,0,1),scope:PolicyLabelScope={datasetId:'a'.repeat(64),replayBuildId:'b'.repeat(64),decisionModuleHash:'c'.repeat(64),scenarioHash:'d'.repeat(64)};
const entry:PortfolioFill={pair:'BTC/EUR',side:'buy',barTs:at,signalBarTs:at-900000,qty:1,price:100,fee:1,realizedPnl:null,reason:'entry fixture',protective:false};
const exit:PortfolioFill={pair:entry.pair,side:'sell',barTs:at+900000,signalBarTs:null,qty:1,price:110,fee:1.1,realizedPnl:7.9,reason:'intrabar target',protective:true};
const made=at+10*900000,lookup=(asOf:number,scopeId=policyScopeId(scope))=>({mode:'historical-simulation' as const,scopeId,asOf});
test('label matches full fee-inclusive position PnL and exposes actual materialization separately',()=>{
 const [r]=buildPolicyLabels([entry,exit],scope,made);expect(r).toMatchObject({entryFeatureClosedAt:at,modeledAvailableAt:at+1805000,materializedAt:made,netPnl:7.9,label:'profit',censoredReason:null,availability:'simulated-bar-close-plus5s-not-observed-receipt'});expect(r!.netReturnPct).toBeCloseTo(7.9/101*100);
});
test('training cutoff cannot read an outcome until after its conservative exit-bar availability',()=>{
 const rows=buildPolicyLabels([entry,exit],scope,made);expect(eligiblePolicyLabels(rows,lookup(at+900000))).toEqual([]);expect(eligiblePolicyLabels(rows,lookup(at+1804999))).toEqual([]);expect(eligiblePolicyLabels(rows,lookup(at+1805000))).toHaveLength(1);
});
test('open tail and forced end liquidation are censored, never labelled losing or profitable',()=>{
 const pending=buildPolicyLabels([entry],scope,made),forced=buildPolicyLabels([entry,{...exit,reason:'evaluation end liquidation'}],scope,made);
 expect(pending[0]).toMatchObject({censoredReason:'still-open',netPnl:null,netReturnPct:null,label:null,modeledAvailableAt:null});expect(forced[0]).toMatchObject({censoredReason:'evaluation-end',netPnl:null,label:null});
 expect(eligiblePolicyLabels([...pending,...forced],lookup(made))).toEqual([]);
});
test('cost/strategy/build scopes cannot be pooled and repeated materialization is one event',()=>{
 const rows=buildPolicyLabels([entry,exit],scope,made),again=buildPolicyLabels([entry,exit],scope,made+1000),other=buildPolicyLabels([entry,exit],{...scope,scenarioHash:'e'.repeat(64)},made);
 expect(rows[0]!.id).toBe(again[0]!.id);expect(eligiblePolicyLabels([...rows,...again,...other],lookup(made))).toHaveLength(1);expect(eligiblePolicyLabels([...rows,...again],lookup(made))[0]!.materializedAt).toBe(made);
});
test('contradictory same-ID outcomes and forged class labels fail closed',()=>{
 const rows=buildPolicyLabels([entry,exit],scope,made);expect(()=>eligiblePolicyLabels([...rows,{...rows[0]!,netPnl:8,netReturnPct:8/101*100}],lookup(made))).toThrow('Conflicting');expect(()=>eligiblePolicyLabels([{...rows[0]!,label:'loss'}],lookup(made))).toThrow('mislabeled');
});
test.each(['scale','partial','unmatched','future-feature','bad-pnl','bad-fee','time-order'] as const)('%s ledger cannot generate learning evidence',kind=>{
 let fills=[{...entry},{...exit}];if(kind==='scale')fills=[{...entry},{...entry},{...exit}];if(kind==='partial')fills[1]!.qty=.5;if(kind==='unmatched')fills=[{...exit}];if(kind==='future-feature')fills[0]!.signalBarTs=at;if(kind==='bad-pnl')fills[1]!.realizedPnl=99;if(kind==='bad-fee')fills[0]!.fee=-1;if(kind==='time-order')fills=[{...entry},{...exit,barTs:at-900000}];expect(()=>buildPolicyLabels(fills,scope,made)).toThrow();
});
test('materialization follows modeled availability and historical lookups require explicit simulation mode',()=>{
 expect(()=>buildPolicyLabels([entry,exit],scope,at+1800000)).toThrow('availability');
 const rows=buildPolicyLabels([entry,exit],scope,made);expect(()=>eligiblePolicyLabels(rows,{...lookup(made),mode:'live' as 'historical-simulation'})).toThrow('simulation mode');
});
test('zero after costs stays break-even rather than becoming a direction class',()=>{
 const rows=buildPolicyLabels([{...entry,fee:0},{...exit,price:100,fee:0,realizedPnl:0}],scope,made);expect(rows[0]).toMatchObject({label:'break-even',netPnl:0,netReturnPct:0});expect(eligiblePolicyLabels(rows,lookup(made))).toHaveLength(1);
});
test('altered not-yet-mature outcomes cannot change a prior eligible training set',()=>{
 const first=buildPolicyLabels([entry,exit],scope,made),future=buildPolicyLabels([{...entry,barTs:at+2700000,signalBarTs:at+1800000},{...exit,barTs:at+3600000}],scope,made);
 const changed={...future[0]!,netPnl:-11,netReturnPct:-11/101*100,label:'loss' as const};expect(eligiblePolicyLabels([...first,...future],lookup(at+1805000))).toEqual(eligiblePolicyLabels([...first,changed],lookup(at+1805000)));
});


test('not-yet-available payload validation cannot influence an earlier training lookup',()=>{
 const first=buildPolicyLabels([entry,exit],scope,made),later=buildPolicyLabels([{...entry,barTs:at+2700000,signalBarTs:at+1800000},{...exit,barTs:at+3600000}],scope,made);
 const damaged={...later[0]!,label:'loss' as const};expect(eligiblePolicyLabels([...first,damaged],lookup(at+1805000))).toEqual(eligiblePolicyLabels(first,lookup(at+1805000)));
 expect(()=>eligiblePolicyLabels([...first,damaged],lookup(made))).toThrow('mislabeled');
});
