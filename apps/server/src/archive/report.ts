import {mkdirSync, writeFileSync, existsSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {aggregateHourly, DAY, DEFAULT_ARCHIVE_DB, openArchive, updateRegimes, type ArchiveCandle, type ArchiveDb} from './store.js';
import {ARCHIVE_DOC, ARCHIVE_REPORT} from './paths.js';

export type Gap = {symbol: string; intervalMin: number; month: string; missing: number};
export type QualityReport = {
  generatedAt: string; symbols: number; candles: number; earliest: string|null; latest: string|null;
  gaps: Gap[]; duplicates: number; outlierCandles: number; archiveDbBytes: number;
  rawZipBytes: number; dailyParity: {checked: number; mismatches: number};
};
const monthKey = (ts: number) => new Date(ts).toISOString().slice(0, 7);


/** Offline research gate: every historically eligible symbol must have its own
 * completed candles and pre-entry warm-up. We deliberately never fill gaps. */
export type CoverageInterval = 15 | 60 | 240 | 1440;
export type CoverageInput = {
  symbol: string;
  intervalMin: CoverageInterval;
  candles: readonly {ts: number}[];
};
export type CoverageMonth = {
  symbol: string;
  intervalMin: CoverageInterval;
  month: string;
  expected: number;
  observed: number;
  missing: number;
  completeness: number;
  firstExpectedCloseMs: number;
  firstTradableCloseMs: number | null;
  warmupExpected: number;
  warmupObserved: number;
  missingOpens: number[];
};
export type CoveragePreflight = {
  status: 'passed' | 'blocked';
  reason: string | null;
  fingerprint: string;
  rows: CoverageMonth[];
};
const DEFAULT_WARMUP_BARS: Record<CoverageInterval, number> = {15: 100, 60: 100, 240: 40, 1440: 10};

/** Read-only matrix. Membership is checked at candle close (as in the runner),
 * not against today's symbols; a later listing cannot hide an earlier gap. */
export function assessResearchCoverage(input: {
  fromMs: number;
  toMs: number;
  universeHistory: readonly {dateMs: number; symbols: readonly string[]}[];
  series: readonly CoverageInput[];
  warmupBars?: Partial<Record<CoverageInterval, number>>;
}): CoveragePreflight {
  const DAY_MS = 86_400_000;
  const {fromMs, toMs} = input;
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) ||
      fromMs < 0 || fromMs >= toMs || toMs > Date.UTC(2024, 0, 1) ||
      fromMs % DAY_MS !== 0 || toMs % DAY_MS !== 0)
    throw Error('Research coverage only accepts aligned development dates before 2024');
  const membership = new Map<number, Set<string>>();
  for (const day of input.universeHistory) {
    if (!Number.isSafeInteger(day.dateMs) || day.dateMs % DAY_MS !== 0 ||
        membership.has(day.dateMs) || new Set(day.symbols).size !== day.symbols.length)
      throw Error('Invalid point-in-time membership for coverage');
    membership.set(day.dateMs, new Set(day.symbols));
  }
  const expectedDays = (toMs - fromMs) / DAY_MS;
  for (let i = 0; i <= expectedDays; i++)
    if (!membership.has(fromMs + i * DAY_MS))
      throw Error('Incomplete historical membership in coverage preflight');
  const series = [...input.series].sort((a, b) =>
    a.symbol.localeCompare(b.symbol) || a.intervalMin - b.intervalMin);
  if (new Set(series.map(row => row.symbol + ':' + row.intervalMin)).size !== series.length)
    throw Error('Duplicate coverage series');
  const rows: CoverageMonth[] = [];
  const fingerprintSources: unknown[] = [];
  for (const entry of series) {
    const {symbol, intervalMin} = entry;
    if (![15, 60, 240, 1440].includes(intervalMin))
      throw Error('Unknown coverage interval');
    const step = intervalMin * 60_000;
    const needed = input.warmupBars?.[intervalMin] ?? DEFAULT_WARMUP_BARS[intervalMin];
    if (!Number.isSafeInteger(needed) || needed < 1)
      throw Error('Invalid minimum warm-up for coverage');
    const present = new Set(entry.candles.map(bar => bar.ts));
    if (present.size !== entry.candles.length ||
        entry.candles.some(bar => !Number.isSafeInteger(bar.ts) || bar.ts % step !== 0))
      throw Error('Duplicate or misaligned coverage candle');
    const months = new Map<string, number[]>();
    for (let ts = fromMs; ts < toMs; ts += step) {
      const closeDay = Math.floor((ts + step) / DAY_MS) * DAY_MS;
      if (!membership.get(closeDay)!.has(symbol)) continue;
      const month = monthKey(ts);
      const expected = months.get(month) ?? [];
      expected.push(ts);
      months.set(month, expected);
    }
    fingerprintSources.push({symbol, intervalMin, timestamps: [...present].sort((a, b) => a - b)});
    for (const [month, expected] of months) {
      const first = expected[0]!;
      let warmupObserved = 0;
      for (let n = 1; n <= needed; n++)
        if (present.has(first - n * step)) warmupObserved++;
      const observed = expected.filter(ts => present.has(ts)).length;
      const missingOpens = expected.filter(ts => !present.has(ts));
      rows.push({
        symbol, intervalMin, month, expected: expected.length, observed,
        missing: missingOpens.length, completeness: observed / expected.length,
        firstExpectedCloseMs: first + step,
        firstTradableCloseMs: warmupObserved === needed && present.has(first) ? first + step : null,
        warmupExpected: needed, warmupObserved, missingOpens
      });
    }
  }
  rows.sort((a, b) => a.month.localeCompare(b.month) || a.symbol.localeCompare(b.symbol) || a.intervalMin - b.intervalMin);
  const failures = rows.filter(row => row.missing > 0 || row.warmupObserved < row.warmupExpected);
  const reason = !rows.length ? 'No eligible historical candles to verify' :
    failures.length ? failures.length + ' market/interval/month coverage rows lack candles or warm-up' : null;
  const fingerprint = createHash('sha256').update(JSON.stringify({
    fromMs, toMs,
    membership: [...membership.entries()].sort(([a], [b]) => a - b).map(([day, members]) => [day, [...members].sort()]),
    rows, sources: fingerprintSources
  })).digest('hex');
  return {status: reason ? 'blocked' : 'passed', reason, fingerprint, rows};
}

