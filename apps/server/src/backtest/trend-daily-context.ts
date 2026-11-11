import type {Candle} from './candle-source.js';
import type {MarketConstraints,SimulatedPosition} from './simulated-broker.js';
import type {TrendV1Input,TrendMarket,TrendQuality} from '../strategy/trend-vol-target-v1.js';

const DAY=86_400_000;
export type TrendDailyEvidence={
 pair:string;
 daily:readonly Candle[];
 constraints:MarketConstraints|null;
 /** Only a verified point-in-time quality check can grant allowed. */
 quality:TrendQuality;
};
export type ClosedTrendContextInput={
 asOf:number;quote:string;equity:number;cash:number;
 markets:readonly TrendDailyEvidence[];
 positions:readonly SimulatedPosition[];
 feeRate:number;spreadBps:number;slippageBps:number;
 lastRebalanceAt?:number|null;
};
/**
 * Pure, read-only adaptation of already observed daily OHLC and paper positions.
 * Never synthesizes missing historic exchange filters or coin-quality evidence.
 * The plan/provider applies its own 240-consecutive-closed-day preflight.
 */
export function buildClosedTrendV1Context(input:ClosedTrendContextInput):TrendV1Input{
 const {asOf,quote,equity,cash}=input;
 if(!Number.isSafeInteger(asOf)||asOf<0||asOf%DAY!==0)
  throw Error('Trend context requires a fully closed UTC daily event');
 if(!Number.isFinite(input.feeRate)||input.feeRate<0||
  !Number.isFinite(input.spreadBps)||input.spreadBps<0||
  !Number.isFinite(input.slippageBps)||input.slippageBps<0)
  throw Error('Trend context requires explicit nonnegative cost assumptions');
 // Both fees, one full round-trip spread and two side-specific slippage costs.
 // These are assumptions only, never empirical execution-quality evidence.
 const roundtripBps=2*input.feeRate*10_000+
  input.spreadBps+2*input.slippageBps;
 const closed=new Map<string,Candle[]>();
 const markets:TrendMarket[]=input.markets.map(evidence=>{
  const bars=evidence.daily.filter(c=>Number.isSafeInteger(c.ts)&&c.ts+DAY<=asOf)
   .map(c=>({...c})).sort((a,b)=>a.ts-b.ts);
  closed.set(evidence.pair,bars);
  const lot=evidence.constraints;
  return {
   pair:evidence.pair,daily:bars,quality:evidence.quality,
   assumedRoundtripBps:Number.isFinite(roundtripBps)?roundtripBps:null,
   lot:lot?{minQty:lot.ordermin,minNotional:lot.costmin,decimals:lot.lotDecimals}:
    {minQty:0,minNotional:0,decimals:0}
  };
 });
 const positions=input.positions.map(position=>{
  // Historical watermark is only computed from completed daily closes
  // since the recorded entry, never from the future or intrabar highs.
  const closes=(closed.get(position.symbol)??[])
   .filter(c=>c.ts+DAY>=position.openedAt&&c.ts+DAY<=asOf)
   .map(c=>c.close).filter(x=>Number.isFinite(x)&&x>0);
  return {pair:position.symbol,qty:position.qty,
   highestCloseSinceEntry:closes.length?Math.max(...closes):null};
 });
 return {asOf,quote,equity,cash,markets,positions,
  lastRebalanceAt:input.lastRebalanceAt??null};
}
