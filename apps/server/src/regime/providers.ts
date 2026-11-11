import { publicRequest } from '../market/binance-data.js';
import { breadthComponent, closedThrough, DAY_MS, incomplete, transition, trendComponent, utcDay, validCandles, volatilityComponent } from './math.js';
import type { Candle, CandleSource, RegimeProvider, RegimeState, UniverseAt } from './types.js';

export type RegimeDependencies = { source: CandleSource; universeAt: UniverseAt };
const BTC = 'BTCUSDT';
const HISTORY_DAYS = 1_095 + 200 + 31;

export class ArchiveRegimeProvider implements RegimeProvider {
  constructor(protected readonly dependencies: RegimeDependencies) {}

  async getRegime(asOfMs: number): Promise<RegimeState> {
    const day = utcDay(this.checked(asOfMs));
    const states = await this.getHistory(day, day);
    return { ...states[0]!, asOf: asOfMs };
  }

  /** Inclusive UTC-day boundaries. Every daily score excludes all bars from that day onward. */
  async getHistory(fromMs: number, toMs: number): Promise<RegimeState[]> {
    const first = utcDay(this.checked(fromMs)), last = utcDay(this.checked(toMs));
    if (last < first || (last - first) / DAY_MS > 2_200) throw new Error('Ungültiger Regime-Berichtszeitraum');
    const warmup = first - 90 * DAY_MS;
    const readFrom = warmup - HISTORY_DAYS * DAY_MS;
    const cache = new Map<string, Promise<Candle[]>>();
    const load = (symbol: string): Promise<Candle[]> => {
      let pending = cache.get(symbol);
      if (!pending) {
        pending = this.dependencies.source.getCandles(symbol, 1440, readFrom, last)
          .then(rows => {
            // Ignore even malformed future rows: they must not change a past decision.
            const past = rows.filter(row => Number.isSafeInteger(row.ts) && row.ts + DAY_MS <= last);
            return validCandles(past) ? past : [];
          })
          .catch(() => []);
        cache.set(symbol, pending);
      }
      return pending;
    };
    const btc = await load(BTC);
    const out: RegimeState[] = [];
    let prior: { regime: RegimeState['regime']; daysInState: number } = { regime: 'neutral', daysInState: 3 };
    for (let day = warmup; day <= last; day += DAY_MS) {
      let state: RegimeState;
      const btcClosed = closedThrough(btc, day);
      if (!btcClosed.length || btcClosed.at(-1)!.ts + DAY_MS !== day) {
        state = incomplete(day, 'BTC-Tageskerze bis Vortag fehlt oder ist ungültig');
      } else {
        const trend = trendComponent(btcClosed), volatility = volatilityComponent(btcClosed, day);
        if (!trend || !volatility) {
          state = incomplete(day, 'BTC-EMA- oder rollierende Volatilitäts-Historie unzureichend');
        } else {
          let universe: string[];
          try {
            universe = await this.dependencies.universeAt(day, { quote: 'USDT', topN: 50 });
          } catch {
            universe = [];
          }
          if (!universe.length || universe.length > 50 || new Set(universe).size !== universe.length ||
            universe.some(s => !/^[A-Z0-9]{2,30}USDT$/.test(s))) {
            state = incomplete(day, 'Point-in-Time-Top-50-Universum nicht verfügbar');
          } else {
            const candles = await Promise.all(universe.map(load));
            const coins = candles.map(rows => closedThrough(rows, day));
            if (coins.some(rows => !rows.length || rows.at(-1)!.ts + DAY_MS !== day)) {
              state = incomplete(day, 'Tageskerzen im Point-in-Time-Universum fehlen');
            } else {
              const breadth = breadthComponent(coins);
              if (!breadth) {
                state = incomplete(day, '50-Tage-EMA der Point-in-Time-Coins nicht vollständig');
              } else {
                const components = { trend: trend.value, volatility: volatility.value, breadth: breadth.value };
                const score = (components.trend + components.volatility + components.breadth) / 3;
                state = {
                  asOf: day, regime: 'neutral', score, components,
                  reasons: [...trend.reasons,
                    'BTC-Volatilitätsperzentil (rollierende 3 Jahre): ' + Math.round(volatility.percentile * 100) + ' %',
                    'Marktbreite PIT-Top-' + universe.length + ': ' + Math.round(breadth.fraction * 100) + ' % über EMA(50)']
                };
              }
            }
          }
        }
      }
      const missing = state.reasons.some(reason => reason.startsWith('Daten unvollständig'));
      prior = transition(prior, state.score, missing);
      state.regime = prior.regime;
      if (day >= first) out.push(state);
    }
    return out;
  }