export function qualityReport(db: ArchiveDb, databasePath = DEFAULT_ARCHIVE_DB): QualityReport {
  const summary = db.prepare('SELECT COUNT(DISTINCT symbol) AS symbols, COUNT(*) AS candles, MIN(ts) AS earliest, MAX(ts) AS latest FROM candles').get() as {
    symbols:number; candles:number; earliest:number|null; latest:number|null;
  };
  const duplicates = (db.prepare('SELECT COALESCE(SUM(duplicates),0) AS n FROM files').get() as {n:number}).n;
  const gaps = new Map<string, Gap>();
  const addGap = (symbol: string, intervalMin: number, ts: number, missing: number) => {
    const month = monthKey(ts);
    const key = symbol + ':' + intervalMin + ':' + month;
    const row = gaps.get(key) ?? {symbol, intervalMin, month, missing: 0};
    row.missing += missing;
    gaps.set(key, row);
  };
  let prior: {symbol:string; interval_min:number; ts:number}|undefined;
  let outlierCandles = 0;
  for (const bar of db.prepare('SELECT symbol,interval_min,ts,open,high,low FROM candles ORDER BY symbol,interval_min,ts')
    .iterate() as Iterable<{symbol:string;interval_min:number;ts:number;open:number;high:number;low:number}>) {
    if ((bar.high - bar.low) / bar.open > .5) outlierCandles++;
    if (prior && bar.symbol === prior.symbol && bar.interval_min === prior.interval_min) {
      const step = bar.interval_min * 60_000;
      let expected = prior.ts + step;
      while (expected < bar.ts) {
        const date = new Date(expected);
        const boundary = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
        const end = Math.min(bar.ts, boundary);
        const missing = Math.ceil((end - expected) / step);
        if (missing <= 0) break;
        addGap(bar.symbol, bar.interval_min, expected, missing);
        expected += missing * step;
      }
    }
    prior = bar;
  }
  // Independent 1h-to-1d consistency sample: only complete sets are compared.
  const days = db.prepare('SELECT ts,open,high,low,close,volume,quote_volume AS quoteVolume,trades FROM candles WHERE symbol=? AND interval_min=1440 ORDER BY ts LIMIT 60')
    .all('BTCUSDT') as ArchiveCandle[];
  let checked = 0, mismatches = 0;
  for (const daily of days) {
    const hours = db.prepare('SELECT ts,open,high,low,close,volume,quote_volume AS quoteVolume,trades FROM candles WHERE symbol=? AND interval_min=60 AND ts>=? AND ts<? ORDER BY ts')
      .all('BTCUSDT', daily.ts, daily.ts + DAY) as ArchiveCandle[];
    const result = aggregateHourly(hours, 24)[0];
    if (!result) continue;
    checked++;
    if (Math.abs(result.open - daily.open) > 1e-8 ||
        Math.abs(result.close - daily.close) > 1e-8 ||
        Math.abs(result.high - daily.high) > 1e-8 ||
        Math.abs(result.low - daily.low) > 1e-8 ||
        Math.abs(result.volume - daily.volume) > Math.max(1e-6, daily.volume * 1e-8))
      mismatches++;
  }
  let rawZipBytes = 0;
  for (const file of db.prepare('SELECT path FROM files').iterate() as Iterable<{path:string}>) {
    if (existsSync(file.path)) rawZipBytes += statSync(file.path).size;
  }
  return {
    generatedAt: new Date().toISOString(), symbols: summary.symbols, candles: summary.candles,
    earliest: summary.earliest === null ? null : new Date(summary.earliest).toISOString(),
    latest: summary.latest === null ? null : new Date(summary.latest).toISOString(),
    gaps: [...gaps.values()].sort((a,b) => a.symbol.localeCompare(b.symbol) || a.intervalMin - b.intervalMin || a.month.localeCompare(b.month)),
    duplicates, outlierCandles, archiveDbBytes: [databasePath, databasePath + '-wal', databasePath + '-shm'].reduce((sum, file) => sum + (existsSync(file) ? statSync(file).size : 0), 0),
    rawZipBytes, dailyParity: {checked, mismatches}
  };
}
export function writeReport(db: ArchiveDb, databasePath = DEFAULT_ARCHIVE_DB): QualityReport {
  updateRegimes(db);
  const result = qualityReport(db, databasePath);
  const json = ARCHIVE_REPORT;
  mkdirSync(dirname(json), {recursive: true});
  writeFileSync(json, JSON.stringify(result, null, 2) + '\n');
  const biggest = [...result.gaps].sort((a,b) => b.missing - a.missing).slice(0, 30);
  const lines = [
    '# Binance Spot – lokales Datenarchiv',
    '',
    'Automatisch generiert durch pnpm data:report (' + result.generatedAt + '). Kein Profitabilitätsnachweis.',
    '',
    '| Kennzahl | Wert |', '| --- | ---: |',
    '| Symbole mit Kerzen | ' + result.symbols + ' |',
    '| Kerzen insgesamt | ' + result.candles + ' |',
    '| Erste Kerze (UTC) | ' + (result.earliest ?? 'keine') + ' |',
    '| Letzte Kerze (UTC) | ' + (result.latest ?? 'keine') + ' |',
    '| Fehlende Zeitfenster innerhalb bekannter Reihen | ' + result.gaps.reduce((n,g) => n + g.missing, 0) + ' |',
    '| Doppelte importierte Zeitstempel | ' + result.duplicates + ' |',
    '| Kerzen mit Range > 50% des Open | ' + result.outlierCandles + ' |',
    '| Archiv-DB (Bytes) | ' + result.archiveDbBytes + ' |',
    '| Roh-ZIPs (Bytes) | ' + result.rawZipBytes + ' |',
    '| 1h → 1d Paritätsvergleich (geprüft / abweichend) | ' + result.dailyParity.checked + ' / ' + result.dailyParity.mismatches + ' |',
    '',
    '## Größte Lücken nach Symbol / Monat / Intervall',
    '',
    '| Symbol | Minuten | Monat (UTC) | Fehlende Kerzen |',
    '| --- | ---: | --- | ---: |',
    ...biggest.map(g => '| ' + g.symbol + ' | ' + g.intervalMin + ' | ' + g.month + ' | ' + g.missing + ' |'),
    '',
    'Der vollständige maschinenlesbare Report steht unter data/archive/report.json (lokal, gitignored).',
    'Lücken außerhalb des beobachteten ersten/letzten Zeitstempels sind unbekannt und werden nicht geschätzt.',
    'Unvollständige 4h-Gruppen werden nicht synthetisiert. Regime-Labels liegen in der separaten Archiv-DB.',
    ''
  ];
  writeFileSync(ARCHIVE_DOC, lines.join('\n'));
  return result;
}
export function runReport(): void {
  const db = openArchive();
  try { console.log(JSON.stringify(writeReport(db), null, 2)); }
  finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {runReport();} catch (error) {console.error(error); process.exitCode = 1;}
}
