import {test,expect,vi} from 'vitest';
import {ClosedCandleBuffer} from '../src/market/closed-candle-buffer.js';
const end=Date.UTC(2026,9,31,11),row=[end-900000,'100','102','99','101','10',end-1];
test('one-second-ahead final message stays invisible until local close, then commits once',async()=>{
 vi.useFakeTimers();vi.setSystemTime(end-1000);const commit=vi.fn(),b=new ClosedCandleBuffer(commit,vi.fn());
 try{expect(b.accept('BTC/EUR',15,row)).toBe(true);expect(commit).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(999);expect(commit).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(2);expect(commit).toHaveBeenCalledTimes(1);expect(commit.mock.calls[0]![0]).toMatchObject({pair:'BTC/EUR',interval:15,ts:end-900000,close:101});await vi.advanceTimersByTimeAsync(10000);expect(commit).toHaveBeenCalledTimes(1);}finally{b.stop();vi.useRealTimers();}
});
test('already closed data commits immediately; remote future and invalid candles never queue',()=>{
 vi.useFakeTimers();vi.setSystemTime(end);const commit=vi.fn(),b=new ClosedCandleBuffer(commit,vi.fn());
 try{expect(b.accept('BTC/EUR',15,row)).toBe(true);expect(commit).toHaveBeenCalledTimes(1);expect(b.accept('BTC/EUR',15,[end,...row.slice(1)])).toBe(false);expect(b.accept('BTC/EUR',5,row)).toBe(false);expect(b.accept('BTC/EUR',15,[row[0],'100','90','99','101','10',end-1])).toBe(false);expect(commit).toHaveBeenCalledTimes(1);}finally{b.stop();vi.useRealTimers();}
});
test('duplicate pending final messages replace one slot and retain latest valid OHLC',async()=>{
 vi.useFakeTimers();vi.setSystemTime(end-500);const commit=vi.fn(),b=new ClosedCandleBuffer(commit,vi.fn());
 try{b.accept('BTC/EUR',15,row);b.accept('BTC/EUR',15,[...row.slice(0,4),'101.5',...row.slice(5)]);await vi.advanceTimersByTimeAsync(501);expect(commit).toHaveBeenCalledTimes(1);expect(commit.mock.calls[0]![0].close).toBe(101.5);}finally{b.stop();vi.useRealTimers();}
});
test('shutdown discards delayed work and refuses later messages',async()=>{
 vi.useFakeTimers();vi.setSystemTime(end-500);const commit=vi.fn(),b=new ClosedCandleBuffer(commit,vi.fn());
 try{b.accept('BTC/EUR',15,row);b.stop();await vi.advanceTimersByTimeAsync(1000);expect(commit).not.toHaveBeenCalled();expect(b.accept('BTC/EUR',15,row)).toBe(false);}finally{b.stop();vi.useRealTimers();}
});
test('a backward local clock step never releases a candle early',async()=>{
 vi.useFakeTimers();vi.setSystemTime(end-500);const commit=vi.fn(),b=new ClosedCandleBuffer(commit,vi.fn());
 try{b.accept('BTC/EUR',15,row);vi.setSystemTime(end-2000);await vi.advanceTimersByTimeAsync(501);expect(commit).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1501);expect(commit).toHaveBeenCalledTimes(1);}finally{b.stop();vi.useRealTimers();}
});


test('asynchronous storage failure is reported without an unhandled timer exception',async()=>{
 vi.useFakeTimers();vi.setSystemTime(end-500);const error=new Error('simulated storage failure'),report=vi.fn(),b=new ClosedCandleBuffer(()=>{throw error;},report);
 try{b.accept('BTC/EUR',15,row);await vi.advanceTimersByTimeAsync(501);expect(report).toHaveBeenCalledExactlyOnceWith(error);}finally{b.stop();vi.useRealTimers();}
});
