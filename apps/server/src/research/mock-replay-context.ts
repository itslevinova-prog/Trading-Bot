import {closedHourlyTrend} from '../context/hourly-trend.js';
import type {DecisionContext,MarketTicker,OrderBook} from '@paper/shared';
import {windowMetrics} from '../context/window-metrics.js';
import {closedMarketStructure} from '../context/market-structure.js';
import {effectiveTradingPolicy} from '../strategy/trading-policy.js';
import type {PortfolioOptions,ReplayStudy} from './portfolio.js';
export type MockReplayAssumptions={venue:'binance'|'kraken';quoteCurrency:'EUR'|'USDT'|'USDC';visibleDepthQuote:number;stopLossPct:number};
/** Explicit OHLC-only simulation, not historical order-book reconstruction. */
export function mockReplayStudy(options:PortfolioOptions,assumptions:MockReplayAssumptions):ReplayStudy{
 if(!Number.isFinite(assumptions.visibleDepthQuote)||assumptions.visibleDepthQuote<=0||!Number.isFinite(assumptions.stopLossPct)||assumptions.stopLossPct<.02||assumptions.stopLossPct>.15)throw Error('Invalid mock replay assumptions');
 const policy=effectiveTradingPolicy({mode:'safe',stopLossPct:assumptions.stopLossPct,revision:0,updatedAt:null},{MAX_POSITION_PCT:options.risk.maxPositionPct,MAX_OPEN_POSITIONS:options.risk.maxOpenPositions,MAX_TRADES_PER_DAY:options.risk.maxTradesPerDay,COIN_COOLDOWN_MINUTES:options.risk.cooldownMinutes,MAX_TOTAL_RISK_PCT:options.risk.maxPortfolioRiskPct??1,MAX_ENTRY_SPREAD_BPS:options.entry.maxSpreadBps,MAX_ENTRY_SLIPPAGE_BPS:options.entry.maxSlippageBps,DEFAULT_STOP_LOSS_PCT:assumptions.stopLossPct});
 return {kind:'paper-mock-study',policy,enrich:(context,markets):DecisionContext=>{
  const asOf=Date.parse(context.timeUTC);if(!Number.isSafeInteger(asOf))throw Error('Invalid replay context clock');
  const btc=markets.find(m=>m.pair==='BTC/'+assumptions.quoteCurrency)?.candles??[];
  const inputs=markets.map(m=>{
   if(!Number.isFinite(m.bid)||!Number.isFinite(m.ask)||m.bid<=0||m.ask<m.bid||m.candles.some(c=>c.pair!==m.pair||c.ts+900000>asOf)||m.hourly.some(c=>c.pair!==m.pair||c.ts+3600000>asOf))throw Error('Noncausal or invalid replay market');
   const ticker:MarketTicker={symbol:m.pair,bid:m.bid,ask:m.ask,last:(m.bid+m.ask)/2,volume:0,change24h:0,receivedAt:asOf};
   const book:OrderBook={symbol:m.pair,valid:true,receivedAt:asOf,bids:[{price:String(m.bid),qty:String(assumptions.visibleDepthQuote/m.bid)}],asks:[{price:String(m.ask),qty:String(assumptions.visibleDepthQuote/m.ask)}]};
   const metrics=windowMetrics(m.candles,btc,asOf),last=m.candles.at(-1);
   return {pair:m.pair,asOf,source:'synthetic-'+assumptions.venue,ticker,feature:context.features.find(f=>f.pair===m.pair),
    quality:{stale:!last||asOf-last.ts-900000>1200000,bookUsable:true,bookAgeMs:0,lastClosedAt:last?last.ts+900000:null,last24hComplete:metrics.last24hComplete},
    microstructure:{bids:book.bids,asks:book.asks,scope:'Synthetic one-level depth assumption; not an observed historical order book'},
    regime:{...metrics,hourlyTrend:closedHourlyTrend(m.pair,m.hourly,context.features.find(f=>f.pair===m.pair),asOf),structure:closedMarketStructure(m.candles,m.pair,asOf)}};
  });
  const evidence={version:'mock-replay-context-v1',asOf,markets:inputs,missingSources:['Historical spread/depth/queue/latency and first actual candle receipt were not observed; synthetic next-open quotes are assumptions.','Long-horizon context/news/memory are not used by either frozen prototype and are not supplied here. Shared daily/48h metrics and21bar structure use exact closed windows.']};
  return {...context,tradingPolicy:policy,execution:{mode:'paper',venue:assumptions.venue,quoteCurrency:assumptions.quoteCurrency,simulation:{kind:'ohlc-next-open-synthetic-book-v1',historicalOrderBookObserved:false,visibleDepthQuote:assumptions.visibleDepthQuote,nominalDecisionDelayMs:5000,spreadBps:options.spreadBps,slippageBps:options.slippageBps}},marketContext:evidence,limits:{...context.limits,MAX_POSITION_PCT:policy.maxPositionPct,MAX_TOTAL_RISK_PCT:policy.maxPortfolioRiskPct,MAX_OPEN_POSITIONS:policy.maxOpenPositions,MAX_TRADES_PER_DAY:policy.maxEntriesPerDay,MAX_ENTRY_SPREAD_BPS:policy.maxSpreadBps,MAX_ENTRY_SLIPPAGE_BPS:policy.maxSlippageBps}};
 }};
}
