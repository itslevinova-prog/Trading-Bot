import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ARCHIVE_ROOT} from './paths.js';

const DAY=86_400_000;
const DEVELOPMENT_START=Date.UTC(2020,0,1);
const DEVELOPMENT_END=Date.UTC(2024,0,1);
const FUNDING_ENDPOINT='https://fapi.binance.com/fapi/v1/fundingRate';
const MAX_PAGE=500;

export type FundingObservation={
 symbol:string;
 fundingTimeMs:number;
 fundingRate:number;
 markPrice:number|null;
 /** Binance history does not include a verifiable original publication timestamp. */
 publicationAtMs:null;
 /** Actual first local receipt of this public historical API response. */
 firstReceivedAtMs:number;
 source:'binance-usdm-public-funding-history';
};
export type FundingPage={
 schema:'funding-public-receipt-v1';
 symbol:string;
 dayFromMs:number;
 dayToMs:number;
 sourceUrl:string;
 fetchedAtMs:number;
 publicationTimeVerified:false;
 observations:FundingObservation[];
 contentHash:string;
};
export type FundingCoverage={
 schema:'funding-coverage-v1';
 symbol:string;
 fromMs:number;
 toMs:number;
 status:'retrieved'|'partial'|'unknown';
 retrievedDays:number;
 unknownDays:number[];
 attemptedRequests:number;
 requestBudget:number;
 observations:FundingObservation[];
 fingerprint:string;
 reasons:string[];
 /** This historical fetch alone never proves historic as-of publication. */
 historicAvailabilityVerified:false;
};
export type FundingFetcher=(url:string)=>Promise<{status:number;ok:boolean;json():Promise<unknown>}>;
export type FundingOptions={
 cacheDir?:string;
 maxRequests?:number;
 firstReceivedAtMs?:()=>number;
 fetcher?:FundingFetcher;
};
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validClock=(x:number)=>Number.isSafeInteger(x)&&x>=0;
const symbolPattern=/^[A-Z0-9]{2,20}USDT$/;
const validRate=(x:string)=>/^-?(?:0|[0-9]+)(?:\.[0-9]{1,16})?$/.test(x)&&Number.isFinite(Number(x))&&Math.abs(Number(x))<=1;
const validPrice=(x:unknown)=>typeof x==='string'&&/^[0-9]+(?:\.[0-9]{1,16})?$/.test(x)&&
 Number.isFinite(Number(x))&&Number(x)>0;
const fileFor=(cacheDir:string,symbol:string,day:number)=>
 join(cacheDir,symbol,new Date(day).toISOString().slice(0,10)+'.json');
function normalizePage(raw:unknown,symbol:string,day:number,receivedAt:number):FundingPage {
 if(!Array.isArray(raw)||raw.length===0||raw.length>=MAX_PAGE)
  throw Error('Unknown or truncated public funding window');
 const observations:FundingObservation[]=[];
 let previous=-1;
 for(const item of raw){
  if(!item||typeof item!=='object')throw Error('Invalid public funding record');
  const row=item as Record<string,unknown>;
  if(row.symbol!==symbol||!validClock(row.fundingTime as number)||
    (row.fundingTime as number)<day||(row.fundingTime as number)>=day+DAY||
    (row.fundingTime as number)<=previous||
    (row.fundingTime as number)>receivedAt||
    typeof row.fundingRate!=='string'||!validRate(row.fundingRate)||
    row.markPrice!==undefined&&!validPrice(row.markPrice))
    throw Error('Funding conflict, duplicate, future event or invalid rate');
  previous=row.fundingTime as number;
  observations.push({
    symbol,fundingTimeMs:previous,fundingRate:Number(row.fundingRate),
    markPrice:row.markPrice===undefined?null:Number(row.markPrice),
    publicationAtMs:null,firstReceivedAtMs:receivedAt,
    source:'binance-usdm-public-funding-history'
  });
 }
 const payload={
  schema:'funding-public-receipt-v1' as const,symbol,
  dayFromMs:day,dayToMs:day+DAY,
  sourceUrl:FUNDING_ENDPOINT+'?symbol='+symbol+'&startTime='+day+
    '&endTime='+(day+DAY-1)+'&limit='+MAX_PAGE,
  fetchedAtMs:receivedAt,
  publicationTimeVerified:false as const,observations
 };
 return {...payload,contentHash:hash(payload)};
}
function verifiedPage(json:string,symbol:string,day:number):FundingPage {
 const page=JSON.parse(json) as FundingPage;
 if(!page||page.schema!=='funding-public-receipt-v1'||page.symbol!==symbol||
   page.dayFromMs!==day||page.dayToMs!==day+DAY||
   !validClock(page.fetchedAtMs)||page.publicationTimeVerified!==false||
   !Array.isArray(page.observations)||!page.observations.length||
   typeof page.contentHash!=='string'||page.contentHash.length!==64)
  throw Error('Cached funding evidence is inconsistent');
 const expected=normalizePage(page.observations.map(x=>({
  symbol:x.symbol,fundingTime:x.fundingTimeMs,
  fundingRate:x.fundingRate.toString(),
  ...(x.markPrice===null?{}:{markPrice:x.markPrice.toString()})
 })),symbol,day,page.fetchedAtMs);
 // Verify both the original response URL and the full immutable evidence digest.
 if(page.sourceUrl!==expected.sourceUrl||page.contentHash!==hash({
  schema:page.schema,symbol:page.symbol,dayFromMs:page.dayFromMs,
  dayToMs:page.dayToMs,sourceUrl:page.sourceUrl,
  fetchedAtMs:page.fetchedAtMs,publicationTimeVerified:page.publicationTimeVerified,
  observations:page.observations
 })||JSON.stringify(page.observations)!==JSON.stringify(expected.observations))
  throw Error('Cached funding integrity check failed');
 return page;
}
/**
 * Explicit, budgeted read of the *public* funding-history endpoint, never an
 * order/account API. Offline tests inject the fetcher. Only UTC development
 * days 2020-2023 are accepted; cached pages are immutable and reusable.
 */
