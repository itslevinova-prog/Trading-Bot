import {mergeTicker} from './ticker-state.js';
import WebSocket from 'ws';
import {eq, and, desc, lt} from 'drizzle-orm';
import {BookEventSchema,Candle as C, OhlcEventSchema,TickerEventSchema,type OrderBook,type MarketTicker,type FeatureSnapshot} from '@paper/shared';
import {db} from '../db.js';import {config} from '../config.js';import {pairs,candles,positions} from '../schema.js';import {updateBook} from './orderBook.js';import {feature} from './indicators.js';
import type {FastifyBaseLogger as Logger} from 'fastify';
const exclude=new Set(['USDT','USDC','EURT','DAI','PYUSD','GBP','USD','CHF','EUR','TUSD','USDD','FDUSD','RLUSD','USDE','USD1','XAUT']);
const restPair=(s:string)=>s.startsWith('XBT/')?'BTC/'+s.slice(4):s.replace(/^XBT\//,'BTC/');
async function request(path:string,params:Record<string,string>={}){
 const u=new URL('https://api.kraken.com/0/public/'+path);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
 const response=await fetch(u,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error(`Kraken HTTP ${response.status}`);
 const payload=await response.json() as {error:string[];result:Record<string,any>};if(payload.error?.length)throw Error(payload.error.join(', '));return payload.result;
}
export class KrakenMarket{
 readonly venue='kraken' as const;
 readonly tickers=new Map<string,MarketTicker>();readonly books=new Map<string,OrderBook>();readonly features=new Map<string,FeatureSnapshot>();
 ws:WebSocket|undefined;connected=false;stopped=false;reconnectCount=0;private timer:NodeJS.Timeout|undefined;private selectionTimer:NodeJS.Timeout|undefined;private onEvent:(type:string,payload:unknown)=>void;private onTick:(symbol:string,bid:number)=>void;
 constructor(private logger:Logger,onEvent:(type:string,payload:unknown)=>void,onTick:(symbol:string,bid:number)=>void){this.onEvent=onEvent;this.onTick=onTick;}
 async selectPairs(){const [assets,tickers]=await Promise.all([request('AssetPairs',{assetVersion:'1'}),request('Ticker',{assetVersion:'1'})]);
  const found=Object.entries(assets).flatMap(([restName,info])=>{const item=info as any;const wsName=item.wsname as string|undefined;const symbol=wsName?restPair(wsName):restName;if(!symbol.endsWith('/EUR')||item.status!=='online'||!item.ordermin||!item.lot_decimals&&item.lot_decimals!==0)return [];
  const base=symbol.split('/')[0]!;if(exclude.has(base)||base.startsWith('Z')||base.endsWith('.S'))return [];
  const tick=(tickers[restName]??tickers[item.altname]??tickers[symbol]) as any;const vol=Number(tick?.v?.[1]??0)*Number(tick?.p?.[1]??0);if(vol<=0)return [];
  return [{symbol,restName,base,quote:'EUR',ordermin:Number(item.ordermin),costmin:Number(item.costmin??0),lotDecimals:Number(item.lot_decimals),pairDecimals:Number(item.pair_decimals),active:true,volume24hEur:vol,status:item.status,updatedAt:Date.now()}];});
  const unique=[...new Map(found.sort((a,b)=>b.volume24hEur-a.volume24hEur).map(p=>[p.symbol,p])).values()];const saved=db.select().from(positions).all().map(p=>p.pair);const symbols=new Set(unique.slice(0,config.TOP_N_PAIRS).map(p=>p.symbol));symbols.add('BTC/EUR');for(const sym of saved)symbols.add(sym);
  const active=unique.filter(p=>symbols.has(p.symbol));if(active.length<15)throw Error(`Nur ${active.length} EUR-Paare gefunden`);
  db.update(pairs).set({active:false}).run();for(const p of active)db.insert(pairs).values(p).onConflictDoUpdate({target:pairs.symbol,set:p}).run();this.logger.info({count:active.length},'Kraken pairs selected');return active;
 }
 async loadHistory(pair:string,interval:15|60){const p=db.select().from(pairs).where(eq(pairs.symbol,pair)).get();if(!p)return;
  const result=await request('OHLC',{pair:p.restName,interval:String(interval)});const raw=(result[p.restName]??Object.values(result).find(Array.isArray)) as unknown[][]|undefined;if(!raw)return;
  for(const row of raw.slice(0,-1)){const [ts,o,h,l,c,,volume]=row;const candle={pair,interval,ts:Number(ts)*1000,open:Number(o),high:Number(h),low:Number(l),close:Number(c),volume:Number(volume)};db.insert(candles).values(candle).onConflictDoUpdate({target:[candles.pair,candles.interval,candles.ts],set:candle}).run();}
  this.calculate(pair);
 }
 calculate(pair:string){const t=this.tickers.get(pair);if(!t)return;const a=db.select().from(candles).where(and(eq(candles.pair,pair),eq(candles.interval,15))).orderBy(desc(candles.ts)).limit(750).all().reverse();const b=db.select().from(candles).where(and(eq(candles.pair,pair),eq(candles.interval,60))).orderBy(desc(candles.ts)).limit(750).all().reverse();const f=feature(pair,a,b,t);if(f)this.features.set(pair,f);else this.features.delete(pair);}
 private subscribe(symbols:string[]){if(this.ws?.readyState!==WebSocket.OPEN)return;for(const params of [{channel:'ticker',symbol:symbols,event_trigger:'bbo'},{channel:'book',symbol:symbols,depth:10},{channel:'ohlc',symbol:symbols,interval:15},{channel:'ohlc',symbol:symbols,interval:60}])this.ws.send(JSON.stringify({method:'subscribe',params}));}
 connect(){if(this.stopped)return;this.ws=new WebSocket('wss://ws.kraken.com/v2');
  this.ws.on('open',()=>{this.connected=true;this.reconnectCount=0;this.onEvent('system_status',{connected:true});this.subscribe(db.select().from(pairs).where(eq(pairs.active,true)).all().map(p=>p.symbol));});
  this.ws.on('message',raw=>{try{const text=raw.toString();const rawSafe=/"channel"\s*:\s*"book"/.test(text)?text.replace(/("(?:price|qty)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,'$1"$2"'):text;const msg=JSON.parse(rawSafe) as any;if(msg.channel==='ticker'){const check=TickerEventSchema.safeParse(msg);if(!check.success)return;for(const t of check.data.data){const old=this.tickers.get(t.symbol);const receivedAt=Date.now(),value=mergeTicker(t.symbol,old,{bid:t.bid,ask:t.ask,last:t.last,volume:t.volume,change24h:t.change_pct},receivedAt);this.tickers.set(t.symbol,value);this.onEvent('ticker',value);if(t.bid!==undefined&&t.bid===value.bid&&value.bid>0&&value.fieldReceivedAt?.bid===receivedAt)this.onTick(t.symbol,value.bid);}}
  if(msg.channel==='book'){const check=BookEventSchema.safeParse(msg);if(!check.success)return;for(const item of check.data.data){let book:OrderBook;try{book=updateBook(this.books.get(item.symbol),item,check.data.type==='snapshot');}catch{this.resubscribeBook(item.symbol);continue;}this.books.set(item.symbol,book);if(!book.valid){this.resubscribeBook(item.symbol);continue;}this.onEvent('book_top',{pair:item.symbol,bids:book.bids.slice(0,5),asks:book.asks.slice(0,5),receivedAt:book.receivedAt});}}
  if(msg.channel==='ohlc'){const check=OhlcEventSchema.safeParse(msg);if(!check.success)return;for(const item of check.data.data){const c={pair:item.symbol,interval:item.interval,ts:Date.parse(item.interval_begin),open:item.open,high:item.high,low:item.low,close:item.close,volume:item.volume};db.insert(candles).values(c).onConflictDoUpdate({target:[candles.pair,candles.interval,candles.ts],set:c}).run();this.calculate(item.symbol);this.onEvent('candle',c);}}
  }catch(error){this.logger.warn({error},'Kraken payload rejected');}});
  this.ws.on('error',error=>this.logger.warn({error},'Kraken websocket error'));
  this.ws.on('close',()=>{this.connected=false;this.books.clear();this.onEvent('system_status',{connected:false});if(!this.stopped){const ms=Math.min(60000,1000*2**Math.min(this.reconnectCount++,6));this.timer=setTimeout(()=>{this.connect();void this.backfill();},ms);}});
 }
 private resubscribeBook(symbol:string){this.books.delete(symbol);if(this.ws?.readyState===WebSocket.OPEN){this.ws.send(JSON.stringify({method:'unsubscribe',params:{channel:'book',symbol:[symbol],depth:10}}));setTimeout(()=>{if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({method:'subscribe',params:{channel:'book',symbol:[symbol],depth:10}}));},400);}}
 async backfill(){for(const p of db.select().from(pairs).where(eq(pairs.active,true)).all()){for(const interval of [15,60] as const){try{await this.loadHistory(p.symbol,interval);await new Promise(r=>setTimeout(r,350))}catch(e){this.logger.warn({pair:p.symbol,interval,error:e},'History unavailable')}}}}
 async start(){await this.selectPairs();this.connect();void this.backfill();const refresh=async()=>{try{await this.selectPairs();this.ws?.close()}catch(e){this.logger.error(e,'Pair selection failed')}};
 this.selectionTimer=setInterval(()=>{const d=new Date();if(d.getUTCHours()===0&&d.getUTCMinutes()===5)void refresh();},60_000);}
 stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);if(this.selectionTimer)clearInterval(this.selectionTimer);this.ws?.close();}
}
