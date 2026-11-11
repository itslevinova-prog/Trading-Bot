import {createHash} from 'node:crypto';
import {quantile} from './stats.js';

const DAY=86_400_000;
const DEVELOPMENT_FROM=Date.UTC(2020,0,1);
const DEVELOPMENT_TO=Date.UTC(2024,0,1);
const MIN_PAIRS=20; // fixed before observations; a diagnostic, never a gate threshold.
export const PAIRED_COMPARISON_VERSION='paired-block-bootstrap-v1' as const;
export type ObservedDailyReturn={day:string;netReturn:number};
export type ObservedDailyEquity={ts:number;equity:number};
export type PairedComparison={
 version:typeof PAIRED_COMPARISON_VERSION;
 status:'available'|'unavailable';
 pairedDays:number;
 unmatchedDays:number;
 missingStrategyDays:number;
 missingBenchmarkDays:number;
 gapsBetweenPairedDays:number;
 observedExcess:number|null;
 /** Strategy and benchmark equity are compounded on precisely the same paired daily observations. */
 observedStrategyReturn:number|null;
 observedBenchmarkReturn:number|null;
 differenceBand:{p10:number;p50:number;p90:number}|null;
 probabilityPositive:number|null;
 sharedInputHash:string|null;
 seed:number;paths:number;blockLength:number;
 firstPairedDay:string|null;lastPairedDay:string|null;
 reason:string|null;
};

