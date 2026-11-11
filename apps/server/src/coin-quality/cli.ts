import 'dotenv/config';
import {LiveCoinQualityProvider} from './providers.js';
import {QualityPublicSources} from './sources.js';
import {excludedBase, readQualityConfig} from './contracts.js';
import {publicRequest} from '../market/binance-data.js';
import {parseFixedPairs, selectBinanceUniverse} from '../market/pinned-universe.js';

async function universe(quote: string): Promise<string[]> {
  const sources = new QualityPublicSources();
  const catalog = await sources.exchangeInfo();
  const tickers = await publicRequest<{
    symbol:string;quoteVolume:string;bidPrice:string;askPrice:string;
    lastPrice:string;volume:string;priceChangePercent:string;
  }[]>('/api/v3/ticker/24hr');
  const fixed = parseFixedPairs(process.env.PAPER_FIXED_PAIRS || '');
  const selected = selectBinanceUniverse(catalog.symbols,tickers,{
    quote,topN:Number(process.env.TOP_N_PAIRS || 20),held:[],fixed,
  });
  return selected.map(x => x.s.symbol).filter(s => !excludedBase(
    catalog.symbols.find(meta => meta.symbol === s)?.baseAsset ?? s));
}
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command !== 'check' && command !== 'report') throw Error('Usage: quality:check [SYMBOL] or quality:report [--watch]');
  const cfg = readQualityConfig();
  const provider = new LiveCoinQualityProvider(cfg);
  const report = async () => {
    let symbols: string[];
    try { symbols = await universe(cfg.quote); }
    catch (error) {
      console.error('Universe source unavailable; cannot infer safe candidates:',String(error));
      process.exitCode = 1;
      return;
    }
    const yesterday = new Date(Date.now()-86_400_000).toISOString().slice(0,10);
    const before = await provider.getStorage().snapshotOn(yesterday) ?? await provider.getStorage().latest();
    const verdicts = await provider.checkAll(symbols,Date.now());
    const after = await provider.getStorage().latest();
    const changes = verdicts.filter(v => {
      const previous = before?.verdicts.find(x => x.symbol === v.symbol);
      return !previous || previous.status !== v.status || previous.reasons.join('|') !== v.reasons.join('|');
    });
    console.log(JSON.stringify({
      asOf:after?.asOf,quote:cfg.quote,quoteHealth:after?.quoteHealth,
      count:verdicts.length,verdicts,changes,history:'data/coin-quality/snapshots/',
      decisions:'data/coin-quality/decisions.ndjson',
    },null,2));
  };
  if (command === 'check') {
    const symbol = args[1];
    if (!symbol) throw Error('Symbol required, e.g. BTCUSDT');
    const verdict = await provider.check(symbol,Date.now());
    const health = await provider.quoteHealth(Date.now());
    console.log(JSON.stringify({verdict,quoteHealth:health},null,2));
    if (verdict.status !== 'allowed') process.exitCode = 2;
    return;
  }
  if (args.includes('--watch')) {
    // Long-running PAPER companion, daily snapshots without modifying the trade scheduler.
    // Only one watcher instance should run for a given QUALITY_DATA_DIR.
    await report();
    setInterval(() => {void report().catch(error => console.error('Quality report failed:',error));},24*60*60*1000);
    return;
  }
  await report();
}
void main().catch(error => {console.error('Coin quality failed closed:',error);process.exitCode = 1;});
