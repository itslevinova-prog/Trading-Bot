import {describe,it,expect} from 'vitest';
import {advance,initialState,seriesId,DAY} from '../src/forward/engine-v2.js';
import {initialState as initialV1,seriesId as seriesV1} from '../src/forward/engine.js';
import {floorLot,exchangeLots,type LotRules} from '../src/forward/lots.js';
const start=Date.UTC(2026,10,12);
const rules:LotRules=Object.fromEntries(['BTCUSDT','ETHUSDT'].map(s=>[s,{stepSize:'0.00500000',minQty:'0.01000000',minNotional:'5.00000000'}]));
const candles=()=>Object.fromEntries(['BTCUSDT','ETHUSDT'].map(symbol=>[symbol,Array.from({length:263},(_,i)=>{
 const price=50000+i*200+Math.sin(i)*400;
 return {ts:start+(i-260)*DAY,open:price,high:price+1000,low:price-1000,close:price+100,volume:1e6,quoteVolume:1e8};
})]));
describe('H-025 exchange-lot variant',()=>{
 it('rounds exact multiples of arbitrary decimal steps down',()=>{
  expect(floorLot(.019999999,{...rules.BTCUSDT!,stepSize:'0.005'})).toBe(.015);
  expect(floorLot(.3,{...rules.BTCUSDT!,stepSize:'0.1'})).toBe(.3);
  expect(floorLot(1e-7,{...rules.BTCUSDT!,stepSize:'0.00000003'})).toBe(9e-8);
 });
 it('extracts LOT_SIZE and both notional filter formats',()=>{
  const symbols=['BTCUSDT','ETHUSDT'].map((symbol,i)=>({symbol,quoteAsset:'USDT',status:'TRADING',isSpotTradingAllowed:true,
   filters:[{filterType:'LOT_SIZE',stepSize:'0.00500000',minQty:'0.01000000'},{filterType:i?'NOTIONAL':'MIN_NOTIONAL',minNotional:'5.00000000'}]}));
  expect(exchangeLots({symbols})).toEqual(rules);
  symbols[0]!.filters.pop();expect(()=>exchangeLots({symbols})).toThrow('Missing exchange');
 });
 it('fills fractional BTC for strategy and benchmarks and respects cash',()=>{
  const s=advance(initialState(start,'code',rules),candles(),start+DAY,start+DAY);
  expect(s.fills.some(f=>f.account==='strategy')).toBe(true);
  for(const account of ['strategy','hold','dca'] as const){
   expect(s.fills.some(f=>f.account===account)).toBe(true);
   expect(s.accounts[account].cash).toBeGreaterThanOrEqual(0);
  }
  for(const f of s.fills){expect(f.qty).toBeLessThan(1);expect(f.qty).toBeGreaterThanOrEqual(.01);expect(floorLot(f.qty,rules[f.symbol]!)).toBe(f.qty);expect(f.qty*f.price).toBeGreaterThanOrEqual(5);}
 });
 it('rejects fills below actual minimum quantity or notional',()=>{
  for(const key of ['minQty','minNotional'] as const){
   const blocked=Object.fromEntries(Object.entries(rules).map(([s,r])=>[s,{...r,[key]:'1000000'}]));
   expect(advance(initialState(start,'code',blocked),candles(),start+DAY,start+DAY).fills).toHaveLength(0);
  }
 });
 it('freezes a canonical snapshot and separates changed rules and v1',()=>{
  const s=initialState(start,'code',rules);
  expect(seriesId(s)).not.toBe(seriesV1(initialV1(start,'code')));
  const changed=structuredClone(rules);changed.BTCUSDT!.stepSize='0.01000000';
  expect(seriesId(s)).not.toBe(seriesId(initialState(start,'code',changed)));
  const reordered=Object.fromEntries(Object.entries(rules).reverse());
  expect(seriesId(s)).toBe(seriesId(initialState(start,'code',reordered)));
  s.lotRules.BTCUSDT!.minQty='1';expect(()=>advance(s,candles(),start+DAY,start+DAY)).toThrow('Changed config');
 });
 it('remains idempotent when catching up multiple days',()=>{
  const data=candles(),s=initialState(start,'code',rules),all=advance(s,data,start+3*DAY,start+3*DAY);
  const first=advance(s,data,start+DAY,start+3*DAY);
  expect(advance(first,data,start+3*DAY,start+3*DAY)).toEqual(all);
  expect(advance(all,data,start+3*DAY,start+3*DAY)).toEqual(all);
 });
});
