import {mergeTicker} from './ticker-state.js';
import {parseFixedPairs,selectBinanceUniverse} from './pinned-universe.js';
import {ClosedCandleBuffer} from './closed-candle-buffer.js';
import {repairHistory,type HistoryRepair} from './history.js';
import WebSocket from 'ws';
import {and,desc,eq} from 'drizzle-orm';
import type {FeatureSnapshot,MarketTicker,OrderBook} from '@paper/shared';
import type {FastifyBaseLogger as Logger} from 'fastify';
import type {MarketFeed} from './types.js';
import {db} from '../db.js';import {pairs,candles,positions} from '../schema.js';import {config} from '../config.js';
import {feature} from './indicators.js';
import {decimals,parseKlines,partialBook,publicRequest,type BinanceSymbol} from './binance-data.js';

export class BinanceMarket implements MarketFeed {
 readonly historyStatus=new Map<string,HistoryRepair|{pair:string;interval:number;asOf:number;status:'error';previousAsOf:number|null;reason:string}>();
 readonly venue='binance' as const;
 readonly tickers=new Map<string,MarketTicker>();readonly books=new Map<string,OrderBook>();readonly features=new Map<string,FeatureSnapshot>();
 connected=false;private stopped=false;private ws?:WebSocket;private retry?:NodeJS.Timeout;private refresh?:NodeJS.Timeout;private watchdog?:NodeJS.Timeout;private historyRetry?:NodeJS.Timeout;private lastMessage=0;private failures=0;private backfilling=false;
 private symbols=new Map<string,string>();
 private closedCandles:ClosedCandleBuffer;
 constructor(private logger:Logger,private emit:(type:string,payload:unknown)=>void,private onTick:(symbol:string,bid:number)=>void,private onClosedActivity?: (observation:{pair:string;receivedAt:number;rawText:string})=>void){this.closedCandles=new ClosedCandleBuffer(c=>{if(this.stopped)return;db.insert(candles).values(c).onConflictDoUpdate({target:[candles.pair,candles.interval,candles.ts],set:c}).run();this.calculate(c.pair);this.emit('candle',c);},error=>this.logger.warn({error},'Public closed candle storage failed; missing data remains unknown'));}
 async selectPairs(){
  const [info,tickerSnapshot]=await Promise.all([publicRequest<{symbols:BinanceSymbol[]}>('/api/v3/exchangeInfo'),publicRequest<{symbol:string;quoteVolume:string;bidPrice:string;askPrice:string;lastPrice:string;volume:string;priceChangePercent:string}[]>('/api/v3/ticker/24hr').then(value=>({value,receivedAt:Date.now()}))]);
  const ticks=tickerSnapshot.value;
  const held=db.select().from(positions).all().map(p=>p.pair);
  const active=selectBinanceUniverse(info.symbols,ticks,{quote:config.QUOTE_CURRENCY,topN:config.TOP_N_PAIRS,held,fixed:parseFixedPairs(config.PAPER_FIXED_PAIRS)});
  if(!active.length)throw Error('Keine handelbaren Binance-Spot-Paare fÃ¼r die konfigurierte WÃ¤hrung');
  db.transaction(tx=>{tx.update(pairs).set({active:false}).run();this.symbols.clear();for(const {s,t} of active){
   const symbol=`${s.baseAsset}/${s.quoteAsset}`,lot=s.filters.find(f=>f.filterType==='LOT_SIZE'),notional=s.filters.find(f=>f.filterType==='NOTIONAL'||f.filterType==='MIN_NOTIONAL'),price=s.filters.find(f=>f.filterType==='PRICE_FILTER');
   if(!lot?.stepSize||!price?.tickSize)continue;
   const p={symbol,restName:s.symbol,base:s.baseAsset,quote:s.quoteAsset,ordermin:Number(lot.minQty),costmin:Number(notional?.minNotional??0),lotDecimals:decimals(lot.stepSize),pairDecimals:decimals(price.tickSize),active:true,volume24hEur:Number(t!.quoteVolume),status:'online',updatedAt:Date.now()};
   tx.insert(pairs).values(p).onConflictDoUpdate({target:pairs.symbol,set:p}).run();this.symbols.set(s.symbol.toLowerCase(),symbol);
   this.tickers.set(symbol,mergeTicker(symbol,undefined,{bid:Number(t!.bidPrice),ask:Number(t!.askPrice),last:Number(t!.lastPrice),volume:Number(t!.volume),change24h:Number(t!.priceChangePercent)},tickerSnapshot.receivedAt));
  }});
  this.logger.info({count:this.symbols.size,quote:config.QUOTE_CURRENCY},'Binance Spot markets selected');
 }
 calculate(pair:string){const t=this.tickers.get(pair);if(!t)return;const read=(interval:number)=>db.select().from(candles).where(and(eq(candles.pair,pair),eq(candles.interval,interval))).orderBy(desc(candles.ts)).limit(750).all().reverse();const f=feature(pair,read(15),read(60),t);if(f)this.features.set(pair,f);else this.features.delete(pair);}
 async loadHistory(pair:string,interval:15|60,days=config.HISTORY_DAYS){
  const attemptedAt=Date.now();try{
  const known=db.select({ts:candles.ts}).from(candles).where(and(eq(candles.pair,pair),eq(candles.interval,interval))).all().map(row=>row.ts);
  const report=await repairHistory({pair,interval,days:Math.max(days,config.HISTORY_DAYS),now:Math.floor(Date.now()/(interval*60000))*interval*60000,predecessorBars:1,known,isStopped:()=>this.stopped,
   fetchPage:(start,end)=>publicRequest('/api/v3/klines',{symbol:pair.replace('/',''),interval:interval===15?'15m':'1h',startTime:String(start),endTime:String(end),limit:'1000'}),
   save:rows=>db.transaction(tx=>{for(const c of rows)tx.insert(candles).values(c).onConflictDoUpdate({target:[candles.pair,candles.interval,candles.ts],set:c}).run();}),pause:()=>new Promise(resolve=>setTimeout(resolve,150))});
  this.historyStatus.set(`${pair}:${interval}`,report);if(!report.complete&&!report.stopped)this.logger.warn({pair,interval,missing:report.missingAfter,requests:report.requests},'Public history gaps remain; unavailable rows are not synthesized');
  if(!this.stopped)this.calculate(pair);return report;
  }catch(error){const previous=this.historyStatus.get(`${pair}:${interval}`);this.historyStatus.set(`${pair}:${interval}`,{pair,interval,asOf:attemptedAt,status:'error',previousAsOf:previous?.asOf??null,reason:'Public history unavailable; missing candles remain unknown'});throw error;}
 }
 async backfill(days=config.HISTORY_DAYS){if(this.backfilling)return;this.backfilling=true;try{for(const pair of this.symbols.values()){if(this.stopped)break;for(const interval of [15,60] as const){try{await this.loadHistory(pair,interval,days)}catch(error){this.logger.warn({pair,interval,error},'Binance history unavailable');return;}}}}finally{this.backfilling=false;}}
 connect(){if(this.stopped)return;const streams=[...this.symbols.keys()].flatMap(s=>[`${s}@ticker`,`${s}@depth20@100ms`,`${s}@kline_15m`,`${s}@kline_1h`]);
  const socket=new WebSocket(`wss://data-stream.binance.vision/stream?streams=${streams.join('/')}`);this.ws=socket;
  socket.on('open',()=>{this.connected=true;this.lastMessage=Date.now();this.failures=0;this.emit('system_status',{connected:true,exchange:this.venue});});
  socket.on('message',raw=>{this.lastMessage=Date.now();try{const rawText=raw.toString(),message=JSON.parse(rawText);const data=message.data;if(!data)return;if(data.e==='serverShutdown'){socket.close();return;}const rest=String(message.stream??'').split('@')[0]!,pair=this.symbols.get(rest);if(!pair)return;
   if(data.bids&&data.asks){const book=partialBook(pair,data);this.books.set(pair,book);if(book.valid){const old=this.tickers.get(pair);const bid=Number(book.bids[0]!.price),ask=Number(book.asks[0]!.price);this.tickers.set(pair,mergeTicker(pair,old,{bid,ask},book.receivedAt));this.onTick(pair,bid);this.emit('book_top',{pair,bids:book.bids.slice(0,5),asks:book.asks.slice(0,5),receivedAt:book.receivedAt});}}
   else if(data.e==='24hrTicker'){const old=this.tickers.get(pair);const t=mergeTicker(pair,old,{...(!old?{bid:Number(data.b),ask:Number(data.a)}:{}),last:Number(data.c),volume:Number(data.v),change24h:Number(data.P)},Date.now());this.tickers.set(pair,t);this.calculate(pair);this.emit('ticker',t);}
   else if(data.e==='kline'&&data.k?.x){const k=data.k;if(k.i==='15m'&&k.x===true&&this.onClosedActivity){try{this.onClosedActivity({pair,receivedAt:this.lastMessage,rawText});}catch(error){this.logger.warn({pair},'Public activity capture failed; normal candle handling continues');}}if(k.i==='15m'||k.i==='1h')this.closedCandles.accept(pair,k.i==='15m'?15:60,[k.t,k.o,k.h,k.l,k.c,k.v,k.T]);}
  }catch{this.logger.warn('Invalid Binance stream payload ignored');}});
  socket.on('error',()=>this.logger.warn('Binance websocket transport error'));
  socket.on('close',()=>{this.connected=false;this.books.clear();this.emit('system_status',{connected:false,exchange:this.venue});if(!this.stopped)this.retry=setTimeout(()=>{this.connect();void this.backfill(2);},Math.min(60000,1000*2**Math.min(this.failures++,6)));});
 }
 async start(){await this.selectPairs();this.connect();void this.backfill();this.refresh=setInterval(()=>{for(const p of this.symbols.values())this.calculate(p);},15000);this.historyRetry=setInterval(()=>{void this.backfill();},15*60000);this.watchdog=setInterval(()=>{if(this.connected&&Date.now()-this.lastMessage>30000){this.books.clear();this.ws?.terminate();}},10000);}
 stop(){this.stopped=true;this.closedCandles.stop();if(this.retry)clearTimeout(this.retry);if(this.refresh)clearInterval(this.refresh);if(this.watchdog)clearInterval(this.watchdog);if(this.historyRetry)clearInterval(this.historyRetry);this.ws?.close();}
}
