import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import type {CandleSource} from './candle-source.js';
import {ARCHIVE_ROOT} from './paths.js';

const DAY=86_400_000;
const FIRST=Date.UTC(2020,0,1),LAST=Date.UTC(2024,0,1);
const URL_ROOT='https://fapi.binance.com/fapi/v1/markPriceKlines';
const SYMBOL=/^[A-Z0-9]{2,20}USDT$/;
const validClock=(x:number)=>Number.isSafeInteger(x)&&x>=0;
const validPrice=(x:number)=>Number.isFinite(x)&&x>0;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export type HistoricalSpotClose={
 symbol:string;dayMs:number;close:number;closeAtMs:number;
 /** The first independently evidenced local receipt; never guessed from date. */
 firstReceivedAtMs:number;
 source:'binance-spot-archive';
};
export type HistoricalPerpetualMark={
 symbol:string;dayMs:number;close:number;closeAtMs:number;
 firstReceivedAtMs:number;
 /** REST history contains no provable original publication timestamp. */
 originalPublishedAtMs:null;
 source:'binance-usdm-public-mark-price-klines';
};
type PerpetualMarkPage={
 schema:'perp-mark-receipt-v1';
 symbol:string;dayMs:number;sourceUrl:string;receivedAtMs:number;
 originalPublicationVerified:false;
 mark:HistoricalPerpetualMark;
 hash:string;
};
export type BasisReport={
 version:'spot-perp-asof-basis-v1';
 status:'known'|'unknown';
 reason:string|null;symbol:string;decisionAtMs:number;
 spotCloseAtMs:number|null;perpetualCloseAtMs:number|null;
 spotReceivedAtMs:number|null;perpetualReceivedAtMs:number|null;
 basisPct:number|null;basisBps:number|null;
 fingerprint:string;
 note:string;
};
export type PerpetualMarkCoverage={
 version:'perp-mark-public-coverage-v1';
 status:'retrieved'|'partial'|'unknown';
 symbol:string;fromMs:number;toMs:number;
 attemptedRequests:number;retrievedDays:number;
 unknownDays:number[];
 marks:HistoricalPerpetualMark[];
 fingerprint:string;
 issues:string[];
};
export type MarkFetcher=(url:string)=>Promise<{ok:boolean;status:number;json():Promise<unknown>}>;
export type MarkOptions={
 cacheDir?:string;maxRequests?:number;fetcher?:MarkFetcher;receiptClock?:()=>number
};
const query=(symbol:string,day:number)=>URL_ROOT+'?symbol='+symbol+
 '&interval=1d&startTime='+day+'&endTime='+(day+DAY-1)+'&limit=1';
