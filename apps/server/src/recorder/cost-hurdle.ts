import type {BookSnapshot} from './types.js';
import {percentile,readTradesReceivedBy,type ReceivedTradeCutoff} from './reader.js';
import {createHash} from 'node:crypto';
export type DepthSummary = {median: number | null; p90: number | null};
export type RecorderCostCoverage={
 status:'sufficient'|'insufficient';
 requirementsVersion:'recorder-cost-coverage-v1';
 observedFromMs:number|null;observedToMs:number|null;
 observedUtcDays:number;qualifyingUtcDays:number;
 observedSixHourBlocks:number;qualifyingDayBlocks:number;
 observationSpanDays:number;
 reasons:string[];
};
/** Frozen, conservative diagnostics. They do not certify maker fills, size-specific
 * slippage, net edge or exchange tradability. */
export const COST_COVERAGE_MINIMUM={
 minUtcDays:7,minSixHourBlocks:4,minDayBlocks:14,
 minCalendarSpanDays:14,minDistinctMinutesPerDayBlock:3
} as const;
const DAY=86_400_000;
export function assessRecorderCostCoverage(
 snapshots:readonly Pick<BookSnapshot,'ts'>[]
):RecorderCostCoverage {
 const timestamps=snapshots.map(x=>x.ts);
 if(timestamps.some(x=>!Number.isSafeInteger(x)||x<0))
  throw Error('Invalid recorder coverage timestamp');
 const ordered=[...new Set(timestamps)].sort((a,b)=>a-b);
 const observedFromMs=ordered[0]??null,observedToMs=ordered.at(-1)??null;
 const perBlock=new Map<string,Set<number>>();
 const observedDays=new Set<number>(),observedBlocks=new Set<number>();
 for(const ts of ordered){
  const day=Math.floor(ts/DAY),hour=new Date(ts).getUTCHours(),
   sixHourBlock=Math.floor(hour/6);
  observedDays.add(day);observedBlocks.add(sixHourBlock);
  const key=day+':'+sixHourBlock,bins=perBlock.get(key)??new Set<number>();
  bins.add(Math.floor(ts/60_000));perBlock.set(key,bins);
 }
 const qualifyingDayBlocks=[...perBlock.entries()]
  .filter(([,minuteBins])=>minuteBins.size>=COST_COVERAGE_MINIMUM.minDistinctMinutesPerDayBlock);
 const qualifyingDays=new Set(qualifyingDayBlocks.map(([key])=>Number(key.split(':')[0])));
 const spanDays=ordered.length?Math.floor(observedToMs!/DAY)-Math.floor(observedFromMs!/DAY)+1:0;
 const reasons:string[]=[];
 if(qualifyingDays.size<COST_COVERAGE_MINIMUM.minUtcDays)
  reasons.push('Too few independently sampled UTC days: '+qualifyingDays.size);
 if(observedBlocks.size<COST_COVERAGE_MINIMUM.minSixHourBlocks)
  reasons.push('Missing UTC six-hour time blocks: '+observedBlocks.size);
 if(qualifyingDayBlocks.length<COST_COVERAGE_MINIMUM.minDayBlocks)
  reasons.push('Too few independent day/block windows: '+qualifyingDayBlocks.length);
 if(spanDays<COST_COVERAGE_MINIMUM.minCalendarSpanDays)
  reasons.push('Observed calendar span too short: '+spanDays+' days');
 return {
  status:reasons.length?'insufficient':'sufficient',
  requirementsVersion:'recorder-cost-coverage-v1',
  observedFromMs,observedToMs,observedUtcDays:observedDays.size,
  qualifyingUtcDays:qualifyingDays.size,
  observedSixHourBlocks:observedBlocks.size,
  qualifyingDayBlocks:qualifyingDayBlocks.length,
  observationSpanDays:spanDays,reasons
 };
}

export type MarketCostSummary = {
  symbol: string; quote: string; snapshotCount: number;
  spreadBps: DepthSummary;
  coverage:RecorderCostCoverage;
  bidDepth10bps: DepthSummary; askDepth10bps: DepthSummary;
  bidDepth25bps: DepthSummary; askDepth25bps: DepthSummary;
  // Recorder v1 stores aggregated depth bands, not the exact multi-level books
  // or queue positions needed for size-specific slippage and maker fills.
  slippage10: null; slippage50: null; slippage100: null;
  measuredMinimumEdgeBps: null;
  complete: false; reason: string;
};
const summary = (values: number[]): DepthSummary => ({
  median: percentile(values, 0.5), p90: percentile(values, 0.9)
});
/** Summarizes actual supplied observations, never substitutes test data as market evidence. */
export function summarizeRecorderCosts(symbol: string, snapshots: readonly BookSnapshot[]): MarketCostSummary {
  if (!/^[A-Z0-9]{2,20}\/(EUR|USDT|USDC)$/.test(symbol)) throw Error('Invalid market symbol');
  const rows = snapshots.filter(s => s.symbol === symbol);
  if (rows.length !== snapshots.length || rows.some(s =>
    !Number.isSafeInteger(s.ts) || s.ts < 0 || !Number.isFinite(s.bid) ||
    !Number.isFinite(s.ask) || s.bid <= 0 || s.ask <= s.bid ||
    ![s.spreadBps,s.depthBid10bps,s.depthAsk10bps,s.depthBid25bps,s.depthAsk25bps]
      .every(n => Number.isFinite(n) && n >= 0)))
    throw Error('Invalid recorder snapshot data');
  const values = (key: 'spreadBps'|'depthBid10bps'|'depthAsk10bps'|'depthBid25bps'|'depthAsk25bps') =>
    rows.map(s => s[key]);
  return {
    symbol, quote: symbol.split('/')[1]!, snapshotCount: rows.length,
    coverage:assessRecorderCostCoverage(rows),
    spreadBps: summary(values('spreadBps')),
    bidDepth10bps: summary(values('depthBid10bps')),
    askDepth10bps: summary(values('depthAsk10bps')),
    bidDepth25bps: summary(values('depthBid25bps')),
    askDepth25bps: summary(values('depthAsk25bps')),
    slippage10: null, slippage50: null, slippage100: null,
    measuredMinimumEdgeBps: null, complete: false,
    reason: 'Recorder v1 lacks full depth/queue observations; size-specific fills and measured edge are unknown'
  };
}

