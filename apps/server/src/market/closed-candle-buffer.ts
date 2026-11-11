import type {Candle} from '@paper/shared';
import {parseKlines} from './binance-data.js';
/** A final exchange message can arrive before the same close on the local clock.
 * Buffer briefly, then validate again against actual time; never expose future OHLC. */
export class ClosedCandleBuffer {
 private pending=new Map<string,{pair:string;interval:number;row:unknown[];closeAt:number}>();
 private timer:NodeJS.Timeout|undefined;private stopped=false;
 constructor(private commit:(c:Candle)=>void,private onError:(error:unknown)=>void){}
 private publish(c:Candle){try{this.commit(c);}catch(error){this.onError(error);}}
 accept(pair:string,interval:number,row:unknown[]){
  if(this.stopped||![15,60].includes(interval))return false;
  const now=Date.now(),key=pair+':'+interval+':'+String(row[0]),ready=parseKlines(pair,interval,[row],now)[0];
  if(ready){this.pending.delete(key);this.publish(ready);this.schedule();return true;}
  const closeAt=Number(row[0])+interval*60000;
  if(!Number.isSafeInteger(closeAt)||closeAt<=now||closeAt-now>2000||!parseKlines(pair,interval,[row],closeAt).length)return false;
  this.pending.set(key,{pair,interval,row:[...row],closeAt});this.schedule();return true;
 }
 private schedule(){
  if(this.timer)clearTimeout(this.timer);this.timer=undefined;
  if(this.stopped||!this.pending.size)return;
  const next=Math.min(...[...this.pending.values()].map(p=>p.closeAt));
  this.timer=setTimeout(()=>{this.timer=undefined;this.drain();},Math.max(1,Math.min(2000,next-Date.now()+1)));
 }
 private drain(){
  if(this.stopped)return;const now=Date.now();
  for(const [key,p]of this.pending){if(now<p.closeAt)continue;this.pending.delete(key);const c=parseKlines(p.pair,p.interval,[p.row],now)[0];if(c)this.publish(c);}
  this.schedule();
 }
 stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.pending.clear();}
}
