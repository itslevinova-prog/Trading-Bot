import type {MarketFeed} from '../market/types.js';
export type ValuedPosition={pair:string;qty:number;costBasisEur:number;stopLossPrice:number|null};
/** Fresh public top bid, not a promise that the whole position can liquidate there. */
export function markPortfolio<T extends ValuedPosition>(cash:number,held:T[],market:Pick<MarketFeed,'books'|'connected'>,maxAgeMs:number,now=Date.now()){
 const marked=held.map(p=>{
  const book=market.books.get(p.pair),bid=Number(book?.bids[0]?.price),ask=Number(book?.asks[0]?.price);
  const asOf=book&&Number.isFinite(book.receivedAt)?book.receivedAt:null,ageMs=asOf===null?null:now-asOf;
  const reason=!market.connected?'disconnected':!book?'missing':!book.valid||!Number.isFinite(bid)||bid<=0||!Number.isFinite(ask)||ask<bid||!Number.isFinite(p.qty)||p.qty<=0||!Number.isFinite(p.qty*bid)||asOf===null||![Number(book.bids[0]?.qty),Number(book.asks[0]?.qty)].every(q=>Number.isFinite(q)&&q>0)?'invalid':ageMs!==null&&ageMs<0?'future':ageMs!==null&&ageMs>maxAgeMs?'stale':null;
  const value=reason===null?p.qty*bid:null;
  return {...p,bid:reason===null?bid:null,value,priceAsOf:asOf,priceAgeMs:ageMs,valuationStatus:reason??'fresh',lastKnownBid:Number.isFinite(bid)&&bid>0?bid:null,pnlEur:value===null?null:value-p.costBasisEur,pnlPct:value===null||p.costBasisEur<=0?null:(value/p.costBasisEur-1)*100};
 });
 const complete=Number.isFinite(cash)&&cash>=0&&marked.every(p=>p.value!==null);
 const sum=complete?cash+marked.reduce((total,p)=>total+(p.value??0),0):null;
 const equity=sum!==null&&Number.isFinite(sum)?sum:null;
 return {asOf:now,complete:equity!==null,equity,cash,positions:marked,unvaluedPairs:marked.filter(p=>p.value===null).map(p=>p.pair),method:'fresh public top bid; no entry-price fallback; depth/fees excluded from mark',maxAgeMs};
}
