import WebSocket from 'ws';
import type {AggTrade} from './types.js';
import {RecorderBooks} from './books.js';

type SocketFactory = (url:string)=>WebSocket;
export type RecorderTransportOptions = {
  symbols:string[]; tradeSymbols:ReadonlySet<string>; books:RecorderBooks;
  onTrade:(trade:AggTrade)=>void; onMessage:(ts:number)=>void;
  onStatus:(connected:number,total:number)=>void; log:(message:string)=>void;
  socketFactory?:SocketFactory;
};
type Connection = {socket:WebSocket|null;retry:NodeJS.Timeout|null;opening:NodeJS.Timeout|null;rotation:NodeJS.Timeout|null;
  watchdog:NodeJS.Timeout|null; connected:boolean; failures:number; everOpened:boolean; lastMessage:number; symbols:string[]};
/** Separate public stream connections prevent a busy pair from starving every book. */
export class RecorderTransport {
  private stopped=false;
  private connections:Connection[]=[];
  constructor(private options:RecorderTransportOptions,private pairLimit=30) {
    for(let i=0;i<options.symbols.length;i+=pairLimit){
      this.connections.push({socket:null,retry:null,opening:null,rotation:null,watchdog:null,connected:false,
        failures:0,everOpened:false,lastMessage:0,symbols:options.symbols.slice(i,i+pairLimit)});
    }
  }
  get connectedCount(){return this.connections.filter(c=>c.connected).length;}
  get totalCount(){return this.connections.length;}
  start(){if(this.stopped)throw Error('Recorder transport already stopped');for(const c of this.connections)this.connect(c);}
  private status(){this.options.onStatus(this.connectedCount,this.totalCount);}
  private connect(c:Connection){
    if(this.stopped)return;
    const names=new Map(c.symbols.map(s=>[s.replace('/','').toLowerCase(),s]));
    const streams=c.symbols.flatMap(symbol=>{
      const s=symbol.replace('/','').toLowerCase();
      return [s+'@depth20@100ms',...(this.options.tradeSymbols.has(symbol)?[s+'@aggTrade']:[])];
    });
    const url='wss://data-stream.binance.vision/stream?streams='+streams.join('/');
    const ws=(this.options.socketFactory??(url=>new WebSocket(url)))(url);
    c.socket=ws;
    c.opening=setTimeout(()=>{if(c.socket===ws&&!c.connected){this.options.log('Binance WebSocket handshake timeout');ws.terminate();}},20000);
    ws.on('open',()=>{
      if(c.opening)clearTimeout(c.opening);c.opening=null;
      if(this.stopped){ws.close();return;}
      c.connected=true;c.lastMessage=Date.now();c.failures=0;
      if(c.everOpened)for(const symbol of c.symbols)this.options.books.reset(symbol,c.lastMessage,'reconnect');
      else for(const symbol of c.symbols)this.options.books.begin(symbol,c.lastMessage);
      c.everOpened=true;this.status();
      // Public Binance WebSocket connections expire after 24 hours.
      c.rotation=setTimeout(()=>ws.close(),23*60*60*1000+50*60*1000);
      c.watchdog=setInterval(()=>{
        if(c.connected&&Date.now()-c.lastMessage>30000){this.options.log('Recorder WebSocket silent; resetting connection');ws.terminate();}
      },10000);
    });
    ws.on('message',raw=>{
      if(this.stopped||c.socket!==ws)return;
      const now=Date.now();c.lastMessage=now;this.options.onMessage(now);
      try{
        const packet:unknown=JSON.parse(raw.toString());
        if(!packet||typeof packet!=='object')return;
        const {stream,data}=packet as {stream?:unknown;data?:unknown};
        if(!data||typeof data!=='object')return;
        const payload=data as Record<string,unknown>;
        if(payload.e==='serverShutdown'){ws.close();return;}
        const symbol=names.get(String(stream??'').split('@')[0]!.toLowerCase());
        if(!symbol)return;
        if(String(stream).includes('@depth20'))this.options.books.acceptDepth(symbol,payload,now);
        else if(String(stream).includes('@aggTrade')&&this.options.tradeSymbols.has(symbol)){
          const ts=Number(payload.T),aggId=Number(payload.a),price=Number(payload.p),qty=Number(payload.q);
          if(!Number.isSafeInteger(ts)||ts<=0||!Number.isSafeInteger(aggId)||aggId<0||
            !Number.isFinite(price)||price<=0||!Number.isFinite(qty)||qty<=0||
            typeof payload.m!=='boolean')return;
          this.options.onTrade({ts,symbol,aggId,price,qty,isBuyerMaker:payload.m});
        }
      }catch{this.options.log('Invalid public Binance stream message ignored');}
    });
    ws.on('error',()=>{this.options.log('Public Binance stream transport error');});
    ws.on('close',()=>{
      if(c.opening)clearTimeout(c.opening);c.opening=null;
      if(c.rotation)clearTimeout(c.rotation);
      if(c.watchdog)clearInterval(c.watchdog);
      c.rotation=null;c.watchdog=null;
      if(c.socket!==ws)return;
      c.socket=null;c.connected=false;this.status();
      if(this.stopped)return;
      for(const symbol of c.symbols)this.options.books.reset(symbol,Date.now(),'disconnect');
      const delay=Math.min(60000,1000*2**Math.min(c.failures++,6));
      c.retry=setTimeout(()=>{c.retry=null;this.connect(c);},delay+Math.floor(Math.random()*500));
    });
  }
  stop(){
    if(this.stopped)return;this.stopped=true;
    for(const c of this.connections){
      if(c.retry)clearTimeout(c.retry);
      if(c.opening)clearTimeout(c.opening);
      if(c.rotation)clearTimeout(c.rotation);
      if(c.watchdog)clearInterval(c.watchdog);
      c.retry=null;c.opening=null;c.rotation=null;c.watchdog=null;
      const ws=c.socket;c.socket=null;c.connected=false;
      if(ws){ws.removeAllListeners();ws.close();}
    }
    this.status();
  }
}
