import {test,expect} from 'vitest';
import type {Candle} from '@paper/shared';
import {closedMarketStructure} from '../src/context/market-structure.js';
const now=Date.UTC(2026,9,31,10,30),step=900000,pair='ETH/EUR';
const make=(prices:number[]):Candle[]=>prices.map((close,i)=>({pair,interval:15,ts:now-(prices.length-i)*step,open:close,high:close+.1,low:close-.1,close,volume:10}));
const trend=()=>make(Array.from({length:21},(_,i)=>100+i));
test('monotonic and oscillating paths have analytically known efficiencies',()=>{
 expect(closedMarketStructure(trend(),pair,now)).toMatchObject({complete:true,directionalEfficiency:1,upsideBreakout:true});
 expect(closedMarketStructure(make(Array.from({length:21},(_,i)=>100+i%2)),pair,now).directionalEfficiency).toBe(0);
 expect(closedMarketStructure(make(Array(21).fill(100)),pair,now).directionalEfficiency).toBe(0);
});
test('signal high never defines its own preceding resistance; a wick through range is a rejection',()=>{
 const rows=trend();rows[20]={...rows[20]!,open:119,close:119,high:130,low:118.5};
 expect(closedMarketStructure(rows,pair,now)).toMatchObject({priorResistance:119.1,upsideBreakout:false,upsideRejection:true,twoSidedSweep:false});
});
test('closed break below preceding support and a two-sided sweep remain distinct',()=>{
 const rows=trend();rows[20]={...rows[20]!,open:100,close:99,high:130,low:98};
 expect(closedMarketStructure(rows,pair,now)).toMatchObject({downsideBreakout:true,twoSidedSweep:true,upsideRejection:true,downsideRejection:false});
});
test.each(['gap','missing-signal','duplicate','offgrid','invalid-price','invalid-volume'] as const)('%s is unknown rather than replaced by older evidence',kind=>{
 let rows=trend();if(kind==='gap')rows.splice(10,1);if(kind==='missing-signal')rows.pop();if(kind==='duplicate')rows.push({...rows[10]!});if(kind==='offgrid')rows[10]!.ts++;
 if(kind==='invalid-price')rows[10]!.low=-1;if(kind==='invalid-volume')rows[10]!.volume=NaN;
 expect(closedMarketStructure(rows,pair,now)).toMatchObject({complete:false,directionalEfficiency:null,upsideRejection:null});
});
test('future/current candles, unrelated symbols and arbitrarily old history cannot alter the observed window',()=>{
 const rows=trend(),expected=closedMarketStructure(rows,pair,now),extra={...rows[0]!,high:1e15};
 expect(closedMarketStructure([...rows,{...extra,ts:now},{...extra,ts:now+step},{...extra,ts:now-50*step},{...extra,pair:'BTC/EUR'}],pair,now)).toEqual(expected);
});
test('scaling preserves efficiency for tiny and huge valid prices without numeric overflow',()=>{
 const prices=Array.from({length:21},(_,i)=>1+i/100);
 const ordinary=closedMarketStructure(make(prices),pair,now).directionalEfficiency;
 for(const scale of [1e-250,1e300]){const rows=make(prices).map(c=>({...c,open:c.open*scale,high:c.high*scale,low:c.low*scale,close:c.close*scale}));expect(closedMarketStructure(rows,pair,now).directionalEfficiency).toBeCloseTo(ordinary!);}
});
test('invalid observation clock is refused',()=>{expect(()=>closedMarketStructure(trend(),pair,NaN)).toThrow();});

test('equal endpoint and direction can come from a single jump or a distributed move', async()=>{
 const {closedMoveConcentration}=await import('../src/context/move-concentration.js');
 const end=Date.UTC(2026,0,2),step=900000,pair='BTC/EUR';
 const bars=(jump:boolean)=>Array.from({length:17},(_,i)=>{
  const close=100*Math.exp(jump?(i===16?.16:0):i*.01);
  return {pair,interval:15,ts:end-(17-i)*step,open:close,high:close,low:close,close,volume:1};
 });
 const smooth=closedMoveConcentration(bars(false),pair,end);
 const jump=closedMoveConcentration(bars(true),pair,end);
 expect(smooth).toMatchObject({complete:true,upMoves:16,downMoves:0});
 expect(smooth.largestMoveShare).toBeCloseTo(1/16,12);
 expect(jump).toMatchObject({complete:true,largestMoveShare:1,upMoves:1,downMoves:0});
 expect(closedMoveConcentration([...bars(true),bars(true)[0]!],pair,end).complete).toBe(false);
 expect(closedMoveConcentration(bars(true).slice(0,-1),pair,end).largestMoveShare).toBeNull();
 const future={...bars(true)[0]!,ts:end,close:1e100};
 expect(closedMoveConcentration([...bars(true),future],pair,end)).toEqual(jump);
});
