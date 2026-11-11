import type {CandleSource} from './archive-contract.js';
import {assessQuote, DEFAULT_QUALITY_CONFIG, evaluateQuality,
  type CoinQualityProvider, type PublicSignal, type QualityConfig,
  type QualityInput, type QualityVerdict, type QuotePrices} from './contracts.js';
import {QualityPublicSources, UNOFFICIAL_MIN_FETCH_MS} from './sources.js';
import {QualityStore, type CachedSource, type QualitySnapshot} from './storage.js';

const DAY = 86_400_000;
const EMPTY_PRICES: QuotePrices = {eurUsd:null,eurUsdt:null,usdcUsdt:null,fdusdUsdt:null};
const unknown = (symbol: string, asOf: number, reason: string): QualityVerdict =>
  ({symbol,asOf,status:'unknown',reasons:[reason],sources:[]});
const normalize = (symbol: string) => symbol.toUpperCase().replace('/','');
const conservativeFeed = (at: number): PublicSignal =>
  ({available:false,fetchedAt:at,symbols:[],clearForAll:false});
export function allowsEntry(verdict: QualityVerdict): boolean {return verdict.status === 'allowed';}

export class LiveCoinQualityProvider implements CoinQualityProvider {
  private readonly config: QualityConfig;
  constructor(
    config: Partial<QualityConfig> = {},
    private readonly sources = new QualityPublicSources(),
    private readonly store = new QualityStore(),
    private readonly clock: () => number = Date.now,
  ) { this.config = {...DEFAULT_QUALITY_CONFIG,...config}; }
  private async unofficial(key: 'tags'|'delistings', symbols: string[], at: number): Promise<PublicSignal> {
    const previous = await this.store.readSource<PublicSignal>(key);
    const scoped = (value: PublicSignal): PublicSignal => ({...value,
      clearForAll:value.clearForAll && !!value.coverage && symbols.every(s => value.coverage!.includes(s))});
    // Attempt times (including failures) persist across restarts: max one call/hour.
    if (previous && at - previous.attemptedAt < UNOFFICIAL_MIN_FETCH_MS)
      return previous.value && previous.successfulAt !== null &&
        at - previous.successfulAt <= this.config.staleHours*3_600_000 ?
        scoped(previous.value) : conservativeFeed(previous.attemptedAt);
    try {
      const value = key === 'tags' ? await this.sources.monitoringTags(symbols) :
        await this.sources.delistingAnnouncements(symbols);
      const saved: CachedSource<PublicSignal> = {
        attemptedAt:at,successfulAt:value.fetchedAt,value,lastError:null,
      };
      await this.store.writeSource(key,saved);
      return scoped(value);
    } catch (error) {
      const saved: CachedSource<PublicSignal> = {
        attemptedAt:at,successfulAt:previous?.successfulAt ?? null,
        value:previous?.value ?? null,lastError:String(error),
      };
      await this.store.writeSource(key,saved);
      if (previous?.value && previous.successfulAt !== null &&
          at - previous.successfulAt <= this.config.staleHours*3_600_000)
        return scoped(previous.value);
      return conservativeFeed(at);
    }
  }
  private async prices(at: number): Promise<QuotePrices> {
    const previous = await this.store.readSource<number>('ecb');
    let eurUsd = previous?.value ?? null;
    if (!previous || at - previous.attemptedAt >= UNOFFICIAL_MIN_FETCH_MS) {
      try {
        eurUsd = await this.sources.ecbEurUsd();
        await this.store.writeSource('ecb',{attemptedAt:at,successfulAt:this.clock(),value:eurUsd,lastError:null});
      } catch (error) {
        await this.store.writeSource('ecb',{attemptedAt:at,
          successfulAt:previous?.successfulAt ?? null,value:previous?.value ?? null,lastError:String(error)});
      }
    }
    const cache = await this.store.readSource<number>('ecb');
    if (cache?.successfulAt === null || !cache ||
        at - cache.successfulAt > 7*DAY) eurUsd = null; // ECB is closed on weekends.
    const crosses = await this.sources.quoteCrosses().catch(() => ({
      eurUsdt:null,usdcUsdt:null,fdusdUsdt:null,
    }));
    return {...crosses,eurUsd};
  }
  private requireCurrent(asOfMs: number) {
    const now = this.clock();
    // Live feeds cannot answer queries for arbitrary historical or future instants.
    if (!Number.isFinite(asOfMs) || Math.abs(asOfMs - now) > 60_000)
      throw Error('Live provider supports current checks only; use archive provider for historical checks');
  }
  async quoteHealth(asOfMs: number) {
    this.requireCurrent(asOfMs);
    return assessQuote(this.config.quote,await this.prices(this.clock()),this.config);
  }
  async check(symbol: string, asOfMs: number): Promise<QualityVerdict> {
    return (await this.checkAll([symbol],asOfMs))[0]!;
  }
  async checkAll(symbols: string[], asOfMs: number): Promise<QualityVerdict[]> {
    this.requireCurrent(asOfMs);
    const unique = [...new Set(symbols.map(normalize))];
    let catalog: Awaited<ReturnType<QualityPublicSources['exchangeInfo']>>;
    try { catalog = await this.sources.exchangeInfo(); }
    catch {
      const at = this.clock();
      const verdicts = unique.map(s => unknown(s,at,'exchangeInfo unavailable: no new entries'));
      await this.store.record({asOf:at,profile:this.config.profile,quote:this.config.quote,
        inputs:[],prices:EMPTY_PRICES,verdicts,
        quoteHealth:{ok:false,deviationBps:0,reasons:['exchangeInfo unavailable']},
        feeds:{tags:null,delistings:null}});
      return verdicts;
    }
    const now = this.clock();
    const [tags,delistings,prices] = await Promise.all([
      this.unofficial('tags',unique,now),
      this.unofficial('delistings',unique,now),
      this.prices(now),
    ]);
    const health = assessQuote(this.config.quote,prices,this.config);
    const inputs: QualityInput[] = [];
    const verdicts: QualityVerdict[] = [];
    const bySymbol = new Map(catalog.symbols.map(s => [s.symbol,s]));
    for (const key of unique) {
      const meta = bySymbol.get(key);
      if (!meta) {
        verdicts.push(unknown(key,this.clock(),'Symbol missing from official exchangeInfo; no orders'));
        continue;
      }
      try {
        const input = await this.sources.market(meta,this.clock());
        input.spreadBps = await this.store.observeSpread(key,this.clock(),input.spreadBps);
        input.tags = tags; input.delistings = delistings;
        input.sources.push({name:'Binance website product tags (UNOFFICIAL)',
          fetchedAt:tags.fetchedAt,official:false},
          {name:'Binance website delisting CMS (UNOFFICIAL)',
            fetchedAt:delistings.fetchedAt,official:false},
          {name:'Binance spot price tickers',fetchedAt:this.clock(),official:true},
          {name:'ECB EUR/USD',fetchedAt:this.clock(),official:true});
        inputs.push(input);
        verdicts.push(evaluateQuality(input,this.clock(),this.config,health));
      } catch {
        verdicts.push(unknown(key,this.clock(),'Public market candles/bookTicker unavailable; no new entries'));
      }
    }
    const snapshot: QualitySnapshot = {
      asOf:this.clock(),profile:this.config.profile,quote:this.config.quote,
      inputs,prices,verdicts,quoteHealth:health,feeds:{tags,delistings},
    };
    await this.store.record(snapshot);
    return verdicts;
  }
  getStorage() {return this.store;}
}

