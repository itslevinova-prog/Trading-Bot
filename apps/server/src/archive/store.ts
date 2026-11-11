import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {extractArchiveCsv} from './zip.js';
import {ARCHIVE_DB} from './paths.js';

export const DEFAULT_ARCHIVE_DB = ARCHIVE_DB;
export const DAY = 86_400_000;
export type ArchiveCandle = {
  ts: number; open: number; high: number; low: number; close: number;
  volume: number; quoteVolume: number; trades: number;
};
export type ArchiveDb = Database.Database;

export function openArchive(file = DEFAULT_ARCHIVE_DB): ArchiveDb {
  mkdirSync(dirname(file), {recursive: true});
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec([
    'CREATE TABLE IF NOT EXISTS candles (symbol TEXT NOT NULL, interval_min INTEGER NOT NULL, ts INTEGER NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL, quote_volume REAL NOT NULL, trades INTEGER NOT NULL, PRIMARY KEY (symbol, interval_min, ts));',
    'CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, rows INTEGER NOT NULL, imported_at TEXT NOT NULL, duplicates INTEGER NOT NULL DEFAULT 0);',
    'CREATE TABLE IF NOT EXISTS symbols (symbol TEXT PRIMARY KEY, base TEXT NOT NULL, quote TEXT NOT NULL, first_ts INTEGER NOT NULL, last_ts INTEGER NOT NULL);',
    'CREATE TABLE IF NOT EXISTS regimes (date TEXT PRIMARY KEY, btc_above_200d INTEGER, btc_vol_30d_percentile REAL);',
    'CREATE INDEX IF NOT EXISTS archive_candles_time ON candles(interval_min, ts);'
  ].join('\n'));
  return db;
}
export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function parseChecksum(text: string): string {
  const match = /^([a-f\d]{64})(?:\s|$)/i.exec(text.trim());
  if (!match) throw Error('Invalid SHA256 CHECKSUM file');
  return match[1]!.toLowerCase();
}
export function verifiedZip(bytes: Buffer, checksum: string): boolean {
  return sha256(bytes) === parseChecksum(checksum);
}
export function normalizeTimestamp(raw: string): number {
  const timestamp = Number(raw);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw Error('Invalid timestamp: ' + raw);
  return timestamp > 1e14 ? Math.floor(timestamp / 1000) : timestamp;
}
export function parseCsv(csv: string): ArchiveCandle[] {
  const result: ArchiveCandle[] = [];
  const lines = csv.trimEnd().split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim()) throw Error('Blank CSV line ' + (index + 1));
    const f = line.split(',');
    if (f.length !== 12) throw Error('Expected 12 CSV columns at line ' + (index + 1));
    const ts = normalizeTimestamp(f[0]!);
    const nums = [f[1], f[2], f[3], f[4], f[5], f[7], f[8]].map(Number);
    const [open, high, low, close, volume, quoteVolume, trades] = nums as [number,number,number,number,number,number,number];
    const closeTs = normalizeTimestamp(f[6]!);
    // Binance exchange halt (e.g. 2020-12-21 14:00 UTC): flat, zero-volume, zero-trade candle whose closeTs
    // precedes its openTs. Accept only exactly this shape; every other closeTs < ts stays invalid.
    const haltCandle = closeTs < ts && Number(f[5]) === 0 && Number(f[7]) === 0 && Number(f[8]) === 0 &&
      f[1] === f[2] && f[2] === f[3] && f[3] === f[4];
    if (nums.some(n => !Number.isFinite(n)) || open <= 0 || low <= 0 ||
      high < Math.max(open, close, low) || low > Math.min(open, close) ||
      volume < 0 || quoteVolume < 0 || !Number.isSafeInteger(trades) || trades < 0 ||
      (closeTs < ts && !haltCandle)) throw Error('Invalid candle at CSV line ' + (index + 1) + ': ' + line.slice(0, 200));
    result.push({ts, open, high, low, close, volume, quoteVolume, trades});
  }
  return result;
}
export function parts(symbol: string): {base: string; quote: string} {
  const quote = symbol.endsWith('USDT') ? 'USDT' : symbol.endsWith('EUR') ? 'EUR' : '';
  if (!quote || symbol.length <= quote.length || !/^[A-Z0-9]+$/.test(symbol)) throw Error('Unsupported symbol: ' + symbol);
  return {base: symbol.slice(0, -quote.length), quote};
}
export function importZip(db: ArchiveDb, path: string, bytes: Buffer, checksum: string, intervalMinutes: 15 | 60 | 1440): {rows: number; duplicates: number; skipped: boolean} {
  if (!verifiedZip(bytes, checksum)) throw Error('SHA256 mismatch: ' + path);
  const hash = sha256(bytes);
  const previous = db.prepare('SELECT sha256, rows, duplicates FROM files WHERE path=?').get(path) as
    {sha256: string; rows: number; duplicates: number} | undefined;
  if (previous) {
    if (previous.sha256 !== hash) throw Error('Archive file changed; refusing to blend versions: ' + path);
    return {rows: previous.rows, duplicates: previous.duplicates, skipped: true};
  }
  const match = /(?:^|\/)([A-Z0-9]+)-(15m|1h|1d)-\d{4}-\d{2}(?:-\d{2})?\.zip$/.exec(path);
  if (!match) throw Error('Unexpected archive filename: ' + path);
  const symbol = match[1]!;
  if (({'15m': 15, '1h': 60, '1d': 1440} as Record<string, number>)[match[2]!] !== intervalMinutes)
    throw Error('Interval mismatch: ' + path);
  const {base, quote} = parts(symbol);
  const candles = parseCsv(extractArchiveCsv(bytes));
  const insert = db.prepare('INSERT OR IGNORE INTO candles (symbol, interval_min, ts, open, high, low, close, volume, quote_volume, trades) VALUES (?,?,?,?,?,?,?,?,?,?)');
  let duplicates = 0;
  const existing = db.prepare('SELECT open,high,low,close,volume,quote_volume AS quoteVolume,trades FROM candles WHERE symbol=? AND interval_min=? AND ts=?');
  db.transaction(() => {
    for (const candle of candles) {
      const info = insert.run(symbol, intervalMinutes, candle.ts, candle.open, candle.high, candle.low,
        candle.close, candle.volume, candle.quoteVolume, candle.trades);
      if (info.changes === 0) {
        const prior = existing.get(symbol, intervalMinutes, candle.ts) as Omit<ArchiveCandle,'ts'>|undefined;
        if (!prior || ['open','high','low','close','volume','quoteVolume','trades'].some(key =>
          prior[key as keyof typeof prior] !== candle[key as keyof typeof prior]))
          throw Error('Conflicting duplicate candle in ' + path + ' at ' + candle.ts);
        duplicates++;
      }
    }
    if (candles.length) {
      const first = Math.min(...candles.map(c => c.ts));
      const last = Math.max(...candles.map(c => c.ts));
      db.prepare('INSERT INTO symbols(symbol,base,quote,first_ts,last_ts) VALUES (?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET first_ts=min(first_ts,excluded.first_ts),last_ts=max(last_ts,excluded.last_ts)')
        .run(symbol, base, quote, first, last);
    }
    db.prepare('INSERT INTO files(path,sha256,rows,imported_at,duplicates) VALUES (?,?,?,?,?)')
      .run(path, hash, candles.length, new Date().toISOString(), duplicates);
  })();
  return {rows: candles.length, duplicates, skipped: false};
}
export function importLocalZip(db: ArchiveDb, path: string, intervalMinutes: 15|60|1440) {
  if (!existsSync(path + '.CHECKSUM')) throw Error('CHECKSUM missing for ' + path);
  return importZip(db, path, readFileSync(path), readFileSync(path + '.CHECKSUM', 'utf8'), intervalMinutes);
}

