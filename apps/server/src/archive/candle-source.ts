import {appendFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {aggregateHourly, openArchive, type ArchiveCandle, type ArchiveDb, DEFAULT_ARCHIVE_DB} from './store.js';
import {HOLDOUT_LOG} from './paths.js';

// Contract shared structurally with issue #5: do not add parameters to these methods.
export type Candle = { ts: number; open: number; high: number; low: number; close: number; volume: number; quoteVolume?: number };
// ts = UTC open time in milliseconds; ascending, completed only, no synthetic gap filling.
export interface CandleSource {
  getCandles(symbol: string, intervalMinutes: 15 | 60 | 240 | 1440, fromMs: number, toMs: number): Promise<Candle[]>;
  listSymbols(): Promise<string[]>;
}
export type ArchiveSourceOptions = {
  databasePath?: string;
  accessLogPath?: string;
  allowHoldout?: {reason: string};
};
const VALIDATION_START = Date.UTC(2024, 0, 1);
const HOLDOUT_START = Date.UTC(2025, 0, 1);

export class ArchiveCandleSource implements CandleSource {
  private readonly db: ArchiveDb;
  private readonly logPath: string;
  private readonly allowance?: {reason: string};
  constructor(options: ArchiveSourceOptions = {}) {
    this.db = openArchive(options.databasePath ?? DEFAULT_ARCHIVE_DB);
    this.logPath = options.accessLogPath ?? HOLDOUT_LOG;
    this.allowance = options.allowHoldout;
  }
  private log(kind: string, symbol: string, intervalMinutes: number, fromMs: number, toMs: number, reason?: string) {
    mkdirSync(dirname(this.logPath), {recursive: true});
    appendFileSync(this.logPath, JSON.stringify({
      at: new Date().toISOString(), kind, symbol, intervalMinutes, fromMs, toMs,
      ...(reason ? {reason} : {})
    }) + '\n');
  }
  async getCandles(symbol: string, intervalMinutes: 15 | 60 | 240 | 1440, fromMs: number, toMs: number): Promise<Candle[]> {
    if (!/^[A-Z0-9]+$/.test(symbol) || ![15, 60, 240, 1440].includes(intervalMinutes) ||
      !Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs >= toMs)
      throw Error('Invalid candle source request');
    if (toMs > HOLDOUT_START) {
      if (!this.allowance?.reason?.trim()) {
        this.log('holdout-denied', symbol, intervalMinutes, fromMs, toMs);
        throw Error('Holdout is locked; instantiate ArchiveCandleSource with allowHoldout: {reason: "..."}');
      }
      this.log('holdout-allowed', symbol, intervalMinutes, fromMs, toMs, this.allowance.reason.trim());
    }
    if (toMs > VALIDATION_START && fromMs < HOLDOUT_START)
      this.log('validation', symbol, intervalMinutes, fromMs, Math.min(toMs, HOLDOUT_START));
    const to = Math.min(toMs, Date.now());
    if (to <= fromMs) return [];
    const sourceInterval = intervalMinutes === 240 ? 60 : intervalMinutes;
    const start = intervalMinutes === 240 ? Math.floor(fromMs / (240 * 60_000)) * 240 * 60_000 : fromMs;
    const bars = this.db.prepare(
      'SELECT ts,open,high,low,close,volume,quote_volume AS quoteVolume,trades FROM candles WHERE symbol=? AND interval_min=? AND ts>=? AND ts<? ORDER BY ts'
    ).all(symbol, sourceInterval, start, to) as ArchiveCandle[];
    const complete = intervalMinutes === 240 ? aggregateHourly(bars, 4) : bars;
    return complete.filter(c => c.ts >= fromMs && c.ts + intervalMinutes * 60_000 <= to)
      .map(c => ({ts:c.ts, open:c.open, high:c.high, low:c.low, close:c.close, volume:c.volume, quoteVolume:c.quoteVolume}));
  }
  async listSymbols(): Promise<string[]> {
    return (this.db.prepare('SELECT symbol FROM symbols ORDER BY symbol').all() as {symbol: string}[]).map(row => row.symbol);
  }
  close(): void { this.db.close(); }
}
