import {getBookSnapshots, getMonthReport} from './reader.js';
import {summarizeRecorderCosts, type MarketCostSummary} from './cost-hurdle.js';

/** Descriptive public recorder evidence; not an execution-cost certification. */
export type CostReport = {
  schema: 'cost-hurdle-observations-v1';
  month: string;
  source: 'local-public-recorder';
  markets: MarketCostSummary[];
  observedMarkets: number;
  observedQuotes: string[];
  meetsCoverageMinimum: boolean;
  coverageStatus:'sufficient'|'insufficient';
  observedFromMs:number|null;
  observedToMs:number|null;
  insufficientMarkets:string[];
  executableCostEvidenceComplete: false;
  limitations: string[];
};

export function buildCostReport(month: string, markets: readonly MarketCostSummary[]): CostReport {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Invalid report month');
  const symbols = new Set<string>();
  for (const m of markets) {
    if (symbols.has(m.symbol) || m.snapshotCount < 0 || !Number.isSafeInteger(m.snapshotCount) ||
        !['EUR', 'USDT', 'USDC'].includes(m.quote) || !m.symbol.endsWith('/' + m.quote))
      throw Error('Invalid or duplicated cost market');
    symbols.add(m.symbol);
  }
  const observed = markets.filter(m => m.snapshotCount > 0).sort((a,b) => a.symbol.localeCompare(b.symbol));
  const quotes = [...new Set(observed.map(m => m.quote))].sort();
  const [year,mo]=month.split('-').map(Number);
  const monthFrom=Date.UTC(year!,mo!-1,1),monthTo=Date.UTC(year!,mo!,1);
  const insufficientMarkets=observed.filter(m=>m.coverage.status!=='sufficient'||
    m.coverage.observedFromMs===null||m.coverage.observedToMs===null||
    m.coverage.observedFromMs<monthFrom||m.coverage.observedToMs>=monthTo)
    .map(m=>m.symbol);
  const timestamps=observed.flatMap(m=>[m.coverage.observedFromMs,m.coverage.observedToMs])
    .filter((x):x is number=>x!==null);
  const meetsCoverageMinimum=observed.length>=20&&quotes.length>=2&&
    insufficientMarkets.length===0;
  return {
    schema: 'cost-hurdle-observations-v1', month, source: 'local-public-recorder',
    markets: observed, observedMarkets: observed.length, observedQuotes: quotes,
    meetsCoverageMinimum,
    coverageStatus:meetsCoverageMinimum?'sufficient':'insufficient',
    observedFromMs:timestamps.length?Math.min(...timestamps):null,
    observedToMs:timestamps.length?Math.max(...timestamps):null,
    insufficientMarkets,executableCostEvidenceComplete: false,
    limitations: [
      !meetsCoverageMinimum?
       'COST_COVERAGE_INSUFFICIENT: need >=20 markets in >=2 quotes AND each observed market to meet versioned independent UTC-day/time-block coverage; no cost clearance.':'Recorder day/time-block coverage minimum passed; execution cost evidence is still incomplete.',
      'Recorder v1 contains aggregate 10/25 bps depth bands, not full order-book levels or historical queue position.',
      'Slippage for quote order sizes 10/50/100 and observed maker fill outcomes cannot be inferred from aggregate bands.',
      'Measured roundtrip edge remains unknown; this report MUST NOT be used as a cost admission whitelist.'
    ]
  };
}

/** Read only; emits machine-readable observations to stdout, never overwrites evidence files. */
export function loadCostReport(month: string, dir?: string): CostReport {
  const overview = getMonthReport(month, dir);
  if (!overview.exists) throw Error('No real recorder evidence for ' + month);
  const reports = overview.pairs.map(pair => {
    // Never present a truncated reader response as a complete monthly measurement.
    if (pair.snapshots >= 1_000_000) throw Error('Snapshot cap reached for ' + pair.symbol);
    const snapshots = getBookSnapshots(pair.symbol, overview.from, overview.to, dir,1_000_000);
    if (snapshots.length !== pair.snapshots)
      throw Error('Inconsistent recorder snapshot count for ' + pair.symbol);
    return summarizeRecorderCosts(pair.symbol, snapshots);
  });
  return buildCostReport(month, reports);
}
