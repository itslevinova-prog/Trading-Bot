import {percentile,type MakerSelectionWindow} from './reader.js';

/** Recorded decision quotes, not reconstructed from later trades. */
export type MakerSelectionSignal={
  id:string;
  symbol:string;
  side:'buy'|'sell';
  decisionAt:number;
  limitObservedAt:number;
  limitPrice:number;
  takerReferencePrice:number;
  takerObservedAt:number;
  qty:number;
  ttlMs:number;
  makerFeeBps:number;
  takerFeeBps:number;
};
export type MakerSelectionRow={
  signalId:string;
  horizonMs:number;
  status:'hypothetical_filled'|'missed'|'unobservable';
  hypotheticalFillTradeId:number|null;
  makerNetMarkoutBps:number|null;
  takerNetMarkoutBps:number|null;
  pairedMakerMinusTakerBps:number|null;
};
export type MakerSelectionHorizon={
  horizonMs:number;
  hypotheticalFills:number;
  missed:number;
  unknown:number;
  makerMedianBps:number|null;
  takerAllMedianBps:number|null;
  takerOnFilledMedianBps:number|null;
  pairedDeltaMedianBps:number|null;
};
export type MakerSelectionReport={
  version:'maker-selection-public-replay-v1';
  status:'ok'|'insufficient_evidence';
  reason:string|null;
  symbol:string;
  sourceFingerprint:string;
  sourceStatus:MakerSelectionWindow['sourceStatus'];
  recorderGapCount:number;
  unknownReceiptCount:number;
  signals:number;
  horizons:MakerSelectionHorizon[];
  rows:MakerSelectionRow[];
  note:string;
};

const validTime=(t:number)=>Number.isSafeInteger(t)&&t>=0;
const validPrice=(n:number)=>Number.isFinite(n)&&n>0;
const NOTE='Read-only hypothetical maker crossing, not an actual queue fill. Uses only recorded local receipt times; matched taker is an assumption at the original signal, not a real execution. No trade, latency, cost or profit certification.';

/**
 * Ex-post markout by *decision time*, on identical signals and horizon closes.
 * A strict later public trade through the observed limit proves only a possible
 * paper fill; a touch, late receipt or unknown queue position is not enough.
 * Every mark uses the first causally received public trade after the horizon.
 */