export async function fetchFundingDevelopment(
 symbol:string,fromMs:number,toMs:number,options:FundingOptions={}
):Promise<FundingCoverage> {
 if(!symbolPattern.test(symbol)||!validClock(fromMs)||!validClock(toMs)||
   fromMs%DAY!==0||toMs%DAY!==0||
   fromMs<DEVELOPMENT_START||toMs>DEVELOPMENT_END||toMs<=fromMs||
   toMs-fromMs>366*DAY)
  throw Error('Funding source restricted to a bounded, whole-UTC-day 2020-2023 window');
 const cacheDir=resolve(options.cacheDir??join(ARCHIVE_ROOT,'funding'));
 const budget=options.maxRequests??24;
 if(!Number.isSafeInteger(budget)||budget<0||budget>24)
  throw Error('Invalid public funding request budget');
 const fetcher=options.fetcher??(async(url:string)=>fetch(url));
 const clock=options.firstReceivedAtMs??Date.now;
 const observations:FundingObservation[]=[],unknownDays:number[]=[],reasons:string[]=[];
 let attemptedRequests=0,retrievedDays=0,halted=false;
 for(let day=fromMs;day<toMs;day+=DAY){
  const path=fileFor(cacheDir,symbol,day);
  let page:FundingPage|null=null;
  if(existsSync(path)){
   try{page=verifiedPage(readFileSync(path,'utf8'),symbol,day);}
   catch{unknownDays.push(day);reasons.push('Cached funding page failed integrity check: '+day);continue;}
  }else if(!halted&&attemptedRequests<budget){
   attemptedRequests++;
   const endpoint=FUNDING_ENDPOINT+'?symbol='+symbol+'&startTime='+day+
      '&endTime='+(day+DAY-1)+'&limit='+MAX_PAGE;
   try{
    const response=await fetcher(endpoint);
    if(response.status===429||response.status===418){
     halted=true;
     reasons.push('Public Binance rate limit; stop without retry or fabricated rows.');
    }else if(!response.ok){
     halted=true;reasons.push('Public funding endpoint unavailable: HTTP '+response.status);
    }else{
     const received=clock();
     if(!validClock(received)||received<day+DAY)
      throw Error('Unknown or historically impossible receipt time');
     page=normalizePage(await response.json(),symbol,day,received);
     // Never replace older evidence. Explicit read-only verification on resumed runs.
     mkdirSync(join(cacheDir,symbol),{recursive:true});
     writeFileSync(path,JSON.stringify(page,null,2)+'\n',{flag:'wx'});
    }
   }catch{
    halted=true;
    reasons.push('Funding fetch, parse or immutable cache write failed; no silent retry.');
   }
  }
  if(page){
   retrievedDays++;observations.push(...page.observations);
  }else{
   unknownDays.push(day);
   if(attemptedRequests>=budget&&!halted)reasons.push('Request budget exhausted; resume in another explicit call.');
  }
 }
 const status:FundingCoverage['status']=unknownDays.length?
   (retrievedDays?'partial':'unknown'):'retrieved';
 const payload={schema:'funding-coverage-v1' as const,symbol,fromMs,toMs,status,
  retrievedDays,unknownDays,attemptedRequests,requestBudget:budget,observations,
  reasons:[...new Set(reasons)],historicAvailabilityVerified:false as const};
 return {...payload,fingerprint:hash(payload)};
}

/**
 * No backdating from a funding event to a historical signal is permitted.
 * Only a funding observation first actually RECEIVED by cutoff is eligible.
 * Original publication time is absent in Binance's history response.
 */
export function fundingKnownAt(
 observations:readonly FundingObservation[],symbol:string,decisionCutoffMs:number
):{status:'known';observation:FundingObservation}|{status:'unknown';reason:string}{
 if(!validClock(decisionCutoffMs)||!symbolPattern.test(symbol))
  throw Error('Invalid funding decision cutoff or symbol');
 if(observations.some(x=>x.symbol!==symbol||!validClock(x.fundingTimeMs)||
   !validClock(x.firstReceivedAtMs)||!Number.isFinite(x.fundingRate)||
   x.publicationAtMs!==null))
  return {status:'unknown',reason:'Invalid, cross-symbol or unverified funding observation'};
 const eligible=observations.filter(x=>
  x.fundingTimeMs<=decisionCutoffMs&&x.firstReceivedAtMs<=decisionCutoffMs)
  .sort((a,b)=>b.fundingTimeMs-a.fundingTimeMs);
 if(!eligible.length)return {status:'unknown',reason:'No publicly received funding record at the decision cutoff; historical publication cannot be assumed'};
 return {status:'known',observation:eligible[0]!};
}