/**
 * Backtest reads only candles CLOSED at the requested timestamp and snapshots recorded
 * no later than that timestamp. It cannot reconstruct pre-snapshot historical tags.
 */
export class ArchiveCoinQualityProvider implements CoinQualityProvider {
  private readonly config: QualityConfig;
  constructor(
    private readonly source: CandleSource,
    private readonly store = new QualityStore(),
    config: Partial<QualityConfig> = {},
  ) { this.config = {...DEFAULT_QUALITY_CONFIG,...config}; }
  private async snapshot(asOfMs: number) {
    const sample = await this.store.asOf(asOfMs);
    // A stale record is not proof that yesterday's tags still apply.
    return sample && asOfMs - sample.asOf <= this.config.staleHours * 3_600_000 ?
      sample : null;
  }
  async quoteHealth(asOfMs: number) {
    const sample = await this.snapshot(asOfMs);
    return sample?.quoteHealth ?? {
      ok:false,deviationBps:0,reasons:['No point-in-time quote reference for this archive timestamp'],
    };
  }
  async check(symbol: string, asOfMs: number): Promise<QualityVerdict> {
    return (await this.checkAll([symbol],asOfMs))[0]!;
  }
  async checkAll(symbols: string[], asOfMs: number): Promise<QualityVerdict[]> {
    if (!Number.isFinite(asOfMs) || asOfMs < 0) throw Error('Invalid backtest timestamp');
    const sample = await this.snapshot(asOfMs);
    const health = await this.quoteHealth(asOfMs);
    const result: QualityVerdict[] = [];
    for (const raw of symbols) {
      const key = normalize(raw);
      const record = sample?.inputs.find(i => i.symbol === key);
      // No current exchangeInfo queries are permitted in historical replay.
      const bars = await this.source.getCandles(key,1440,0,asOfMs);
      const completed = bars.filter(c => c.ts + DAY <= asOfMs && c.ts >= 0 &&
        Number.isFinite(c.quoteVolume) && (c.quoteVolume ?? -1) >= 0);
      const input: QualityInput = {
        symbol:key, baseAsset:record?.baseAsset ?? key,
        quoteAsset:record?.quoteAsset ?? this.config.quote,
        status:record?.status ?? 'UNKNOWN', spotAllowed:record?.spotAllowed ?? false,
        listedAtMs:completed.length ? Math.min(...completed.map(c => c.ts)) : null,
        volumes:completed.map(c => ({ts:c.ts,quoteVolume:c.quoteVolume!})),
        spreadBps:record?.spreadBps ?? null,
        tags:sample?.feeds.tags ?? null,delistings:sample?.feeds.delistings ?? null,
        sources:record?.sources ?? [{name:'archive daily candles (point-in-time)',fetchedAt:asOfMs,official:true}],
      };
      result.push(evaluateQuality(input,asOfMs,this.config,health));
    }
    return result;
  }
}
