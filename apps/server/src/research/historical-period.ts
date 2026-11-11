import type {Candle} from '@paper/shared';
import {parseKlines} from '../market/binance-data.js';
import type {ReplayMarket} from './portfolio.js';
export type HistoricalPeriod={id:string;fromTs:number;toExclusive:number;warmupDays:number};
export function historicalPeriodPlan(period:HistoricalPeriod,now=Date.now()){
 const {id,fromTs,toExclusive,warmupDays}=period,day=86400000,step=900000;
 if(!/^[0-9]{4}-[0-9]{2}$/.test(id)||![fromTs,toExclusive,now].every(Number.isSafeInteger)||fromTs%day!==0||toExclusive%day!==0||fromTs<0||toExclusive<=fromTs||toExclusive>now||!Number.isInteger(warmupDays)||warmupDays<8||warmupDays>30||(toExclusive-fromTs)/day>90||fromTs<warmupDays*day)throw Error('Invalid bounded closed historical period');
 if(new Date(fromTs).toISOString().slice(0,7)!==id)throw Error('Historical period identity/date mismatch');
 const fromWithWarmup=fromTs-warmupDays*day;return {fromWithWarmup,toExclusive,step,days:(toExclusive-fromWithWarmup)/day,expectedBars:(toExclusive-fromWithWarmup)/step};
}
/** Strict wrapper around the existing public parser: no silently dropped malformed rows,
 * conflicting duplicates, wrong close-times or out-of-request observations enter a study. */
export function strictHistoricalPage(pair:string,from:number,toInclusive:number,asOf:number,raw:unknown):Candle[]{
 if(!/^[A-Z0-9]{1,24}\/EUR$/.test(pair)||![from,toInclusive,asOf].every(Number.isSafeInteger)||from%900000!==0||toInclusive<from||toInclusive>=asOf||!Array.isArray(raw)||raw.length>1000)throw Error('Invalid historical page bounds/payload');
 const rows=parseKlines(pair,15,raw,asOf);if(rows.length!==raw.length)throw Error('Malformed historical candle was not accepted');
 if(rows.some((c,i)=>c.ts<from||c.ts>toInclusive||!Number.isSafeInteger(c.ts)||i>0&&c.ts<=rows[i-1]!.ts||Number((raw[i] as unknown[])[6])!==c.ts+899999))throw Error('Historical page duplicate/order/range/close-time mismatch');
 return rows;
}
export function historicalReplayMarket(metadata:{symbol:string;lotDecimals:number;ordermin:number;costmin:number},candles:Candle[],period:HistoricalPeriod,now=Date.now()):ReplayMarket{
 const plan=historicalPeriodPlan(period,now),{symbol,lotDecimals,ordermin,costmin}=metadata;
 if(!Number.isInteger(lotDecimals)||lotDecimals<0||lotDecimals>12||![ordermin,costmin].every(v=>Number.isFinite(v)&&v>=0)||candles.length!==plan.expectedBars)throw Error('Incomplete historical market or invalid assumed metadata');
 const rows=strictHistoricalPage;
 // Chunk validation retains the existing parser limits while requiring every expected grid point.
 for(let i=0;i<candles.length;i+=1000){const chunk=candles.slice(i,i+1000);if(chunk.some(c=>c.pair!==symbol||c.interval!==15))throw Error('Mixed historical market/interval');rows(symbol,plan.fromWithWarmup,plan.toExclusive-1,plan.toExclusive,chunk.map(c=>[c.ts,c.open,c.high,c.low,c.close,c.volume,c.ts+899999]));}
 if(candles.some((c,i)=>c.ts!==plan.fromWithWarmup+i*plan.step))throw Error('Historical grid missing/conflicting; no padding or asset exclusion');
 return {pair:symbol,lotDecimals,minQty:ordermin,minOrderQuote:costmin,candles:candles.map(c=>({...c}))};
}