function parseMark(raw:unknown,symbol:string,day:number,receivedAtMs:number):PerpetualMarkPage {
 if(!Array.isArray(raw)||raw.length!==1||!Array.isArray(raw[0])||raw[0].length<7)
  throw Error('Missing or incomplete public mark-price daily candle');
 const row=raw[0] as unknown[];
 const open=row[0],close=row[4],end=row[6];
 const price=typeof close==='string'?Number(close):NaN;
 if(open!==day||end!==day+DAY-1||typeof close!=='string'||
   !/^\d+(?:\.\d+)?$/.test(close)||!validPrice(price)||
   !validClock(receivedAtMs)||receivedAtMs<day+DAY)
  throw Error('Mark-price close time, price or actual reception unknown');
 const mark:HistoricalPerpetualMark={
  symbol,dayMs:day,close:price,closeAtMs:day+DAY,firstReceivedAtMs:receivedAtMs,
  originalPublishedAtMs:null,source:'binance-usdm-public-mark-price-klines'
 };
 const payload={schema:'perp-mark-receipt-v1' as const,symbol,dayMs:day,
  sourceUrl:query(symbol,day),receivedAtMs,
  originalPublicationVerified:false as const,mark};
 return {...payload,hash:digest(payload)};
}
function validateCachedPage(raw:string,symbol:string,day:number):PerpetualMarkPage {
 const candidate=JSON.parse(raw) as PerpetualMarkPage;
 if(!candidate||candidate.schema!=='perp-mark-receipt-v1'||
   candidate.symbol!==symbol||candidate.dayMs!==day||
   candidate.originalPublicationVerified!==false||
   candidate.sourceUrl!==query(symbol,day)||
   !validClock(candidate.receivedAtMs)||
   candidate.mark?.symbol!==symbol||candidate.mark.dayMs!==day||
   candidate.mark.closeAtMs!==day+DAY||
   candidate.mark.firstReceivedAtMs!==candidate.receivedAtMs||
   candidate.mark.originalPublishedAtMs!==null||
   !validPrice(candidate.mark.close)||
   candidate.mark.source!=='binance-usdm-public-mark-price-klines'||
   !candidate.hash||candidate.hash.length!==64||
   candidate.hash!==digest({
    schema:candidate.schema,symbol:candidate.symbol,dayMs:candidate.dayMs,
    sourceUrl:candidate.sourceUrl,receivedAtMs:candidate.receivedAtMs,
    originalPublicationVerified:candidate.originalPublicationVerified,mark:candidate.mark
   }))throw Error('Invalid or modified immutable perpetual mark evidence');
 return candidate;
}
/**
 * Only explicitly requested public read-only market-data pages, never an
 * account/order API. Missing days and rate limits are n/a, not zero basis.
 */
export async function fetchPublicPerpetualMarks(
 symbol:string,fromMs:number,toMs:number,options:MarkOptions={}
):Promise<PerpetualMarkCoverage>{
 if(!SYMBOL.test(symbol)||!validClock(fromMs)||!validClock(toMs)||
   fromMs%DAY!==0||toMs%DAY!==0||fromMs<FIRST||toMs>LAST||
   toMs<=fromMs||toMs-fromMs>366*DAY)
  throw Error('Mark-price research restricted to whole UTC days during 2020-2023');
 const budget=options.maxRequests??24;
 if(!Number.isSafeInteger(budget)||budget<0||budget>24)throw Error('Invalid public request budget');
 const dir=resolve(options.cacheDir??join(ARCHIVE_ROOT,'perp-mark'));
 const fetcher=options.fetcher??(async(url:string)=>fetch(url));
 const clock=options.receiptClock??Date.now;
 const marks:HistoricalPerpetualMark[]=[],unknownDays:number[]=[],issues:string[]=[];
 let requests=0,halted=false;
 for(let day=fromMs;day<toMs;day+=DAY){
  const filename=join(dir,symbol,new Date(day).toISOString().slice(0,10)+'.json');
  let page:PerpetualMarkPage|null=null;
  if(existsSync(filename)){
   try{page=validateCachedPage(readFileSync(filename,'utf8'),symbol,day);}
   catch{issues.push('Immutable mark cache failed validation: '+day);}
  }else if(!halted&&requests<budget){
   requests++;
   try{
    const result=await fetcher(query(symbol,day));
    if(result.status===429||result.status===418){
     halted=true;issues.push('Public rate limit; no retry or synthetic backfill.');
    }else if(!result.ok){
     halted=true;issues.push('Public mark-price history unavailable: '+result.status);
    }else{
     const received=clock();
     page=parseMark(await result.json(),symbol,day,received);
     mkdirSync(join(dir,symbol),{recursive:true});
     writeFileSync(filename,JSON.stringify(page,null,2)+'\n',{flag:'wx'});
    }
   }catch{
    halted=true;issues.push('Public mark response or immutable cache write failed.');
   }
  }
  if(page)marks.push(page.mark);else unknownDays.push(day);
 }
 if(unknownDays.length&&requests>=budget&&!halted)
  issues.push('Request budget exhausted; remaining UTC days unknown.');
 const status:PerpetualMarkCoverage['status']=unknownDays.length?
   (marks.length?'partial':'unknown'):'retrieved';
 const payload={version:'perp-mark-public-coverage-v1' as const,status,symbol,
  fromMs,toMs,attemptedRequests:requests,retrievedDays:marks.length,
  unknownDays,marks,issues:[...new Set(issues)]};
 return {...payload,fingerprint:digest(payload)};
}
/** Reading historical Spot OHLC now does NOT establish its former receipt time. */
export async function readSpotArchiveClose(
 source:Pick<CandleSource,'getCandles'>,symbol:string,dayMs:number,nowMs:number
):Promise<HistoricalSpotClose|null>{
 if(!SYMBOL.test(symbol)||!validClock(dayMs)||dayMs%DAY!==0||
   dayMs<FIRST||dayMs>=LAST||!validClock(nowMs)||nowMs<dayMs+DAY)
  throw Error('Invalid completed Spot archive lookup');
 const bars=await source.getCandles(symbol,1440,dayMs,dayMs+DAY);
 if(bars.length!==1||bars[0]!.ts!==dayMs||!validPrice(bars[0]!.close))
  return null;
 return {symbol,dayMs,close:bars[0]!.close,closeAtMs:dayMs+DAY,
  firstReceivedAtMs:nowMs,source:'binance-spot-archive'};
}
/**
 * Only synchronous already-closed spot/perp observations known at cutoff.
 * Never permit a late-received perpetual mark to create an earlier signal.
 * Basis = (perp mark close - Spot close) / Spot close; not a trading PnL.
 */
