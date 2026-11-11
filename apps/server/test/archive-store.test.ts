import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtempSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openArchive, parseCsv, importZip, aggregateHourly, type ArchiveDb, DAY} from '../src/archive/store.js';
import {ArchiveCandleSource} from '../src/archive/candle-source.js';

let directory = '';
let db: ArchiveDb;
const fixture = (name: string) => readFileSync(new URL('./fixtures/archive/' + name, import.meta.url));
const checked = (name: string, interval: 15|60|1440) =>
  importZip(db, name, fixture(name), fixture(name + '.CHECKSUM').toString('utf8'), interval);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'trading-archive-'));
  db = openArchive(join(directory, 'archive.db'));
});
afterEach(() => {db.close(); rmSync(directory, {recursive:true, force:true});});

describe('Archive import / CSV quality (no network)', () => {
  it('rejects a wrong SHA256 checksum without writing any candles or files', () => {
    const file = 'BTCUSDT-1h-2024-01.zip';
    expect(() => importZip(db, file, fixture(file), '0'.repeat(64) + '  ' + file, 60)).toThrow(/SHA256 mismatch/);
    expect((db.prepare('SELECT COUNT(*) AS n FROM files').get() as {n:number}).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM candles').get() as {n:number}).n).toBe(0);
  });
  it('parses and imports a 2025 Spot microsecond timestamp as UTC milliseconds', () => {
    const result = checked('BTCUSDT-1d-2025-01.zip', 1440);
    expect(result.rows).toBe(1);
    const row = db.prepare('SELECT ts FROM candles WHERE interval_min=1440').get() as {ts:number};
    expect(row.ts).toBe(Date.UTC(2025, 0, 1));
  });
  it('imports idempotently and never duplicates the same archive file', () => {
    const first = checked('BTCUSDT-1h-2024-01.zip', 60);
    const second = checked('BTCUSDT-1h-2024-01.zip', 60);
    expect(first).toMatchObject({rows:24, duplicates:0, skipped:false});
    expect(second).toMatchObject({rows:24, skipped:true});
    expect((db.prepare('SELECT COUNT(*) AS n FROM candles').get() as {n:number}).n).toBe(24);
  });
  it('aggregates complete UTC 4h intervals and matches independent 1d data from ZIP', () => {
    checked('BTCUSDT-1h-2024-01.zip', 60);
    checked('BTCUSDT-1d-2024-01.zip', 1440);
    const hours = db.prepare('SELECT ts,open,high,low,close,volume,quote_volume AS quoteVolume,trades FROM candles WHERE interval_min=60 ORDER BY ts').all() as
      {ts:number;open:number;high:number;low:number;close:number;volume:number;quoteVolume:number;trades:number}[];
    const four = aggregateHourly(hours, 4);
    expect(four).toHaveLength(6);
    expect(four[0]).toMatchObject({open:100, close:103.5, high:104, low:99, volume:46});
    const daily = aggregateHourly(hours, 24)[0]!;
    const downloaded = db.prepare('SELECT open,high,low,close,volume,quote_volume AS quoteVolume,trades FROM candles WHERE interval_min=1440').get() as typeof daily;
    expect(daily).toMatchObject({open: downloaded.open, high:downloaded.high, low:downloaded.low, close:downloaded.close, volume:downloaded.volume, quoteVolume:downloaded.quoteVolume, trades:downloaded.trades});
    expect(aggregateHourly(hours.slice(0,3), 4)).toHaveLength(0);
    expect(aggregateHourly(hours.filter((_, i) => i !== 2), 4)).toHaveLength(5);
  });
  it('rejects malformed rows instead of silently skipping them', () => {
    expect(() => parseCsv('1704067200000,abc,2,1,2,1,1704070799999,2,1,1,1,0')).toThrow();
  });
});

describe('Exact CandleSource contract and holdout audit (no network)', () => {
  it('returns ascending, closed, gap-preserving candles and logs validation access', async () => {
    checked('BTCUSDT-1h-2024-01.zip', 60);
    const source = new ArchiveCandleSource({databasePath:join(directory,'archive.db'), accessLogPath:join(directory,'access.log')});
    try {
      const start = Date.UTC(2024,0,1);
      const bars = await source.getCandles('BTCUSDT', 240, start, start + DAY);
      expect(bars).toHaveLength(6);
      expect(bars[0]?.ts).toBe(start);
      expect((await source.listSymbols())).toEqual(['BTCUSDT']);
      expect(readFileSync(join(directory,'access.log'),'utf8')).toContain('"kind":"validation"');
    } finally { source.close(); }
  });
  it('denies holdout access by default and logs explicitly justified access', async () => {
    checked('BTCUSDT-1d-2025-01.zip', 1440);
    const start = Date.UTC(2025,0,1);
    const base = {databasePath:join(directory,'archive.db'), accessLogPath:join(directory,'access.log')};
    const locked = new ArchiveCandleSource(base);
    try {
      await expect(locked.getCandles('BTCUSDT',1440,start,start+DAY)).rejects.toThrow(/Holdout is locked/);
    } finally {locked.close();}
    const allowed = new ArchiveCandleSource({...base, allowHoldout:{reason:'pre-registered independent evaluation'}});
    try {
      const bars = await allowed.getCandles('BTCUSDT',1440,start,start+DAY);
      expect(bars).toHaveLength(1);
      expect(bars[0]?.ts).toBe(start);
    } finally {allowed.close();}
    const log = readFileSync(join(directory,'access.log'),'utf8');
    expect(log).toContain('holdout-denied');
    expect(log).toContain('holdout-allowed');
    expect(log).toContain('pre-registered independent evaluation');
    expect(existsSync(join(directory,'holdout-access.log'))).toBe(false);
  });
});
