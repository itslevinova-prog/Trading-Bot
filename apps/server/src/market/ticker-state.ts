import type {MarketTicker,TickerField} from '@paper/shared';
const fields:TickerField[]=['bid','ask','last','volume','change24h'];
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
/** Local receipt clocks only: a book update does not refresh carried ticker statistics. */
export function mergeTicker(symbol:string,old:MarketTicker|undefined,patch:Partial<Record<TickerField,number>>,receivedAt:number):MarketTicker{
 if(!time(receivedAt))throw Error('Invalid ticker receipt clock');
 if(old&&old.symbol!==symbol)throw Error('Ticker symbol mismatch');
 const clocks=Object.fromEntries(fields.map(k=>[k,time(old?.fieldReceivedAt?.[k])?old!.fieldReceivedAt![k]:null])) as Record<TickerField,number|null>;
 const result:MarketTicker={symbol,bid:old?.bid??0,ask:old?.ask??0,last:old?.last??0,volume:old?.volume??0,change24h:old?.change24h??0,receivedAt:old?.receivedAt??0,fieldReceivedAt:clocks};
 for(const k of fields){const v=patch[k];if(typeof v!=='number'||!Number.isFinite(v)||(k==='volume'?v<0:k==='change24h'?false:v<=0))continue;
  if(clocks[k]!==null&&receivedAt<clocks[k]!)continue;
  result[k]=v;clocks[k]=receivedAt;
 }
 // Legacy receivedAt remains a conservative quote receipt, never a statistics clock.
 result.receivedAt=clocks.bid!==null&&clocks.ask!==null?Math.min(clocks.bid,clocks.ask):0;
 return result;
}
/** No inference of per-field receipt clocks from legacy snapshots or exchange event times. */
export function tickerAges(ticker:MarketTicker|undefined,now:number):{tickerAgeMs:number|null;tickerFieldAgeMs?:Record<TickerField,number|null>}{
 if(!ticker)return {tickerAgeMs:null};
 const age=(at:unknown)=>time(now)&&time(at)&&at<=now?now-at:null;
 if(!ticker.fieldReceivedAt)return {tickerAgeMs:age(ticker.receivedAt)};
 const ages=Object.fromEntries(fields.map(k=>[k,age(ticker.fieldReceivedAt![k])])) as Record<TickerField,number|null>;
 return {tickerAgeMs:fields.every(k=>ages[k]!==null)?Math.max(...fields.map(k=>ages[k]!)):null,tickerFieldAgeMs:ages};
}
