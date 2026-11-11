import {test,expect} from 'vitest';
import type {Candle} from '@paper/shared';
import {closedRangeRegime} from '../src/context/range-regime.js';
import {rangeReversionSetup,type RangeEntryCosts} from '../src/strategy/range-entry.js';
const now=Date.UTC(2026,9,31,18,30),step=900000,pair='ETH/EUR';
const make=(prices:number[]):Candle[]=>prices.map((close,i)=>({pair,interval:15,ts:now-(prices.length-i)*step,open:close,high:close+.2,low:close-.2,close,volume:100}));
const range=()=>{const rows=make([99,100,102,105,108,105,102,100,99,100,102,105,108,105,102,100,99,99.5,99.8,99.2,99.8]);rows[20]={...rows[20]!,open:99.4,low:98,high:100};return rows;};
const costs=():RangeEntryCosts=>({bid:99.79,ask:99.8,bookTs:now,feeRate:.001,slippageBps:5,maxSpreadBps:20,maxStopLossPct:.05});
test('two prior oscillations plus a closed lower-boundary reclaim nominate only a research family',()=>{
 const r=closedRangeRegime(range(),pair,now);
 expect(r).toMatchObject({complete:true,regime:'repeated-range',strategyFamily:'range-reversion-research',boundaryTransitions:4,priorSupport:98.8,priorResistance:108.2,signalClose:99.8});
 expect(r.priorEfficiency).toBeLessThan(.2);expect(r.sourceHash).toMatch(/^[a-f0-9]{64}$/);
});
test('a single V-shaped reversal has low net efficiency but is not an established repeated range',()=>{
 const r=closedRangeRegime(make([100,101,102,103,104,105,106,107,108,109,108,107,106,105,104,103,102,101,100,100,100]),pair,now);
 expect(r.priorEfficiency).toBe(0);expect(r.regime).toBe('unconfirmed-or-flat');expect(r.strategyFamily).toBe('no-trade');expect(r.boundaryTransitions).toBe(2);
});
test('adjacent boundary candles and center noise never manufacture alternating visits',()=>{
 const r=closedRangeRegime(make([99,99,99,99,102,102.1,102,102.1,102,105,108,108,108,108,108,108,108,108,108,108,108]),pair,now);
 expect(r.boundaryTransitions).toBe(1);expect(r.regime).not.toBe('repeated-range');
});
test('flat closes with wide wicks are not close-confirmed range traversals',()=>{
 const rows=make(Array(21).fill(100)).map(c=>({...c,low:90,high:110}));
 expect(closedRangeRegime(rows,pair,now)).toMatchObject({regime:'unconfirmed-or-flat',boundaryTransitions:0,strategyFamily:'no-trade'});
});
test('a downward path never becomes a long reversion setup merely because price is low',()=>{
 const r=closedRangeRegime(make(Array.from({length:21},(_,i)=>120-i)),pair,now);
 expect(r.regime).toBe('directional-down');expect(r.strategyFamily).toBe('no-trade');
});
test.each(['breakout','breakdown','both-sides','no-reclaim'] as const)('signal %s is distinguished without moving preceding boundaries',kind=>{
 const rows=range();if(kind==='breakout')rows[20]={...rows[20]!,open:108,close:109,high:110,low:107};
 if(kind==='breakdown')rows[20]={...rows[20]!,open:99,close:98,high:99,low:97};
 if(kind==='both-sides')rows[20]!.high=110;
 if(kind==='no-reclaim')rows[20]!.low=99;
 const r=closedRangeRegime(rows,pair,now);expect(r.priorSupport).toBe(98.8);expect(r.priorResistance).toBe(108.2);expect(r.regime).toBe('repeated-range');
 expect(r.strategyFamily).toBe(kind==='breakout'?'breakout-research':'no-trade');
});
test.each(['missing','duplicate','offgrid','invalid-low','invalid-volume'] as const)('incomplete %s observations remain unknown',kind=>{
 const rows=range();if(kind==='missing')rows.splice(3,1);if(kind==='duplicate')rows.push({...rows[3]!});if(kind==='offgrid')rows[3]!.ts++;if(kind==='invalid-low')rows[3]!.low=-1;if(kind==='invalid-volume')rows[3]!.volume=NaN;
 expect(closedRangeRegime(rows,pair,now)).toMatchObject({complete:false,regime:'unknown',strategyFamily:'no-trade',sourceHash:null});
 expect(rangeReversionSetup(rows,pair,now,costs()).eligibleSetup).toBe(false);
});
test('future candles, another symbol and old history do not alter causal evidence',()=>{
 const rows=range(),expected=closedRangeRegime(rows,pair,now),c={...rows[0]!,close:1e6,high:1e7};
 expect(closedRangeRegime([...rows,{...c,ts:now},{...c,ts:now+step},{...c,ts:now-50*step},{...c,pair:'BTC/EUR'}],pair,now)).toEqual(expected);
 expect(closedRangeRegime([...rows].reverse(),pair,now)).toEqual(expected);
 expect(closedRangeRegime(rows.map(c=>({...c,pair:'BTC/EUR'})),'BTC/EUR',now).sourceHash).not.toBe(expected.sourceHash);
});
test('positive conditional setup stops below old support and targets observed resistance, without estimating edge',()=>{
 const r=rangeReversionSetup(range(),pair,now,costs());expect(r.eligibleSetup).toBe(true);
 expect(r.payoff!.stopPrice).toBeLessThanOrEqual(r.regime.priorSupport!-r.regime.priorAtr!+1e-10);expect(r.payoff!.targetPrice).toBeCloseTo(108.2);
 expect(r.payoff!.netRewardRisk).toBeGreaterThanOrEqual(1.5);expect(r.estimatedWinProbability).toBeNull();expect(r.expectedValue).toBeNull();expect(r.performanceValidated).toBe(false);expect(r.requiresFullPaperBrokerValidation).toBe(true);expect(r).not.toHaveProperty('action');expect(r).not.toHaveProperty('amount');
});
test('selected tight stop rejects a setup rather than clipping the structural/volatility risk',()=>{
 const r=rangeReversionSetup(range(),pair,now,{...costs(),maxStopLossPct:.02});expect(r.eligibleSetup).toBe(false);expect(r.reasons).toContain('structural-or-volatility-stop-exceeds-selected-limit');expect(r.payoff).toBeNull();
});
test('fees and spread can consume an otherwise valid range scenario',()=>{
 const expensive=rangeReversionSetup(range(),pair,now,{...costs(),feeRate:.02,maxStopLossPct:.15});expect(expensive.eligibleSetup).toBe(false);expect(expensive.reasons).toContain('range-reward-insufficient-after-costs');
 const spread=rangeReversionSetup(range(),pair,now,{...costs(),bid:99});expect(spread.eligibleSetup).toBe(false);expect(spread.reasons).toContain('spread-over-hard-limit');
});
test.each(['stale','future','nan','invalid-fee','invalid-stop','crossed'] as const)('%s book/cost evidence cannot qualify',kind=>{
 const c=costs();if(kind==='stale')c.bookTs-=5001;if(kind==='future')c.bookTs++;if(kind==='nan')c.slippageBps=NaN;if(kind==='invalid-fee')c.feeRate=-.001;if(kind==='invalid-stop')c.maxStopLossPct=.5;if(kind==='crossed')c.bid=c.ask+.1;
 expect(rangeReversionSetup(range(),pair,now,c)).toMatchObject({eligibleSetup:false,reasons:['unknown-invalid-or-stale-cost-and-book-inputs']});
});
test('a dislocated price is rejected even while the closed setup remains intact',()=>{
 const r=rangeReversionSetup(range(),pair,now,{...costs(),bid:110,ask:110.01});expect(r.eligibleSetup).toBe(false);expect(r.reasons).toContain('price-dislocated-from-closed-setup');
});
test('zero volatility stays unknown, and invalid observation clocks throw',()=>{
 const rows=make(Array(21).fill(100)).map(c=>({...c,low:100,high:100}));expect(closedRangeRegime(rows,pair,now)).toMatchObject({priorAtr:null,strategyFamily:'no-trade'});
 expect(()=>closedRangeRegime(range(),pair,NaN)).toThrow();
});

test.each(['maxSpreadBps','maxStopLossPct','feeRate'] as const)('missing %s is rejected explicitly, not treated as an unlimited budget',key=>{
 const c=costs();delete (c as Partial<RangeEntryCosts>)[key];expect(rangeReversionSetup(range(),pair,now,c)).toMatchObject({eligibleSetup:false,reasons:['unknown-invalid-or-stale-cost-and-book-inputs']});
});
test('the current signal changes its own hash and setup but cannot alter the prior regime or volatility',()=>{
 const a=range(),first=closedRangeRegime(a,pair,now);a[20]={...a[20]!,open:105,close:106,high:107,low:104};const second=closedRangeRegime(a,pair,now);
 for(const key of ['priorSupport','priorResistance','priorEfficiency','priorAtr','boundaryTransitions','regime'] as const)expect(second[key]).toBe(first[key]);expect(second.sourceHash).not.toBe(first.sourceHash);expect(second.strategyFamily).toBe('no-trade');
});