  private checked(ms: number): number {
    if (!Number.isSafeInteger(ms) || ms < DAY_MS) throw new Error('asOfMs muss UTC-Millisekunden enthalten');
    return ms;
  }
}

export type DailyFetcher = (symbol: string, fromMs: number, toMs: number) => Promise<Candle[]>;

/** Public Binance Spot REST: 1d candles only, without API key, credentials or orders. */
export async function fetchPublicDaily(symbol: string, fromMs: number, toMs: number): Promise<Candle[]> {
  if (!/^[A-Z0-9]{2,30}USDT$/.test(symbol)) throw new Error('Nur öffentliche Spot-USDT-Paare');
  const out: Candle[] = [];
  let cursor = fromMs;
  for (let page = 0; page < 3 && cursor < toMs; page++) {
    const raw = await publicRequest<unknown>('/api/v3/klines', {
      symbol, interval: '1d', startTime: String(cursor), endTime: String(toMs - 1), limit: '1000'
    });
    if (!Array.isArray(raw) || !raw.length) break;
    for (const row of raw) {
      if (!Array.isArray(row) || row.length < 6) throw new Error('Ungültiges Binance-Tageskerzenformat');
      const candle: Candle = { ts: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
        low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) };
      if (candle.ts + DAY_MS <= toMs) out.push(candle);
    }
    const lastTs = Number((raw.at(-1) as unknown[])[0]);
    if (!Number.isSafeInteger(lastTs) || lastTs < cursor) throw new Error('Unerwartete Binance-Zeitstempel');
    cursor = lastTs + DAY_MS;
    if (raw.length < 1000) break;
  }
  if (!validCandles(out)) throw new Error('Binance-Tageskerzen beschädigt');
  return out;
}

/**
 * Paper-only live provider. Prefer injected local 1d candles, filling absent public
 * Binance history on demand. The PIT universe is always injected; a present-day
 * volume leaderboard is NEVER used to label historical dates.
 */
export class LiveRegimeProvider extends ArchiveRegimeProvider {
  constructor(dependencies: RegimeDependencies & { fetchDaily?: DailyFetcher; loadMissing?: boolean }) {
    const fetchDaily = dependencies.fetchDaily ?? fetchPublicDaily;
    const source: CandleSource = {
      listSymbols: () => dependencies.source.listSymbols(),
      getCandles: async (symbol, interval, fromMs, toMs) => {
        const local = await dependencies.source.getCandles(symbol, interval, fromMs, toMs).catch(() => []);
        if (interval !== 1440 || dependencies.loadMissing === false) return local;
        const expectedLast = toMs - DAY_MS;
        const enough = local.length >= (symbol === BTC ? 1_125 : 50) &&
          local.some(c => c.ts === expectedLast);
        if (enough) return local;
        try {
          const publicRows = await fetchDaily(symbol, fromMs, toMs);
          const merged = new Map<number, Candle>();
          for (const row of publicRows) merged.set(row.ts, row);
          for (const row of local) merged.set(row.ts, row);
          return [...merged.values()].sort((a, b) => a.ts - b.ts);
        } catch {
          return local; // A network failure cannot fabricate bullish evidence.
        }
      }
    };
    super({ source, universeAt: dependencies.universeAt });
  }
}
