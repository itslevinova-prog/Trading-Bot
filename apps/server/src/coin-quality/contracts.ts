/** Point-in-time coin eligibility. A verdict never submits an order. */
export type QualityVerdict = {
  symbol: string;
  asOf: number;
  status: 'allowed' | 'hold-only' | 'exit' | 'unknown';
  reasons: string[];
  sources: {name: string; fetchedAt: number; official: boolean}[];
};
export interface CoinQualityProvider {
  check(symbol: string, asOfMs: number): Promise<QualityVerdict>;
  checkAll(symbols: string[], asOfMs: number): Promise<QualityVerdict[]>;
  quoteHealth(asOfMs: number): Promise<{ok: boolean; deviationBps: number; reasons: string[]}>;
}
export type RiskProfile = 'vorsichtig' | 'normal' | 'aggressiv';
export type QualityConfig = {
  minAgeDays: number;
  minMedianQuoteVolume: number;
  maxSpreadBps: number;
  depegBps: number;
  severeDepegBps: number;
  staleHours: number;
  delistHaircutPct: number;
  profile: RiskProfile;
  quote: string;
};
export const DEFAULT_QUALITY_CONFIG: Readonly<QualityConfig> = Object.freeze({
  minAgeDays: 90, minMedianQuoteVolume: 5_000_000, maxSpreadBps: 25,
  depegBps: 50, severeDepegBps: 200, staleHours: 48,
  delistHaircutPct: 10, profile: 'normal', quote: 'USDT',
});
export function readQualityConfig(env: NodeJS.ProcessEnv = process.env): QualityConfig {
  const number = (key: string, fallback: number, min: number, max: number) => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max)
      throw Error(key + ' must be between ' + min + ' and ' + max);
    return parsed;
  };
  const profile = env.QUALITY_PROFILE ?? 'normal';
  if (!['vorsichtig', 'normal', 'aggressiv'].includes(profile)) throw Error('Invalid QUALITY_PROFILE');
  const quote = env.QUALITY_QUOTE ?? env.QUOTE_CURRENCY ?? 'USDT';
  if (!/^[A-Z]{3,6}$/.test(quote)) throw Error('Invalid QUALITY_QUOTE');
  return {
    minAgeDays: number('QUALITY_MIN_AGE_DAYS', 90, 0, 3650),
    minMedianQuoteVolume: number('QUALITY_MIN_QUOTE_VOLUME', 5_000_000, 0, 1e12),
    maxSpreadBps: number('QUALITY_MAX_SPREAD_BPS', 25, 0, 10000),
    depegBps: number('QUALITY_DEPEG_BPS', 50, 1, 10000),
    severeDepegBps: number('QUALITY_SEVERE_DEPEG_BPS', 200, 1, 10000),
    staleHours: Math.min(48, number('QUALITY_STALE_HOURS', 48, 0, 48)),
    delistHaircutPct: number('QUALITY_DELIST_HAIRCUT_PCT', 10, 0, 99),
    profile: profile as RiskProfile,
    quote,
  };
}
export type QualitySource = QualityVerdict['sources'][number];
export type DailyVolume = {ts: number; quoteVolume: number}; // ts = UTC opening, fully closed 1d candle
export type PublicSignal = {
  available: boolean;
  fetchedAt: number;
  symbols: string[];
  // A positive announcement may be known, but an unparseable feed is NEVER assumed clear.
  clearForAll: boolean;
  coverage?: string[]; // set of symbols for which this particular observation can assert absence
  effectiveAt?: Record<string, number>;
};
export type QualityInput = {
  symbol: string; baseAsset: string; quoteAsset: string;
  status: string; spotAllowed: boolean;
  listedAtMs: number | null;
  volumes: DailyVolume[];
  spreadBps: number | null;
  tags: PublicSignal | null;
  delistings: PublicSignal | null;
  sources: QualitySource[];
};
export type QuotePrices = {
  eurUsd: number | null;
  eurUsdt: number | null;
  usdcUsdt: number | null;
  fdusdUsdt: number | null;
};
const stableAndFiat = new Set([
  'USDT', 'USDC', 'FDUSD', 'TUSD', 'DAI', 'USDP', 'BUSD', 'USD1', 'USDE',
  'EUR', 'EURI', 'USD', 'GBP', 'CHF', 'JPY', 'AUD', 'BRL', 'TRY',
]);
export function excludedBase(base: string): boolean {
  return stableAndFiat.has(base) || /(?:UP|DOWN|BULL|BEAR|[235]L|[235]S)$/.test(base);
}
export function median(values: number[]): number | null {
  if (values.length === 0 || values.some(x => !Number.isFinite(x) || x < 0)) return null;
  const sorted = [...values].sort((a,b) => a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
export function median30At(volumes: DailyVolume[], asOf: number): number | null {
  const day = 86_400_000;
  const closed = volumes.filter(v => Number.isInteger(v.ts) && v.ts >= 0 &&
    v.ts % day === 0 && v.ts + day <= asOf && Number.isFinite(v.quoteVolume) && v.quoteVolume >= 0)
    .sort((a,b) => b.ts-a.ts);
  // Require 30 consecutive, fully closed UTC days. Missing data is not zero.
  if (closed.length < 30 || closed[0]?.ts !== Math.floor(asOf/day)*day-day) return null;
  for (let i=1; i<30; i++) if (closed[i-1]!.ts - closed[i]!.ts !== day) return null;
  return median(closed.slice(0,30).map(v => v.quoteVolume));
}
export function assessQuote(quote: string, prices: QuotePrices, cfg: QualityConfig) {
  const reasons: string[] = [];
  // Independent ECB EUR/USD anchor distinguishes USDT depeg from relative cross-rate moves.
  const valid = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;
  if (!valid(prices.eurUsd) || !valid(prices.eurUsdt)) {
    return {ok:false, deviationBps:0, reasons:['EUR/USD (EZB) oder EURUSDT fehlt: Quote-Sicherheit unbekannt; keine Einstiege']};
  }
  const usdtUsd = prices.eurUsd / prices.eurUsdt;
  const values: Record<string, number | null> = {
    USDT: usdtUsd,
    USDC: valid(prices.usdcUsdt) ? prices.usdcUsdt * usdtUsd : null,
    FDUSD: valid(prices.fdusdUsdt) ? prices.fdusdUsdt * usdtUsd : null,
  };
  if (quote === 'EUR') return {ok:true, deviationBps:0, reasons:['EUR-Fiatquote: keine Stablecoin-Depeg-Bewertung; EZB nur Referenz']};
  const value = values[quote] ?? null;
  if (!valid(value)) return {ok:false, deviationBps:0, reasons:['Kein vertrauenswürdiger USD-Anker für Quote ' + quote + '; keine Einstiege']};
  const deviationBps = Math.abs(value - 1) * 10_000;
  if (deviationBps > cfg.depegBps) reasons.push(quote + ' Depeg: ' + deviationBps.toFixed(1) + ' bps; bot-weit keine Einstiege und Alarm');
  if (deviationBps >= cfg.severeDepegBps) reasons.push('Cash in anderen Stablecoin umschichten prüfen (nur Hinweis/Paper, keine Live-Aktion)');
  if (!reasons.length) reasons.push(quote + ' im Depeg-Toleranzband (' + deviationBps.toFixed(1) + ' bps)');
  return {ok:deviationBps <= cfg.depegBps, deviationBps, reasons};
}
export function evaluateQuality(input: QualityInput, asOf: number, cfg: QualityConfig,
  quoteHealth: {ok: boolean; deviationBps: number; reasons: string[]}): QualityVerdict {
  const reasons: string[] = [];
  let status: QualityVerdict['status'] = 'allowed';
  const block = (kind: QualityVerdict['status'], reason: string) => {
    reasons.push(reason);
    const priority = {allowed:0, 'hold-only':1, unknown:2, exit:3};
    if (priority[kind] > priority[status]) status = kind;
  };
  const {symbol, baseAsset, quoteAsset} = input;
  if (!Number.isFinite(asOf) || asOf < 0) throw Error('Invalid asOf');
  if (excludedBase(baseAsset)) block('hold-only', 'Stablecoin/Fiat/Leveraged-Token als Basis ausgeschlossen');
  if (!input.spotAllowed || input.status !== 'TRADING')
    block('hold-only', 'exchangeInfo: kein TRADING-Spot-Symbol; keine Orders');
  if (quoteAsset !== cfg.quote) block('hold-only', 'Quote nicht im konfigurierten Universum');
  if (!quoteHealth.ok) block('unknown', quoteHealth.reasons.length ? quoteHealth.reasons.join('; ') : 'Quote-Sicherheit unklar');
  if (input.listedAtMs === null || input.listedAtMs > asOf)
    block('unknown', 'Listing-Alter unbekannt (point-in-time)');
  else if (asOf - input.listedAtMs < cfg.minAgeDays * 86_400_000)
    block('hold-only', 'Listing jünger als ' + cfg.minAgeDays + ' Tage');
  const vol = median30At(input.volumes, asOf);
  if (vol === null) block('unknown', 'Keine 30 lückenlos geschlossenen Tages-Volumenkerzen');
  else if (vol < cfg.minMedianQuoteVolume)
    block('hold-only', 'Median Quote-Volumen ' + vol.toFixed(0) + ' unter ' + cfg.minMedianQuoteVolume);
  if (input.spreadBps === null || !Number.isFinite(input.spreadBps) || input.spreadBps < 0)
    block('unknown', 'Spread fehlt; keine neuen Einstiege');
  else if (input.spreadBps > cfg.maxSpreadBps)
    block('hold-only', 'Spread ' + input.spreadBps.toFixed(1) + ' bps über ' + cfg.maxSpreadBps);
  for (const [name, signal] of [['Monitoring/Seed-Tag',input.tags], ['Delisting-Ankündigungen',input.delistings]] as const) {
    if (!signal || !signal.available || signal.fetchedAt > asOf ||
        asOf - signal.fetchedAt > cfg.staleHours * 3_600_000 || !signal.clearForAll)
      block('unknown', name + ' nicht verlässlich verfügbar oder älter als ' + cfg.staleHours + ' h');
  }
  if (input.tags?.available && input.tags.fetchedAt <= asOf &&
      asOf - input.tags.fetchedAt <= cfg.staleHours * 3_600_000 &&
      input.tags.symbols.includes(symbol)) {
    block(cfg.profile === 'vorsichtig' ? 'exit' : 'hold-only',
      'Monitoring/Seed-Tag: ' + (cfg.profile === 'vorsichtig' ? 'Exit innerhalb 24 h' :
        cfg.profile === 'normal' ? 'halten, Exit bei schwächerem Signal' : 'nur halten'));
  }
  if (input.delistings?.available && input.delistings.fetchedAt <= asOf &&
      input.delistings.symbols.includes(symbol)) {
    block('exit', 'Delisting angekündigt: ' + (cfg.profile === 'vorsichtig' ? 'sofortiger Exit' :
      cfg.profile === 'normal' ? 'Exit innerhalb 24 h' : 'Exit vor Delisting-Datum') +
      (input.delistings.effectiveAt?.[symbol] ? ' (' + new Date(input.delistings.effectiveAt[symbol]).toISOString() + ')' : ' (Datum unklar)'));
  }
  if (status === 'allowed') reasons.push('Alle verfügbaren Qualitätsregeln erfüllt');
  return {symbol, asOf, status, reasons, sources: input.sources.filter(x => x.fetchedAt <= asOf)};
}
/** Only at post-replay settlement, never as an early strategy signal. */
export function archiveTerminalSettlement(lastClose: number, haircutPct = 10) {
  if (!Number.isFinite(lastClose) || lastClose <= 0 ||
      !Number.isFinite(haircutPct) || haircutPct < 0 || haircutPct >= 100) throw Error('Invalid terminal settlement');
  return {price:lastClose*(1-haircutPct/100), reason:'Ex-post terminal archive settlement; NOT pre-announced to strategy'};
}
