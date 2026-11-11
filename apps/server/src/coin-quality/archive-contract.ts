/** Structural interface shared with Issues #3/#5; no code in those areas is modified. */
export type Candle = {
  ts: number; open: number; high: number; low: number; close: number;
  volume: number; quoteVolume?: number;
};
export interface CandleSource {
  getCandles(symbol: string, intervalMinutes: 15 | 60 | 240 | 1440,
    fromMs: number, toMs: number): Promise<Candle[]>;
  listSymbols(): Promise<string[]>;
}
/**
 * Do not expose terminal history information to a strategy.
 * Settle a residual position only AFTER the replay reaches the end of its data,
 * using the last observed close and a configurable adverse haircut.
 */
export function settleTerminalArchivePosition(
  observed: Candle[],
  replayEndMs: number,
  haircutPct = 10,
): {at: number; fill: number; reason: string} | null {
  const completed = observed.filter(c => c.ts + 86_400_000 <= replayEndMs &&
    Number.isFinite(c.close) && c.close > 0).sort((a,b) => a.ts-b.ts);
  const last = completed.at(-1);
  if (!last) return null;
  if (!Number.isFinite(haircutPct) || haircutPct < 0 || haircutPct >= 100)
    throw Error('Invalid archive haircut');
  return {
    at:last.ts + 86_400_000,
    fill:last.close * (1 - haircutPct/100),
    reason:'Post-replay terminal settlement, not an advance delisting signal',
  };
}

/**
 * Historical exchange-status observations are independent of the price-derived
 * point-in-time universe. A candle is NOT evidence that orders were possible.
 * This is a reporting-only contract; QualityProvider retains all admission logic.
 */
export type HistoricalTradabilityObservation = {
  symbol: string;
  status: 'tradable' | 'restricted';
  effectiveAt: number;
  observedAt: number;
  source: {name: string; fetchedAt: number; official: boolean};
};
export type HistoricalTradabilityAssessment = {
  status: 'evidenced-tradable' | 'evidenced-restricted' | 'unknown';
  knownAt: number | null;
  source: string | null;
  effectiveAt: number | null;
};
/** Require a contemporary, official archived observation. Later announcements
 * are never retroactively applied to dates when they were not yet known. */
export function historicalTradabilityAt(
  symbol: string,
  atMs: number,
  observations: readonly HistoricalTradabilityObservation[],
): HistoricalTradabilityAssessment {
  if (!Number.isSafeInteger(atMs) || atMs < 0 || !symbol.trim())
    throw Error('Invalid historical tradability query');
  const day = 86_400_000;
  const candidates = observations.filter(row => {
    if (row.symbol !== symbol || !['tradable','restricted'].includes(row.status) ||
        !row.source || !row.source.official || !row.source.name.trim() ||
        !Number.isSafeInteger(row.observedAt) || !Number.isSafeInteger(row.effectiveAt) ||
        !Number.isSafeInteger(row.source.fetchedAt) || row.observedAt < 0 ||
        row.effectiveAt < 0 || row.source.fetchedAt < 0) return false;
    const knownAt = Math.max(row.observedAt,row.source.fetchedAt);
    return knownAt <= atMs && row.effectiveAt <= atMs && atMs - knownAt < day;
  }).sort((a,b) =>
    Math.max(b.observedAt,b.source.fetchedAt) - Math.max(a.observedAt,a.source.fetchedAt) ||
    Number(a.status === 'tradable') - Number(b.status === 'tradable'));
  const latest = candidates[0];
  return latest ? {
    status:latest.status === 'tradable' ? 'evidenced-tradable' : 'evidenced-restricted',
    knownAt:Math.max(latest.observedAt,latest.source.fetchedAt),
    source:latest.source.name,effectiveAt:latest.effectiveAt
  } : {status:'unknown',knownAt:null,source:null,effectiveAt:null};
}

export type HistoricalTradabilitySummary = {
  membershipMode: 'point-in-time' | 'static-unverified';
  totalMarketDays: number | null;
  unknownMarketDays: number | null;
  restrictedMarketDays: number | null;
  evidencedTradableMarketDays: number | null;
  totalTrades: number;
  unknownTrades: number;
  restrictedTrades: number;
  evidencedTradableTrades: number;
  evidenceSources: Array<{
    symbol: string; status: HistoricalTradabilityObservation['status'];
    observedAt: number; effectiveAt: number; fetchedAt: number;
    name: string; official: boolean;
  }>;
};
/** Count market-days (a day for each eligible historical symbol), not just dates.
 * Unknown does not mean cleared. This function never modifies trading decisions. */
export function summarizeHistoricalTradability(input: {
  fromMs: number;
  toMs: number;
  universeHistory: readonly {dateMs: number; symbols: readonly string[]}[];
  trades: readonly {ts: number; symbol: string}[];
  observations?: readonly HistoricalTradabilityObservation[];
}): HistoricalTradabilitySummary {
  const {fromMs,toMs,universeHistory,trades}=input;
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs>=toMs)
    throw Error('Invalid historical tradability interval');
  const observations=input.observations??[];
  const seenDays=new Set<number>();
  let totalMarketDays=0,unknownMarketDays=0,restrictedMarketDays=0,evidencedTradableMarketDays=0;
  for (const day of universeHistory) {
    if (day.dateMs<fromMs || day.dateMs>=toMs) continue;
    if (!Number.isSafeInteger(day.dateMs) || seenDays.has(day.dateMs) ||
        new Set(day.symbols).size !== day.symbols.length)
      throw Error('Invalid historical tradability membership');
    seenDays.add(day.dateMs);
    for (const symbol of day.symbols) {
      totalMarketDays++;
      const status=historicalTradabilityAt(symbol,day.dateMs,observations).status;
      if(status==='evidenced-tradable')evidencedTradableMarketDays++;
      else if(status==='evidenced-restricted')restrictedMarketDays++;
      else unknownMarketDays++;
    }
  }
  let unknownTrades=0,restrictedTrades=0,evidencedTradableTrades=0;
  for (const trade of trades) {
    const status=historicalTradabilityAt(trade.symbol,trade.ts,observations).status;
    if(status==='evidenced-tradable')evidencedTradableTrades++;
    else if(status==='evidenced-restricted')restrictedTrades++;
    else unknownTrades++;
  }
  const pointInTime=universeHistory.length>0;
  return {
    membershipMode:pointInTime?'point-in-time':'static-unverified',
    totalMarketDays:pointInTime?totalMarketDays:null,
    unknownMarketDays:pointInTime?unknownMarketDays:null,
    restrictedMarketDays:pointInTime?restrictedMarketDays:null,
    evidencedTradableMarketDays:pointInTime?evidencedTradableMarketDays:null,
    totalTrades:trades.length,unknownTrades,restrictedTrades,evidencedTradableTrades,
    evidenceSources:observations.filter(row=>row.source && Number.isSafeInteger(row.observedAt) &&
      Number.isSafeInteger(row.source.fetchedAt) && Math.max(row.observedAt,row.source.fetchedAt)<toMs)
      .map(row=>({
      symbol:row.symbol,status:row.status,observedAt:row.observedAt,effectiveAt:row.effectiveAt,
      fetchedAt:row.source.fetchedAt,name:row.source.name,official:row.source.official
    }))
  };
}
