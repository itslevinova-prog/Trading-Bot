import {mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, statfsSync, statSync} from 'node:fs';
import {dirname, resolve, join, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {importLocalZip, openArchive, parseChecksum, sha256, updateRegimes} from './store.js';
import {ARCHIVE_RAW} from './paths.js';
import {excludedBase} from '../coin-quality/contracts.js';

const BUCKET = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision';
const PUBLIC = 'https://data.binance.vision/';

export type Interval = '15m' | '1h' | '1d';
export type ArchiveObject = {key: string; size: number; interval: Interval; symbol: string; date: string};
export type DownloadResult = 'downloaded' | 'skipped';

/** Selects archive objects. Without an explicit symbol list and with a fixed quote,
 * stablecoin/fiat bases and leveraged tokens are skipped: they never enter the
 * research universe, and some of their public archives contain invalid candles. */
export function selectEntries(items: ArchiveObject[], symbols: string[], quote: string): ArchiveObject[] {
  return items.filter(i => (!symbols.length || symbols.includes(i.symbol)) &&
    (quote === 'all' || (i.symbol.endsWith(quote) &&
      (symbols.length > 0 || !excludedBase(i.symbol.slice(0, -quote.length))))));
}

function xmlValue(body: string, tag: string): string | undefined {
  const found = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(body);
  return found?.[1]?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
export function parseListing(xml: string): {entries: {key: string; size: number}[]; continuation?: string} {
  const entries: {key: string; size: number}[] = [];
  for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = xmlValue(block[1]!, 'Key');
    const size = Number(xmlValue(block[1]!, 'Size'));
    if (key && Number.isSafeInteger(size) && size >= 0) entries.push({key, size});
  }
  return {entries, continuation: xmlValue(xml, 'NextContinuationToken')};
}
export function filterObject(key: string, size: number, scope: 'monthly'|'daily', intervals: Interval[], from: string, to: string, today = new Date()): ArchiveObject | undefined {
  const exp = new RegExp('^data/spot/' + scope + '/klines/([A-Z0-9]+)/(15m|1h|1d)/\\1-\\2-(\\d{4}-\\d{2}(?:-\\d{2})?)\\.zip$');
  const match = exp.exec(key);
  if (!match) return undefined;
  const symbol = match[1]!;
  const interval = match[2] as Interval;
  const date = match[3]!;
  if (!intervals.includes(interval) || !symbol || !(symbol.endsWith('USDT') || symbol.endsWith('EUR'))) return undefined;
  if (scope === 'monthly' && date.length !== 7 || scope === 'daily' && date.length !== 10) return undefined;
  const currentMonth = today.toISOString().slice(0, 7);
  if (scope === 'monthly' && (date < from || date > to || date >= currentMonth)) return undefined;
  if (scope === 'daily' && (date.slice(0, 7) < from || date.slice(0, 7) > to || date >= today.toISOString().slice(0, 10))) return undefined;
  return {key, size, interval, symbol, date};
}
export async function listObjects(scope: 'monthly'|'daily', intervals: Interval[], from: string, to: string, fetcher: typeof fetch = fetch, today = new Date(), symbols: string[] = []): Promise<ArchiveObject[]> {
  const results: ArchiveObject[] = [];
  // With explicit symbols, list only their folders instead of the whole bucket (minutes -> seconds).
  const prefixes = symbols.length ? symbols.map(s => 'data/spot/' + scope + '/klines/' + s + '/') : ['data/spot/' + scope + '/klines/'];
  for (const prefix of prefixes) {
  let continuation: string | undefined;
  do {
    const url = new URL(BUCKET);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    if (continuation) url.searchParams.set('continuation-token', continuation);
    const response = await fetcher(url.toString(), {headers: {'User-Agent': 'TradingArchive/1.0 (public data only)'}});
    if (!response.ok) throw Error('Bucket listing HTTP ' + response.status);
    const parsed = parseListing(await response.text());
    for (const item of parsed.entries) {
      const selected = filterObject(item.key, item.size, scope, intervals, from, to, today);
      if (selected) results.push(selected);
    }
    continuation = parsed.continuation;
  } while (continuation);
  }
  return results;
}
export function rawFilePath(item: ArchiveObject, root = ARCHIVE_RAW): string {
  return join(root, item.interval, item.symbol, basename(item.key));
}
export function alreadyVerified(path: string): boolean {
  if (!existsSync(path) || !existsSync(path + '.CHECKSUM')) return false;
  try { return sha256(readFileSync(path)) === parseChecksum(readFileSync(path + '.CHECKSUM', 'utf8')); }
  catch { return false; }
}
export async function downloadFile(item: ArchiveObject, root = ARCHIVE_RAW, fetcher: typeof fetch = fetch, sleep: (ms: number) => Promise<unknown> = delay): Promise<DownloadResult> {
  const path = rawFilePath(item, root);
  if (alreadyVerified(path)) return 'skipped';
  const headers = { 'User-Agent': 'TradingArchive/1.0 (public data only)' };
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = PUBLIC + item.key;
      const checksumResponse = await fetcher(url + '.CHECKSUM', {headers});
      if (!checksumResponse.ok) throw Error('CHECKSUM HTTP ' + checksumResponse.status);
      const checksum = await checksumResponse.text();
      const expected = parseChecksum(checksum);
      const zipResponse = await fetcher(url, {headers});
      if (!zipResponse.ok) throw Error('ZIP HTTP ' + zipResponse.status);
      const bytes = Buffer.from(await zipResponse.arrayBuffer());
      if (sha256(bytes) !== expected) throw Error('SHA256 mismatch: ' + item.key);
      mkdirSync(dirname(path), {recursive: true});
      const temporary = path + '.partial-' + process.pid;
      // The original ZIP is saved unchanged, only once both downloads are verified.
      writeFileSync(temporary, bytes);
      renameSync(temporary, path);
      writeFileSync(path + '.CHECKSUM', checksum);
      return 'downloaded';
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(1000 * 2 ** attempt);
    }
  }
  throw Error('Download failed after three attempts: ' + item.key + ' — ' + String(lastError));
}
export function estimateSpace(entries: ArchiveObject[], root = ARCHIVE_RAW): {estimatedBytes: number; freeBytes: number; totalBytes: number; allowed: boolean} {
  mkdirSync(root, {recursive: true});
  const stat = statfsSync(root);
  const freeBytes = Number(stat.bavail) * Number(stat.bsize);
  const totalBytes = Number(stat.blocks) * Number(stat.bsize);
  // Conservative headroom for SQLite rows/indexes in addition to compressed ZIPs.
  const estimatedBytes = entries.reduce((sum, item) => sum + item.size * 9, 0);
  return {estimatedBytes, freeBytes, totalBytes, allowed: freeBytes - estimatedBytes >= totalBytes * .2};
}
export async function processQueue<T>(items: T[], worker: (item: T) => Promise<void>, concurrency = 4): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw Error('Max 4 parallel downloads');
  let next = 0;
  const workers = Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await worker(item);
    }
  });
  await Promise.all(workers);
}
function option(args: string[], flag: string, fallback: string) {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1] ?? (() => {throw Error('Missing value: ' + flag);})();
}
export async function runImport(args = process.argv.slice(2), fetcher: typeof fetch = fetch): Promise<void> {
  const now = new Date();
  const lastComplete = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 7);
  const from = option(args, '--from', '2020-01');
  const to = option(args, '--to', lastComplete);
  const intervals = option(args, '--intervals', '1h,1d').split(',') as Interval[];
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || from > to ||
    !intervals.length || intervals.some(v => !['15m','1h','1d'].includes(v)))
    throw Error('Invalid --from/--to (YYYY-MM) or --intervals (1h,1d,15m)');
  const symbols = option(args, '--symbols', '').split(',').filter(Boolean);
  const quote = option(args, '--quote', 'all');
  if (!['all','USDT','EUR'].includes(quote)) throw Error('Invalid --quote');
  const monthly = await listObjects('monthly', intervals, from, to, fetcher, now, symbols);
  const daily = args.includes('--include-current')
    ? await listObjects('daily', intervals, now.toISOString().slice(0,7), now.toISOString().slice(0,7), fetcher, now, symbols) : [];
  const entries = selectEntries([...monthly, ...daily], symbols, quote);
  if (!entries.length) throw Error('No public archive ZIPs matched selection');
  const db = openArchive();
  try {
    const pending = entries.filter(i => {
      const row = db.prepare('SELECT sha256 FROM files WHERE path=?').get(rawFilePath(i)) as {sha256:string}|undefined;
      return !row;
    });
    const disk = estimateSpace(pending);
    console.log('Archive: ' + entries.length + ' files; estimated additional space ' + (disk.estimatedBytes / 1e9).toFixed(2) + ' GB; free ' + (disk.freeBytes / 1e9).toFixed(2) + ' GB');
    if (!disk.allowed) throw Error('Refusing import: less than 20% disk space would remain');
    const failures: string[] = [];
    let completed = 0;
    await processQueue(entries, async item => {
      try {
        await downloadFile(item, ARCHIVE_RAW, fetcher);
        const path = rawFilePath(item);
        importLocalZip(db, path, ({'15m':15,'1h':60,'1d':1440} as const)[item.interval]);
        completed++;
        if (completed % 100 === 0) console.log('Verified/imported ' + completed + '/' + entries.length);
      } catch (error) { const msg = item.key + ': ' + String(error); failures.push(msg); console.error(msg); }
    });
    updateRegimes(db);
    console.log('Archive imported: ' + completed + '/' + entries.length + '; failed ' + failures.length);
    if (failures.length) throw Error(failures.length + ' archives failed. Re-run to resume. ' + failures.slice(0, 3).join('; '));
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runImport().catch(error => {console.error(error); process.exitCode = 1;});
}
