import {createHash} from 'node:crypto';
import type {Candle,IntervalMinutes} from './candle-source.js';
import {ConservativeOhlcModel} from './fill-models.js';

const FROM=Date.UTC(2020,0,1),TO=Date.UTC(2024,0,1);
export const INTRABAR_UNCERTAINTY_VERSION='intrabar-ohlc-uncertainty-v1' as const;

/** Recorded position state at the moment a complete candle becomes available.
 * The recorder must supply one entry for every bar when stop and target coexist.
 * This is a READ-ONLY diagnostic; it cannot send orders or change fills. */
export type IntrabarPositionBar={
 pair:string;intervalMinutes:IntervalMinutes;candle:Candle;
 /** Actual position open must not be inferred from the next candle. */
 positionOpenedAtMs:number;
 qty:number;
 /** Historical all-in acquisition basis per unit, including entry fees. */
 entryBasisPerUnit:number;
 stopPrice:number|null;targetPrice:number|null;
 /** Simulated taker exit fee; sourced from the same frozen cost configuration. */
 exitFeeRate:number;
};
export type AmbiguousIntrabarCase={
 pair:string;candleOpenMs:number;candleCloseMs:number;
 /** Only known after the complete candle closed, never at decision time. */
 observedAtMs:number;
 stopPrice:number;targetPrice:number;
 conservativeExitPrice:number;targetFirstExitPrice:number;
 conservativeNetPnl:number;targetFirstNetPnl:number;
 deltaNetPnl:number;qty:number;
};
export type IntrabarUncertainty={
 version:typeof INTRABAR_UNCERTAINTY_VERSION;
 status:'available'|'insufficient_evidence';
 expectedPositionBars:number;observedPositionBars:number;
 doubleTriggerBars:number|null;
 /** Opens already at/beyond a trigger are not falsely called unknown-order paths. */
 openResolvedBars:number|null;
 ambiguousBars:number|null;
 resultBand:{conservativeNetPnl:number;targetFirstNetPnl:number;deltaNetPnl:number}|null;
 rows:AmbiguousIntrabarCase[];
 inputHash:string|null;
 note:string;
 reason:string|null;
};
function sha(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function validBar(b:IntrabarPositionBar):boolean{
 const {candle:c,intervalMinutes:m}=b,close=c.ts+m*60_000;
 return typeof b.pair==='string'&&b.pair.length>0&&[15,60,240,1440].includes(m)&&
  Number.isSafeInteger(c.ts)&&c.ts>=FROM&&close<=TO&&c.ts%(m*60_000)===0&&
  Number.isSafeInteger(b.positionOpenedAtMs)&&b.positionOpenedAtMs>=FROM&&
  b.positionOpenedAtMs<=c.ts&&
  [c.open,c.high,c.low,c.close,c.volume,b.qty,b.entryBasisPerUnit,b.exitFeeRate].every(Number.isFinite)&&
  c.open>0&&c.low>0&&c.high>=Math.max(c.open,c.close)&&
  c.low<=Math.min(c.open,c.close)&&c.volume>=0&&
  b.qty>0&&b.entryBasisPerUnit>0&&b.exitFeeRate>=0&&b.exitFeeRate<=.05&&
  (b.stopPrice===null||(Number.isFinite(b.stopPrice)&&b.stopPrice>0))&&
  (b.targetPrice===null||(Number.isFinite(b.targetPrice)&&b.targetPrice>0))&&
  (b.stopPrice===null||b.targetPrice===null||b.stopPrice<b.targetPrice);
}
/**
 * Read-only replay of synthetic OHLC stop-vs-target order uncertainty.
 * We do NOT alter the conservative production fill or impute which exit occurred.
 * Both outcomes are counterfactual cost-inclusive PnL scenarios, not realized PnL
 * or an end-to-end portfolio performance interval.
 */
export function diagnoseIntrabarUncertainty(
 bars:readonly IntrabarPositionBar[],
 settings:{expectedPositionBars:number;spreadBps:number;slippageBps:number}
):IntrabarUncertainty{
 const {expectedPositionBars,spreadBps,slippageBps}=settings;
 const empty=(reason:string):IntrabarUncertainty=>({
  version:INTRABAR_UNCERTAINTY_VERSION,status:'insufficient_evidence',
  expectedPositionBars,observedPositionBars:bars.length,doubleTriggerBars:null,
  openResolvedBars:null,ambiguousBars:null,resultBand:null,rows:[],
  inputHash:null,note:'Szenario, keine beobachtete Intrabar-Trade-Reihenfolge; verbindlicher konservativer Broker-Fill unverändert.',
  reason
 });
 // Fail closed before attempting any hypothetical quote computations.
 if(!Number.isSafeInteger(expectedPositionBars)||expectedPositionBars<1||
  !Array.isArray(bars)||bars.length!==expectedPositionBars)
  return empty('n/a: Position-Kerzenabdeckung unvollständig oder ungültig');
 if(![spreadBps,slippageBps].every(x=>Number.isFinite(x)&&x>=0&&x<=1000))
  return empty('n/a: Ungültige oder unbekannte historische synthetische Kosten');
 const keys=new Set<string>();
 for(const bar of bars){
  if(!validBar(bar))
   return empty('n/a: Fehlende, unplausible oder nicht-entwicklungszeitliche Positions-/Kerzenbelege');
  const key=bar.pair+':'+bar.intervalMinutes+':'+bar.candle.ts;
  if(keys.has(key))return empty('n/a: Doppelte Positionskerze');
  keys.add(key);
 }
 const model=new ConservativeOhlcModel({spreadBps,slippageBps});
 const rows:AmbiguousIntrabarCase[]=[];
 let doubleTriggerBars=0,openResolvedBars=0;
 for(const bar of bars){
  const {candle,stopPrice:stop,targetPrice:target}=bar;
  if(stop===null||target===null||candle.low>stop||candle.high<target)continue;
  doubleTriggerBars++;
  // OHLC includes the open first; a gap already through either trigger reveals
  // that first crossing, so the event is not counted as an unknown-order candle.
  if(candle.open<=stop||candle.open>=target){openResolvedBars++;continue;}
  const conservative=model.exit(candle,stop,target);
  if(conservative?.reason!=='stop')
   return empty('n/a: Baseline-Fill stimmt nicht mit konservativem OHLC-Modell überein');
  const targetFirst=model.entry({...candle,open:target},'sell');
  const basis=bar.qty*bar.entryBasisPerUnit;
  const conservativeNetPnl=bar.qty*conservative.quote.price*(1-bar.exitFeeRate)-basis;
  const targetFirstNetPnl=bar.qty*targetFirst.price*(1-bar.exitFeeRate)-basis;
  if(![conservativeNetPnl,targetFirstNetPnl].every(Number.isFinite))
   return empty('n/a: Nicht-finite Intrabar-PnL-Szenarien');
  rows.push({
   pair:bar.pair,candleOpenMs:candle.ts,candleCloseMs:candle.ts+bar.intervalMinutes*60_000,
   observedAtMs:candle.ts+bar.intervalMinutes*60_000,
   stopPrice:stop,targetPrice:target,
   conservativeExitPrice:conservative.quote.price,
   targetFirstExitPrice:targetFirst.price,
   conservativeNetPnl,targetFirstNetPnl,deltaNetPnl:targetFirstNetPnl-conservativeNetPnl,
   qty:bar.qty
  });
 }
 const conservativeNetPnl=rows.reduce((sum,row)=>sum+row.conservativeNetPnl,0);
 const targetFirstNetPnl=rows.reduce((sum,row)=>sum+row.targetFirstNetPnl,0);
 return {
  version:INTRABAR_UNCERTAINTY_VERSION,status:'available',
  expectedPositionBars,observedPositionBars:bars.length,
  doubleTriggerBars,openResolvedBars,ambiguousBars:rows.length,
  resultBand:rows.length?{
   conservativeNetPnl,targetFirstNetPnl,
   deltaNetPnl:targetFirstNetPnl-conservativeNetPnl
  }:null,rows,inputHash:sha({version:INTRABAR_UNCERTAINTY_VERSION,settings,bars}),
  note:'Nur synthetische OHLC-Szenarien auf mehrdeutigen Positionskerzen, nicht die Strategie-Gesamtrendite. Basis-Stop-Fill unverändert; keine Tick-/Trade-Reihenfolge rückprojiziert.',
  reason:rows.length?'Intrabar-Reihenfolge ohne historische empfangene Ticks/Trades nicht beobachtbar':
   'Keine ungeklärten Doppeltrigger innerhalb der vollständig bereitgestellten Positionskerzen'
 };
}
