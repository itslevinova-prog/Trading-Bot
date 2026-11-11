import {expect,test} from 'vitest';import {ema,rsi,atr} from '../src/market/indicators.js';
import type {Candle} from '@paper/shared';
test('EMA uses the SMA seed and exponential update',()=>{const result=ema([1,2,3,4,5],3);expect(result[2]).toBeCloseTo(2);expect(result[3]).toBeCloseTo(3);expect(result[4]).toBeCloseTo(4);});
test('RSI of constant prices is neutral and rising prices 100',()=>{expect(rsi(Array(30).fill(10))).toBe(50);expect(rsi(Array.from({length:30},(_,i)=>i+1))).toBe(100);});
test('ATR of constant true range remains constant',()=>{const candles:Candle[]=Array.from({length:25},(_,i)=>({pair:'BTC/EUR',interval:15,ts:i*900000,open:100,close:100,high:102,low:98,volume:1}));expect(atr(candles)).toBeCloseTo(4);});
