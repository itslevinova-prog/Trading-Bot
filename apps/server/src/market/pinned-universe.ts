import {decimals,type BinanceSymbol} from './binance-data.js';
export type PublicPairTicker={symbol:string;quoteVolume:string;bidPrice:string;askPrice:string;lastPrice:string;volume:string;priceChangePercent:string};
const excluded=new Set(['USDT','USDC','FDUSD','TUSD','DAI','USDP','EUR','EURI','USD1','USDE','PAXG','XAUT']);
export function parseFixedPairs(raw:string):string[]{
 if(raw==='')return [];
 const value:unknown=JSON.parse(raw);
 if(!Array.isArray(value)||!value.length||value.length>80||value.some(p=>typeof p!=='string'||!/^([A-Z0-9]{1,20})\/(EUR|USDT|USDC)$/.test(p))||new Set(value).size!==value.length)throw Error('Fixed pairs must be1..80unique uppercase spot pair names');
 return [...value].sort();
}
/** Empty pins preserve the existing volume selector. Fixed pins never replace metadata with stale seed rows. */
export function selectBinanceUniverse(info:BinanceSymbol[],ticks:PublicPairTicker[],options:{quote:string;topN:number;held:string[];fixed:string[]}){
 const {quote,topN,held,fixed}=options,eligible=info.filter(s=>s.status==='TRADING'&&s.isSpotTradingAllowed!==false&&s.quoteAsset===quote&&!excluded.has(s.baseAsset)&&s.orderTypes.includes('MARKET'));
 if(!fixed.length){
  const bySymbol=new Map(ticks.map(t=>[t.symbol,t])),selected=eligible.map(s=>({s,t:bySymbol.get(s.symbol)})).filter(x=>Number(x.t?.quoteVolume)>0).sort((a,b)=>Number(b.t!.quoteVolume)-Number(a.t!.quoteVolume));
  const wanted=new Set(selected.slice(0,topN).map(x=>x.s.symbol));wanted.add(`BTC${quote}`);
  return selected.filter(({s})=>wanted.has(s.symbol)||held.includes(`${s.baseAsset}/${s.quoteAsset}`));
 }
 const pins=parseFixedPairs(JSON.stringify(fixed));
 if(!pins.includes(`BTC/${quote}`)||pins.some(p=>!p.endsWith('/'+quote))||held.some(p=>!pins.includes(p)))throw Error('Fixed universe quote/BTC/held membership mismatch');
 return pins.map(pair=>{
  const matches=eligible.filter(s=>`${s.baseAsset}/${s.quoteAsset}`===pair),s=matches[0];
  if(matches.length!==1||!s||s.isSpotTradingAllowed!==true||s.symbol!==s.baseAsset+s.quoteAsset)throw Error('Fixed symbol missing or no longer tradable: '+pair);
  const matchesTick=ticks.filter(t=>t.symbol===s.symbol),t=matchesTick[0];
  if(matchesTick.length!==1||!t||![t.quoteVolume,t.bidPrice,t.askPrice,t.lastPrice,t.volume,t.priceChangePercent].every(v=>typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v)))||Number(t.quoteVolume)<0||Number(t.volume)<0||Number(t.bidPrice)<=0||Number(t.askPrice)<Number(t.bidPrice)||Number(t.lastPrice)<=0)throw Error('Fixed symbol ticker unavailable/invalid: '+pair);
  const lot=s.filters.filter(f=>f.filterType==='LOT_SIZE'),price=s.filters.filter(f=>f.filterType==='PRICE_FILTER'),notional=s.filters.find(f=>f.filterType==='NOTIONAL'||f.filterType==='MIN_NOTIONAL');
  const supportedStep=(v:string|undefined)=>!!v&&Number.isFinite(Number(v))&&Number(v)>0&&decimals(v)<=18&&Math.abs(Number(v)*10**decimals(v)-1)<1e-12;
  if(lot.length!==1||price.length!==1||!supportedStep(lot[0]?.stepSize)||!supportedStep(price[0]?.tickSize)||!Number.isFinite(Number(lot[0]?.minQty))||Number(lot[0]?.minQty)<=0||!Number.isFinite(Number(notional?.minNotional))||Number(notional?.minNotional)<=0)throw Error('Fixed symbol supported trading limits unavailable: '+pair);
  return {s,t};
 });
}
