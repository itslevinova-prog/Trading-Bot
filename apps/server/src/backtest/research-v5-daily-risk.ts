import type {Candle} from './candle-source.js';

const DAY=86_400_000;
export const V5_DAILY_RISK=Object.freeze({
 lookbackDays:60,shockQuantile:.99,annualizationDays:365,
 history:'contiguous-closed-UTC-days',hourlyRequired:false
});
export type V5DailyRiskVerdict={
 allowed:boolean;reason:'ok'|'missing-daily-history'|'btc-daily-shock-p99';
 btcAnnualVol:number|null;assetAnnualVol:number|null;btcShockAbsReturn:number|null;
 btcShockP99:number|null;
};
/** Closed daily prices only; no interpolation, hourly fallback or current-bar leakage. */
function dailyReturns(rows:readonly Candle[],asOf:number):number[]|null {
 if(!Number.isSafeInteger(asOf)||asOf%DAY!==0)return null;
 const relevant=rows.filter(c=>c.ts+DAY<=asOf);
 const byTs=new Map<number,number>();
 for(const c of relevant){
  if(!Number.isSafeInteger(c.ts)||!Number.isFinite(c.close)||c.close<=0||
   byTs.has(c.ts))return null;
  byTs.set(c.ts,c.close);
 }
 const result:number[]=[];
 const last=asOf-DAY;
 for(let i=V5_DAILY_RISK.lookbackDays;i>=1;i--){
  const before=byTs.get(last-i*DAY),after=byTs.get(last-(i-1)*DAY);
  if(before===undefined||after===undefined)return null;
  const r=Math.log(after/before);
  if(!Number.isFinite(r))return null;
  result.push(r);
 }
 return result;
}
function annualVol(returns:readonly number[]):number {
 const mean=returns.reduce((sum,r)=>sum+r,0)/returns.length;
 const variance=returns.reduce((sum,r)=>sum+(r-mean)**2,0)/(returns.length-1);
 return Math.sqrt(variance*V5_DAILY_RISK.annualizationDays);
}
/** Daily BTC absolute 1-day return against the previous 59 returns' empirical P99. */
export function checkV5DailyRisk(
 asOf:number,btcDaily:readonly Candle[],assetDaily:readonly Candle[]
):V5DailyRiskVerdict{
 const btc=dailyReturns(btcDaily,asOf),asset=dailyReturns(assetDaily,asOf);
 const blocked=(reason:V5DailyRiskVerdict['reason']):V5DailyRiskVerdict=>({
  allowed:false,reason,btcAnnualVol:null,assetAnnualVol:null,
  btcShockAbsReturn:null,btcShockP99:null
 });
 if(!btc||!asset)return blocked('missing-daily-history');
 const history=btc.slice(0,-1).map(Math.abs).sort((a,b)=>a-b);
 const p99=history[Math.min(history.length-1,Math.ceil(history.length*.99)-1)]!;
 const latest=Math.abs(btc.at(-1)!);
 return {allowed:latest<=p99,reason:latest>p99?'btc-daily-shock-p99':'ok',
  btcAnnualVol:annualVol(btc),assetAnnualVol:annualVol(asset),
  btcShockAbsReturn:latest,btcShockP99:p99};
}
