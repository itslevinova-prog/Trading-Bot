import {expect,test} from 'vitest';
import {compressHourlyTrends,expandPackedHourlyTrends,readPackedHourlyTrend} from '../src/ai/hourly-encoding.js';
const unknown={version:'closed-hourly-ema-direction-v1',complete:false,direction:'unknown',slopePct:null,reason:'closed-feature-clock-unavailable'};
const frame=(records:unknown[])=>({transmission:{} as Record<string,unknown>,marketContext:{markets:records.map((hourlyTrend,i)=>({pair:`P${i}/EUR`,regime:{hourlyTrend}}))}});
test('lossless dictionary retains exact optional presence, unknowns and future fields',()=>{
 const known={...unknown,complete:true,direction:'rising',reason:null,slopePct:.5,closedAt:123,currentEma50:101,previousEma50:100,future:{flag:false,nullable:null}};
 const full=frame([...Array.from({length:12},()=>({...unknown})),known,{...known,extra:null}]),before=JSON.stringify(full.marketContext);
 expect(compressHourlyTrends(full)).toBe(true);expect(JSON.stringify(full.marketContext).length).toBeLessThan(before.length);
 const meta=full.transmission.hourlyTrendTableEncoding as {records:unknown[]};expect(meta.records).toHaveLength(3);
 expandPackedHourlyTrends(full);expect(JSON.stringify(full.marketContext)).toBe(before);
 full.marketContext.markets[0]!.regime.hourlyTrend={...unknown,reason:'changed'};
 expect(full.marketContext.markets[1]!.regime.hourlyTrend).toEqual(unknown);
});
test('small unique tables remain untouched rather than increasing the budget',()=>{const f=frame([unknown]);const original=JSON.stringify(f);expect(compressHourlyTrends(f)).toBe(false);expect(JSON.stringify(f)).toBe(original);});
test.each([-1,1.2,99,NaN])('invalid dictionary index %s fails closed',index=>{const f=frame(Array(12).fill(unknown));compressHourlyTrends(f);expect(()=>readPackedHourlyTrend({hourlyTrendRef:index},f)).toThrow('Invalid packed hourly trend');});
test('unlabelled, recursive, extra-key and wrong-format references are rejected',()=>{
 expect(()=>readPackedHourlyTrend({hourlyTrendRef:0},{})).toThrow();const f=frame(Array(12).fill(unknown));compressHourlyTrends(f);
 expect(()=>readPackedHourlyTrend({hourlyTrendRef:0,extra:1},f)).toThrow();
 const meta=f.transmission.hourlyTrendTableEncoding as {format:string;records:unknown[]};meta.format='wrong';expect(()=>readPackedHourlyTrend({hourlyTrendRef:0},f)).toThrow();meta.format='hourly-trend-dictionary-v1';meta.records[0]={hourlyTrendRef:0};expect(()=>readPackedHourlyTrend({hourlyTrendRef:0},f)).toThrow();
});
test('compression requires expansion first; arbitrary non-reference values remain unchanged',()=>{const f=frame(Array(12).fill(unknown));compressHourlyTrends(f);expect(()=>compressHourlyTrends(f)).toThrow('Expand');expect(readPackedHourlyTrend(null,f)).toBeNull();expect(readPackedHourlyTrend(unknown,f)).toBe(unknown);});

test('unique hourly records use lossless labelled columns and reject malformed column metadata',()=>{
 const f=frame(Array.from({length:20},(_,i)=>({...unknown,complete:true,direction:'rising',reason:null,slopePct:i+.1,closedAt:123+i,currentEma50:101+i,previousEma50:100+i,future:{flag:false,unknown:null}}))),before=structuredClone(f.marketContext);
 expect(compressHourlyTrends(f)).toBe(true);expect((f.transmission.hourlyTrendTableEncoding as {format:string}).format).toBe('market-hourly-columns-v1');
 expect(()=>compressHourlyTrends(f)).toThrow('Expand');expect(()=>readPackedHourlyTrend({hourlyFieldSet:0,values:[]},{})).toThrow('Invalid packed hourly columns');
 expect(()=>readPackedHourlyTrend({hourlyFieldSet:-1,values:[]},f)).toThrow();expect(()=>readPackedHourlyTrend({hourlyFieldSet:0,values:[],extra:1},f)).toThrow();
 expandPackedHourlyTrends(f);expect(f.marketContext).toEqual(before);
});
