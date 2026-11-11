import {test,expect} from 'vitest';import {validateRisk,drawdown,positionStopRisk,entryDrawdownGuard} from '../src/broker/risk.js';
const limits={maxPositionPct:.3,maxOpenPositions:4,maxTradesPerDay:10,cooldownMinutes:60};
const order={accountId:'rules',pair:'BTC/EUR',side:'buy' as const,amountEur:50,reason:'test',decisionId:'t'};
const state={equity:100,cash:100,status:'active',positions:[],tradesToday:0,now:1000000};
test('caps position at 30%',()=>{const v=validateRisk(order,state,limits);expect(v.allowed).toBe(true);expect(v.amountEur).toBe(30);});
test('rejects open positions limit',()=>{const v=validateRisk(order,{...state,positions:['A','B','C','D'].map(pair=>({pair,value:5}))},limits);expect(v.allowed).toBe(false);});
test('blocks cooldown, paused account and daily quota',()=>{expect(validateRisk(order,{...state,lastSellAt:999999},limits).allowed).toBe(false);expect(validateRisk(order,{...state,status:'paused'},limits).allowed).toBe(false);expect(validateRisk(order,{...state,tradesToday:10},limits).allowed).toBe(false);});
test('kill switch drawdown threshold',()=>{expect(drawdown(75,100)).toBe(.25);});
test('shared stop risk budget reduces an otherwise affordable position',()=>{const result=validateRisk({...order,amountEur:25,stopLossPct:.05},{...state,positions:[{pair:'ETH/EUR',value:20,stopRisk:2}]},{...limits,maxPortfolioRiskPct:.025,feeRate:.005});expect(result.allowed).toBe(true);expect(result.amountEur).toBeCloseTo(.5/.06);});
test('exhausted and unknown portfolio stop risk block new entries',()=>{for(const position of [{pair:'ETH/EUR',value:20,stopRisk:3},{pair:'ETH/EUR',value:20}])expect(validateRisk(order,{...state,positions:[position]},{...limits,maxPortfolioRiskPct:.025,feeRate:.001}).allowed).toBe(false);});
test('invalid stop estimates cannot bypass portfolio risk',()=>{expect(validateRisk({...order,stopLossPct:NaN},state,{...limits,maxPortfolioRiskPct:.025}).allowed).toBe(false);});

test('breached, absent or too-small stops consume the position value',()=>{expect(positionStopRisk(1,100,105,.001,10)).toBeCloseTo(100.1);expect(positionStopRisk(1,100,null,.001,10)).toBeCloseTo(100.1);expect(positionStopRisk(.05,100,95,.001,10)).toBeCloseTo(5.005);expect(positionStopRisk(1,100,95,.001,10)).toBeCloseTo(5.1);});

test.each([
 ['negative-trade-count',{tradesToday:-1}],['fractional-trade-count',{tradesToday:.5}],
 ['unsafe-trade-count',{tradesToday:Number.MAX_SAFE_INTEGER+1}],['negative-clock',{now:-1}],
 ['fractional-clock',{now:1000000.5}],['NaN-last-sell',{lastSellAt:NaN}],['infinite-last-sell',{lastSellAt:Infinity}],
 ['negative-last-sell',{lastSellAt:-1}],['duplicate-held-pair',{positions:[{pair:'BTC/EUR',value:10},{pair:'BTC/EUR',value:10}]}],
] as const)('rejects malformed buy state %s instead of granting budget',(_name,patch)=>{
 expect(validateRisk(order,{...state,...patch} as any,limits).allowed).toBe(false);
});
test.each([
 ['oversized-position',{maxPositionPct:1.1}],['negative-cooldown',{cooldownMinutes:-1}],
 ['fractional-position-count',{maxOpenPositions:1.5}],['fractional-trade-limit',{maxTradesPerDay:1.5}],
 ['oversized-stop-budget',{maxPortfolioRiskPct:1.1}],['negative-fee',{feeRate:-.1}],['infinite-fee',{feeRate:Infinity}],
 ['fee-one',{feeRate:1}],
] as const)('rejects malformed buy limit %s',(_name,patch)=>{
 expect(validateRisk(order,state,{...limits,...patch}).allowed).toBe(false);
});
test('invalid entry state/limits still cannot block an authorized protective sell',()=>{
 expect(validateRisk({...order,side:'sell'},{...state,tradesToday:-1,lastSellAt:NaN},{...limits,cooldownMinutes:-1}).allowed).toBe(true);
});
test('zero daily-entry limit explicitly disables buys while zero cooldown is valid',()=>{
 expect(validateRisk(order,state,{...limits,maxTradesPerDay:0}).allowed).toBe(false);
 expect(validateRisk(order,{...state,lastSellAt:state.now},{...limits,cooldownMinutes:0}).allowed).toBe(true);
});


test('persisted drawdown boundary is exact and does not guess invalid valuations',()=>{
 expect(entryDrawdownGuard(88,100,.12)).toContain('Drawdown');
 expect(entryDrawdownGuard(88.0001,100,.12)).toBeNull();
 expect(entryDrawdownGuard(110,100,.12)).toBeNull();
 expect(entryDrawdownGuard(100,100,0)).toContain('Drawdown');
 for(const args of [[NaN,100,.12],[100,Infinity,.12],[100,0,.12],[100,100,-1],[100,100,1.1],[100,100,NaN],[-1,100,.12]])expect(entryDrawdownGuard(...args as [number,number,number])).not.toBeNull();
});
