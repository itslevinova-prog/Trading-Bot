const DAY=86_400_000;

/** Fixed, research-only H-025 v5.1 re-entry rule. No Paper account can use it. */
export const H025_V51_REENTRY=Object.freeze({
 flatDays:30,peakZeroDrawdown:.30,permanentInitialLoss:.30,
 requiredRegime:'risk-on' as const,
 reason:'30-full-flat-days-and-closed-btc-200d-risk-on' as const
});
export type ResearchV51Reset={
 asOf:number;date:string;equity:number;oldPeak:number;newPeak:number;
 reason:typeof H025_V51_REENTRY.reason;
};
export type ResearchV51Observation={
 asOf:number;equity:number;historicalPeak:number;openPositions:number;
 btcRegime:'risk-on'|'risk-off'|null;
};

/**
 * The historical broker peak remains untouched. Until the FIRST eligible reset,
 * entry scaling uses exactly the original v5 historical peak. Thereafter only
 * this separate reference peak can increase; it never reads the pre-reset peak.
 */
export class ResearchV51Drawdown {
 private resetPeak:number|null=null;
 private flatSince:number|null=null;
 private lastDay:number|null=null;
 private stoppedAt:number|null=null;
 readonly resets:ResearchV51Reset[]=[];
 constructor(readonly initialCash:number){
  if(!Number.isFinite(initialCash)||initialCash<=0)
   throw Error('Invalid H-025 v5.1 initial cash');
 }
 get permanentStopAt(){return this.stoppedAt;}
 get referencePeak(){return this.resetPeak;}
 /** Also called at order fill: never uses unclosed current-bar prices to reset. */
 entryScale(asOf:number,equity:number,historicalPeak:number):number {
  if(!Number.isSafeInteger(asOf)||asOf<0||!Number.isFinite(equity)||
   equity<=0||!Number.isFinite(historicalPeak)||historicalPeak<=0)
   throw Error('Invalid H-025 v5.1 research risk observation');
  if(equity<=this.initialCash*(1-H025_V51_REENTRY.permanentInitialLoss)+1e-8)
   this.stoppedAt??=asOf;
  if(this.stoppedAt!==null)return 0;
  if(this.resetPeak!==null)this.resetPeak=Math.max(this.resetPeak,equity);
  const peak=this.resetPeak??Math.max(historicalPeak,equity);
  const drawdown=Math.max(0,1-equity/peak);
  return drawdown<=.10?1:drawdown>=H025_V51_REENTRY.peakZeroDrawdown?0:
   (H025_V51_REENTRY.peakZeroDrawdown-drawdown)/.20;
 }
 /** Exactly one observation per consecutive closed UTC day, including cash days. */
 observeDay(input:ResearchV51Observation):ResearchV51Reset|null {
  const {asOf,equity,historicalPeak,openPositions,btcRegime}=input;
  if(asOf%DAY!==0||this.lastDay!==null&&asOf!==this.lastDay+DAY||
   !Number.isSafeInteger(openPositions)||openPositions<0||
   !(['risk-on','risk-off',null] as const).includes(btcRegime))
   throw Error('Invalid or non-contiguous H-025 v5.1 closed-day observation');
  const scale=this.entryScale(asOf,equity,historicalPeak);
  this.lastDay=asOf;
  this.flatSince=openPositions===0?(this.flatSince??asOf):null;
  if(scale!==0||this.stoppedAt!==null||this.flatSince===null||
   asOf-this.flatSince<H025_V51_REENTRY.flatDays*DAY||
   btcRegime!==H025_V51_REENTRY.requiredRegime)return null;
  const oldPeak=this.resetPeak??Math.max(historicalPeak,equity);
  this.resetPeak=equity;
  const reset:ResearchV51Reset={asOf,date:new Date(asOf).toISOString().slice(0,10),
   equity,oldPeak,newPeak:equity,reason:H025_V51_REENTRY.reason};
  this.resets.push(reset);
  return reset;
 }
}