// Incomplete / gapped UTC groups are never filled or returned.
export function aggregateHourly(bars: ArchiveCandle[], hours: 4|24): ArchiveCandle[] {
  const sorted = [...bars].sort((a, b) => a.ts - b.ts);
  const period = hours * 3_600_000;
  const result: ArchiveCandle[] = [];
  for (let i = 0; i < sorted.length;) {
    const start = Math.floor(sorted[i]!.ts / period) * period;
    const group: ArchiveCandle[] = [];
    while (i < sorted.length && sorted[i]!.ts < start + period) group.push(sorted[i++]!);
    if (group.length !== hours || group.some((v, j) => v.ts !== start + j * 3_600_000)) continue;
    result.push({
      ts: start, open: group[0]!.open, high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)), close: group[group.length - 1]!.close,
      volume: group.reduce((a, c) => a + c.volume, 0),
      quoteVolume: group.reduce((a, c) => a + c.quoteVolume, 0),
      trades: group.reduce((a, c) => a + c.trades, 0)
    });
  }
  return result;
}

// Every regime value uses data through that UTC date only.
export function updateRegimes(db: ArchiveDb): number {
  const candles = db.prepare('SELECT ts,close FROM candles WHERE symbol=? AND interval_min=1440 ORDER BY ts')
    .all('BTCUSDT') as {ts: number; close: number}[];
  const insert = db.prepare('INSERT OR REPLACE INTO regimes(date,btc_above_200d,btc_vol_30d_percentile) VALUES (?,?,?)');
  const vol: number[] = [];
  db.transaction(() => {
    for (let i = 0; i < candles.length; i++) {
      const slice = candles.slice(Math.max(0, i - 199), i + 1);
      const above = slice.length === 200 && slice[199]!.ts - slice[0]!.ts === 199 * DAY
        ? Number(candles[i]!.close > slice.reduce((a, c) => a + c.close, 0) / 200) : null;
      let realized: number | null = null;
      if (i >= 30 && candles[i]!.ts - candles[i - 30]!.ts === 30 * DAY) {
        const returns = candles.slice(i - 29, i + 1).map((v, j) => Math.log(v.close / candles[i - 30 + j]!.close));
        const mean = returns.reduce((a, r) => a + r, 0) / returns.length;
        realized = Math.sqrt(returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length);
      }
      if (realized !== null) vol.push(realized);
      const pct = realized === null ? null : vol.filter(v => v <= realized!).length / vol.length * 100;
      insert.run(new Date(candles[i]!.ts).toISOString().slice(0, 10), above, pct);
    }
  })();
  return candles.length;
}
