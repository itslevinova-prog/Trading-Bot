import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DAY, openArchive, type ArchiveDb} from './store.js';

const STABLE_BASES = new Set(['USDT','USDC','FDUSD','TUSD','BUSD','DAI','USDP','EUR','EURC','USD','USDD','GUSD','PAX','PYUSD','UST','USTC','EURI','AEUR']);
const LEVERAGED_SUFFIX = /(?:UP|DOWN|BULL|BEAR)$/;
export type UniverseOptions = {quote: 'USDT'|'EUR'; topN: number};
export type UniverseEntry = {symbol: string; base: string; quote: string; quoteVolume30d: number};

export class ArchiveUniverse {
  constructor(private readonly db: ArchiveDb) {}
  // The query interval is [date-30d, date), so the last included day is yesterday.
  universeAt(dateMs: number, options: UniverseOptions): UniverseEntry[] {
    if (!Number.isSafeInteger(dateMs) || dateMs % DAY !== 0) throw Error('Universe date must be UTC midnight');
    if (!Number.isInteger(options.topN) || options.topN < 1) throw Error('topN must be a positive integer');
    return (this.db.prepare(
      'SELECT s.symbol, s.base, s.quote, SUM(c.quote_volume) AS quoteVolume30d ' +
      'FROM symbols s JOIN candles c ON c.symbol=s.symbol ' +
      'WHERE s.quote=? AND s.first_ts<=? AND c.interval_min=1440 AND c.ts>=? AND c.ts<? ' +
      'GROUP BY s.symbol HAVING COUNT(*)=30 AND MIN(c.ts)=? AND MAX(c.ts)=? ' +
      'ORDER BY quoteVolume30d DESC, s.symbol ASC'
    ).all(options.quote, dateMs - 30 * DAY, dateMs - 30 * DAY, dateMs,
      dateMs - 30 * DAY, dateMs - DAY) as UniverseEntry[])
      .filter(row => !STABLE_BASES.has(row.base) && !LEVERAGED_SUFFIX.test(row.base))
      .slice(0, options.topN);
  }
}
export function universeAt(dateMs: number, options: UniverseOptions): UniverseEntry[] {
  const db = openArchive();
  try { return new ArchiveUniverse(db).universeAt(dateMs, options); }
  finally { db.close(); }
}
export function runUniverse(args = process.argv.slice(2)): void {
  const at = args.indexOf('--date');
  const value = at >= 0 ? args[at + 1] : undefined;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)
    throw Error('Usage: pnpm data:universe --date YYYY-MM-DD --top 20 [--quote USDT|EUR]');
  const n = args.indexOf('--top');
  const q = args.indexOf('--quote');
  const topN = Number(n < 0 ? '20' : args[n + 1]);
  const quote = (q < 0 ? 'USDT' : args[q + 1]) as 'USDT'|'EUR';
  if (!['USDT','EUR'].includes(quote)) throw Error('Quote must be USDT or EUR');
  console.log(JSON.stringify({date:value, quote, universe: universeAt(Date.parse(value + 'T00:00:00Z'), {quote, topN})}, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {runUniverse();} catch (error) {console.error(error); process.exitCode = 1;}
}
