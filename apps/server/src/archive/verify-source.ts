import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ARCHIVE_DB} from './paths.js';
import type {ArchiveDb} from './store.js';

const DAY=86_400_000;
const FROM=Date.UTC(2020,0,1),END=Date.UTC(2024,0,1);
type Minutes=15|60|1440;
export type SourceSample={symbol:string;intervalMin:Minutes;dayMs:number};
type Bar={ts:number;open:number;high:number;low:number;close:number;volume:number;quoteVolume:number;trades:number};
export type SourceCheck={
  sample:SourceSample;
  status:'match'|'conflict'|'unknown';
  reasons:string[];
  archiveHash:string;restHash:string|null;
  archiveBars:number;restBars:number|null;
  sourceFirstAt:number|null;sourceLastAt:number|null;
  requestedAt:number|null;receivedAt:number|null;url:string;
};
export type SourceVerificationReport={
  seed:string;selected:number;sampleFingerprint:string;fingerprint:string;
  source:'Binance public Spot REST /api/v3/klines';
  status:'passed'|'conflict'|'unknown';
  counts:{matched:number;conflicts:number;unknown:number};checks:SourceCheck[];
};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validateSample(sample:SourceSample):void{
 if(!/^[A-Z0-9]{5,25}$/.test(sample.symbol)||![15,60,1440].includes(sample.intervalMin)||
    !Number.isSafeInteger(sample.dayMs)||sample.dayMs<FROM||sample.dayMs>=END||sample.dayMs%DAY!==0)
  throw Error('Spot verification accepts only 2020–2023 development days');
}
/** SHA256 ranking is deterministic regardless of DB iteration order. */
export function chooseDevelopmentSamples(db:ArchiveDb,seed:string,count:number):SourceSample[]{
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(seed)||!Number.isSafeInteger(count)||count<1||count>50)
  throw Error('Invalid seed or sample count');
 const rows=db.prepare('SELECT symbol,interval_min AS intervalMin,ts-(ts % ?) AS dayMs FROM candles '+
  'WHERE ts>=? AND ts<? AND interval_min IN (15,60,1440) '+
  'GROUP BY symbol,interval_min,dayMs ORDER BY symbol,interval_min,dayMs')
  .all(DAY,FROM,END) as SourceSample[];
 return rows.filter(x=>/^[A-Z0-9]{5,25}$/.test(x.symbol))
  .map(row=>({row,rank:hash([seed,row.symbol,row.intervalMin,row.dayMs])}))
  .sort((a,b)=>a.rank.localeCompare(b.rank)||a.row.symbol.localeCompare(b.row.symbol)||
    a.row.intervalMin-b.row.intervalMin||a.row.dayMs-b.row.dayMs)
  .slice(0,count).map(x=>x.row);
}
function archiveBars(db:ArchiveDb,sample:SourceSample):Bar[]{
 return db.prepare('SELECT ts,open,high,low,close,volume,quote_volume AS quoteVolume,trades FROM candles '+
  'WHERE symbol=? AND interval_min=? AND ts>=? AND ts<? ORDER BY ts')
  .all(sample.symbol,sample.intervalMin,sample.dayMs,sample.dayMs+DAY) as Bar[];
}
export function publicRestUrl(sample:SourceSample):string{
 validateSample(sample);
 const interval=({15:'15m',60:'1h',1440:'1d'} as const)[sample.intervalMin];
 const url=new URL('https://api.binance.com/api/v3/klines');
 url.searchParams.set('symbol',sample.symbol);url.searchParams.set('interval',interval);
 url.searchParams.set('startTime',String(sample.dayMs));
 url.searchParams.set('endTime',String(sample.dayMs+DAY));url.searchParams.set('limit','1000');
 return url.toString();
}
function parseRestBars(raw:string,sample:SourceSample):Bar[]{
 const parsed:unknown=JSON.parse(raw);
 if(!Array.isArray(parsed))throw Error('REST response is not a Kline array');
 const step=sample.intervalMin*60_000;
 const result:Bar[]=[];
 for(const entry of parsed){
  if(!Array.isArray(entry)||entry.length<9)throw Error('Malformed REST Kline');
  const ts=Number(entry[0]),values=[entry[1],entry[2],entry[3],entry[4],entry[5],entry[7],entry[8]].map(Number);
  if(!Number.isSafeInteger(ts)||ts<sample.dayMs||ts>=sample.dayMs+DAY||ts%step!==0||
     result.length>0&&ts<=result[result.length-1]!.ts)
   throw Error('REST timestamp scaling, range or ordering conflict');
  if(values.some(n=>!Number.isFinite(n)||n<0)||
     values[0]!<=0||values[3]!<=0||
     values[1]!<Math.max(values[0]!,values[2]!,values[3]!)||
     values[2]!>Math.min(values[0]!,values[3]!)||
     !Number.isSafeInteger(values[6])||Number(entry[6])!==ts+step-1)
   throw Error('Invalid REST OHLC/volume/close timestamp');
  result.push({ts,open:values[0]!,high:values[1]!,low:values[2]!,close:values[3]!,
   volume:values[4]!,quoteVolume:values[5]!,trades:values[6]!});
 }
 return result;
}
const near=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-8,Math.max(Math.abs(a),Math.abs(b))*1e-10);
function differences(archive:Bar[],rest:Bar[],sample:SourceSample):string[]{
 const expected=DAY/(sample.intervalMin*60_000),issues:string[]=[];
 if(archive.length!==expected||rest.length!==expected)
  issues.push('Incomplete day: expected '+expected+', archive '+archive.length+', REST '+rest.length);
 if(archive.length!==rest.length)issues.push('Series length mismatch');
 for(let i=0;i<Math.min(archive.length,rest.length);i++){
  const a=archive[i]!,b=rest[i]!;
  if(a.ts!==b.ts||a.ts!==sample.dayMs+i*sample.intervalMin*60_000){
   issues.push('Timestamp/order mismatch at index '+i);continue;
  }
  for(const key of ['open','high','low','close','volume','quoteVolume'] as const)
   if(!near(a[key],b[key]))issues.push(key+' mismatch at '+a.ts);
  if(a.trades!==b.trades)issues.push('Trades mismatch at '+a.ts);
 }
 return issues;
}
/** Read-only. Tests inject a fetcher and clock; no HTTP is needed in CI. */
export async function verifySpotSample(
 db:ArchiveDb,sample:SourceSample,fetcher:typeof fetch=fetch,clock:()=>number=Date.now
):Promise<SourceCheck>{
 const url=publicRestUrl(sample),archive=archiveBars(db,sample),archiveHash=hash(archive);
 const base={sample,url,archiveHash,archiveBars:archive.length};
 let requestedAt:number|null=null,receivedAt:number|null=null;
 try{
  requestedAt=clock();
  const response=await fetcher(url,{headers:{'User-Agent':'TradingArchiveVerify/1.0 (free public Spot)'}});
  receivedAt=clock();
  if(!response.ok)return {...base,status:'unknown',reasons:['REST HTTP '+response.status],
   restHash:null,restBars:null,sourceFirstAt:null,sourceLastAt:null,requestedAt,receivedAt};
  const raw=await response.text(),restHash=createHash('sha256').update(raw).digest('hex');
  let rest:Bar[];
  try{rest=parseRestBars(raw,sample);}
  catch(error){return {...base,status:'conflict',reasons:[String(error instanceof Error?error.message:error)],
   restHash,restBars:null,sourceFirstAt:null,sourceLastAt:null,requestedAt,receivedAt};}
  const reasons=differences(archive,rest,sample);
  const incompleteOnly=reasons.length===1&&reasons[0]!.startsWith('Incomplete day');
  return {...base,status:incompleteOnly?'unknown':reasons.length?'conflict':'match',reasons,
   restHash,restBars:rest.length,sourceFirstAt:rest[0]?.ts??null,sourceLastAt:rest.at(-1)?.ts??null,
   requestedAt,receivedAt};
 }catch(error){
  return {...base,status:'unknown',reasons:['REST unavailable: '+String(error instanceof Error?error.message:error)],
   restHash:null,restBars:null,sourceFirstAt:null,sourceLastAt:null,requestedAt,receivedAt};
 }
}
export async function verifyDevelopmentSource(
 db:ArchiveDb,options:{seed:string;count:number;fetcher?:typeof fetch;clock?:()=>number}
):Promise<SourceVerificationReport>{
 const samples=chooseDevelopmentSamples(db,options.seed,options.count),checks:SourceCheck[]=[];
 for(const sample of samples)checks.push(await verifySpotSample(
  db,sample,options.fetcher??fetch,options.clock??Date.now));
 const counts={matched:checks.filter(r=>r.status==='match').length,
  conflicts:checks.filter(r=>r.status==='conflict').length,
  unknown:checks.filter(r=>r.status==='unknown').length};
 const status=counts.conflicts?'conflict':counts.unknown||checks.length<options.count?'unknown':'passed';
 const sampleFingerprint=hash([options.seed,options.count,samples]);
 const fingerprint=hash({sampleFingerprint,checks:checks.map(row=>({
  sample:row.sample,status:row.status,archiveHash:row.archiveHash,restHash:row.restHash,reasons:row.reasons
 }))});
 return {seed:options.seed,selected:samples.length,sampleFingerprint,fingerprint,
  source:'Binance public Spot REST /api/v3/klines',status,counts,checks};
}
/** Content-addressed local audit. An existing report is never overwritten. */
export function writeSourceVerification(
 report:SourceVerificationReport,folder='data/archive/source-verification'
):string{
 if(!/^[a-f0-9]{64}$/.test(report.fingerprint))throw Error('Invalid verification fingerprint');
 const path=resolve(folder,report.fingerprint+'.json');
 mkdirSync(dirname(path),{recursive:true});
 if(existsSync(path)){
  const prior=JSON.parse(readFileSync(path,'utf8')) as SourceVerificationReport;
  if(prior.fingerprint!==report.fingerprint||prior.sampleFingerprint!==report.sampleFingerprint)
   throw Error('Source report fingerprint collision');
  return path;
 }
 writeFileSync(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 return path;
}
export async function runSourceVerification(args=process.argv.slice(2)):Promise<void>{
 const values=new Map<string,string>();
 for(let i=0;i<args.length;i+=2){
  if(!['--seed','--samples'].includes(args[i]??'')||!args[i+1]||values.has(args[i]!))
   throw Error('Usage: pnpm data:verify-source --seed check-v1 --samples 12');
  values.set(args[i]!,args[i+1]!);
 }
 const count=Number(values.get('--samples')??12),seed=values.get('--seed')??'archive-check-v1';
 if(!existsSync(ARCHIVE_DB))throw Error('Local archive missing; no verification performed');
 const db=new Database(ARCHIVE_DB,{readonly:true,fileMustExist:true});
 try{
  const report=await verifyDevelopmentSource(db,{seed,count});
  const path=writeSourceVerification(report);
  console.log(JSON.stringify({status:report.status,selected:report.selected,counts:report.counts,
   sampleFingerprint:report.sampleFingerprint,reportFingerprint:report.fingerprint,path},null,2));
  if(report.status!=='passed')process.exitCode=1;
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 runSourceVerification().catch(error=>{console.error(error);process.exitCode=1;});