/** Receipt-time quality is an offline diagnostic, not a claim that aggregate
 * trade prints reproduce executable book depth or maker queue position. */
export type CostReplayQuality={
 version:'recorder-cost-replay-receipt-v1';
 symbol:string;decisionCutoffMs:number;
 status:'valid'|'insufficient'|'invalid';
 eligibleTradeIds:number[];
 eligibleTrades:number;
 rejectedLate:number;unknownReceipt:number;clockConflict:number;
 duplicateIds:number;chronologyAnomalies:number;
 medianReceiptLatencyMs:number|null;p90ReceiptLatencyMs:number|null;
 maxReceiptLatencyMs:number|null;knownReceiptPct:number;
 observedSourceStatus:'consistent'|'incomplete'|'conflict';
 sourceFingerprint:string;
 /** The recorder cannot certify executable slippage or queue fills. */
 executableCostEvidenceComplete:false;
 reasons:string[];fingerprint:string;
};
/** Pure deterministic diagnostic. Never treats exchange time as receipt time. */
export function summariseReceivedCostReplay(event:ReceivedTradeCutoff):CostReplayQuality{
 const invalid=event.sourceStatus==='conflict'||event.excluded.clockConflict>0||
  event.anomalies.some(a=>['receive-order','exchange-order','receive-before-exchange','id-conflict'].includes(a.kind));
 const total=event.eligible.length+event.excluded.late+
  event.excluded.unknownReceipt+event.excluded.clockConflict;
 const known=event.eligible.length;
 const latencies=event.eligible.map(t=>t.receivedAt!-t.ts);
 if(latencies.some(x=>!Number.isSafeInteger(x)||x<0))throw Error('Invalid received cost replay latency');
 const chronologyAnomalies=event.anomalies.filter(a=>[
  'receive-order','exchange-order','receive-before-exchange','id-conflict'
 ].includes(a.kind)).length;
 const reasons:string[]=[];
 if(invalid)reasons.push('CLOCK_OR_ORDER_CONFLICT: exchange, reception or IDs contradict');
 if(event.sourceStatus!=='consistent')reasons.push('RECORDER_SOURCE_'+event.sourceStatus.toUpperCase());
 if(event.excluded.late)reasons.push('LATE_RECEIPTS_EXCLUDED: '+event.excluded.late);
 if(event.excluded.unknownReceipt)reasons.push('UNKNOWN_RECEIPTS_EXCLUDED: '+event.excluded.unknownReceipt);
 if(event.excluded.clockConflict)reasons.push('CLOCK_SKEW_EXCLUDED: '+event.excluded.clockConflict);
 if(event.duplicateTradeIds)reasons.push('DUPLICATE_AGG_IDS_DEDUPLICATED: '+event.duplicateTradeIds);
 if(!known)reasons.push('NO_CAUSAL_RECEIVED_TRADES');
 const status:CostReplayQuality['status']=invalid?'invalid':
  reasons.length?'insufficient':'valid';
 const payload={
  version:'recorder-cost-replay-receipt-v1' as const,symbol:event.symbol,
  decisionCutoffMs:event.cutoffMs,status,
  eligibleTradeIds:event.eligible.map(x=>x.aggId),eligibleTrades:known,
  rejectedLate:event.excluded.late,unknownReceipt:event.excluded.unknownReceipt,
  clockConflict:event.excluded.clockConflict,
  duplicateIds:event.duplicateTradeIds,chronologyAnomalies,
  medianReceiptLatencyMs:percentile(latencies,.5),
  p90ReceiptLatencyMs:percentile(latencies,.9),
  maxReceiptLatencyMs:latencies.length?Math.max(...latencies):null,
  knownReceiptPct:total?100*known/total:0,
  observedSourceStatus:event.sourceStatus,
  sourceFingerprint:event.sourceFingerprint,
  executableCostEvidenceComplete:false as const,
  reasons
 };
 return {...payload,fingerprint:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
}
/** Strict point-in-time API: it queries only a read-only local recorder and
 * never invokes a backtest or an order-placement path. */
export function receivedCostReplay(symbol:string,from:number,to:number,
 decisionCutoffMs:number,dir?:string):CostReplayQuality {
 return summariseReceivedCostReplay(readTradesReceivedBy(symbol,from,to,decisionCutoffMs,dir));
}
