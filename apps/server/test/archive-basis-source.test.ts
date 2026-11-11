import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {
 fetchPublicPerpetualMarks,readSpotArchiveClose,spotPerpetualBasisAt,
 type HistoricalSpotClose,type HistoricalPerpetualMark,type MarkFetcher
} from '../src/archive/basis-source.js';

const DAY=86_400_000;
const day=Date.UTC(2022,6,5);
const close=day+DAY;
const symbol='BTCUSDT';
const mark=(price:number,received=close+100):HistoricalPerpetualMark=>({
 symbol,dayMs:day,close:price,closeAtMs:close,firstReceivedAtMs:received,
 originalPublishedAtMs:null,source:'binance-usdm-public-mark-price-klines'
});
const spot=(price:number,received=close+60):HistoricalSpotClose=>({
 symbol,dayMs:day,close:price,closeAtMs:close,firstReceivedAtMs:received,
 source:'binance-spot-archive'
});
const kline=(start:number,price:string)=>[start,'100','102','98',price,'0',start+DAY-1,
 '0',0,'0','0','0'];
async function withTemporaryCache<T>(fn:(path:string)=>Promise<T>):Promise<T>{
 const path=mkdtempSync(join(tmpdir(),'spot-perp-fixtures-'));
 try{return await fn(path);}finally{rmSync(path,{recursive:true,force:true});}
}
const goodResponse=(start:number):MarkFetcher=>async()=>({
 status:200,ok:true,json:async()=>[kline(start,'100.50')]
});

test('aligned closed Spot and mark-price candles reproduce exact arithmetic, not executed arbitrage',()=>{
 const a=spotPerpetualBasisAt(symbol,close+150,spot(100),mark(100.5));
 expect(a.status).toBe('known');
 expect(a.basisPct).toBeCloseTo(.005,12);
 expect(a.basisBps).toBeCloseTo(50,10);
 expect(a.spotCloseAtMs).toBe(close);
 expect(a.perpetualCloseAtMs).toBe(close);
 expect(a.spotReceivedAtMs).toBe(close+60);
 expect(a.perpetualReceivedAtMs).toBe(close+100);
 expect(a.note).toContain('no executable futures trade');
 expect(spotPerpetualBasisAt(symbol,close+150,spot(100),mark(100.5))).toEqual(a);
});

test('late perpetual receipt never leaks backward into completed historical Spot signal',()=>{
 const before=spotPerpetualBasisAt(symbol,close+80,spot(100),mark(101,close+1000));
 expect(before.status).toBe('unknown');
 expect(before.basisPct).toBeNull();
 const after=spotPerpetualBasisAt(symbol,close+1001,spot(100),mark(101,close+1000));
 expect(after.status).toBe('known');
 expect(after.basisBps).toBeCloseTo(100,10);
 // Fetching historical marks today cannot certify their past availability.
 const backfilled=spotPerpetualBasisAt(symbol,close+500,spot(100),mark(101,Date.UTC(2026,10,7)));
 expect(backfilled.status).toBe('unknown');
});

test('missing Spot day, unsupported symbol, future price, or inconsistent UTC day fail closed',()=>{
 expect(spotPerpetualBasisAt(symbol,close+150,null,mark(100.5)).status).toBe('unknown');
 expect(spotPerpetualBasisAt(symbol,close+150,spot(100),null).status).toBe('unknown');
 expect(spotPerpetualBasisAt(symbol,close-1,spot(100),mark(100.5)).status).toBe('unknown');
 expect(spotPerpetualBasisAt(symbol,close+150,spot(100),{...mark(100.5),symbol:'ETHUSDT'}).status).toBe('unknown');
 expect(spotPerpetualBasisAt(symbol,close+150,spot(100),{...mark(100.5),dayMs:day+DAY}).status).toBe('unknown');
 expect(spotPerpetualBasisAt(symbol,close+150,spot(0),mark(100.5)).status).toBe('unknown');
 expect(spotPerpetualBasisAt(symbol,close+150,spot(100),{...mark(100.5),firstReceivedAtMs:close-10}).status).toBe('unknown');
});

test('real Spot archive CandleSource is read only after complete UTC candle close',async()=>{
 const requests:unknown[][]=[];
 const source={
  getCandles:async(...args:[string,15|60|240|1440,number,number])=>{
   requests.push(args);
   return [{ts:day,open:99,high:103,low:98,close:100,volume:5}];
  }
 };
 const result=await readSpotArchiveClose(source,symbol,day,close+60);
 expect(requests).toEqual([[symbol,1440,day,close]]);
 expect(result).toEqual(spot(100));
 expect(spotPerpetualBasisAt(symbol,close+150,result,mark(100.5)).basisBps).toBeCloseTo(50,10);
 const missing=await readSpotArchiveClose({getCandles:async()=>[]},symbol,day,close+60);
 expect(missing).toBeNull();
 await expect(readSpotArchiveClose(source,symbol,day,close-1)).rejects.toThrow();
});

