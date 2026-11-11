import {PortfolioRiskEngine,DEFAULT_RISK_LIMITS,type RiskLimits} from '../risk-engine/engine.js';
import {assessResearchCoverage,type CoveragePreflight,type CoverageInterval} from '../archive/report.js';
import {requireCoinQualityEntry} from '../coin-quality/admission.js';
import {summarizeHistoricalTradability,type HistoricalTradabilityObservation,type HistoricalTradabilitySummary} from '../coin-quality/archive-contract.js';
import type {CoinQualityProvider} from '../coin-quality/contracts.js';
import {replayRiskSnapshot} from '../risk-engine/replay.js';
import type {Action,DecisionContext,DecisionProvider} from '@paper/shared';
import {RuleBasedProvider,BuyAndHoldProvider,TrendVolTargetV1Provider} from '../strategy/providers.js';
import {buildClosedTrendV1Context,type TrendDailyEvidence} from './trend-daily-context.js';
import {feature} from '../market/indicators.js';
import {paperMarketContext} from '../context/paper-market-context.js';
import {digest} from '../provenance/build.js';
import type {Candle,CandleSource,IntervalMinutes} from './candle-source.js';
import {validateCandles,candleStep} from './candle-source.js';
import type {FillModelName} from './fill-models.js';
import {makeFillModel} from './fill-models.js';
import {SimulatedBroker,type MarketConstraints,type RiskConfiguration,type SimulatedTrade} from './simulated-broker.js';
import {assertLedgerInvariant} from './ledger-invariant.js';
import {calculateMetrics,type EquityPoint} from './metrics.js';
import type {PerformanceMetrics,DailyPoint} from './metrics.js';
type Strategy='rules'|'hold'|'trend-vol-target';
export type RecordedDecision={ts:number;symbol:string;actions:Action[]};
export type BacktestOptions={
  source:CandleSource;strategy:Strategy;fromMs:number;toMs:number;intervalMinutes:IntervalMinutes;
  initialCash?:number;fillModel?:FillModelName;spreadBps?:number;slippageBps?:number;
  feeRate?:number;trials?:number;seed?:number;dropSignalPct?:number;executionDelayBars?:number;
  constraints?:Map<string,MarketConstraints>;provider?:DecisionProvider;buildId?:string|null;
  quoteCurrency?:string;venue?:'binance'|'kraken';riskLimits?:Partial<RiskConfiguration>;
  variants?:readonly (readonly number[])[];
  /** Uses the exact same pure PortfolioRiskEngine as paper, but no live orders. */
  enablePortfolioRisk?:boolean;portfolioRiskLimits?:Partial<RiskLimits>;
  riskHistoryWarmup?:boolean;
  /** Fail-closed offline/archive research gate, opt-in for legacy fixture/paper tests. */
  enforceResearchCoverage?:boolean;
  /** Historical membership at each UTC midnight, derived only from earlier archived candles. */
  universeAt?:(utcMidnightMs:number)=>readonly string[]|Promise<readonly string[]>;
  /** Optional point-in-time quality source; absent in legacy comparison runs.
   * Archived provider must never infer old tags from current Binance metadata. */
  coinQuality?: Pick<CoinQualityProvider,'check'>;
  /** Reporting-only historical observations; never fed into order admission. */
  historicalTradabilityEvidence?: readonly HistoricalTradabilityObservation[];
};
export type BacktestResult={
  configuration:{strategy:Strategy;fromMs:number;toMs:number;intervalMinutes:IntervalMinutes;fillModel:FillModelName;feeRate:number;spreadBps:number;slippageBps:number;trials:number;seed:number;executionDelayBars:number;dropSignalPct:number};
  fingerprints:{data:string;configuration:string;codeBuild:string|null;combined:string};
  metrics:PerformanceMetrics;daily:DailyPoint[];equity:EquityPoint[];
  trades:SimulatedTrade[];decisions:RecordedDecision[];rejections:string[];
  limitations:string[];universe:string[];
  universeHistory:Array<{dateMs:number;symbols:string[]}>;
  coverage:CoveragePreflight|null;
  historicalTradability:HistoricalTradabilitySummary;
};
export class ResearchCoverageBlocked extends Error {
  constructor(readonly coverage: CoveragePreflight) {
    super('Research coverage blocked: ' + (coverage.reason ?? 'unknown data deficiency') +
      ' [fingerprint=' + coverage.fingerprint + ']');
    this.name = 'ResearchCoverageBlocked';
  }
}
export const defaultRisk:RiskConfiguration={maxPositionPct:.30,maxOpenPositions:4,maxTradesPerDay:10,cooldownMinutes:60,maxPortfolioRiskPct:.025,maxDrawdownPct:.25,maxSpreadBps:20,maxSlippageBps:30,minOrderEur:10,feeRate:.001};
function nextRandom(seed:number):()=>number {
  let state=(seed>>>0)||0x9e3779b9;
  return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
}
export async function runBacktest(options:BacktestOptions):Promise<BacktestResult> {
  const {source,fromMs,toMs,intervalMinutes}=options,step=candleStep(intervalMinutes);
  const trendMode=options.strategy==='trend-vol-target';
  // This integration is development-only. Real Stage-2/holdout access remains gated
  // by the pipeline, and an unverified PIT market cannot be called tradable.
  if(trendMode&&(intervalMinutes!==1440||fromMs<Date.UTC(2020,0,1)||
    toMs>Date.UTC(2024,0,1)||!options.universeAt||!options.coinQuality||
    !options.constraints?.size||options.enablePortfolioRisk!==true))
    throw Error('Trend v1 requires sealed daily development, PIT universe/quality, historic lots and portfolio-risk gate');
  if(options.enforceResearchCoverage && (toMs > Date.UTC(2024,0,1) || !options.universeAt))
   throw Error('Research coverage requires sealed pre-2024 development range and point-in-time membership');
  if(!Number.isSafeInteger(fromMs)||!Number.isSafeInteger(toMs)||fromMs<0||fromMs>=toMs||![15,60,240,1440].includes(intervalMinutes))
    throw Error('Invalid backtest interval/range');
  const feeRate=options.feeRate??.001,spreadBps=options.spreadBps??10,slippageBps=options.slippageBps??8,trials=options.trials??1;
  const seed=options.seed??1,dropSignalPct=options.dropSignalPct??0,executionDelayBars=options.executionDelayBars??0;
  if(!Number.isInteger(seed)||!Number.isInteger(trials)||trials<1||dropSignalPct<0||dropSignalPct>1)throw Error('Invalid random configuration');
  const available=new Set(await source.listSymbols());
  const DAY=86400000;
  const universeHistory:Array<{dateMs:number;symbols:string[]} >=[];
  if(options.universeAt){
   for(let dateMs=Math.floor(fromMs/DAY)*DAY;dateMs<=Math.floor(toMs/DAY)*DAY;dateMs+=DAY){
    const selected=await options.universeAt(dateMs);
    if(!Array.isArray(selected)||selected.some(s=>typeof s!=='string'||!s)||
      new Set(selected).size!==selected.length)
     throw Error('Invalid point-in-time universe at '+new Date(dateMs).toISOString());
    for(const symbol of selected){
     if(!available.has(symbol))throw Error('Point-in-time universe has no archived candle source: '+symbol);
     if(options.constraints?.size&&!options.constraints.has(symbol))
      throw Error('Historic coin excluded by current-only market constraints: '+symbol);
    }
    universeHistory.push({dateMs,symbols:[...selected].sort()});
   }
  }
  const symbols=(options.universeAt?
   [...new Set(universeHistory.flatMap(day=>day.symbols))]:
   [...available].filter(x=>options.constraints?.size?options.constraints.has(x):true)).sort();
  if(!symbols.length)throw Error('No candle symbols in the requested historic universe');
  const config={strategy:options.strategy,fromMs,toMs,intervalMinutes,fillModel:options.fillModel??'conservative-ohlc',feeRate,spreadBps,slippageBps,trials,seed,executionDelayBars,dropSignalPct};
  const limits={...defaultRisk,...options.riskLimits,feeRate};
  const warmup=Math.max((options.enablePortfolioRisk||options.riskHistoryWarmup)?62*86400000:10*86400000,100*candleStep(60)),start=Math.max(0,fromMs-warmup);
  const all=new Map<string,{primary:Candle[];m15:Candle[];h1:Candle[];trendDaily?:Candle[]}>();
  for(const symbol of symbols){
    const get=async(min:IntervalMinutes)=>{
      const rows=await source.getCandles(symbol,min,start,toMs);
      // Reject sources returning incomplete, unsorted or out-of-window candles.
      validateCandles(rows,min,start,toMs);return rows;
    };
    const primary=await get(intervalMinutes),m15=trendMode?[]:intervalMinutes===15?primary:await get(15);
    const h1=trendMode?[]:intervalMinutes===60?primary:await get(60);
    if(options.universeAt&&!trendMode&&(!m15.length||!h1.length))
     throw Error('Point-in-time backtest requires actual archived 15m and 1h candles: '+symbol);
    const trendFrom=Math.max(0,fromMs-260*DAY);
    const trendDaily=trendMode?await source.getCandles(symbol,1440,trendFrom,toMs):undefined;
    if(trendDaily)validateCandles(trendDaily,1440,trendFrom,toMs);
    all.set(symbol,{primary,m15,h1,trendDaily});
  }
  const coverage=options.enforceResearchCoverage?assessResearchCoverage({
    fromMs,toMs,universeHistory,
    series:[...all.entries()].flatMap(([symbol,source])=>
     ([{intervalMin:intervalMinutes,candles:source.primary},{intervalMin:15,candles:source.m15},
       {intervalMin:60,candles:source.h1}] as Array<{intervalMin:CoverageInterval;candles:Candle[]}>)
      .filter((row,index,list)=>list.findIndex(item=>item.intervalMin===row.intervalMin)===index)
      .map(row=>({symbol,intervalMin:row.intervalMin,candles:row.candles})))
   }):null;
  if(coverage?.status==='blocked')throw new ResearchCoverageBlocked(coverage);
  const events=new Map<number,{symbol:string;candle:Candle}[]>();
  for(const [symbol,series] of all)for(const candle of series.primary){
    const closedAt=candle.ts+step;
    if(closedAt<fromMs||closedAt>toMs)continue;
    const group=events.get(closedAt)??[];group.push({symbol,candle});events.set(closedAt,group);
  }
  if(!events.size)throw Error('No closed candles in selected period');
  const constraints=options.constraints??new Map(symbols.map(symbol=>[symbol,{symbol,ordermin:0,costmin:0,lotDecimals:8}]));
  const model=makeFillModel(config.fillModel,{spreadBps,slippageBps});
  if(model.name==='maker-queue')throw Error('maker-queue not implemented (issue #2)');
  const broker=new SimulatedBroker(options.initialCash??100,constraints,model,limits,executionDelayBars);
  const portfolioRisk=options.enablePortfolioRisk?
   new PortfolioRiskEngine({...DEFAULT_RISK_LIMITS,...options.portfolioRiskLimits}):null;
  const provider=options.provider??(trendMode?new TrendVolTargetV1Provider():
    options.strategy==='rules'?new RuleBasedProvider():new BuyAndHoldProvider());
  const random=nextRandom(seed),decisions:RecordedDecision[]=[],equity:EquityPoint[]=[{ts:fromMs,equity:broker.equity,exposed:false}];
  let holdQueued=false,lastTrendRebalanceAt:number|null=null;
  const membership=new Map(universeHistory.map(day=>[day.dateMs,new Set(day.symbols)]));
  for(const [now,group] of [...events.entries()].sort(([a],[b])=>a-b)){
    const eligible=options.universeAt?(membership.get(Math.floor(now/DAY)*DAY)??new Set<string>()):new Set(symbols);
    // Pending buys lose permission when a new day's historical universe drops the coin.
    for(let i=broker.orders.length-1;i>=0;i--){
     const pending=broker.orders[i]!;
     if(pending.action.type==='buy'&&!eligible.has(pending.action.pair)){
      broker.rejectionReasons.push('Coin left point-in-time universe before buy fill: '+pending.action.pair);
      broker.orders.splice(i,1);
     }
    }
    // Process bars only once they have closed; execution prices are modeled from their opens.
    for(const {symbol,candle} of group.sort((a,b)=>a.symbol.localeCompare(b.symbol)))broker.onCandle(symbol,candle,intervalMinutes);
    if(trendMode&&now>=toMs){equity.push({ts:now,equity:broker.equity,exposed:broker.positions.size>0});continue;}
    const inputs=[...all.entries()].filter(([pair])=>eligible.has(pair)||broker.positions.has(pair)).map(([pair,series])=>{
      // Closed-only binary cutoffs avoid quadratic scans over years of history.
      const closed=(rows:Candle[],minutes:number,limit:number)=>{
        let lo=0,hi=rows.length;
        while(lo<hi){const m=Math.floor((lo+hi)/2);if(rows[m]!.ts+minutes*60000<=now)lo=m+1;else hi=m;}
        return rows.slice(Math.max(0,lo-limit),lo).map(c=>({...c,pair,interval:minutes}));
      };
      const m15=closed(series.m15,15,1000);
      const h1=closed(series.h1,60,500);
      const price=m15.at(-1)?.close,synthetic=price?{bid:price*(1-spreadBps/20000),ask:price*(1+spreadBps/20000)}:undefined;
      const f=synthetic?feature(pair,m15,h1,synthetic,now):undefined;
      return {pair,candles:m15,hourly:h1,feature:f,coverage:{closedBars:m15.length,firstAt:m15[0]?.ts??null,lastAt:m15.at(-1)?.ts??null}};
    });
    const features=inputs.flatMap(i=>i.feature?[i.feature]:[]);
    const marketContext=paperMarketContext(inputs,options.venue??'binance',options.quoteCurrency??'EUR',now);
    const trendMarkets:TrendDailyEvidence[]=trendMode?await Promise.all(
      [...all.entries()].filter(([pair])=>eligible.has(pair)||broker.positions.has(pair))
      .map(async([pair,series])=>{
        const quality=await requireCoinQualityEntry(options.coinQuality!,pair,now,'backtest');
        return {pair,daily:series.trendDaily??[],
          constraints:constraints.get(pair)??null,
          quality:quality.allowed?'allowed' as const:'unknown' as const};
      })):[];
    const execution={mode:'backtest' as const,syntheticSpreadBps:spreadBps,
      syntheticSlippageBps:slippageBps,orderBookAvailable:false,
      ...(trendMode?{trendV1:buildClosedTrendV1Context({
        asOf:now,quote:options.quoteCurrency??'EUR',equity:broker.equity,cash:broker.cash,
        markets:trendMarkets,positions:[...broker.positions.values()],
        feeRate,spreadBps,slippageBps,lastRebalanceAt:lastTrendRebalanceAt
      })}:{})};
    const ctx:DecisionContext={
      timeUTC:new Date(now).toISOString(),timeZurich:new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',dateStyle:'short',timeStyle:'medium'}).format(now),
      account:{id:options.strategy,equity:broker.equity,cash:broker.cash,peakEquity:broker.peak},
      positions:[...broker.positions.values()].map(p=>({pair:p.symbol,qty:p.qty,stopLossPrice:p.stop,takeProfitPrice:p.target})),
      features,recentTrades:broker.trades.slice(-10),limits:{TAKER_FEE_RATE:feeRate,MIN_ORDER_EUR:limits.minOrderEur,MAX_POSITION_PCT:limits.maxPositionPct,MAX_OPEN_POSITIONS:limits.maxOpenPositions,MAX_TRADES_PER_DAY:limits.maxTradesPerDay,MAX_TOTAL_RISK_PCT:limits.maxPortfolioRiskPct,MAX_DRAWDOWN_PCT:limits.maxDrawdownPct},
      memory:[],lessons:[],marketContext,
      execution
    };
    // Providers only receive snapshots computed from candles with close timestamps <= now.
    const output=await provider.decide(ctx);
    if(!output||!Array.isArray(output.actions))throw Error('Invalid provider result');
    const actions:Action[]=output.actions;
    for(const a of actions){
      if(a.type==='hold')continue;
      if(a.type==='buy'&&!eligible.has(a.pair)){
       broker.rejectionReasons.push('Buy not in point-in-time universe: '+a.pair);
       continue;
      }
      if(a.type==='buy'&&options.coinQuality){
       const quality=await requireCoinQualityEntry(options.coinQuality,a.pair,now,'backtest');
       if(!quality.allowed){
        broker.rejectionReasons.push(quality.reason);continue;
       }
      }
      if(random()<dropSignalPct)continue;
      if(portfolioRisk&&a.type==='buy'){
       // Daily trend replay loads only the candidate, held coins and BTC hours.
       // Avoid retaining years of hourly bars for every delisted coin in RAM.
       const riskSeries=trendMode?new Map(await Promise.all(
        [...new Set([a.pair,...broker.positions.keys(),'BTC'+(options.quoteCurrency??'EUR')])]
        .map(async pair=>[pair,{h1:await source.getCandles(pair,60,Math.max(fromMs,now-62*DAY),now)}] as const)
       )):new Map([...all.entries()].map(([pair,value])=>[pair,{h1:value.h1}]));
       const snapshot=replayRiskSnapshot(now,a.pair,options.quoteCurrency??'EUR',
        riskSeries,
        {equity:broker.equity,cash:broker.cash,peak:broker.peak,
         positions:broker.positions,marks:broker.marks});
       const verdict=portfolioRisk.evaluateBuy(a.pair,a.amountEur,snapshot);
       if(!verdict.allowed){
        broker.rejectionReasons.push('Portfolio-RiskEngine: '+verdict.reasons.join('; '));
        continue;
       }
       broker.queue({...a,amountEur:Math.min(a.amountEur,verdict.approvedAmount)},now,options.strategy==='hold'?'hold':'rules');
      }else broker.queue(a,now,options.strategy==='hold'?'hold':'rules');
    }
    if(trendMode&&actions.some(a=>a.type!=='hold'))lastTrendRebalanceAt=now;
    if(options.strategy==='hold'&&!holdQueued){
      const quote=options.quoteCurrency??'EUR';
      const btc=['BTC/'+quote,'BTC'+quote].find(symbol=>eligible.has(symbol));
      if(btc&&group.some(x=>x.symbol===btc)&&!broker.positions.has(btc)){
        // Scheduler.buyHoldFirst places the initial BTC order outside BuyAndHoldProvider.decide.
        const quality=options.coinQuality?
         await requireCoinQualityEntry(options.coinQuality,btc,now,'backtest'):null;
        if(quality&&!quality.allowed)broker.rejectionReasons.push(quality.reason);
        else {
         broker.queue({type:'buy',pair:btc,amountEur:broker.cash,stopLossPct:.05,confidence:1,reasoning:'Paper buyHoldFirst'},now,'hold');
         holdQueued=true;
        }
      }
    }
    decisions.push({ts:now,symbol:'*',actions:actions.map(a=>({...a}))});
    equity.push({ts:now,equity:broker.equity,exposed:broker.positions.size>0});
  }
  if(options.universeAt){
   for(const symbol of broker.positions.keys()){
    const last=all.get(symbol)?.primary.at(-1);
    if(!last||last.ts+step<toMs)
     throw Error('Unresolved open position after historical candles end (possible delisting): '+symbol);
   }
   if(broker.orders.length)throw Error('Unfilled orders remain after historic candles ended; refusing to invent fills');
  }
  assertLedgerInvariant(broker,feeRate);
  const historicalTradability=summarizeHistoricalTradability({
    fromMs,toMs,universeHistory,trades:broker.trades,
    observations:options.historicalTradabilityEvidence
  });
  const data=digest(JSON.stringify({series:[...all.entries()].map(([symbol,v])=>({symbol,...v})),
    universeHistory,historicalTradabilityEvidence:options.historicalTradabilityEvidence??[] }));
  const configuration=digest(JSON.stringify({
    config,limits,initialCash:options.initialCash??100,quoteCurrency:options.quoteCurrency??'EUR',
    venue:options.venue??'binance',constraints:[...constraints.entries()].sort(([a],[b])=>a.localeCompare(b)),
    provider:options.provider?'injected-provider (not separately fingerprinted)':'production-provider',
    universeMode:options.universeAt?'point-in-time-daily':'static',
    researchCoverage:options.enforceResearchCoverage?'strict-monthly':'not-enforced',
    historicalTradability:'report-only-source-time-safe',
    coverageFingerprint:coverage?.fingerprint??null,
    coinQuality:options.coinQuality?'point-in-time-admission (external source fingerprint required)':'disabled',
    portfolioRisk:options.enablePortfolioRisk?{enabled:true,limits:{...DEFAULT_RISK_LIMITS,...options.portfolioRiskLimits}}:{enabled:false}
  }));
  const combined=digest(data+configuration+(options.buildId??'unverified-build'));
  const calculated=calculateMetrics(equity,broker.trades,fromMs,toMs,trials,options.variants,broker.rejected);
  return {configuration:config,fingerprints:{data,configuration,codeBuild:options.buildId??null,combined},
    metrics:calculated.metrics,daily:calculated.daily,equity,trades:broker.trades,decisions,rejections:broker.rejectionReasons,
    universe:symbols,universeHistory,coverage,historicalTradability,limitations:['Synthetic spread and slippage replace unavailable historic order-book data','No gap filling or look-ahead',
     options.universeAt?'Historic UTC-day universe from prior 30 daily candles; delisted pairs are included only where Binance public ZIPs exist. Missing delistings or archive gaps remain a limitation.':
      'Static source symbols: point-in-time membership unavailable; survivorship bias prevents historical promotion.',
     ...(options.universeAt&&!options.constraints?['Historical exchange lot and minimum-order rules unavailable; synthetic precision assumptions used']:[]),
     ...(coverage?['Verified offline point-in-time monthly candle coverage and minimum warm-up; fingerprint '+coverage.fingerprint]:[]),
     'Historical exchange tradability is separate from price-derived universe; unknown days and trades are not verified executable',
     'BuyAndHoldProvider follows the Paper scheduler initial-BTC order convention',
     ...(options.coinQuality?['Point-in-time quality source injected; independent archive and source fingerprint verification required; missing eligibility blocks entries']:[]),
     ...(portfolioRisk?['Portfolio RiskEngine applied only to completed hourly history; missing observations deny entries']:[]),
     ...(trendMode?['Trend v1 is an unvalidated daily development-only strategy; PIT coin quality and exchange lots are required; no 2024+/holdout or live/paper account promotion']:[])]};
}
