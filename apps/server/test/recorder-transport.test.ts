import {afterEach,expect,test,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import type WebSocket from 'ws';
import {RecorderBooks} from '../src/recorder/books.js';
import {RecorderTransport} from '../src/recorder/transport.js';
import type {AggTrade,RecorderEvent} from '../src/recorder/types.js';

class FakeSocket extends EventEmitter {
  closed=false;
  constructor(readonly url:string){super();}
  close(){if(!this.closed){this.closed=true;this.emit('close');}}
  terminate(){this.close();}
  message(stream:string,data:unknown){this.emit('message',Buffer.from(JSON.stringify({stream,data})));}
}
afterEach(()=>{vi.useRealTimers();});
test('mocked Binance combined WS depth/trades reconnect without restoring the old book',()=>{
  vi.useFakeTimers();vi.setSystemTime(Date.UTC(2026,10,5));
  const sockets:FakeSocket[]=[],events:RecorderEvent[]=[],trades:AggTrade[]=[];
  const books=new RecorderBooks(15000,e=>events.push(e));
  const transport=new RecorderTransport({
    symbols:['BTC/USDT'],tradeSymbols:new Set(['BTC/USDT']),books,
    onTrade:t=>trades.push(t),onMessage:vi.fn(),onStatus:vi.fn(),log:vi.fn(),
    socketFactory:url=>{const socket=new FakeSocket(url);sockets.push(socket);return socket as unknown as WebSocket;},
  },1);
  transport.start();
  const first=sockets[0]!;
  expect(first.url).toContain('btcusdt@depth20@100ms');
  expect(first.url).toContain('btcusdt@aggTrade');
  first.emit('open');
  first.message('btcusdt@depth20@100ms',{lastUpdateId:44,bids:[['100','2']],asks:[['101','3']]});
  expect(books.snapshot('BTC/USDT',Date.now(),5000)).not.toBeNull();
  first.message('btcusdt@aggTrade',{e:'aggTrade',T:Date.now(),a:5,p:'100.5',q:'1.25',m:true});
  expect(trades).toMatchObject([{symbol:'BTC/USDT',aggId:5,isBuyerMaker:true}]);
  first.close();
  expect(books.snapshot('BTC/USDT',Date.now(),5000)).toBeNull();
  vi.advanceTimersByTime(2000);
  const next=sockets[1]!;
  next.emit('open');
  expect(books.snapshot('BTC/USDT',Date.now(),5000)).toBeNull();
  next.message('btcusdt@depth20@100ms',{lastUpdateId:1,bids:[['99','1']],asks:[['101','1']]});
  expect(books.snapshot('BTC/USDT',Date.now(),5000)).not.toBeNull();
  expect(events.filter(e=>e.type==='disconnect')).toHaveLength(1);
  expect(events.filter(e=>e.type==='reconnect')).toHaveLength(1);
  transport.stop();
  expect(vi.getTimerCount()).toBe(0);
});