test('public Mark-price GET is strictly budgeted and resumes only verified immutable daily cache',async()=>{
 await withTemporaryCache(async cacheDir=>{
  let calls=0;
  const fetcher:MarkFetcher=async url=>{
   calls++;
   expect(url).toContain('/fapi/v1/markPriceKlines?symbol=BTCUSDT');
   expect(url).toContain('interval=1d');
   const from=Number(new URL(url).searchParams.get('startTime'));
   return {status:200,ok:true,json:async()=>[kline(from,'100.50')]};
  };
  const received=Date.UTC(2026,10,7);
  const first=await fetchPublicPerpetualMarks(symbol,day,day+2*DAY,{
   cacheDir,maxRequests:1,receiptClock:()=>received,fetcher
  });
  expect(first.status).toBe('partial');
  expect(first.attemptedRequests).toBe(1);
  expect(first.unknownDays).toEqual([day+DAY]);
  expect(calls).toBe(1);
  const second=await fetchPublicPerpetualMarks(symbol,day,day+2*DAY,{
   cacheDir,maxRequests:1,receiptClock:()=>received,fetcher
  });
  expect(second.status).toBe('retrieved');
  expect(second.marks).toHaveLength(2);
  expect(calls).toBe(2);
  const noFetch=await fetchPublicPerpetualMarks(symbol,day,day+2*DAY,{
   cacheDir,maxRequests:0,fetcher:async()=>{throw Error('cache should be read-only');}
  });
  expect(noFetch.status).toBe('retrieved');
  expect(noFetch.marks).toEqual(second.marks);
  expect(spotPerpetualBasisAt(symbol,close+150,spot(100),noFetch.marks[0]!).status)
   .toBe('unknown');
 });
});

test('429/418/empty and conflicting marks never create a historical signal',async()=>{
 for(const response of [
  {status:429,ok:false,json:async()=>[]},
  {status:418,ok:false,json:async()=>[]},
  {status:200,ok:true,json:async()=>[]},
  {status:200,ok:true,json:async()=>[kline(day+DAY,'100')]},
  {status:200,ok:true,json:async()=>[kline(day,'not-a-price')]}
 ]){
  await withTemporaryCache(async cacheDir=>{
   let calls=0;
   const out=await fetchPublicPerpetualMarks(symbol,day,day+2*DAY,{
    cacheDir,maxRequests:3,receiptClock:()=>Date.UTC(2026,10,7),
    fetcher:async()=>{calls++;return response;}
   });
   expect(calls).toBe(1);
   expect(out.status).toBe('unknown');
   expect(out.marks).toHaveLength(0);
   expect(out.unknownDays).toEqual([day,day+DAY]);
  });
 }
});

test('tampering with cached mark refuses a silent overwrite or fabricated price',async()=>{
 await withTemporaryCache(async cacheDir=>{
  await fetchPublicPerpetualMarks(symbol,day,close,{
   cacheDir,maxRequests:1,receiptClock:()=>Date.UTC(2026,10,7),
   fetcher:goodResponse(day)
  });
  const file=join(cacheDir,symbol,'2022-07-05.json');
  const previous=readFileSync(file,'utf8');
  writeFileSync(file,previous.replace('"close": 100.5','"close": 999.5'));
  const result=await fetchPublicPerpetualMarks(symbol,day,close,{
   cacheDir,maxRequests:1,
   fetcher:async()=>{throw Error('must not try to repair a modified page');}
  });
  expect(result.status).toBe('unknown');
  expect(result.attemptedRequests).toBe(0);
  expect(result.marks).toHaveLength(0);
  expect(readFileSync(file,'utf8')).not.toBe(previous);
 });
});

test('2024 validation, 2025+ holdout and unaligned time windows are never downloaded',async()=>{
 await withTemporaryCache(async cacheDir=>{
  for(const [from,to] of [
   [Date.UTC(2024,0,1),Date.UTC(2024,0,2)],
   [Date.UTC(2025,0,1),Date.UTC(2025,0,2)],
   [day+1,day+DAY]
  ] as const){
   await expect(fetchPublicPerpetualMarks(symbol,from,to,{
    cacheDir,fetcher:async()=>{throw Error('forbidden request');}
   })).rejects.toThrow('2020-2023');
  }
 });
});
