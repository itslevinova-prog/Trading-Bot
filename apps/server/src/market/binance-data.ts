import type {Candle,OrderBook} from '@paper/shared';

export const PUBLIC_BINANCE='https://data-api.binance.vision';
export type BinanceFilter={filterType:string;minQty?:string;maxQty?:string;stepSize?:string;tickSize?:string;minPrice?:string;maxPrice?:string;minNotional?:string;maxNotional?:string;applyToMarket?:boolean;applyMinToMarket?:boolean;applyMaxToMarket?:boolean;avgPriceMins?:number};
export type BinanceSymbol={symbol:string;status:string;baseAsset:string;quoteAsset:string;baseAssetPrecision:number;quoteAssetPrecision:number;isSpotTradingAllowed?:boolean;orderTypes:string[];filters:BinanceFilter[];ocoAllowed?:boolean;otoAllowed?:boolean;opoAllowed?:boolean};
export const decimals=(value:string)=>Math.max(0,(value.replace(/0+$/,'').split('.')[1]??'').length);
export function parseKlines(pair:string,interval:number,rows:unknown,now=Date.now()):Candle[]{
 if(!Array.isArray(rows))throw Error('Ungültige Kline-Antwort');
 return rows.flatMap(row=>{
  if(!Array.isArray(row)||row.length<7)return [];
  const c={pair,interval,ts:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5])};
  if(!Object.values(c).filter(x=>typeof x==='number').every(Number.isFinite)||c.ts<0||c.ts%(interval*60000)!==0||c.ts+interval*60000>now||c.low<=0||c.volume<0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close))return [];
  return [c];
 });
}
export function partialBook(symbol:string,data:{bids?:unknown;asks?:unknown},receivedAt=Date.now()):OrderBook{
 const parse=(rows:unknown)=>Array.isArray(rows)?rows.flatMap(row=>Array.isArray(row)&&row.length>=2&&Number(row[0])>0&&Number(row[1])>0&&Number.isFinite(Number(row[0]))&&Number.isFinite(Number(row[1]))?[{price:String(row[0]),qty:String(row[1])}]:[]):[];
 const bids=parse(data.bids).sort((a,b)=>Number(b.price)-Number(a.price)),asks=parse(data.asks).sort((a,b)=>Number(a.price)-Number(b.price));
 const complete=Array.isArray(data.bids)&&Array.isArray(data.asks)&&bids.length===data.bids.length&&asks.length===data.asks.length&&new Set(bids.map(x=>Number(x.price))).size===bids.length&&new Set(asks.map(x=>Number(x.price))).size===asks.length;
 return {symbol,bids,asks,receivedAt,valid:complete&&!!bids.length&&!!asks.length&&Number(bids[0]!.price)<Number(asks[0]!.price)};
}
/** Public GET only; no keys, redirects, or implicit fallback to a different venue. */
export async function publicRequest<T>(path:string,params:Record<string,string>={},base=PUBLIC_BINANCE):Promise<T>{
 const url=new URL(path,base);for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
 const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!response.ok)throw Error(`Binance public HTTP ${response.status}; Retry-After ${response.headers.get('retry-after')??'unknown'}`);
 return response.json() as Promise<T>;
}
