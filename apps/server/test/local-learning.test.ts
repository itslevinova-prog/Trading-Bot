import {expect,test} from 'vitest';
import type {Candle} from '@paper/shared';
import {learningObservations,learningFolds,splitLearningFold,fitRidge,ridgeForecast,forecastMetrics,diagnosticCostFactors,fixedHorizonDiagnostic,selectLearningModel,type LearningObservation} from '../src/research/local-learning.js';
const base=Date.UTC(2026,0,1),step=900000,day=86400000;
const row=(i:number,x=0,y=0):LearningObservation=>({pair:'ETH/EUR',decisionAt:base+i*6*3600000,entryAt:base+i*6*3600000+step,labelEnd:base+i*6*3600000+17*step,x:[x,0,0,0,0,0,0,0],y,entryPrice:100,exitPrice:100*(1+y)});
const bars:Candle[]=Array.from({length:480},(_,i)=>({pair:'ETH/EUR',interval:15,ts:base+i*step,open:100+i*.01,high:101+i*.01,low:99+i*.01,close:100.05+i*.01,volume:10+i%3}));

test('targets use a delayed next full bar and exact four-hour close, with only past features',()=>{
 const samples=learningObservations('ETH/EUR',bars,base,base+480*step),r=samples[0]!;
 expect(r.entryAt).toBe(r.decisionAt+step);expect(r.labelEnd).toBe(r.entryAt+16*step);
 const entry=bars.find(c=>c.ts===r.entryAt)!,exit=bars.find(c=>c.ts===r.labelEnd-step)!;
 expect(r.y).toBe(exit.close/entry.open-1);
 const futurePoison=bars.map(c=>c.ts+step<=r.decisionAt?c:{...c,open:c.open*2,high:c.high*2,low:c.low*2,close:c.close*2,volume:1e8});
 expect(learningObservations('ETH/EUR',futurePoison,base,base+480*step)[0]!.x).toEqual(r.x);
 expect(learningObservations('ETH/EUR',bars,base,r.labelEnd-1).some(s=>s.decisionAt===r.decisionAt)).toBe(false);
});
test('missing label path, wrong pair and duplicate candles are not silently repaired',()=>{
 const r=learningObservations('ETH/EUR',bars,base,base+480*step)[0]!;
 expect(learningObservations('ETH/EUR',bars.filter(c=>c.ts!==r.entryAt+step),base,base+480*step).some(s=>s.decisionAt===r.decisionAt)).toBe(false);
 expect(()=>learningObservations('BTC/EUR',bars,base,base+480*step)).toThrow();
 expect(()=>learningObservations('ETH/EUR',[...bars,bars[0]!],base,base+480*step)).toThrow();
});
test('all pairs share chronological fold boundaries; crossing training and validation labels are purged',()=>{
 const folds=learningFolds(base,base+30*day);expect(folds).toHaveLength(3);const f=folds[0]!;
 const good={...row(0),decisionAt:f.validationStart-6*3600000,labelEnd:f.validationStart-step};
 const bad={...good,pair:'BTC/EUR',labelEnd:f.validationStart};
 const validation={...row(1),decisionAt:f.validationStart,labelEnd:f.testStart-step};
 const cross={...validation,pair:'BTC/EUR',labelEnd:f.testStart+step};
 const split=splitLearningFold([bad,validation,good,cross],f);expect(split.train).toEqual([good]);expect(split.validation).toEqual([validation]);
});
test('ridge matches an analytic one-dimensional solution and keeps a centered unpenalized intercept',()=>{
 const rows=[-2,-1,1,2].map((x,i)=>row(i,x,.01+.02*x)),model=fitRidge(rows,base+5*day,1,2);
 expect(model.intercept).toBeCloseTo(.01);expect(ridgeForecast(model,[1,0,0,0,0,0,0,0],base+5*day)).toBeCloseTo(.026);
 expect(model.weights.slice(1)).toEqual(Array(7).fill(0));
});
test('future label poisoning is rejected at fit, rather than affecting scaling or weights',()=>{
 const rows=[-2,-1,1,2].map((x,i)=>row(i,x,.001*x)),at=base+5*day,before=JSON.stringify(rows),m=fitRidge(rows,at,10,2);
 expect(JSON.stringify(rows)).toBe(before);
 expect(()=>fitRidge([...rows,{...row(20,1e20,10),labelEnd:at+1}],at,10,2)).toThrow('unavailable');
 expect(fitRidge(rows,at,10,2)).toEqual(m);expect(()=>fitRidge([...rows,rows[0]!],at,10,2)).toThrow('Duplicate');
});
test('invalid dimensions, low sample count and nonfinite training values fail explicitly',()=>{
 const rows=[row(0),row(1)],at=base+day;
 expect(()=>fitRidge(rows,at)).toThrow();expect(()=>fitRidge([{...rows[0]!,x:[1]},rows[1]!],at,10,2)).toThrow();
 expect(()=>fitRidge([{...rows[0]!,y:NaN},rows[1]!],at,10,2)).toThrow();expect(()=>fitRidge(rows,at,0,2)).toThrow();
});
test('unknown domain, feature age and outliers produce abstention without inventing probabilities',()=>{
 const at=base+5*day,m=fitRidge([row(0,-1),row(1,1)],at,10,2);
 expect(ridgeForecast(m,[100,0,0,0,0,0,0,0],at)).toBeNull();expect(ridgeForecast(m,Array(8).fill(0),at-1)).toBeNull();
 expect(ridgeForecast(m,Array(8).fill(0),at+10*day+1)).toBeNull();expect(ridgeForecast(m,[NaN],at)).toBeNull();
});
test('abstaining models are scored on the same rows with zero forecasts, coverage stays explicit',()=>{
 const rows=[row(0,0,.1),row(1,0,-.1)];expect(forecastMetrics(rows,[null,null])).toMatchObject({mae:.1,rmse:.1,coverage:0,independentSamples:null});
 expect(()=>forecastMetrics(rows,[0])).toThrow();expect(forecastMetrics([],[]).mae).toBeNull();
});
test('validation chooses no-trade on ties and rejects selective low coverage',()=>{
 const rows=Array.from({length:40},(_,i)=>row(i,0,.01));
 expect(selectLearningModel(rows,{zero:Array(40).fill(0),mean:Array(40).fill(.01),ridge:Array(40).fill(.01)}).selected).toBe('mean');
 const ridge:(number|null)[]=Array(40).fill(.01);ridge[0]=null;ridge[1]=null;ridge[2]=null;
 expect(selectLearningModel(rows,{zero:Array(40).fill(0),mean:Array(40).fill(0),ridge}).selected).toBe('zero');
 expect(selectLearningModel(rows.slice(0,1),{zero:[0],mean:[.01],ridge:[.01]}).selected).toBe('zero');
});
test('round-trip costs match actual cash arithmetic; fee-negative scenarios do not trade',()=>{
 const costs={feeRate:.01,spreadBps:20,slippageBps:30},f=diagnosticCostFactors(costs),r=row(0,0,0);
 expect(f.entry/f.exit-1).toBe(f.requiredGrossReturn);
 expect(fixedHorizonDiagnostic([r],[.01],costs)).toMatchObject({trades:0,returnPct:0});
 const d=fixedHorizonDiagnostic([r],[.10],costs);expect(d.trades).toBe(1);expect(d.returnPct).toBeCloseTo(.1*(f.exit/f.entry-1)*100);expect(d.feesPctStartingCapital).toBeGreaterThan(0);
});
test('diagnostic caps concurrent exposure, ignores input order, uses held-out realized price not its forecast',()=>{
 const rows=['ETH/EUR','BTC/EUR','SOL/EUR','ADA/EUR'].map(pair=>({...row(0,0,.1),pair})),pred=Array(4).fill(.2),costs={feeRate:0,spreadBps:0,slippageBps:0};
 const result=fixedHorizonDiagnostic(rows,pred,costs);expect(result.trades).toBe(3);expect(result.returnPct).toBeCloseTo(3);
 expect(fixedHorizonDiagnostic([...rows].reverse(),pred,costs)).toEqual(result);
 expect(()=>fixedHorizonDiagnostic([rows[0]!,rows[0]!],[.2,.2],costs)).toThrow();
});

