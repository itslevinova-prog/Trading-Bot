import {test,expect,vi,beforeEach} from 'vitest';
import type {BinanceSymbol} from '../src/market/binance-data.js';
const state=vi.hoisted(()=>({info:[] as unknown[],ticks:[] as unknown[],held:[] as {pair:string}[],writes:[] as any[],transaction:vi.fn(),request:vi.fn()}));
vi.mock('../src/config.js',()=>({config:{QUOTE_CURRENCY:'EUR',TOP_N_PAIRS:2,PAPER_FIXED_PAIRS:'["BTC/EUR","ETH/EUR"]'}}));
vi.mock('../src/db.js',()=>{
 const tx={
  update:()=>({set:()=>({run:()=>{}})}),
  insert:()=>({values:(value:any)=>({onConflictDoUpdate:()=>({run:()=>{state.writes.push(structuredClone(value));}})})})
 };
 return {db:{select:()=>({from:()=>({all:()=>state.held})}),transaction:(callback:(tx:any)=>void)=>{state.transaction();return callback(tx);}}};
});
vi.mock('../src/market/binance-data.js',async importOriginal=>({...await importOriginal<object>(),publicRequest:(path:string)=>state.request(path)}));
import {BinanceMarket} from '../src/market/binance.js';
const symbol=(base:string):BinanceSymbol=>({symbol:base+'EUR',baseAsset:base,quoteAsset:'EUR',status:'TRADING',isSpotTradingAllowed:true,orderTypes:['MARKET'],baseAssetPrecision:8,quoteAssetPrecision:8,filters:[{filterType:'LOT_SIZE',stepSize:'.001',minQty:'.001'},{filterType:'PRICE_FILTER',tickSize:'.01'},{filterType:'MIN_NOTIONAL',minNotional:'5'}]});
beforeEach(()=>{state.info=['BTC','ETH','SOL'].map(symbol);state.ticks=['BTC','ETH','SOL'].map((base,i)=>({symbol:base+'EUR',quoteVolume:String(100-i),bidPrice:'100',askPrice:'100.01',lastPrice:'100',volume:'1',priceChangePercent:'0'}));state.held=[];state.writes=[];state.transaction.mockClear();state.request.mockReset();state.request.mockImplementation(async path=>{if(path==='/api/v3/exchangeInfo')return {symbols:state.info};if(path==='/api/v3/ticker/24hr')return state.ticks;throw Error('Unexpected public endpoint');});});
const market=()=>new BinanceMarket({info:vi.fn(),warn:vi.fn()} as any,()=>{},()=>{});
test('real adapter delegates pinned selection and stores only declared members despite rank changes',async()=>{
 const m=market();(state.ticks[2] as any).quoteVolume='999999';(state.ticks[1] as any).quoteVolume='0';await m.selectPairs();expect(state.writes.map(p=>p.symbol)).toEqual(['BTC/EUR','ETH/EUR']);expect([...m.tickers.keys()]).toEqual(['BTC/EUR','ETH/EUR']);expect(state.request.mock.calls.map(c=>c[0]).sort()).toEqual(['/api/v3/exchangeInfo','/api/v3/ticker/24hr']);
});
test('a pinned metadata failure occurs before any database activation or memory-map clearing',async()=>{
 const m=market();await m.selectPairs();const before=structuredClone(state.writes);(state.info[1] as BinanceSymbol).status='BREAK';await expect(m.selectPairs()).rejects.toThrow('no longer tradable');expect(state.transaction).toHaveBeenCalledTimes(1);expect(state.writes).toEqual(before);expect([...m.tickers.keys()]).toEqual(['BTC/EUR','ETH/EUR']);
});
test('successful resume rereads supported exchange limits rather than restoring old seed metadata',async()=>{
 const m=market();await m.selectPairs();(state.info[1] as BinanceSymbol).filters[0]!.minQty='.01';await m.selectPairs();expect(state.writes.at(-1)).toMatchObject({symbol:'ETH/EUR',ordermin:.01,costmin:5,lotDecimals:3,pairDecimals:2});expect(state.request).toHaveBeenCalledTimes(4);
});
