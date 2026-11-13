import type {RiskLimits} from './engine.js';
import type {Regime} from '../regime/types.js';

const DAY=86_400_000;

/** Fixed before the H-025 v3 development run. Research-only, never a Paper default. */
export const H025_V3_DRAWDOWN=Object.freeze({
 rebalanceTolerance:.20,flatDays:30,absoluteLossFromInitial:.30,requiredRegime:'risk-on' as const
});
export type ResearchV3Reset={
 asOf:number;date:string;equity:number;oldPeak:number;newPeak:number;
 reason:'30d-flat-and-risk-on-after-drawdown-stop';
};
export type ResearchV3Day={
 asOf:number;equity:number;referencePeak:number;drawdown:number;
 status:'ok'|'caution'|'exit-only'|'halted';entryScale:number;
 flatDays:number;regime:Regime;permanentStop:boolean;reset:ResearchV3Reset|null;
};
export type ResearchV3Observation={asOf:number;equity:number;openPositions:number;regime:Regime};

/**
 * Separate, non-production H-025 v3 state machine. Daily closed-bar observations
 * are mandatory, even on days without a buy signal. No price data is sourced here.
 */
export class ResearchDrawdownV3 {
 private referencePeak:number;
 private lastDay:number|null=null;
 private flatSince:number|null=null;
 private haltedLatch=false;
 private emergencyAt:number|null=null;
 private current:ResearchV3Day|null=null;
 readonly resets:ResearchV3Reset[]=[];
 constructor(readonly initialCash:number){
  if(!Number.isFinite(initialCash)||initialCash<=0)throw Error('Invalid H-025 v3 initial cash');
  this.referencePeak=initialCash;
 }
 get state():ResearchV3Day|null{return this.current;}
 get permanentStopAt():number|null{return this.emergencyAt;}
 observe(input:ResearchV3Observation,limits:RiskLimits):ResearchV3Day {
  const {asOf,equity,openPositions,regime}=input;
  if(!Number.isSafeInteger(asOf)||asOf<0||asOf%DAY!==0||
   this.lastDay!==null&&asOf!==this.lastDay+DAY||
   !Number.isFinite(equity)||equity<=0||
   !Number.isSafeInteger(openPositions)||openPositions<0||
   !(['risk-on','neutral','risk-off'] as const).includes(regime))
   throw Error('Invalid or non-contiguous H-025 v3 closed-day observation');
  this.lastDay=asOf;
  this.flatSince=openPositions===0?(this.flatSince??asOf):null;
  this.referencePeak=Math.max(this.referencePeak,equity);
  if(equity<=this.initialCash*(1-H025_V3_DRAWDOWN.absoluteLossFromInitial))
   this.emergencyAt??=asOf;
  let dd=Math.max(0,1-equity/this.referencePeak);
  if(dd>=limits.hardStopDrawdown)this.haltedLatch=true;
  let reset:ResearchV3Reset|null=null;
  if(this.emergencyAt===null&&this.flatSince!==null&&
   (dd>=limits.exitOnlyDrawdown||this.haltedLatch)&&
   asOf-this.flatSince>=H025_V3_DRAWDOWN.flatDays*DAY&&
   regime===H025_V3_DRAWDOWN.requiredRegime){
    const oldPeak=this.referencePeak;
    this.referencePeak=equity;
    this.haltedLatch=false;
    dd=0;
    reset={asOf,date:new Date(asOf).toISOString().slice(0,10),equity,
     oldPeak,newPeak:equity,reason:'30d-flat-and-risk-on-after-drawdown-stop'};
    this.resets.push(reset);
  }
  const permanentStop=this.emergencyAt!==null;
  const status=permanentStop||this.haltedLatch?'halted':
   dd>=limits.exitOnlyDrawdown?'exit-only':
   dd>=limits.cautionDrawdown?'caution':'ok';
  // Exact linear cap on new entries, no automatic liquidation or rebalancing.
  const entryScale=status==='halted'||status==='exit-only'?0:
   dd<=limits.cautionDrawdown?1:
   Math.max(0,Math.min(1,(limits.exitOnlyDrawdown-dd)/
    (limits.exitOnlyDrawdown-limits.cautionDrawdown)));
  const state:ResearchV3Day={asOf,equity,referencePeak:this.referencePeak,
   drawdown:dd,status,entryScale,
   flatDays:this.flatSince===null?0:Math.floor((asOf-this.flatSince)/DAY),
   regime,permanentStop,reset};
  this.current=state;
  return state;
 }
}
