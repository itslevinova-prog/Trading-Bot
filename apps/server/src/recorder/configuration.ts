import {publicRequest, type BinanceSymbol} from '../market/binance-data.js';
import {selectBinanceUniverse, type PublicPairTicker} from '../market/pinned-universe.js';

export type TradeMode = 'all' | 'top10' | 'off';
export type RecorderConfig = {
  topN: number; pairs: string[]; snapshotMs: number; flushMs: number; staleMs: number;
  minFreeGb: number; tradeMode: TradeMode; socketPairLimit: number; recordingDir: string;
};
const positiveInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error(`Invalid recorder integer: ${value}`);
  return n;
};
const nonNegativeNumber = (value: string | undefined, fallback: number) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) throw Error('Invalid RECORD_MIN_FREE_GB');
  return n;
};
export function recorderConfig(env: NodeJS.ProcessEnv, recordingDir: string): RecorderConfig {
  const tradeMode = env.RECORD_TRADES ?? 'all';
  if (!['all','top10','off'].includes(tradeMode)) throw Error('RECORD_TRADES must be all, top10 or off');
  const pairs = (env.RECORD_PAIRS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (new Set(pairs).size !== pairs.length || pairs.some(s => !/^[A-Z0-9]{2,20}\/(?:USDT|USDC|EUR)$/.test(s))) throw Error('RECORD_PAIRS must be unique BASE/QUOTE pairs');
  return {
    topN: positiveInt(env.RECORD_TOP_N, 20, 1, 50),
    pairs, snapshotMs: positiveInt(env.RECORD_SNAPSHOT_MS, 5000, 1000, 60000),
    flushMs: positiveInt(env.RECORD_FLUSH_MS, 2000, 250, 60000),
    staleMs: positiveInt(env.RECORD_STALE_MS, 15000, 1000, 120000),
    minFreeGb: nonNegativeNumber(env.RECORD_MIN_FREE_GB, 5),
    tradeMode: tradeMode as TradeMode,
    socketPairLimit: positiveInt(env.RECORD_SOCKET_PAIRS, 30, 1, 100),
    recordingDir,
  };
}
export type RecorderUniverse = {symbols: string[]; tradeSymbols: Set<string>};
export function selectRecorderUniverse(
  info: BinanceSymbol[], tickers: PublicPairTicker[], config: Pick<RecorderConfig,'topN'|'pairs'|'tradeMode'>,
): RecorderUniverse {
  const available = new Map(info.filter(s => s.status === 'TRADING' && s.isSpotTradingAllowed !== false &&
    ['USDT','USDC','EUR'].includes(s.quoteAsset)).map(s => [s.symbol,s]));
  const ranked = selectBinanceUniverse(info,tickers,{quote:'USDT',topN:config.topN,held:[],fixed:[]})
    .slice(0, config.topN).map(({s}) => s.baseAsset);
  const symbols = config.pairs.length ? config.pairs :
    ranked.flatMap(base => ['USDT','USDC','EUR'].filter(quote => available.has(base+quote)).map(quote=>base+'/'+quote));
  for (const symbol of symbols) {
    const compact=symbol.replace('/',''),metadata=available.get(compact);
    if(!metadata||metadata.baseAsset+'/'+metadata.quoteAsset!==symbol)throw Error('Unavailable Binance spot pair: '+symbol);
  }
  if (!symbols.length) throw Error('No eligible Binance spot pairs');
  const top10 = new Set(ranked.slice(0,10));
  const tradeSymbols = new Set(config.tradeMode === 'off' ? [] : symbols.filter(s =>
    config.tradeMode === 'all' || top10.has(available.get(s.replace('/',''))!.baseAsset)));
  return {symbols,tradeSymbols};
}
export async function loadRecorderUniverse(config: RecorderConfig): Promise<RecorderUniverse> {
  const [info,tickers] = await Promise.all([
    publicRequest<{symbols: BinanceSymbol[]}>('/api/v3/exchangeInfo'),
    publicRequest<PublicPairTicker[]>('/api/v3/ticker/24hr'),
  ]);
  return selectRecorderUniverse(info.symbols,tickers,config);
}