function utcDay(day:string):number{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Invalid ISO UTC day');
 const ts=Date.parse(day+'T00:00:00.000Z');
 if(!Number.isSafeInteger(ts)||new Date(ts).toISOString().slice(0,10)!==day||
    ts<DEVELOPMENT_FROM||ts>=DEVELOPMENT_TO)
  throw Error('Days must be real UTC development dates 2020-2023');
 return ts;
}
function parseSeries(rows:readonly ObservedDailyReturn[]):Map<string,number>{
 const days=new Map<string,number>();
 for(const row of rows){
  utcDay(row.day);
  if(days.has(row.day)||!Number.isFinite(row.netReturn)||row.netReturn<=-1)
   throw Error('Duplicate or invalid daily net return');
  days.set(row.day,row.netReturn);
 }
 return days;
}
function digest(value:unknown):string{
 return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function random(seed:number):()=>number{
 let state=(seed>>>0)||0x9e3779b9;
 return ()=>{
  state^=state<<13;state^=state>>>17;state^=state<<5;
  return (state>>>0)/4294967296;
 };
}
function compound(values:readonly number[]):number {
 return values.reduce((equity,r)=>equity*(1+r),1)-1;
}
/**
 * Convert observed equity closes to daily net returns. A gap never becomes a
 * fabricated multi-day return; only consecutive observed UTC days yield rows.
 */
export function consecutiveDailyReturns(points:readonly ObservedDailyEquity[]):ObservedDailyReturn[]{
 const byDay=new Map<string,{ts:number;equity:number}>();
 for(const point of points){
  if(!Number.isSafeInteger(point.ts)||!Number.isFinite(point.equity)||point.equity<=0)
   throw Error('Invalid observed equity point');
  const day=new Date(point.ts).toISOString().slice(0,10);
  utcDay(day);
  const prior=byDay.get(day);
  if(!prior||prior.ts<point.ts)byDay.set(day,point);
 }
 const days=[...byDay.entries()].sort(([a],[b])=>a.localeCompare(b));
 const returns:ObservedDailyReturn[]=[];
 for(let i=1;i<days.length;i++){
  const [day,p]=days[i]!, [prev,old]=days[i-1]!;
  if(utcDay(day)-utcDay(prev)===DAY)
   returns.push({day,netReturn:p.equity/old.equity-1});
 }
 return returns;
}
/**
 * Stationary block bootstrap of *paired* market shocks. Every sampled index
 * applies to both daily return series. Blocks restart at actual observation
 * gaps, rather than treating nonconsecutive days as adjacent.
 */
export function pairedBlockComparison(
 strategy:readonly ObservedDailyReturn[],
 benchmark:readonly ObservedDailyReturn[],
 options:{seed?:number;paths?:number;blockLength?:number}={}
):PairedComparison{
 const seed=options.seed??1,paths=options.paths??1000,blockLength=options.blockLength??10;
 if(!Number.isSafeInteger(seed)||!Number.isSafeInteger(paths)||paths<100||paths>10000||
    !Number.isSafeInteger(blockLength)||blockLength<1||blockLength>90)
  throw Error('Invalid precommitted paired bootstrap settings');
 const blank=(reason:string,pairedDays=0,unmatchedDays=0,
  missingStrategyDays=0,missingBenchmarkDays=0,gapsBetweenPairedDays=0):PairedComparison=>({
  version:PAIRED_COMPARISON_VERSION,status:'unavailable',pairedDays,unmatchedDays,
  missingStrategyDays,missingBenchmarkDays,gapsBetweenPairedDays,
  observedExcess:null,observedStrategyReturn:null,observedBenchmarkReturn:null,
  differenceBand:null,probabilityPositive:null,sharedInputHash:null,
  seed,paths,blockLength,firstPairedDay:null,lastPairedDay:null,reason
 });
 let a:Map<string,number>,b:Map<string,number>;
 try{a=parseSeries(strategy);b=parseSeries(benchmark);}
 catch(error){return blank('n/a: '+(error instanceof Error?error.message:String(error)));}
 const union=new Set([...a.keys(),...b.keys()]);
 const shared=[...a.keys()].filter(day=>b.has(day)).sort();
 const missingStrategyDays=[...b.keys()].filter(day=>!a.has(day)).length;
 const missingBenchmarkDays=[...a.keys()].filter(day=>!b.has(day)).length;
 const unmatchedDays=union.size-shared.length;
 const gapsBetweenPairedDays=shared.slice(1).filter((day,i)=>utcDay(day)-utcDay(shared[i]!)!==DAY).length;
 if(shared.length<MIN_PAIRS)
  return blank('n/a: Weniger als 20 gemeinsame beobachtete tägliche Renditen',
   shared.length,unmatchedDays,missingStrategyDays,missingBenchmarkDays,gapsBetweenPairedDays);
 const pairs=shared.map(day=>({day,ts:utcDay(day),a:a.get(day)!,b:b.get(day)!}));
 const grossA=compound(pairs.map(p=>p.a)),grossB=compound(pairs.map(p=>p.b));
 const observedExcess=grossA-grossB;
 if(![grossA,grossB,observedExcess].every(Number.isFinite))
  return blank('n/a: Nicht-finite gepaarte Gesamtperformance',
   shared.length,unmatchedDays,missingStrategyDays,missingBenchmarkDays,gapsBetweenPairedDays);
 const rng=random(seed),diffs:number[]=[];
 let positives=0;
 for(let path=0;path<paths;path++){
  let index=Math.floor(rng()*pairs.length);
  let ea=1,eb=1;
  for(let i=0;i<pairs.length;i++){
   if(i>0){
    const contiguous=index+1<pairs.length&&pairs[index+1]!.ts-pairs[index]!.ts===DAY;
    if(!contiguous||rng()<1/blockLength)index=Math.floor(rng()*pairs.length);
    else index++;
   }
   ea*=1+pairs[index]!.a;eb*=1+pairs[index]!.b;
  }
  const diff=ea-eb;
  if(!Number.isFinite(diff))
   return blank('n/a: Nicht-finite Bootstrap-Szenarien',
    shared.length,unmatchedDays,missingStrategyDays,missingBenchmarkDays,gapsBetweenPairedDays);
  diffs.push(diff);
  if(diff>0)positives++;
 }
 return {
  version:PAIRED_COMPARISON_VERSION,status:'available',pairedDays:shared.length,
  unmatchedDays,missingStrategyDays,missingBenchmarkDays,gapsBetweenPairedDays,
  observedExcess,observedStrategyReturn:grossA,observedBenchmarkReturn:grossB,
  differenceBand:{p10:quantile(diffs,.10),p50:quantile(diffs,.50),p90:quantile(diffs,.90)},
  probabilityPositive:positives/paths,
  sharedInputHash:digest({version:PAIRED_COMPARISON_VERSION,pairs}),seed,paths,blockLength,
  firstPairedDay:shared[0]!,lastPairedDay:shared.at(-1)!,
  reason:unmatchedDays?
   'Nur gemeinsame beobachtete UTC-Tage verglichen; fehlende Tage nicht aufgefüllt':'Gepaarte, vollständig beobachtete UTC-Tage'
 };
}
