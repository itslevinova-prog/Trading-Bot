import type {Candle} from '../backtest/candle-source.js';

/** H-027: fixed, parked signal candidates; never an executable order provider. */
export const DAILY_COMPRESSION_BREAKOUT_VARIANTS={
 'breakout-20':{breakoutDays:20,compressionDays:20,medianDays:30},
 'breakout-40':{breakoutDays:40,compressionDays:20,medianDays:30}
} as const;
export type CompressionBreakoutVariant=keyof typeof DAILY_COMPRESSION_BREAKOUT_VARIANTS;
export type CompressionBreakoutInput={
 symbol:string;asOf:number;variant:CompressionBreakoutVariant;
 bars:readonly Candle[];
 coinQuality:'allowed'|'hold-only'|'exit'|'unknown';
 /** Conservative, historical, per-round-trip modeled costs; missing = no entry. */
 roundtripCostBps:number|null;
 /** Independently predeclared gross movement assumption, never fitted to 2024+. */
 expectedGrossMoveBps:number|null;
};
export type CompressionBreakoutAssessment={
 version:'H-027-v1';
 variant:CompressionBreakoutVariant;
 status:'candidate'|'no-signal'|'blocked';
 reason:string;
 breakoutAbovePriorHigh:boolean|null;
 compressionBelowPastMedian:boolean|null;
 earliestNextOpenAt:number|null;
 /** Contextual signal only. A separate risk-checked, next-bar broker is required. */
 executableOrder:false;
};
const DAY=86_400_000,FROM=Date.UTC(2020,0,1),UNTIL=Date.UTC(2024,0,1);
const finite=(n:number)=>Number.isFinite(n);
function volatility(rows:readonly Candle[],end:number,days:number):number|null{
 if(end<days)return null;
 const returns:number[]=[];
 for(let i=end-days+1;i<=end;i++){
  const older=rows[i-1]!.close,newer=rows[i]!.close;
  if(!finite(older)||!finite(newer)||older<=0||newer<=0)return null;
  returns.push(Math.log(newer/older));
 }
 const average=returns.reduce((a,b)=>a+b,0)/returns.length;
 const variance=returns.reduce((a,b)=>a+(b-average)**2,0)/(returns.length-1);
 const sigma=Math.sqrt(variance);
 return finite(sigma)?sigma:null;
}
function median(values:readonly number[]):number{
 const s=[...values].sort((a,b)=>a-b),n=s.length;
 return n%2?s[Math.floor(n/2)]!:(s[n/2-1]!+s[n/2]!)/2;
}
/** No order placement and no data loading. H-027 remains parked under #32. */
export function assessDailyCompressionBreakout(input:CompressionBreakoutInput):CompressionBreakoutAssessment{
 const variant=input.variant;
 if(!(variant in DAILY_COMPRESSION_BREAKOUT_VARIANTS))
  throw Error('Only preregistered H-027 variants may be evaluated');
 const result=(status:CompressionBreakoutAssessment['status'],reason:string,
  breakoutAbovePriorHigh:boolean|null=null,compressionBelowPastMedian:boolean|null=null,
  earliestNextOpenAt:number|null=null):CompressionBreakoutAssessment=>({
   version:'H-027-v1',variant,status,reason,breakoutAbovePriorHigh,
   compressionBelowPastMedian,earliestNextOpenAt,executableOrder:false
  });
 if(!Number.isSafeInteger(input.asOf)||input.asOf%DAY!==0||
  input.asOf<=FROM||input.asOf>UNTIL||
  !/^[A-Z0-9]{2,20}\/?[A-Z0-9]{3,6}$/.test(input.symbol)||
  !Array.isArray(input.bars))
  return result('blocked','Invalid UTC date, market or evidence: development 2020–2023 only');
 if(input.coinQuality!=='allowed')
  return result('blocked','Point-in-time coin quality does not authorize new exposure');
 const spec=DAILY_COMPRESSION_BREAKOUT_VARIANTS[variant];
 // To compare the pre-breakout 20d sigma against 30 older completed
 // rolling sigma windows, at least 52 contiguous completed bars are needed.
 const eligible=input.bars.filter(c=>c.ts+DAY<=input.asOf);
 const required=Math.max(52,spec.breakoutDays+1);
 const bars=eligible.slice(-required),last=bars.length-1;
 if(bars.length!==required||bars[last]!.ts!==input.asOf-DAY||
  bars.some((c,i)=>c.ts<FROM||!Number.isSafeInteger(c.ts)||c.ts%DAY!==0||
   (i>0&&c.ts!==bars[i-1]!.ts+DAY)||
   ![c.open,c.high,c.low,c.close,c.volume].every(finite)||
   c.open<=0||c.close<=0||c.low<=0||c.volume<0||
   c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)))
  return result('blocked','Missing, gapped, duplicate or invalid completed daily history');
 const beforeBreakoutVol=volatility(bars,last-1,spec.compressionDays);
 const earlierVols=Array.from({length:spec.medianDays},(_,i)=>
  volatility(bars,last-2-i,spec.compressionDays));
 if(beforeBreakoutVol===null||earlierVols.some(v=>v===null))
  return result('blocked','Insufficient pre-breakout volatility evidence');
 const medianVol=median(earlierVols as number[]);
 if(!finite(medianVol)||medianVol<=0||beforeBreakoutVol===0)
  return result('blocked','Undefined/zero historical volatility comparison');
 const compression=beforeBreakoutVol<medianVol;
 const priorHigh=Math.max(...bars.slice(last-spec.breakoutDays,last).map(b=>b.high));
 const breakout=bars[last]!.close>priorHigh;
 if(!breakout||!compression)
  return result('no-signal','Fixed pre-breakout compression / close-over-prior-high gate failed',breakout,compression);
 if(input.roundtripCostBps===null||!finite(input.roundtripCostBps)||
  input.roundtripCostBps<=0||
  input.expectedGrossMoveBps===null||!finite(input.expectedGrossMoveBps)||
  input.expectedGrossMoveBps<2*input.roundtripCostBps)
  return result('blocked','Missing or insufficient independently assumed gross edge: require >= 2x round-trip costs',breakout,compression);
 return result('candidate',
  'Pre-registered causal signal only; any hypothetical entry must be risk-checked at the NEXT daily open',
  breakout,compression,input.asOf);
}
