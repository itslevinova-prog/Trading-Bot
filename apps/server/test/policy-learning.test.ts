import {test,expect} from 'vitest';
import {digest} from '../src/provenance/build.js';import {canonicalJson} from '../src/research/dataset.js';
import {buildPolicyLabels,policyScopeId} from '../src/research/policy-labels.js';
import {POLICY_INPUT_FIELDS,POLICY_INPUT_VERSION,joinPolicyInputs,type PolicyEntryCapture,type PolicyInputFields} from '../src/research/policy-inputs.js';
import {fitPolicyPreprocessor,transformPolicyVector,policyLearningFold} from '../src/research/policy-learning.js';
const at=Date.UTC(2026,0,1),bar=900000,scope={datasetId:'a'.repeat(64),replayBuildId:'b'.repeat(64),decisionModuleHash:'c'.repeat(64),scenarioHash:'d'.repeat(64)},scopeId=policyScopeId(scope);
function row(offset:number,hold:number,rsi:number,profit=true,optional:number|null=.5,pair='BTC/EUR'){
 const ts=at+offset*bar,features=Object.fromEntries(POLICY_INPUT_FIELDS.map(k=>[k,0])) as PolicyInputFields;
 Object.assign(features,{rsi14:rsi,atrPct:1,volumeRatio:1,directionalEfficiency:optional,btcCorrelation48h:null});
 const facts:Omit<PolicyEntryCapture,'inputHash'>={version:POLICY_INPUT_VERSION,scopeId,pair,entryBarTs:ts,decisionAt:ts+5000,featureClosedAt:ts,features,source:'retrospective-synthetic-replay-recapture'};
 const capture={...facts,inputHash:digest(canonicalJson(facts))};
 const entry={pair,side:'buy' as const,barTs:ts,signalBarTs:ts-bar,qty:1,price:100,fee:1,realizedPnl:null,reason:'entry',protective:false};
 const exit={...entry,side:'sell' as const,barTs:ts+hold*bar,signalBarTs:null,price:profit?110:90,fee:profit?1.1:.9,realizedPnl:profit?7.9:-11.9,reason:'exit'};
 return joinPolicyInputs(buildPolicyLabels([entry,exit],scope,at+100*bar),[capture],scopeId)[0]!;
}
const lookup=(n:number)=>({mode:'historical-simulation' as const,scopeId,asOf:at+n*bar});
const options={mode:'historical-simulation' as const,scopeId,trainStart:at,validationStart:at+10*bar+5000,testStart:at+20*bar+5000,testEnd:at+30*bar+5000,embargoMs:0};
test('training-only population scaling and balanced weights are analytically correct',()=>{
 const rows=[row(0,1,40),row(3,1,60,false),row(6,1,50,false)],m=fitPolicyPreprocessor(rows,lookup(10),at);
 expect(m.columns[0]!.mean).toBe(50);expect(m.columns[0]!.std).toBeCloseTo(Math.sqrt(200/3));expect(m.classes).toEqual({profit:1,loss:2,'break-even':0});expect(m.classWeights).toEqual({profit:1.5,loss:.75,'break-even':null});expect(m.trainingIds).toHaveLength(3);
});
test('future inputs/outcomes cannot change fitted statistics, weights or identity',()=>{
 const rows=[row(0,1,40),row(3,1,60,false)],before=fitPolicyPreprocessor(rows,lookup(10),at),future=row(15,1,100);
 future.capture.features.rsi14=NaN;future.label.netReturnPct=1e9;
 expect(fitPolicyPreprocessor([...rows,future],lookup(10),at)).toEqual(before);
});
test('missing observed values use train mean with a mask; never-observed fields stay unsupported',()=>{
 const m=fitPolicyPreprocessor([row(0,1,40,true,null),row(3,1,60,false,.8)],lookup(10),at),x=POLICY_INPUT_FIELDS.map(()=>0) as (number|null)[];x[12]=null;x[15]=.9;
 const r=transformPolicyVector(m,{scopeId,x});expect(r.values[12]).toBe(0);expect(r.missing[12]).toBe(true);expect(r.values[15]).toBeNull();expect(r.unsupported[15]).toBe(true);
});
test('unseen variation in a training constant is rejected as unsupported, observed zero remains known',()=>{
 const m=fitPolicyPreprocessor([row(0,1,50)],lookup(10),at),x=POLICY_INPUT_FIELDS.map(()=>0) as (number|null)[];x[0]=51;
 const r=transformPolicyVector(m,{scopeId,x});expect(r.values[0]).toBeNull();expect(r.unsupported[0]).toBe(true);expect(r.values[1]).toBe(0);expect(r.missing[1]).toBe(false);
});
test('scope mixing, tampered preprocessors and malformed feature dimensions fail',()=>{
 const m=fitPolicyPreprocessor([row(0,1,50)],lookup(10),at),x=POLICY_INPUT_FIELDS.map(()=>0);
 expect(()=>transformPolicyVector(m,{scopeId:'f'.repeat(64),x})).toThrow('mismatch');expect(()=>transformPolicyVector({...m,rows:99},{scopeId,x})).toThrow('mismatch');expect(()=>transformPolicyVector(m,{scopeId,x:[]})).toThrow('mismatch');
});
test('empty or future-only training cannot fit a fictional learner',()=>{expect(()=>fitPolicyPreprocessor([row(15,1,50)],lookup(10),at)).toThrow('No mature');expect(()=>fitPolicyPreprocessor([],lookup(10),at)).toThrow('No mature');});
test('per-trade purging excludes outcomes crossing or equal to the next decision boundary',()=>{
 const rows=[row(0,1,40),row(8,1,60),row(7,2,70),row(10,1,55),row(18,1,60),row(17,2,70),row(20,1,55),row(28,1,60)];
 const fold=policyLearningFold(rows,options);expect(fold.train.map(r=>r.decisionAt)).toEqual([at+5000]);expect(fold.validation.map(r=>r.decisionAt)).toEqual([at+10*bar+5000]);expect(fold.test.map(r=>r.decisionAt)).toEqual([at+20*bar+5000]);expect(fold.modelTrained).toBe(false);
});
test('validation/test feature changes never refit training or class weights',()=>{
 const train=[row(0,1,40),row(3,1,60,false)],a=policyLearningFold([...train,row(10,1,55),row(20,1,55)],options),b=policyLearningFold([...train,row(10,1,99,false),row(20,1,1,false)],options);
 expect(a.preprocessor).toEqual(b.preprocessor);expect(a.train).toEqual(b.train);expect(a.validation).not.toEqual(b.validation);
});
test('embargo is elapsed time and applies to validation model-selection availability too',()=>{
 const rows=[row(0,1,40),row(6,1,60),row(10,1,55),row(16,1,60),row(20,1,55)];const f=policyLearningFold(rows,{...options,embargoMs:3*bar});
 expect(f.train).toHaveLength(1);expect(f.validation).toHaveLength(1);expect(f.test).toHaveLength(1);
});
test('same-time correlated pairs share the same boundary and repeated rows do not add training weight',()=>{
 const r=row(0,1,50),other=row(0,1,60,false,.5,'ETH/EUR');expect(fitPolicyPreprocessor([r,r,other],lookup(10),at).rows).toBe(2);const f=policyLearningFold([r,other,row(8,1,70,true,.5,'SOL/EUR'),row(10,1,55),row(20,1,55)],options);expect(f.train).toHaveLength(2);expect(f.preprocessor.asOf).toBe(options.validationStart-1);expect(f.independentSamples).toBeNull();
});
test.each([{...options,testStart:options.validationStart},{...options,embargoMs:11*bar},{...options,testEnd:NaN}])('invalid split cannot silently overlap or fall back to a random split',o=>expect(()=>policyLearningFold([row(0,1,50)],o)).toThrow('chronological'));

test('rolling training start excludes older outcomes from every fitted statistic',()=>{const m=fitPolicyPreprocessor([row(0,1,100),row(3,1,40,false)],lookup(10),at+3*bar);expect(m.rows).toBe(1);expect(m.columns[0]!.mean).toBe(40);expect(m.classes.profit).toBe(0);});
