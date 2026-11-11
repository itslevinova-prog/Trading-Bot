import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {
 fetchFundingDevelopment,fundingKnownAt,type FundingFetcher
} from '../src/archive/funding-source.js';

const D=86_400_000;
const day=Date.UTC(2022,5,1);
const observed=Date.UTC(2026,10,7);
const symbol='BTCUSDT';
const funding=(at:number,rate='0.00010000')=>({
 symbol,fundingTime:at,fundingRate:rate,markPrice:'30101.50'
});
const source=(rows:unknown):FundingFetcher=>async()=>({
 ok:true,status:200,json:async()=>rows
});
async function temp<T>(fn:(path:string)=>Promise<T>):Promise<T>{
 const path=mkdtempSync(join(tmpdir(),'paper-funding-offline-'));
 try{return await fn(path);}finally{rmSync(path,{recursive:true,force:true});}
}

test('separates historical funding event time from real public receipt; future record never leaks into a past signal',async()=>{
 await temp(async cacheDir=>{
  const calls:string[]=[];
  const fetcher:FundingFetcher=async url=>{
   calls.push(url);
   return {ok:true,status:200,json:async()=>[funding(day+8*3_600_000),funding(day+16*3_600_000,'-0.00020000')]};
  };
  const r=await fetchFundingDevelopment(symbol,day,day+D,{
   cacheDir,maxRequests:1,firstReceivedAtMs:()=>observed,fetcher
  });
  expect(r.status).toBe('retrieved');
  expect(r.observations).toHaveLength(2);
  expect(r.observations[0]!.publicationAtMs).toBeNull();
  expect(r.observations[0]!.firstReceivedAtMs).toBe(observed);
  expect(r.historicAvailabilityVerified).toBe(false);
  expect(r.attemptedRequests).toBe(1);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain('startTime='+day);
  expect(calls[0]).toContain('endTime='+(day+D-1));
  expect(calls[0]).not.toContain('apiKey');
  expect(fundingKnownAt(r.observations,symbol,day+20*3_600_000).status).toBe('unknown');
  expect(fundingKnownAt(r.observations,symbol,observed)).toEqual({
   status:'known',observation:r.observations[1]
  });
  const rerun=await fetchFundingDevelopment(symbol,day,day+D,{
   cacheDir,maxRequests:0,firstReceivedAtMs:()=>observed,
   fetcher:async()=>{throw Error('cache must avoid any network request');}
  });
  expect(rerun.status).toBe('retrieved');
  expect(rerun.observations).toEqual(r.observations);
  expect(rerun.attemptedRequests).toBe(0);
 });
});

test('request budget is strict and interrupted downloads resume only on explicit next call',async()=>{
 await temp(async cacheDir=>{
  let called=0;
  const fetcher:FundingFetcher=async url=>{
   called++;
   const q=new URL(url);
   const start=Number(q.searchParams.get('startTime'));
   return {ok:true,status:200,json:async()=>[funding(start+8*3_600_000)]};
  };
  const first=await fetchFundingDevelopment(symbol,day,day+3*D,{
   cacheDir,maxRequests:1,firstReceivedAtMs:()=>observed,fetcher
  });
  expect(first.status).toBe('partial');
  expect(first.retrievedDays).toBe(1);
  expect(first.unknownDays).toEqual([day+D,day+2*D]);
  expect(called).toBe(1);
  const second=await fetchFundingDevelopment(symbol,day,day+3*D,{
   cacheDir,maxRequests:2,firstReceivedAtMs:()=>observed,fetcher
  });
  expect(second.status).toBe('retrieved');
  expect(second.retrievedDays).toBe(3);
  expect(second.unknownDays).toHaveLength(0);
  expect(second.observations).toHaveLength(3);
  expect(called).toBe(3);
  expect(readdirSync(join(cacheDir,symbol))).toHaveLength(3);
 });
});

test.each([
 ['429',{ok:false,status:429,json:async()=>[]}],
 ['418',{ok:false,status:418,json:async()=>[]}],
 ['unavailable',{ok:false,status:502,json:async()=>[]}]
] as const)('%s fails closed with no retry or manufactured point',async(_,response)=>{
 await temp(async cacheDir=>{
  let calls=0;
  const result=await fetchFundingDevelopment(symbol,day,day+2*D,{
   cacheDir,maxRequests:20,firstReceivedAtMs:()=>observed,
   fetcher:async()=>{calls++;return response;}
  });
  expect(calls).toBe(1);
  expect(result.status).toBe('unknown');
  expect(result.observations).toHaveLength(0);
  expect(result.unknownDays).toEqual([day,day+D]);
  expect(result.reasons.length).toBeGreaterThan(0);
 });
});

test('duplicate exchange events, empty pages and malformed rates are not cached as complete',async()=>{
 for(const rows of [
  [funding(day+8*3_600_000),funding(day+8*3_600_000)],
  [],
  [funding(day+8*3_600_000,'Infinity')],
  [funding(day+D,'0.0001')],
  [funding(day+8*3_600_000),funding(day+4*3_600_000)]
 ]){
  await temp(async cacheDir=>{
   const result=await fetchFundingDevelopment(symbol,day,day+D,{
    cacheDir,maxRequests:1,firstReceivedAtMs:()=>observed,
    fetcher:source(rows)
   });
   expect(result.status).toBe('unknown');
   expect(result.unknownDays).toEqual([day]);
   expect(result.observations).toHaveLength(0);
  });
 }
});

test('tampered immutable cache is rejected instead of re-downloaded or silently repaired',async()=>{
 await temp(async cacheDir=>{
  await fetchFundingDevelopment(symbol,day,day+D,{
   cacheDir,maxRequests:1,firstReceivedAtMs:()=>observed,
   fetcher:source([funding(day+8*3_600_000)])
  });
  const path=join(cacheDir,symbol,'2022-06-01.json');
  const content=readFileSync(path,'utf8');
  writeFileSync(path,content.replace('0.0001','0.9999'));
  const result=await fetchFundingDevelopment(symbol,day,day+D,{
   cacheDir,maxRequests:1,firstReceivedAtMs:()=>observed,
   fetcher:async()=>{throw Error('must not auto-replace corrupted evidence');}
  });
  expect(result.status).toBe('unknown');
  expect(result.unknownDays).toEqual([day]);
  expect(result.attemptedRequests).toBe(0);
  expect(readFileSync(path,'utf8')).not.toBe(content);
 });
});

test('holdout and non-UTC development windows are rejected without calling the network',async()=>{
 await temp(async cacheDir=>{
  const unavailable:FundingFetcher=async()=>{throw Error('unexpected network');};
  await expect(fetchFundingDevelopment(symbol,Date.UTC(2025,0,1),Date.UTC(2025,0,2),{
   cacheDir,fetcher:unavailable
  })).rejects.toThrow('2020-2023');
  await expect(fetchFundingDevelopment(symbol,day+1,day+D,{
   cacheDir,fetcher:unavailable
  })).rejects.toThrow('2020-2023');
  await expect(fetchFundingDevelopment('BTC/USDT',day,day+D,{
   cacheDir,fetcher:unavailable
  })).rejects.toThrow('2020-2023');
 });
});
