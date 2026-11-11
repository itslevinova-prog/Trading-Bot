import {describe,it,expect} from 'vitest';
import {advance,initialState,DAY,seriesId} from '../src/forward/engine.js';
const start=Date.UTC(2026,10,12);
const rows=()=>Object.fromEntries(['BTCUSDT','ETHUSDT','ALTUSDT'].map(symbol=>[symbol,Array.from({length:264},(_,i)=>{
 const price=50+i*.2+Math.sin(i)*.4;
 return {ts:start+(i-260)*DAY,open:price,high:price+1,low:price-1,close:price+.1,volume:1e6,quoteVolume:1e8};
})]));
describe('isolated research forward',()=>{
 it('executes only at next open with identical costs for every account',()=>{
  const data=rows(),s=advance(initialState(start,'a'),data,start+DAY,start+DAY);
  expect(s.fills.some(f=>f.account==='strategy')).toBe(true);
  for(const f of s.fills){expect(f.day).toBe(start);const mid=data[f.symbol]![260]!.open;expect(f.price).toBeCloseTo(mid*1.001);expect(f.fee).toBeCloseTo(f.qty*f.price*.001);}
 });
 it('is idempotent and catches up three missed days in order',()=>{
  const data=rows(),s=initialState(start,'a');
  const all=advance(s,data,start+3*DAY,start+3*DAY);
  let incremental=s;for(let n=1;n<=3;n++)incremental=advance(incremental,data,start+n*DAY,start+3*DAY);
  expect(incremental).toEqual(all);expect(advance(all,data,start+3*DAY,start+3*DAY)).toEqual(all);
 });
 it('never emits pre-start results and refuses incomplete days',()=>{
  const s=advance(initialState(start,'a'),rows(),start+DAY,start+DAY);
  expect(s.points.every(p=>p.day>=start)).toBe(true);expect(()=>advance(s,rows(),start+2*DAY,start+DAY)).toThrow();
 });
 it('records missing data without trades or invented equity',()=>{
  const data=rows();data.BTCUSDT=data.BTCUSDT!.filter(c=>c.ts!==start);
  const s=advance(initialState(start,'a'),data,start+DAY,start+DAY);
  expect(s.fills).toHaveLength(0);expect(s.points[0]!.strategy).toBeNull();
 });
 it('separates changed code and rejects changed frozen assumptions',()=>{
  expect(seriesId(initialState(start,'a'))).not.toBe(seriesId(initialState(start,'b')));
  const s=initialState(start,'a');s.configHash='changed';expect(()=>advance(s,rows(),start+DAY,start+DAY)).toThrow();
 });
});