test('retraining old labels today cannot reset the forecast data-freshness clock',()=>{
 const m=fitRidge([row(0,-1),row(1,1)],base+40*day,10,2);expect(m.trainedAt).toBe(base+40*day);expect(ridgeForecast(m,Array(8).fill(0),m.trainedAt)).toBeNull();
});
test('freshness is bounded by the latest available target as well as model age',()=>{
 const m=fitRidge([row(0,-1),row(1,1)],base+5*day,10,2),boundary=m.lastLabelEnd+10*day;expect(ridgeForecast(m,Array(8).fill(0),boundary)).toBe(0);expect(ridgeForecast(m,Array(8).fill(0),boundary+1)).toBeNull();
});
test('missing or future target clocks cannot be promoted into a valid local forecast',()=>{
 const m=fitRidge([row(0,-1),row(1,1)],base+5*day,10,2);for(const lastLabelEnd of [NaN,m.trainedAt,m.trainedAt+1])expect(ridgeForecast({...m,lastLabelEnd},Array(8).fill(0),m.trainedAt)).toBeNull();
});

test.each(['negative-scale','zero-scale','extra-weight','missing-mean','invalid-row-count','invalid-lambda','nonfinite-intercept'] as const)('structurally invalid research model %s must abstain',kind=>{
 const m=fitRidge([-2,-1,1,2].map((x,i)=>row(i,x,.01+.02*x)),base+5*day,1,2);
 if(kind==='negative-scale')m.stds[0]=-m.stds[0]!;if(kind==='zero-scale')m.stds[0]=0;if(kind==='extra-weight')m.weights.push(999);if(kind==='missing-mean')m.means.pop();if(kind==='invalid-row-count')m.rows=0;if(kind==='invalid-lambda')m.lambda=0;if(kind==='nonfinite-intercept')m.intercept=NaN;
 expect(ridgeForecast(m,[1,0,0,0,0,0,0,0],m.trainedAt)).toBeNull();
});
test('sparse and non-array forecast vectors cannot become an intercept-only prediction',()=>{
 const m=fitRidge([row(0,-1,.01),row(1,1,.03)],base+5*day,10,2);
 for(const x of [Array(8),null,{length:8},'00000000'])expect(ridgeForecast(m,x as number[],m.trainedAt)).toBeNull();
});
test('malformed deserialized models fail closed without exceptions',()=>{
 for(const m of [null,undefined,[],{}, {version:'local-ridge-v1'}])expect(ridgeForecast(m as Parameters<typeof ridgeForecast>[0],Array(8).fill(0),base+5*day)).toBeNull();
});