export function spotPerpetualBasisAt(
 symbol:string,decisionAtMs:number,
 spot:HistoricalSpotClose|null,perp:HistoricalPerpetualMark|null
):BasisReport{
 if(!SYMBOL.test(symbol)||!validClock(decisionAtMs))
  throw Error('Invalid as-of Spot-perpetual basis request');
 const base={version:'spot-perp-asof-basis-v1' as const,symbol,decisionAtMs,
  spotCloseAtMs:spot?.closeAtMs??null,
  perpetualCloseAtMs:perp?.closeAtMs??null,
  spotReceivedAtMs:spot?.firstReceivedAtMs??null,
  perpetualReceivedAtMs:perp?.firstReceivedAtMs??null,
  note:'Public mark-price vs Spot close, descriptive only: no executable futures trade, funding cashflow, margin or realized arbitrage.'};
 const result=(reason:string|null,basisPct:number|null):BasisReport=>{
  const data={...base,status:basisPct===null?'unknown' as const:'known' as const,
   reason,basisPct,basisBps:basisPct===null?null:basisPct*10_000};
  return {...data,fingerprint:digest(data)};
 };
 if(!spot||!perp)return result('Spot or perpetual observation missing.',null);
 if(spot.symbol!==symbol||perp.symbol!==symbol||
   spot.source!=='binance-spot-archive'||
   perp.source!=='binance-usdm-public-mark-price-klines'||
   perp.originalPublishedAtMs!==null||
   !validClock(spot.dayMs)||spot.dayMs%DAY!==0||
   spot.dayMs<FIRST||spot.dayMs>=LAST||
   spot.dayMs!==perp.dayMs||
   spot.closeAtMs!==spot.dayMs+DAY||
   perp.closeAtMs!==spot.closeAtMs||
   !validPrice(spot.close)||!validPrice(perp.close)||
   !validClock(spot.firstReceivedAtMs)||!validClock(perp.firstReceivedAtMs)||
   spot.firstReceivedAtMs<spot.closeAtMs||
   perp.firstReceivedAtMs<perp.closeAtMs)
  return result('Cross-symbol, misaligned, invalid or historically unverified observations.',null);
 if(decisionAtMs<spot.closeAtMs||
   decisionAtMs<spot.firstReceivedAtMs||
   decisionAtMs<perp.firstReceivedAtMs)
  return result('Decision predates completed candle or verified receipt of either market.',null);
 const value=(perp.close-spot.close)/spot.close;
 if(!Number.isFinite(value))return result('Unrepresentable price basis.',null);
 return result(null,value);
}
