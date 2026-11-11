import {expect,test,vi} from 'vitest';
import {RecorderBooks} from '../src/recorder/books.js';
import {selectRecorderUniverse} from '../src/recorder/configuration.js';
import type {RecorderEvent} from '../src/recorder/types.js';
import type {BinanceSymbol} from '../src/market/binance-data.js';

const depth=(lastUpdateId:number)=>({
  lastUpdateId,bids:[['100','2'],['99.95','3'],['99.70','4']],
  asks:[['100.10','5'],['100.15','6'],['100.50','7']],
});
test('top 20 depth uses quote notional, correct spread and 10/25bps cutoffs',()=>{
  const events:RecorderEvent[]=[],books=new RecorderBooks(15000,e=>events.push(e));
  books.begin('BTC/USDT',1000);
  expect(books.snapshot('BTC/USDT',2000,5000)).toBeNull();
  expect(books.acceptDepth('BTC/USDT',depth(100),2000)).toBe(true);
  const s=books.snapshot('BTC/USDT',5000,5000)!;
  expect(s.symbol).toBe('BTC/USDT');
  expect(s.spreadBps).toBeCloseTo(0.1/100.05*10000);
  expect(s.depthBid10bps).toBeCloseTo(200+99.95*3); // 99.95 is 9.995bps below mid, symmetric to ask 100.15
  expect(s.depthBid25bps).toBeCloseTo(200+99.95*3);
  expect(s.depthAsk10bps).toBeCloseTo(100.10*5+100.15*6);
  expect(s.depthAsk25bps).toBeCloseTo(100.10*5+100.15*6);
  expect(events.map(e=>e.type)).toEqual(['connect','gap_start','gap_end']);
});
test('reconnect invalidates old book until a new full depth snapshot arrives',()=>{
  const events:RecorderEvent[]=[],books=new RecorderBooks(15000,e=>events.push(e));
  books.begin('BTC/EUR',1000);
  books.acceptDepth('BTC/EUR',depth(15),2000);
  expect(books.snapshot('BTC/EUR',3000,5000)).not.toBeNull();
  books.reset('BTC/EUR',3500,'disconnect');
  books.reset('BTC/EUR',4000,'reconnect');
  expect(books.snapshot('BTC/EUR',5000,5000)).toBeNull();
  expect(books.acceptDepth('BTC/EUR',depth(1),6000)).toBe(true);
  expect(books.snapshot('BTC/EUR',7000,5000)).not.toBeNull();
  expect(events.filter(e=>e.type==='gap_start')).toHaveLength(2);
  expect(events.filter(e=>e.type==='gap_end')).toHaveLength(2);
});
test('sequence regression, invalid depth and staleness produce gaps and quality events',()=>{
  const events:RecorderEvent[]=[],books=new RecorderBooks(1000,e=>events.push(e));
  books.begin('BTC/USDC',1000);
  books.acceptDepth('BTC/USDC',depth(5),1100);
  expect(books.acceptDepth('BTC/USDC',depth(4),1150)).toBe(false);
  expect(books.snapshot('BTC/USDC',1200,5000)).toBeNull();
  books.acceptDepth('BTC/USDC',depth(10),1300);
  books.markStale(3001);
  expect(books.snapshot('BTC/USDC',3200,5000)).toBeNull();
  expect(events.filter(e=>e.type==='sequence_error')).toHaveLength(1);
  expect(events.filter(e=>e.type==='stale_book')).toHaveLength(1);
  expect(events.filter(e=>e.type==='gap_start')).toHaveLength(3);
});
test('public USDT-liquidity ranking expands each base to all available quotes',()=>{
  const s=(base:string,quote:string):BinanceSymbol=>({
    symbol:base+quote,status:'TRADING',baseAsset:base,quoteAsset:quote,
    baseAssetPrecision:8,quoteAssetPrecision:8,isSpotTradingAllowed:true,
    orderTypes:['MARKET'],filters:[],
  });
  const info=[s('BTC','USDT'),s('BTC','EUR'),s('BTC','USDC'),s('ETH','USDT'),s('ETH','EUR'),s('SOL','EUR')];
  const ticks=[{symbol:'BTCUSDT',quoteVolume:'1000'},{symbol:'ETHUSDT',quoteVolume:'500'}]
    .map(x=>({...x,bidPrice:'1',askPrice:'2',lastPrice:'1',volume:'1',priceChangePercent:'0'}));
  const u=selectRecorderUniverse(info,ticks,{topN:2,pairs:[],tradeMode:'top10'});
  expect(u.symbols).toEqual(['BTC/USDT','BTC/USDC','BTC/EUR','ETH/USDT','ETH/EUR']);
  expect([...u.tradeSymbols]).toEqual(u.symbols);
  expect(()=>selectRecorderUniverse(info,ticks,{topN:1,pairs:['SOL/USDT'],tradeMode:'off'})).toThrow('Unavailable');
});
