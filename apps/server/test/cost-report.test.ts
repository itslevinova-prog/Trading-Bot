import {expect,test} from 'vitest';
import {buildCostReport,loadCostReport} from '../src/recorder/cost-report.js';
import {summarizeRecorderCosts} from '../src/recorder/cost-hurdle.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const make = (symbol:string) => summarizeRecorderCosts(symbol, [{
  ts: 1000, symbol, bid: 100, bidQty: 2, ask: 101, askQty: 2,
  spreadBps: 99.5, depthBid10bps: 2, depthAsk10bps: 2,
  depthBid25bps: 5, depthAsk25bps: 4
}]);

test('cost observation output is deterministic and does not invent a tradable edge', () => {
  const report = buildCostReport('2026-11',[make('BTC/USDT'),make('ETH/EUR')]);
  expect(report.observedMarkets).toBe(2);
  expect(report.observedQuotes).toEqual(['EUR','USDT']);
  expect(report.meetsCoverageMinimum).toBe(false);
  expect(report.executableCostEvidenceComplete).toBe(false);
  expect(report.markets[0]?.measuredMinimumEdgeBps).toBeNull();
  expect(report.markets[0]?.slippage100).toBeNull();
  expect(report.source).toBe('local-public-recorder');
});

test('20 thinly sampled pairs in two quotes do NOT satisfy independent time coverage', () => {
  const symbols = Array.from({length:10},(_,i) => 'COIN'+i);
  const report = buildCostReport('2026-11',symbols.flatMap(s => [make(s+'/EUR'),make(s+'/USDT')]));
  expect(report.observedMarkets).toBe(20);
  expect(report.meetsCoverageMinimum).toBe(false);
  expect(report.coverageStatus).toBe('insufficient');
  expect(report.insufficientMarkets).toHaveLength(20);
  expect(report.executableCostEvidenceComplete).toBe(false);
  expect(report.markets.every(m => m.complete === false)).toBe(true);
});

test('empty, duplicate, invalid and missing observations fail closed', () => {
  expect(buildCostReport('2026-11',[]).observedMarkets).toBe(0);
  expect(() => buildCostReport('2026-11',[make('BTC/USDT'),make('BTC/USDT')])).toThrow('duplicated');
  expect(() => buildCostReport('2026-13',[])).toThrow('month');
  const dir = mkdtempSync(join(tmpdir(),'cost-report-'));
  try { expect(() => loadCostReport('2026-11',dir)).toThrow('No real recorder evidence'); }
  finally { rmSync(dir,{recursive:true,force:true}); }
});
