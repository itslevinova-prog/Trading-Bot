import {expect,test} from 'vitest';
import {assessDailyCompressionBreakout,DAILY_COMPRESSION_BREAKOUT_VARIANTS,
 type CompressionBreakoutInput} from '../src/strategy/daily-compression-breakout.js';
import type {Candle} from '../src/backtest/candle-source.js';
const DAY=86_400_000,AS_OF=Date.UTC(2022,6,1);
function completedBars():Candle[]{
 return Array.from({length:90},(_,i)=>{
  const ts=AS_OF-(90-i)*DAY;
  const close=i===89?110:i<60?100+2*Math.sin(i*1.3):
   100+.02*(i-60)+.001*Math.sin(i);
  return {ts,open:close-.05,high:close+.2,low:close-.2,close,volume:1000};
 });
}
const input=(extra:Partial<CompressionBreakoutInput>={}):CompressionBreakoutInput=>({
 symbol:'BTCUSDT',asOf:AS_OF,variant:'breakout-20',
 bars:completedBars(),coinQuality:'allowed',
 roundtripCostBps:40,expectedGrossMoveBps:80,...extra
});
test('exactly two pre-registered variants produce only causal NEXT-bar candidates',()=>{
 expect(Object.keys(DAILY_COMPRESSION_BREAKOUT_VARIANTS)).toEqual(['breakout-20','breakout-40']);
 for(const variant of ['breakout-20','breakout-40'] as const){
  const plan=assessDailyCompressionBreakout(input({variant}));
  expect(plan).toMatchObject({version:'H-027-v1',variant,
   status:'candidate',breakoutAbovePriorHigh:true,
   compressionBelowPastMedian:true,earliestNextOpenAt:AS_OF,executableOrder:false});
 }
});
test('adding a huge future intraday/daily bar cannot change prior signal',()=>{
 const fixture=input();
 const without=assessDailyCompressionBreakout(fixture);
 const future:Candle={ts:AS_OF,open:1,high:9000,low:1,close:8999,volume:100_000};
 expect(assessDailyCompressionBreakout(input({bars:[...fixture.bars,future]}))).toEqual(without);
 expect(assessDailyCompressionBreakout(input({bars:[future,...fixture.bars]}))).toEqual(without);
 expect(fixture.bars.length).toBe(90);
});
test('missing daily bar, incomplete last bar and stale evidence all fail closed',()=>{
 const bars=completedBars();
 expect(assessDailyCompressionBreakout(input({bars:bars.filter((_,i)=>i!==80)})).status)
  .toBe('blocked');
 expect(assessDailyCompressionBreakout(input({bars:bars.slice(0,-1)})).status)
  .toBe('blocked');
 expect(assessDailyCompressionBreakout(input({bars:bars.slice(-40)})).status)
  .toBe('blocked');
 const duplicate=[...bars.slice(0,70),bars[69]!,...bars.slice(70)];
 expect(assessDailyCompressionBreakout(input({bars:duplicate})).status)
  .toBe('blocked');
});
test('cost, point-in-time quality and registered-variant gates are strict',()=>{
 expect(assessDailyCompressionBreakout(input({expectedGrossMoveBps:79})).status).toBe('blocked');
 expect(assessDailyCompressionBreakout(input({roundtripCostBps:null})).status).toBe('blocked');
 expect(assessDailyCompressionBreakout(input({expectedGrossMoveBps:null})).status).toBe('blocked');
 expect(assessDailyCompressionBreakout(input({coinQuality:'unknown'})).status).toBe('blocked');
 expect(assessDailyCompressionBreakout(input({coinQuality:'hold-only'})).status).toBe('blocked');
 expect(()=>assessDailyCompressionBreakout(input({variant:'breakout-100' as 'breakout-20'})))
  .toThrow(/preregistered/);
});
test('no validation or holdout-window data may be used for new signals',()=>{
 expect(assessDailyCompressionBreakout(input({asOf:Date.UTC(2024,0,2)})).status)
  .toBe('blocked');
 expect(assessDailyCompressionBreakout(input({asOf:AS_OF+60_000})).status)
  .toBe('blocked');
});
