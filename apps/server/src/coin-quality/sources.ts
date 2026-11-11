import type {DailyVolume, PublicSignal, QualityInput, QuotePrices, QualitySource} from './contracts.js';
import type {BinanceSymbol} from '../market/binance-data.js';

const BASE = 'https://data-api.binance.vision';
const BINANCE_WEB = 'https://www.binance.com';
const ECB_XML = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const HOUR = 3_600_000;
const DAY = 86_400_000;
type Requester = typeof fetch;
export type PublicMarket = {symbols: BinanceSymbol[]};
export class QualityPublicSources {
  constructor(private readonly requester: Requester = fetch, private readonly clock: () => number = Date.now) {}
  private async text(url: string, timeoutMs: number): Promise<string> {
    const response = await this.requester(url, {
      method:'GET', signal:AbortSignal.timeout(timeoutMs), redirect:'error',
      headers:{'User-Agent':'coin-quality-paper/1.0', 'Accept':'application/json, application/xml, text/xml'},
    });
    if (!response.ok) throw Error('Public source HTTP ' + response.status);
    const body = await response.text();
    if (body.length > 2_000_000) throw Error('Public source response too large');
    return body;
  }
  private async json(url: string, timeoutMs = 8000): Promise<unknown> {
    return JSON.parse(await this.text(url, timeoutMs)) as unknown;
  }
  private endpoint(path: string, options: Record<string,string> = {}): string {
    const url = new URL(path, BASE);
    for (const [key,value] of Object.entries(options)) url.searchParams.set(key,value);
    return url.toString();
  }
  async exchangeInfo(): Promise<PublicMarket> {
    const data = await this.json(this.endpoint('/api/v3/exchangeInfo'));
    if (!data || typeof data !== 'object' || !('symbols' in data) || !Array.isArray(data.symbols))
      throw Error('Invalid official exchangeInfo payload');
    const symbols = data.symbols as BinanceSymbol[];
    if (!symbols.length || symbols.some(x => !x || typeof x.symbol !== 'string' ||
       typeof x.baseAsset !== 'string' || typeof x.quoteAsset !== 'string' ||
       typeof x.status !== 'string')) throw Error('Incomplete exchangeInfo payload');
    return {symbols};
  }
  async market(symbol: BinanceSymbol, asOfMs: number): Promise<QualityInput> {
    if (asOfMs > this.clock() + 1000) throw Error('Future live quality query');
    const before = Math.floor(asOfMs / DAY) * DAY - 1;
    const source: QualitySource = {name:'Binance REST exchangeInfo / klines / bookTicker', fetchedAt:this.clock(), official:true};
    const [oldest, recent, book] = await Promise.all([
      this.json(this.endpoint('/api/v3/klines',{symbol:symbol.symbol,interval:'1d',startTime:'0',limit:'1'})),
      this.json(this.endpoint('/api/v3/klines',{symbol:symbol.symbol,interval:'1d',endTime:String(Math.max(0,before)),limit:'30'})),
      this.json(this.endpoint('/api/v3/ticker/bookTicker',{symbol:symbol.symbol})),
    ]);
    const parseCandle = (value: unknown): DailyVolume | null => {
      if (!Array.isArray(value) || value.length < 8) return null;
      const ts = Number(value[0]), quoteVolume = Number(value[7]);
      if (!Number.isInteger(ts) || ts < 0 || ts % DAY !== 0 ||
          !Number.isFinite(quoteVolume) || quoteVolume < 0) return null;
      return {ts,quoteVolume};
    };
    if (!Array.isArray(oldest) || !Array.isArray(recent)) throw Error('Invalid daily candle payload');
    const listedAtMs = oldest.length === 1 ? parseCandle(oldest[0])?.ts ?? null : null;
    const volumes = recent.map(parseCandle).filter((x): x is DailyVolume => x !== null);
    const bid = (book && typeof book === 'object' && 'bidPrice' in book) ? Number(book.bidPrice) : NaN;
    const ask = (book && typeof book === 'object' && 'askPrice' in book) ? Number(book.askPrice) : NaN;
    const spreadBps = Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid ?
      (ask-bid)/((ask+bid)/2)*10_000 : null;
    return {
      symbol:symbol.symbol, baseAsset:symbol.baseAsset, quoteAsset:symbol.quoteAsset,
      status:symbol.status, spotAllowed:symbol.isSpotTradingAllowed !== false,
      listedAtMs, volumes, spreadBps, tags:null, delistings:null, sources:[source],
    };
  }
  async ticker(symbol: 'EURUSDT'|'USDCUSDT'|'FDUSDUSDT'): Promise<number | null> {
    const data = await this.json(this.endpoint('/api/v3/ticker/price',{symbol}));
    if (!data || typeof data !== 'object' || !('price' in data)) return null;
    const n = Number(data.price);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  async quoteCrosses(): Promise<Omit<QuotePrices,'eurUsd'>> {
    const [eurUsdt,usdcUsdt,fdusdUsdt] = await Promise.all([
      this.ticker('EURUSDT').catch(() => null),
      this.ticker('USDCUSDT').catch(() => null),
      this.ticker('FDUSDUSDT').catch(() => null),
    ]);
    return {eurUsdt,usdcUsdt,fdusdUsdt};
  }
  async ecbEurUsd(): Promise<number> {
    const xml = await this.text(ECB_XML, 5000);
    const match = xml.match(/<Cube\b(?=[^>]*\bcurrency=['"]USD['"])(?=[^>]*\brate=['"]([0-9.]+)['"])[^>]*\/?>/i);
    const value = Number(match?.[1]);
    if (!Number.isFinite(value) || value <= 0) throw Error('Invalid ECB USD reference');
    return value;
  }
  /** UNOFFICIAL Binance website product list; do not treat missing/unrecognised tags as clean. */
  async monitoringTags(expectedSymbols: string[]): Promise<PublicSignal> {
    const url = BINANCE_WEB + '/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=true';
    const payload = await this.json(url, 5000);
    const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : null;
    const rows = Array.isArray(data) ? data :
      data && typeof data === 'object' && 'products' in data && Array.isArray(data.products) ? data.products : null;
    if (!rows || !rows.length) throw Error('Unavailable/unrecognised unofficial tags list');
    const checked = new Set<string>(), tagged = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !('s' in row) || typeof row.s !== 'string') continue;
      const tags: unknown = 'tags' in row ? row.tags : null;
      if (!Array.isArray(tags) || !tags.every(t => typeof t === 'string')) continue;
      checked.add(row.s);
      if (tags.some(t => /monitoring|seed/i.test(t))) tagged.add(row.s);
    }
    if (checked.size === 0) throw Error('No usable tag fields');
    return {
      available:true, fetchedAt:this.clock(), symbols:[...tagged].sort(),
      clearForAll:expectedSymbols.every(s => checked.has(s)),coverage:[...checked],
    };
  }
  /** UNOFFICIAL Binance CMS list. Ambiguous titles are always unknown, not safe. */
  async delistingAnnouncements(expectedSymbols: string[]): Promise<PublicSignal> {
    const url = BINANCE_WEB + '/bapi/apex/v1/public/apex/cms/article/list/query?type=1&catalogId=161&pageNo=1&pageSize=50';
    const payload = await this.json(url, 5000);
    const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : null;
    const direct = data && typeof data === 'object' && 'articles' in data ? data.articles : null;
    const catalogs = data && typeof data === 'object' && 'catalogs' in data ? data.catalogs : null;
    const entries: unknown[] = Array.isArray(direct) ? direct :
      Array.isArray(catalogs) ? catalogs.flatMap(c => c && typeof c === 'object' && 'articles' in c &&
        Array.isArray(c.articles) ? c.articles : []) : [];
    if (!entries.length) throw Error('Empty/unrecognised unofficial delisting feed');
    const marked = new Set<string>();
    let ambiguous = false;
    for (const article of entries) {
      const title = article && typeof article === 'object' && 'title' in article && typeof article.title === 'string'
        ? article.title.toUpperCase() : '';
      if (!title) { ambiguous = true; continue; }
      const matches = expectedSymbols.filter(s => title.includes(s) ||
        new RegExp('(^|[^A-Z0-9])' + s.replace(/(USDT|USDC|FDUSD|EUR)$/, '') + '([^A-Z0-9]|$)').test(title));
      if (matches.length === 0) { ambiguous = true; continue; }
      for (const symbol of matches) marked.add(symbol);
    }
    // A first page of announcements is not a full historical record. Never clear all
    // coins solely because nothing appeared in this short recent feed.
    return {available:true,fetchedAt:this.clock(),symbols:[...marked].sort(),clearForAll:!ambiguous,coverage:[...expectedSymbols]};
  }
}
export const UNOFFICIAL_MIN_FETCH_MS = HOUR;