export function measureMakerSelection(
  signals:readonly MakerSelectionSignal[],
  evidence:MakerSelectionWindow,
  horizonsMs:readonly number[]=[60_000,300_000],
  maxMarkDelayMs=60_000
):MakerSelectionReport {
  if(!horizonsMs.length||horizonsMs.length>24||
    horizonsMs.some(x=>!Number.isSafeInteger(x)||x<1)||
    new Set(horizonsMs).size!==horizonsMs.length||
    !Number.isSafeInteger(maxMarkDelayMs)||maxMarkDelayMs<1)
    throw Error('Invalid maker selection horizon');
  const base={version:'maker-selection-public-replay-v1' as const,
    symbol:evidence.symbol,sourceFingerprint:evidence.sourceFingerprint,
    sourceStatus:evidence.sourceStatus,
    recorderGapCount:evidence.gaps.length+evidence.missingMonths.length,
    unknownReceiptCount:evidence.trades.filter(t=>t.receivedAt===null).length,
    signals:signals.length,note:NOTE};
  const blank=(reason:string):MakerSelectionReport=>({
    ...base,status:'insufficient_evidence',reason,
    rows:[],horizons:horizonsMs.map(h=>({
      horizonMs:h,hypotheticalFills:0,missed:0,unknown:signals.length,
      makerMedianBps:null,takerAllMedianBps:null,
      takerOnFilledMedianBps:null,pairedDeltaMedianBps:null
    }))
  });
  if(evidence.status!=='complete'||evidence.sourceStatus!=='consistent'||
    evidence.gaps.length||evidence.missingMonths.length||evidence.anomalies.length)
    return blank('Recorder gaps, missing months or chronology anomalies; no comparison certified.');
  if(!signals.length)return blank('No frozen signals supplied.');
  const ids=new Set<string>();
  const maxHorizon=Math.max(...horizonsMs);
  for(const s of signals){
    if(!s.id||ids.has(s.id)||s.symbol!==evidence.symbol||
      !['buy','sell'].includes(s.side)||!validTime(s.decisionAt)||
      !validTime(s.limitObservedAt)||!validTime(s.takerObservedAt)||
      s.limitObservedAt>s.decisionAt||s.takerObservedAt>s.decisionAt||
      !validPrice(s.limitPrice)||!validPrice(s.takerReferencePrice)||
      !validPrice(s.qty)||!Number.isSafeInteger(s.ttlMs)||s.ttlMs<1||
      !Number.isFinite(s.makerFeeBps)||s.makerFeeBps<0||s.makerFeeBps>1000||
      !Number.isFinite(s.takerFeeBps)||s.takerFeeBps<0||s.takerFeeBps>1000||
      s.decisionAt<evidence.from||s.decisionAt+maxHorizon+maxMarkDelayMs>=evidence.to)
      return blank('Signal quote/receipt time, fee assumption or complete future observation window missing.');
    ids.add(s.id);
  }
  const trades=[...evidence.trades].sort((a,b)=>a.receivedAt!-b.receivedAt!||
    a.ts-b.ts||a.aggId-b.aggId);
  if(!trades.length||trades.some(t=>t.symbol!==evidence.symbol||
    t.receivedAt===null||!validTime(t.ts)||!validTime(t.receivedAt)||
    t.receivedAt<t.ts||!validPrice(t.price)||!validPrice(t.qty)))
    return blank('No complete, causally received public trade sequence.');
  for(let i=1;i<trades.length;i++){
    if(trades[i]!.aggId===trades[i-1]!.aggId)
      return blank('Duplicate public trade IDs.');
  }
  const markout=(side:'buy'|'sell',entry:number,mark:number,feeBps:number)=>
    (side==='buy'?1:-1)*(mark/entry-1)*10_000-feeBps;
  const rows:MakerSelectionRow[]=[];
  for(const s of signals)for(const horizonMs of horizonsMs){
    const cutoff=s.decisionAt+horizonMs;
    const marker=trades.find(t=>t.receivedAt!>=cutoff&&
      t.receivedAt!<=cutoff+maxMarkDelayMs);
    if(!marker){
      rows.push({signalId:s.id,horizonMs,status:'unobservable',
        hypotheticalFillTradeId:null,makerNetMarkoutBps:null,
        takerNetMarkoutBps:null,pairedMakerMinusTakerBps:null});
      continue;
    }
    const fill=trades.find(t=>t.receivedAt!>s.decisionAt&&
      t.receivedAt!<Math.min(cutoff,s.decisionAt+s.ttlMs)&&
      t.qty>=s.qty&&(s.side==='buy'?t.price<s.limitPrice:t.price>s.limitPrice));
    const taker=markout(s.side,s.takerReferencePrice,marker.price,s.takerFeeBps);
    const maker=fill?markout(s.side,s.limitPrice,marker.price,s.makerFeeBps):null;
    rows.push({signalId:s.id,horizonMs,status:fill?'hypothetical_filled':'missed',
      hypotheticalFillTradeId:fill?.aggId??null,
      makerNetMarkoutBps:maker,takerNetMarkoutBps:taker,
      pairedMakerMinusTakerBps:maker===null?null:maker-taker});
  }
  const horizons=horizonsMs.map(horizonMs=>{
    const subset=rows.filter(r=>r.horizonMs===horizonMs);
    const filled=subset.filter(r=>r.status==='hypothetical_filled');
    const vals=(rows:MakerSelectionRow[],key:'makerNetMarkoutBps'|'takerNetMarkoutBps'|'pairedMakerMinusTakerBps')=>
      percentile(rows.map(r=>r[key]).filter((v):v is number=>v!==null),.5);
    return {horizonMs,hypotheticalFills:filled.length,
      missed:subset.filter(r=>r.status==='missed').length,
      unknown:subset.filter(r=>r.status==='unobservable').length,
      makerMedianBps:vals(filled,'makerNetMarkoutBps'),
      takerAllMedianBps:vals(subset,'takerNetMarkoutBps'),
      takerOnFilledMedianBps:vals(filled,'takerNetMarkoutBps'),
      pairedDeltaMedianBps:vals(filled,'pairedMakerMinusTakerBps')};
  });
  const unknown=horizons.some(x=>x.unknown>0);
  return {...base,status:unknown?'insufficient_evidence':'ok',
    reason:unknown?'Missing post-horizon public trades; some signals cannot be evaluated.':null,
    horizons,rows};
}
