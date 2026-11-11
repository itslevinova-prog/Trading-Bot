import type Database from 'better-sqlite3';

export type Candle = { ts: number; open: number; high: number; low: number; close: number; volume: number; quoteVolume?: number };
// ts is the opening time in UTC milliseconds. Only closed candles, ascending, without gap filling.
export interface CandleSource {
  getCandles(symbol: string, intervalMinutes: 15 | 60 | 240 | 1440, fromMs: number, toMs: number): Promise<Candle[]>;
  listSymbols(): Promise<string[]>;
}
export type IntervalMinutes = 15 | 60 | 240 | 1440;
export const candleStep = (minutes: IntervalMinutes) => minutes * 60_000;

/** Reject source data that could leak unfinished/future bars to a decision. */
export function validateCandles(rows: readonly Candle[], minutes: IntervalMinutes, fromMs: number, toMs: number): void {
  const step = candleStep(minutes);
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || toMs < fromMs) throw Error('Invalid candle range');
  let previous = -1;
  for (const c of rows) {
    if (!Number.isSafeInteger(c.ts) || c.ts < fromMs || c.ts + step > toMs || c.ts % step !== 0 || c.ts <= previous)
      throw Error('Look-ahead, duplicate or unordered candle from CandleSource');
    if (![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) || c.low <= 0 || c.volume < 0 ||
        c.low > Math.min(c.open,c.close) || c.high < Math.max(c.open,c.close) ||
        (c.quoteVolume !== undefined && (!Number.isFinite(c.quoteVolume) || c.quoteVolume < 0)))
      throw Error('Invalid OHLC candle from CandleSource');
    previous = c.ts;
  }
}
/** Reads the existing Paper DB without migrations. 240m/1d are delegated to the archive source (#3). */
export class SqliteCandleSource implements CandleSource {
  constructor(private readonly sqlite: Database.Database) {}
  async getCandles(symbol: string, intervalMinutes: IntervalMinutes, fromMs: number, toMs: number): Promise<Candle[]> {
    if (intervalMinutes !== 15 && intervalMinutes !== 60) throw Error('Paper DB supports only 15m and 60m candles');
    if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs > toMs) throw Error('Invalid candle range');
    const rows = this.sqlite.prepare('SELECT ts, open, high, low, close, volume FROM candles WHERE pair=? AND interval=? AND ts>=? AND ts+?<=? ORDER BY ts ASC')
      .all(symbol, intervalMinutes, fromMs, candleStep(intervalMinutes), toMs) as Candle[];
    validateCandles(rows, intervalMinutes, fromMs, toMs);
    return rows;
  }
  async listSymbols(): Promise<string[]> {
    return (this.sqlite.prepare('SELECT DISTINCT pair FROM candles ORDER BY pair').all() as {pair: string}[]).map(row => row.pair);
  }
}
/** Network-free deterministic source for tests and research fixtures. */
export class FixtureCandleSource implements CandleSource {
  private readonly data = new Map<string, Candle[]>();
  constructor(entries: Array<{symbol: string; intervalMinutes: IntervalMinutes; candles: Candle[]}>) {
    for (const entry of entries) {
      const key = entry.symbol + ':' + entry.intervalMinutes;
      if (this.data.has(key)) throw Error('Duplicate fixture series');
      this.data.set(key, entry.candles.map(c => ({...c})));
    }
  }
  async getCandles(symbol: string, intervalMinutes: IntervalMinutes, fromMs: number, toMs: number): Promise<Candle[]> {
    if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs > toMs) throw Error('Invalid candle range');
    const candles = (this.data.get(symbol + ':' + intervalMinutes) ?? []).filter(c => c.ts >= fromMs && c.ts < toMs);
    // Do not silently drop unfinished bars: fail on an unsafe CandleSource contract.
    validateCandles(candles, intervalMinutes, fromMs, toMs);
    return candles.map(c => ({...c}));
  }
  async listSymbols(): Promise<string[]> {
    return [...new Set([...this.data.keys()].map(key => key.slice(0, key.lastIndexOf(':'))))].sort();
  }
}
