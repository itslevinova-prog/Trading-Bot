/** H-028: pre-registered, SPOT-ONLY entry veto. Never opens perpetuals. */
export const FUNDING_SPOT_VARIANTS={
 'above-p90-block':{lookbackDays:30,percentile:.9,comparison:'above'},
 'below-p10-block':{lookbackDays:30,percentile:.1,comparison:'below'}
} as const;
export type FundingSpotVariant=keyof typeof FUNDING_SPOT_VARIANTS;
export type FundingObservation={
 symbol:string;
 intervalEndMs:number;
 publishedAtMs:number;
 receivedAtMs:number;
 fundingRate:number;
 sourceId:string;
};
export type FundingSpotInput={
 symbol:string;
 asOf:number;
 variant:FundingSpotVariant;
 /** The original H-025 provider decides first. This filter can ONLY veto. */
 baseSpotBuyAllowed:boolean;
 history:readonly FundingObservation[];
};
export type FundingSpotAssessment={
 version:'H-028-v1';
 variant:FundingSpotVariant;
 status:'allowed'|'blocked'|'unknown';
 spotBuyAllowed:boolean;
 latestFundingRate:number|null;
 historicalThreshold:number|null;
 observations:number;
 coveredUtcDays:number;
 reason:string;
 executableOrder:false;
};
const DAY=86_400_000,FROM=Date.UTC(2020,0,1),UNTIL=Date.UTC(2024,0,1);
function quantile(values:number[],p:number):number{
 const sorted=[...values].sort((a,b)=>a-b),index=(sorted.length-1)*p;
 const lo=Math.floor(index),hi=Math.ceil(index);
 return sorted[lo]!+(sorted[hi]!-sorted[lo]!)*(index-lo);
}
const timestamp=(t:number)=>Number.isSafeInteger(t)&&t>=0;
const day=(ts:number)=>Math.floor(ts/DAY);
function usable(record:FundingObservation):boolean{
 return !!record.sourceId&&typeof record.sourceId==='string'&&
  timestamp(record.intervalEndMs)&&timestamp(record.publishedAtMs)&&
  timestamp(record.receivedAtMs)&&record.intervalEndMs<=record.publishedAtMs&&
  record.publishedAtMs<=record.receivedAtMs&&
  Number.isFinite(record.fundingRate)&&Math.abs(record.fundingRate)<=.1;
}
/**
 * Read-only veto for spot *new* buys; no prices, leverage, derivatives orders,
 * historical evaluations or implicit re-optimisation. Missing history blocks.
 */
export function assessFundingSpotFilter(input:FundingSpotInput):FundingSpotAssessment{
 const variant=input.variant;
 if(!(variant in FUNDING_SPOT_VARIANTS))
  throw Error('Only preregistered H-028 funding variants are accepted');
 const result=(status:FundingSpotAssessment['status'],reason:string,
  latestFundingRate:number|null=null,historicalThreshold:number|null=null,
  observations=0,coveredUtcDays=0):FundingSpotAssessment=>({
   version:'H-028-v1',variant,status,spotBuyAllowed:status==='allowed',
   latestFundingRate,historicalThreshold,observations,coveredUtcDays,
   reason,executableOrder:false
  });
 if(!timestamp(input.asOf)||input.asOf<=FROM||input.asOf>UNTIL||
  !/^[A-Z0-9]{5,24}$/.test(input.symbol)||!Array.isArray(input.history))
  return result('unknown','Invalid UTC development window, symbol or funding source');
 if(input.baseSpotBuyAllowed!==true)
  return result('blocked','Original H-025 did not authorize this spot buy');
 const lookback=FUNDING_SPOT_VARIANTS[variant].lookbackDays*DAY;
 // The funding outcome must have been published AND received at the decision.
 // Future observations are ignored, never retrospectively applied.
 const same=input.history.filter(x=>x.symbol===input.symbol&&
  timestamp(x.intervalEndMs)&&x.intervalEndMs>=input.asOf-lookback-DAY&&
  x.intervalEndMs<=input.asOf);
 if(same.some(x=>!usable(x)))
  return result('unknown','Invalid PIT funding source metadata or rate');
 const observed=same.filter(x=>x.publishedAtMs<=input.asOf&&x.receivedAtMs<=input.asOf)
  .sort((a,b)=>a.intervalEndMs-b.intervalEndMs);
 if(new Set(observed.map(x=>x.intervalEndMs)).size!==observed.length)
  return result('unknown','Duplicate funding intervals without immutable identity');
 const latest=observed.at(-1);
 if(!latest||latest.intervalEndMs<input.asOf-DAY)
  return result('unknown','Missing or stale last published funding');
 const prior=observed.filter(x=>x.intervalEndMs<latest.intervalEndMs&&
  x.intervalEndMs>=latest.intervalEndMs-lookback&&x.intervalEndMs>=FROM);
 const days=new Set(prior.map(x=>day(x.intervalEndMs))).size;
 if(prior.length<60||days<20)
  return result('unknown','Insufficient historical funding observations and UTC-day coverage',
   latest.fundingRate,null,prior.length,days);
 const spec=FUNDING_SPOT_VARIANTS[variant];
 const cutoff=quantile(prior.map(x=>x.fundingRate),spec.percentile);
 if(!Number.isFinite(cutoff))
  return result('unknown','Undefined historical funding percentile',
   latest.fundingRate,null,prior.length,days);
 const veto=spec.comparison==='above'?latest.fundingRate>cutoff:latest.fundingRate<cutoff;
 return result(veto?'blocked':'allowed',
  veto?'Pre-registered funding extreme vetoes SPOT entry':
   'No funding-extreme veto; original H-025, costs and risk still apply',
  latest.fundingRate,cutoff,prior.length,days);
}
