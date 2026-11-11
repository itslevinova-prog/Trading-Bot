// No dependencies: node --experimental-strip-types --test apps/server/test/*-offline.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
// Mirror TypeScript's .js -> .ts source-module resolution without installing packages.
registerHooks({resolve(specifier,context,nextResolve){
 if(specifier.startsWith('.')&&specifier.endsWith('.js')&&context.parentURL?.includes('/apps/server/src/'))
  return nextResolve(specifier.slice(0,-3)+'.ts',context);
 return nextResolve(specifier,context);
}});
const [{runResearch},{analyzeRobustness,wilsonLowerBound,bootstrapReturns},{assessSignalQuality,safePositionBudget}]=await Promise.all([import('../src/research/backtest.ts'),import('../src/research/robustness.ts'),import('../src/strategy/quality.ts')]);
const opts={strategy:'quality',startingBalance:100,feeRate:.008,slippagePct:.0008};
const bars=Array.from({length:2400},(_,i)=>{const open=100+Math.sin((i-1)/16)*4+(i-1)*.02,close=100+Math.sin(i/16)*4+i*.02;return {ts:1700000100000+i*900000,open,close,high:Math.max(open,close)+1.3,low:Math.min(open,close)-1.3,volume:100+(i%20)*7};});
const feature={pair:'BTC/EUR',ts:1700000100000,ema20:101,ema50:100,prevEma20:99,prevEma50:100,ema50_60m:95,rsi14:58,atr14:2,atrPct:2,volumeRatio:1.6,change1h:1,change4h:2,change24h:3,spreadPct:.1,distanceEma50Pct:2,price:102};
test('Wilson bound acknowledges uncertainty and never treats 1 winner as certainty',()=>{assert.equal(wilsonLowerBound(0,0),null);assert.ok(wilsonLowerBound(1,1)<.3);assert.ok(wilsonLowerBound(30,40)>wilsonLowerBound(3,4));});
test('Quality scoring rejects unacceptable fees and volatility',()=>{assert.equal(assessSignalQuality(feature,.008).passed,true);assert.equal(assessSignalQuality({...feature,atrPct:9},.008).passed,false);assert.equal(assessSignalQuality({...feature,spreadPct:2},.008).passed,false);assert.equal(assessSignalQuality({...feature,change4h:-4},.008).passed,false);});
test('Risk sizing caps at fixed fractional exposure and rejects invalid values',()=>{assert.equal(safePositionBudget(100,.05),15);assert.equal(safePositionBudget(100,.001),25);assert.equal(safePositionBudget(100,0),0);});
test('Fixed folds never overlap; later changes cannot alter earlier fold',()=>{const before=analyzeRobustness(bars,opts);assert.equal(before.folds.length,3);assert.ok(before.folds[0].to<before.folds[1].from);assert.ok(before.folds[1].to<before.folds[2].from);const edited=bars.map((x,i)=>i>2000?{...x,high:x.high*2,low:x.low/2,close:x.close*1.1}:x);const after=analyzeRobustness(edited,opts);assert.deepEqual(before.folds[0],after.folds[0]);});
test('Missing candles reported accurately; verdict never treats gaps as robust',()=>{const withGap=bars.filter((_,i)=>i<1900||i>=2000);const report=analyzeRobustness(withGap,opts);assert.ok(report.missingBars>=99);assert.ok(report.gapFractionPct>1);assert.equal(report.verdict,'too_little_data');});
test('No trades means no win rate and cannot receive historically robust label',()=>{const steady=bars.map((b)=>({...b,open:100,high:100.01,low:99.99,close:100,volume:50}));const report=analyzeRobustness(steady,opts);assert.equal(report.evaluatedTrades,0);assert.equal(report.historicalWinRatePct,null);assert.equal(report.winRateLower95Pct,null);assert.notEqual(report.verdict,'historically_resilient');});
test('Bootstrap is repeatable and requires samples',()=>{assert.equal(bootstrapReturns([]),null);const data=Array.from({length:40},(_,i)=>({pnlPct:i%2?2:-3}));assert.deepEqual(bootstrapReturns(data),bootstrapReturns(data));});
test('Quality strategy never produces negative account value in this test data',()=>{const r=runResearch('BTC/EUR',bars,opts);assert.ok(r.outOfSample.curve.every(x=>x.equity>=0));assert.ok(r.outOfSample.trades.every(t=>Number.isFinite(t.pnlEur)));});

test('Live rule-provider uses the new quality gate and risk-based budget',async()=>{
 const {RuleBasedProvider}=await import('../src/strategy/providers.ts');
 const context={features:[feature],account:{equity:100},positions:[],timeUTC:'',timeZurich:'',recentTrades:[],limits:{TAKER_FEE_RATE:.008,MIN_ORDER_EUR:10},memory:[],lessons:[]};
 const decision=await new RuleBasedProvider().decide(context);
 assert.equal(decision.actions[0].type,'buy');assert.equal(decision.actions[0].amountEur,15);
 assert.match(decision.actions[0].reasoning,/Qualitätsfilter 6\/6/);
 const blocked=await new RuleBasedProvider().decide({...context,features:[{...feature,change4h:-5}]});
 assert.equal(blocked.actions[0].type,'hold');
 const small=await new RuleBasedProvider().decide({...context,limits:{TAKER_FEE_RATE:.008,MIN_ORDER_EUR:25}});
 assert.equal(small.actions[0].type,'hold');
});
