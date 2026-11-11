import {partialBook} from '../market/binance-data.js';
import type {OrderBook} from '@paper/shared';
import type {BookSnapshot,RecorderEvent,RecorderEventType} from './types.js';

type State = {book: OrderBook | null; sequence: number | null; lastAt: number; gapAt: number | null; stale: boolean};
const event = (ts: number,symbol:string,type:RecorderEventType,detail?:string):RecorderEvent => ({ts,symbol,type,...(detail?{detail}:{})});
function depth(book:OrderBook,bid:number,ask:number,bps:number) {
  const withinBid = bid*(1-bps/10000),withinAsk = ask*(1+bps/10000);
  const sum = (levels: OrderBook['bids'],predicate:(price:number)=>boolean) =>
    levels.reduce((total,l) => {const p=Number(l.price),q=Number(l.qty);return total+(predicate(p)?p*q:0);},0);
  return {bid:sum(book.bids,p=>p>=withinBid),ask:sum(book.asks,p=>p<=withinAsk)};
}
/** Binance partial depth20 messages are full top-20 snapshots, not contiguous diff updates. */
export class RecorderBooks {
  private states = new Map<string,State>();
  constructor(private readonly staleMs:number,private readonly onEvent:(e:RecorderEvent)=>void) {}
  private state(symbol:string):State {
    let state=this.states.get(symbol);
    if (!state) {state={book:null,sequence:null,lastAt:0,gapAt:null,stale:false};this.states.set(symbol,state);}
    return state;
  }
  private emit(e:RecorderEvent){this.onEvent(e);}
  private gap(symbol:string,ts:number,reason:string) {
    const s=this.state(symbol);
    if(s.gapAt===null){s.gapAt=ts;this.emit(event(ts,symbol,'gap_start',reason));}
  }
  begin(symbol:string,ts:number){this.reset(symbol,ts,'connect');}
  reset(symbol:string,ts:number,reason:'connect'|'disconnect'|'reconnect') {
    const s=this.state(symbol);
    s.book=null;s.sequence=null;s.lastAt=0;s.stale=false;
    this.emit(event(ts,symbol,reason));
    this.gap(symbol,ts,reason);
  }
  acceptDepth(symbol:string,payload:unknown,ts:number):boolean {
    const s=this.state(symbol);
    if (!payload || typeof payload !== 'object') {this.invalidate(symbol,ts,'invalid-depth');return false;}
    const data=payload as {bids?:unknown;asks?:unknown;lastUpdateId?:unknown};
    const sequence=Number(data.lastUpdateId);
    if(!Number.isSafeInteger(sequence)||sequence<0||s.sequence!==null&&sequence<s.sequence){
      this.invalidate(symbol,ts,'depth-sequence-regression-or-missing');
      return false;
    }
    const book=partialBook(symbol,data,ts);
    if(!book.valid){this.invalidate(symbol,ts,'invalid-or-crossed-book');return false;}
    if(s.sequence!==null&&sequence===s.sequence&&s.book){
      // Repeated full snapshots are permitted, but never renew the freshness clock.
      return true;
    }
    s.book=book;s.sequence=sequence;s.lastAt=ts;s.stale=false;
    if(s.gapAt!==null){this.emit(event(ts,symbol,'gap_end',String(ts-s.gapAt)));s.gapAt=null;}
    return true;
  }
  private invalidate(symbol:string,ts:number,detail:string) {
    const s=this.state(symbol);
    s.book=null;s.sequence=null;s.lastAt=0;s.stale=false;
    this.emit(event(ts,symbol,'sequence_error',detail));
    this.gap(symbol,ts,detail);
  }
  markStale(ts:number) {
    for(const [symbol,s] of this.states){
      if(s.book&&ts-s.lastAt>this.staleMs&&!s.stale){
        s.stale=true;s.book=null;s.sequence=null;
        this.emit(event(ts,symbol,'stale_book'));
        this.gap(symbol,ts,'stale_book');
      }
    }
  }
  snapshot(symbol:string,ts:number,intervalMs:number):BookSnapshot|null {
    const s=this.state(symbol);
    if(!s.book||!s.book.valid||ts-s.lastAt>this.staleMs||s.gapAt!==null)return null;
    const bidLevel=s.book.bids[0],askLevel=s.book.asks[0];
    if(!bidLevel||!askLevel)return null;
    const bid=Number(bidLevel.price),ask=Number(askLevel.price),bidQty=Number(bidLevel.qty),askQty=Number(askLevel.qty);
    const mid=(bid+ask)/2;
    if(!Number.isFinite(mid)||mid<=0||bid>=ask)return null;
    const d10=depth(s.book,bid,ask,10),d25=depth(s.book,bid,ask,25);
    const values=[bid,ask,bidQty,askQty,d10.bid,d10.ask,d25.bid,d25.ask];
    if(values.some(v=>!Number.isFinite(v)||v<0))return null;
    return {ts:Math.floor(ts/intervalMs)*intervalMs,symbol,bid,bidQty,ask,askQty,
      spreadBps:(ask-bid)/mid*10000,
      depthBid10bps:d10.bid,depthAsk10bps:d10.ask,depthBid25bps:d25.bid,depthAsk25bps:d25.ask};
  }
}
