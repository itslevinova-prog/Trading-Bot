import {mkdir, readFile, writeFile, rename, readdir, appendFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {median, type PublicSignal, type QualityInput, type QualityVerdict, type QuotePrices} from './contracts.js';

export type CachedSource<T> = {
  attemptedAt: number;
  successfulAt: number | null;
  value: T | null;
  lastError: string | null;
};
export type QualitySnapshot = {
  asOf: number;
  profile: string;
  quote: string;
  inputs: QualityInput[];
  prices: QuotePrices;
  verdicts: QualityVerdict[];
  quoteHealth: {ok: boolean; deviationBps: number; reasons: string[]};
  feeds: {tags: PublicSignal | null; delistings: PublicSignal | null};
};
const dayName = (ms: number) => new Date(ms).toISOString().slice(0,10);
async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // Corrupt/incomplete cache must never be interpreted as "not flagged".
    return null;
  }
}
async function atomicJson(path: string, data: unknown) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', {flag:'wx'});
    await rename(temporary, path);
  } catch (error) {
    const {unlink} = await import('node:fs/promises');
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
export class QualityStore {
  constructor(readonly directory = resolve(fileURLToPath(new URL('../../../../',import.meta.url)),
    process.env.QUALITY_DATA_DIR || 'data/coin-quality')) {}
  async readSource<T>(key: 'tags'|'delistings'|'ecb'): Promise<CachedSource<T> | null> {
    return readJson<CachedSource<T>>(join(this.directory, 'sources', key + '.json'));
  }
  async writeSource<T>(key: 'tags'|'delistings'|'ecb', data: CachedSource<T>) {
    const target = join(this.directory, 'sources');
    await mkdir(target, {recursive:true});
    await atomicJson(join(target, key + '.json'), data);
  }
  /** Median from at least three independently captured recent bid/ask samples.
   * A single REST bookTicker is NOT a historical median. Missing samples fail closed.
   */
  async observeSpread(symbol: string, at: number, spreadBps: number | null): Promise<number | null> {
    if (!/^[A-Z0-9]{3,30}$/.test(symbol)) throw Error('Invalid spread symbol');
    const dir = join(this.directory, 'spreads');
    await mkdir(dir, {recursive:true});
    const path = join(dir, symbol + '.json');
    const before = await readJson<{at:number;bps:number}[]>(path);
    const samples = (Array.isArray(before) ? before : []).filter(x =>
      Number.isFinite(x.at) && Number.isFinite(x.bps) && x.bps >= 0 &&
      x.at <= at && at - x.at <= 24*3_600_000);
    const latest = samples.at(-1)?.at ?? -Infinity;
    // Repeated calls in a short burst are not independent observations.
    if (spreadBps !== null && Number.isFinite(spreadBps) && spreadBps >= 0 &&
        at - latest >= 60_000) samples.push({at,bps:spreadBps});
    await atomicJson(path,samples.slice(-1440));
    return samples.length >= 3 ? median(samples.map(s => s.bps)) : null;
  }
  async snapshotOn(day: string): Promise<QualitySnapshot | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error('Invalid UTC day');
    return readJson<QualitySnapshot>(join(this.directory, 'snapshots', day + '.json'));
  }
  async latest(): Promise<QualitySnapshot | null> {
    return readJson<QualitySnapshot>(join(this.directory, 'latest.json'));
  }
  async asOf(asOfMs: number): Promise<QualitySnapshot | null> {
    if (!Number.isFinite(asOfMs) || asOfMs < 0) throw Error('Invalid snapshot time');
    const dir = join(this.directory, 'snapshots');
    let names: string[];
    try { names = (await readdir(dir)).filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse(); }
    catch { return null; }
    for (const name of names) {
      if (name.slice(0,10) > dayName(asOfMs)) continue;
      const candidate = await readJson<QualitySnapshot>(join(dir, name));
      if (candidate && candidate.asOf <= asOfMs) return candidate;
    }
    return null;
  }
  /** Each local UTC day gets one retained snapshot; changes are emitted separately. */
  async record(snapshot: QualitySnapshot): Promise<string[]> {
    const previous = await this.latest();
    const dir = join(this.directory, 'snapshots');
    await mkdir(dir, {recursive:true});
    const changes: string[] = [];
    const before = new Map((previous?.verdicts ?? []).map(v => [v.symbol, v]));
    for (const verdict of snapshot.verdicts) {
      const older = before.get(verdict.symbol);
      if (older?.status !== verdict.status ||
          (older && older.reasons.join('|') !== verdict.reasons.join('|'))) {
        changes.push(verdict.symbol + ': ' + (older?.status ?? 'new') + ' -> ' +
          verdict.status + ' (' + verdict.reasons.join('; ') + ')');
      }
    }
    if (previous && previous.quoteHealth.ok !== snapshot.quoteHealth.ok)
      changes.push('Quote alarm: ' + (snapshot.quoteHealth.ok ? 'cleared' : snapshot.quoteHealth.reasons.join('; ')));
    await atomicJson(join(dir, dayName(snapshot.asOf) + '.json'), snapshot);
    await atomicJson(join(this.directory, 'latest.json'), snapshot);
    if (changes.length) {
      const lines = changes.map(message =>
        JSON.stringify({at:snapshot.asOf, type:'coin-quality', message}) + '\n').join('');
      await appendFile(join(this.directory, 'decisions.ndjson'), lines, 'utf8');
    }
    return changes;
  }
}
