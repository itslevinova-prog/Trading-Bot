import {test,expect} from 'vitest';
import {replayRiskSnapshot} from '../src/risk-engine/replay.js';
import {PortfolioRiskEngine} from '../src/risk-engine/engine.js';
import type {Candle} from '../src/backtest/candle-source.js';
const DAY=86_400_000,HOUR=3_600_000,now=Date.UTC(2023,7,1,12);
function hourly(pair:string):Candle[]{
 const from=Math.floor(now/DAY)*DAY-61*DAY;
 return Array.from({length:61*24+12},(_,i)=>{
  const ts=from+i*HOUR,close=100+Math.sin(i*.15)*.3+i*.002;
  return {ts,open:close,high:close,low:close,close,volume:1};
 });
}
function make(){
 const btc=hourly('BTC/USDT'),eth=hourly('ETH/USDT');
 return new Map([['BTC/USDT',{h1:btc}],['ETH/USDT',{h1:eth}]]);
}
const portfolio={equity:10000,cash:10000,peak:10000,positions:new Map(),marks:new Map()};
test('historical risk snapshots ignore every future hourly and daily price',()=>{
 const base=make();
 const before=replayRiskSnapshot(now,'ETH/USDT','USDT',base,portfolio);
 const future=make();
 future.get('BTC/USDT')!.h1.push({ts:now+HOUR,open:1e8,high:1e8,low:1e8,close:1e8,volume:1});
 future.get('ETH/USDT')!.h1.push({ts:now+2*HOUR,open:1e-8,high:1e-8,low:1e-8,close:1e-8,volume:1});
 const after=replayRiskSnapshot(now,'ETH/USDT','USDT',future,portfolio);
 expect(after).toEqual(before);
 expect(after.daily.BTCUSDT).toHaveLength(61);
 expect(after.btcHourly).toHaveLength(721);
});
test('missing hourly source rejects candidate rather than using current-day/future data',()=>{
 const missing=new Map([['ETH/USDT',{h1:hourly('ETH/USDT')}]]);
 const snapshot=replayRiskSnapshot(now,'ETH/USDT','USDT',missing,portfolio);
 expect(snapshot.daily.BTCUSDT).toEqual([]);
 expect(new PortfolioRiskEngine().evaluateBuy('ETH/USDT',500,snapshot).allowed).toBe(false);
});
