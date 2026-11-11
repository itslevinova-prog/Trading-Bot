import {effectiveTradingPolicy,entryPolicyGuard,TradingSettingsSchema,type TradingPolicy} from '../strategy/trading-policy.js';
import type {Action,Candle,DecisionContext,DecisionProvider,FeatureSnapshot,MarketTicker} from '@paper/shared';
import {feature} from '../market/indicators.js';
import {aggregate,closedSeries} from '../context/market-context.js';
import {RuleBasedProvider} from '../strategy/providers.js';
import {validateRisk,positionStopRisk,entryDrawdownGuard,type RiskLimits} from '../broker/risk.js';
import {entryQuoteGuard,entryFillGuard,type EntryLimits} from '../broker/executionGuards.js';

export type ReplayMarket={pair:string;candles:Candle[];lotDecimals:number;minQty:number;minOrderQuote:number};
export type PortfolioOptions={startingBalance:number;feeRate:number;spreadBps:number;slippageBps:number;fromTs?:number;toTs?:number;decisionIntervalMinutes:number;maxDrawdownPct:number;minOrderQuote:number;risk:RiskLimits;entry:EntryLimits;protectionTrigger?:'synthetic-bid'};
export type ReplayCausalMarket={pair:string;candles:Candle[];hourly:Candle[];bid:number;ask:number};
export type ReplayStudy={kind:'paper-mock-study';policy:TradingPolicy;enrich:(context:DecisionContext,markets:ReplayCausalMarket[])=>DecisionContext;onBuyFill?:(event:{context:DecisionContext;actions:Action[];action:Extract<Action,{type:'buy'}>;position:Position;fill:PortfolioFill;fillIndex:number})=>void};

type Position={pair:string;qty:number;basis:number;stop:number;target?:number;openedAt:number;pendingExit?:boolean};
export type PortfolioFill={pair:string;side:'buy'|'sell';barTs:number;signalBarTs:number|null;qty:number;price:number;fee:number;realizedPnl:number|null;reason:string;protective:boolean;intrabarOrderAmbiguous?:true};
export type PortfolioResult={
 strategy:'actual-rule-provider'|'paper-mock-study';fromTs:number;toTs:number;bars:number;startingBalance:number;finalEquity:number;returnPct:number;benchmarkReturnPct:number|null;
 maxDrawdownPct:number;fees:number;closedTrades:number;winRatePct:number|null;paused:boolean;decisions:number;signals:number;rejections:Record<string,number>;missingValuationBars:number;unliquidatedPositions:number;
 fills:PortfolioFill[];curve:{ts:number;equity:number;cash:number;positions:number;drawdownPct:number;valuationComplete?:false}[];assumptions:string[];
};
const floorQty=(value:number,decimals:number)=>Math.floor((value+Number.EPSILON)*10**decimals)/10**decimals;

/** Calls the actual rule provider and common risk gates. Historical fills remain
 * an explicit OHLC approximation: this is not a replay of real order books.
 * No database, network, model, parameter selection or live broker is accessible.
 */
export async function replayRulesPortfolio(markets:ReplayMarket[],options:PortfolioOptions,provider:DecisionProvider=new RuleBasedProvider(),study?:ReplayStudy):Promise<PortfolioResult>{
 const nums=[options.startingBalance,options.feeRate,options.spreadBps,options.slippageBps,options.decisionIntervalMinutes,options.maxDrawdownPct,options.minOrderQuote];
 if(!nums.every(Number.isFinite)||options.startingBalance<=0||options.feeRate<0||options.feeRate>.05||options.spreadBps<0||options.slippageBps<0||options.minOrderQuote<=0||options.decisionIntervalMinutes<15||options.decisionIntervalMinutes%15!==0||options.maxDrawdownPct<=0||options.maxDrawdownPct>1)throw Error('Invalid portfolio replay options');
 if (options.protectionTrigger !== undefined && (options.protectionTrigger !== 'synthetic-bid' || options.spreadBps >= 20000)) throw Error('Invalid replay protection trigger');
 if ([options.fromTs,options.toTs].some(t => t !== undefined && (!Number.isSafeInteger(t) || t < 0))) {
  throw Error('Invalid portfolio replay bounds');
 }
 if(!markets.length||new Set(markets.map(m=>m.pair)).size!==markets.length)throw Error('Empty or duplicate portfolio universe');
 if(study){
  if(study.kind!=='paper-mock-study'||options.risk.feeRate!==options.feeRate)throw Error('Invalid study mode or inconsistent study fees');
  TradingSettingsSchema.parse({mode:study.policy.mode,stopLossPct:study.policy.stopLossPct,expectedRevision:study.policy.revision});
  const expected=effectiveTradingPolicy({mode:study.policy.mode,stopLossPct:study.policy.stopLossPct,revision:study.policy.revision,updatedAt:study.policy.updatedAt},{MAX_POSITION_PCT:options.risk.maxPositionPct,MAX_OPEN_POSITIONS:options.risk.maxOpenPositions,MAX_TRADES_PER_DAY:options.risk.maxTradesPerDay,COIN_COOLDOWN_MINUTES:options.risk.cooldownMinutes,MAX_TOTAL_RISK_PCT:options.risk.maxPortfolioRiskPct??1,MAX_ENTRY_SPREAD_BPS:options.entry.maxSpreadBps,MAX_ENTRY_SLIPPAGE_BPS:options.entry.maxSlippageBps,DEFAULT_STOP_LOSS_PCT:study.policy.stopLossPct});
  if(JSON.stringify(expected)!==JSON.stringify(study.policy))throw Error('Study policy differs from effective hard limits');
 }

 const prepared=markets.map(m=>{
  if(!Number.isInteger(m.lotDecimals)||m.lotDecimals<0||m.lotDecimals>12||!Number.isFinite(m.minQty)||m.minQty<0||!Number.isFinite(m.minOrderQuote)||m.minOrderQuote<0)throw Error('Invalid replay exchange metadata');
  const rows=closedSeries(m.candles,15,options.toTs===undefined?Infinity:options.toTs+900000);
  if(rows.some(c=>c.ts%900000!==0))throw Error('Replay candles must be aligned to UTC 15 minutes');
  const hourly=aggregate(rows,60,Infinity);return {...m,rows,hourly,byTime:new Map(rows.map(c=>[c.ts,c])),cursor:0,hourCursor:0};
 });
 const allTimes=[...new Set(prepared.flatMap(m=>m.rows.map(c=>c.ts)))].sort((a,b)=>a-b);
 const from=options.fromTs??(allTimes[0]??0)+220*900000,to=options.toTs??allTimes.at(-1)??0;
 const times=allTimes.filter(ts=>ts>=from&&ts<=to);if(!times.length)throw Error('No evaluation bars after historical warmup');
 const riskLimits=study?{...options.risk,maxPositionPct:study.policy.maxPositionPct,maxOpenPositions:study.policy.maxOpenPositions,maxTradesPerDay:study.policy.maxEntriesPerDay,cooldownMinutes:study.policy.cooldownMinutes,maxPortfolioRiskPct:study.policy.maxPortfolioRiskPct}:options.risk;
 const entryLimits=study?{maxSpreadBps:study.policy.maxSpreadBps,maxSlippageBps:study.policy.maxSlippageBps}:options.entry;
 const positions=new Map<string,Position>(),lastSell=new Map<string,number>(),marks=new Map<string,number>();
 let cash=options.startingBalance,fees=0,peak=options.startingBalance,maxDrawdown=0,paused=false,decisions=0,signals=0,missingValuationBars=0,day=-1,tradesToday=0,entriesToday=0,lastEntryAt:number|undefined;
 const fills:PortfolioFill[]=[],curve:PortfolioResult['curve']=[],rejections:Record<string,number>={};
 const reject=(reason:string)=>{rejections[reason]=(rejections[reason]??0)+1;};
 const halfSpread=options.spreadBps/20000,slippage=options.slippageBps/10000;
 const protectionFactor=options.protectionTrigger==='synthetic-bid'?1-halfSpread:1;
 const markEquity=()=>cash+[...positions.values()].reduce((sum,p)=>sum+p.qty*(marks.get(p.pair)??0),0);
 const riskPositions=()=>[...positions.values()].map(p=>{const price=marks.get(p.pair)??0,m=prepared.find(m=>m.pair===p.pair)!;return {pair:p.pair,value:p.qty*price,stopRisk:positionStopRisk(p.qty,price,p.stop,options.feeRate,Math.max(options.minOrderQuote,m.minOrderQuote))};});
 let lastDrawdown = 0;
 const updateDrawdown = (complete: boolean) => {
  const equity = markEquity();
  if (complete) {
   peak = Math.max(peak, equity);
   lastDrawdown = peak > 0 ? (peak-equity)/peak : 0;
   maxDrawdown = Math.max(maxDrawdown, lastDrawdown);
   if (lastDrawdown >= options.maxDrawdownPct) paused = true;
  }
  return {equity, dd: lastDrawdown};
 };
 const close=(p:Position,c:Candle,reference:number,reason:string,protective:boolean,signalTs:number|null,pauseOnFailure=protective,intrabarOrderAmbiguous=false)=>{
  const price=reference*(1-halfSpread)*(1-slippage),cost=p.qty*price,fee=cost*options.feeRate;
  const m=prepared.find(m=>m.pair===p.pair)!;if(p.qty<m.minQty||cost<Math.max(options.minOrderQuote,m.minOrderQuote)){reject('Exit below exchange minimum');if(pauseOnFailure){p.pendingExit=true;paused=true;}return;}
  cash+=cost-fee;fees+=fee;fills.push({pair:p.pair,side:'sell',barTs:c.ts,signalBarTs:signalTs,qty:p.qty,price,fee,realizedPnl:cost-fee-p.basis,reason,protective,...(intrabarOrderAmbiguous?{intrabarOrderAmbiguous:true as const}:{})});positions.delete(p.pair);lastSell.set(p.pair,c.ts);tradesToday++;
 };
 let previousBar: number | undefined;
 for(const ts of times){
  if (previousBar !== undefined && positions.size) {
   missingValuationBars += (ts - previousBar) / 900000 - 1;
  }
  previousBar = ts;
  const utcDay=Math.floor(ts/86400000);if(day!==utcDay){day=utcDay;tradesToday=0;entriesToday=0;}
  const current=new Map(prepared.flatMap(m=>{const c=m.byTime.get(ts);return c?[[m.pair,c] as const]:[];}));
  const valuationMissing=[...positions.keys()].some(pair=>!current.has(pair));if(valuationMissing)missingValuationBars++;
  for(const [pair,c] of current)marks.set(pair,c.open*(1-halfSpread));
  // Native stops may trigger at the gap-open before a new strategy decision.
  for(const p of [...positions.values()]){const c=current.get(p.pair);if(c&&p.pendingExit)close(p,c,c.open,'latched protective retry',true,null);else if(c&&c.open*protectionFactor<=p.stop)close(p,c,c.open,'gap stop',true,null);else if(c&&p.target!==undefined&&c.open*protectionFactor>=p.target)close(p,c,p.target/protectionFactor,'gap target (conservative target fill)',true,null);}
  updateDrawdown(!valuationMissing);
  if(!paused&&ts%(options.decisionIntervalMinutes*60000)===0){
   const features:FeatureSnapshot[]=[],causalMarkets:ReplayCausalMarket[]=[];
   for(const m of prepared){
    while(m.cursor<m.rows.length&&m.rows[m.cursor]!.ts+900000<=ts)m.cursor++;
    while(m.hourCursor<m.hourly.length&&m.hourly[m.hourCursor]!.ts+3600000<=ts)m.hourCursor++;
    const c=current.get(m.pair);if(!c)continue;
    const ticker:MarketTicker={symbol:m.pair,bid:c.open*(1-halfSpread),ask:c.open*(1+halfSpread),last:c.open,change24h:0,volume:0,receivedAt:ts};
    const f=feature(m.pair,m.rows.slice(Math.max(0,m.cursor-750),m.cursor),m.hourly.slice(Math.max(0,m.hourCursor-750),m.hourCursor),ticker,ts);
    if(f&&f.ts+900000<=ts)features.push(f);
    if(study)causalMarkets.push({pair:m.pair,bid:ticker.bid,ask:ticker.ask,candles:m.rows.slice(Math.max(0,m.cursor-193),m.cursor).map(c=>({...c})),hourly:m.hourly.slice(Math.max(0,m.hourCursor-72),m.hourCursor).map(c=>({...c}))});
   }
   const account={cash,equity:markEquity(),status:paused?'paused':'active'};
   const context:DecisionContext={timeUTC:new Date(ts+5000).toISOString(),timeZurich:new Date(ts+5000).toISOString(),account,positions:[...positions.values()],features,recentTrades:fills.slice(-10),limits:{TAKER_FEE_RATE:options.feeRate,MIN_ORDER_EUR:options.minOrderQuote,MAX_POSITION_PCT:options.risk.maxPositionPct,MAX_TOTAL_RISK_PCT:options.risk.maxPortfolioRiskPct??1,MAX_OPEN_POSITIONS:options.risk.maxOpenPositions,MAX_TRADES_PER_DAY:options.risk.maxTradesPerDay},memory:[],lessons:[]};
   const decisionContext=study?study.enrich({...context,account:{...account,valuation:{complete:!valuationMissing}},tradingPolicy:study.policy},causalMarkets):context;
   const entryContext=study?.onBuyFill?structuredClone(decisionContext):undefined;
   const answer=await provider.decide(decisionContext);decisions++;
   for(const action of answer.actions){
    if(action.type==='hold')continue;signals++;
    const m=prepared.find(m=>m.pair===action.pair),c=current.get(action.pair),f=features.find(f=>f.pair===action.pair);
    if(!m||!c||!f){reject('No current market and closed feature');continue;}
    if(action.type==='sell'){
     const p=positions.get(action.pair);if(!p){reject('No position');continue;}
     if(!study&&tradesToday>=options.risk.maxTradesPerDay){reject('Daily strategy trade cap');continue;}
     if(action.sellFraction!==1){reject('Partial sells not emitted by actual rule provider');continue;}
     if(p.qty<m.minQty||p.qty*c.open*(1-halfSpread)*(1-slippage)<Math.max(options.minOrderQuote,m.minOrderQuote)){reject('Exit below exchange minimum');continue;}
     close(p,c,c.open,action.reasoning,false,f.ts);continue;
    }
    if(valuationMissing){reject('Stale portfolio valuation');continue;}
    if(study){const why=entryPolicyGuard(study.policy,{revision:study.policy.revision,confidence:action.confidence,lastEntryAt,now:ts+5000});if(why){reject(why);continue;}}
    const stopPct=study?Math.min(action.stopLossPct,study.policy.stopLossPct):action.stopLossPct;
    const quote=entryQuoteGuard(c.open*(1-halfSpread),c.open*(1+halfSpread),entryLimits);if(!quote.allowed){reject(quote.reason);continue;}
    const approved=validateRisk({accountId:'rules',pair:action.pair,side:'buy',amountEur:action.amountEur,stopLossPct:stopPct,reason:action.reasoning,decisionId:String(ts)},{equity:markEquity(),cash,status:paused?'paused':'active',positions:riskPositions(),tradesToday:study?entriesToday:tradesToday,lastSellAt:lastSell.get(action.pair),now:ts},riskLimits);
    if(!approved.allowed){reject(approved.reason);continue;}
    const price=c.open*(1+halfSpread)*(1+slippage),guard=entryFillGuard(price,c.open,entryLimits);if(!guard.allowed){reject(guard.reason);continue;}
    const qty=floorQty((approved.amountEur??0)/((1+options.feeRate)*price),m.lotDecimals),cost=qty*price,fee=cost*options.feeRate,old=positions.get(action.pair),bid=c.open*(1-halfSpread);
    if(!Number.isFinite(qty)||qty<m.minQty||qty<=0||cost<Math.max(options.minOrderQuote,m.minOrderQuote)){reject('Entry below exchange minimum');continue;}
    const postEquity=markEquity()-cost-fee+qty*bid,exposure=(old?.qty??0)*price+cost;
    const stop=old?.stop??price*(study?1+options.feeRate:1)*(1-stopPct),usedRisk=riskPositions().reduce((s,p)=>s+p.stopRisk,0),newRisk=positionStopRisk(qty,price,stop,options.feeRate,Math.max(options.minOrderQuote,m.minOrderQuote))+fee;
    const drawdownWhy=entryDrawdownGuard(postEquity,peak,options.maxDrawdownPct);if(drawdownWhy){reject(drawdownWhy);continue;}
    if(cost+fee>cash+1e-8||exposure>postEquity*riskLimits.maxPositionPct+1e-7||riskLimits.maxPortfolioRiskPct!==undefined&&usedRisk+newRisk>postEquity*riskLimits.maxPortfolioRiskPct+1e-7){reject('Post-fill cash/exposure/portfolio risk cap');continue;}
    positions.set(action.pair,{pair:action.pair,qty:qty+(old?.qty??0),basis:cost+fee+(old?.basis??0),stop,target:old?.target??(action.takeProfitPct?price*(1+action.takeProfitPct):undefined),openedAt:old?.openedAt??ts});cash-=cost+fee;fees+=fee;tradesToday++;entriesToday++;lastEntryAt=ts+5000;
    fills.push({pair:action.pair,side:'buy',barTs:ts,signalBarTs:f.ts,qty,price,fee,realizedPnl:null,reason:action.reasoning,protective:false});
    if(study?.onBuyFill){const returned=study.onBuyFill(structuredClone({context:entryContext!,actions:answer.actions,action,position:positions.get(action.pair)!,fill:fills.at(-1)!,fillIndex:fills.length-1}));if(returned!==undefined)throw Error('Replay buy-fill observer must be synchronous and return void');}
   }
  }
  // Stop-first if both levels are touched: intrabar ordering is unknowable.
  for(const p of [...positions.values()]){const c=current.get(p.pair);if(!c||p.pendingExit)continue;const targetTouched=p.target!==undefined&&c.high*protectionFactor>=p.target;if(c.low*protectionFactor<=p.stop)close(p,c,Math.min(c.open,p.stop/protectionFactor),'intrabar stop-first',true,null,true,targetTouched);else if(targetTouched)close(p,c,p.target!/protectionFactor,'intrabar target',true,null);}
  for(const [pair,c] of current)marks.set(pair,c.close*(1-halfSpread));
  const {equity,dd}=updateDrawdown(!valuationMissing);
  curve.push({ts:ts+900000,equity,cash,positions:positions.size,drawdownPct:dd*100,
   ...(valuationMissing ? {valuationComplete:false as const} : {})});
 }
 // Use the requested final bar, even when every market is missing at that clock.
 const finalBar = Math.floor(to / 900000) * 900000;
 const firstBar = Math.ceil(from / 900000) * 900000;
 if (positions.size) missingValuationBars += (finalBar - times.at(-1)!) / 900000;
 let finalMarkStale = false;
 for(const p of [...positions.values()]){
  const c=prepared.find(m=>m.pair===p.pair)!.byTime.get(finalBar);
  if(c)close(p,c,c.close,'evaluation end liquidation',true,null,false);
  else {
   reject('Cannot liquidate missing final market');
   finalMarkStale = true;
  }
 }
 const end=updateDrawdown(!finalMarkStale);
 if(curve.length)curve[curve.length-1]={ts:times.at(-1)!+900000,equity:end.equity,cash,positions:positions.size,drawdownPct:end.dd*100,
  ...(finalMarkStale ? {valuationComplete:false as const} : {})};
 const sales=fills.filter(f=>f.side==='sell'),wins=sales.filter(f=>(f.realizedPnl??0)>0).length;
 const btc=prepared.find(m=>m.pair.split('/')[0]==='BTC'),b0=btc?.byTime.get(firstBar),b1=btc?.byTime.get(finalBar);
 const benchmarkReturnPct=b0&&b1?((b1.close*(1-halfSpread)*(1-slippage)*(1-options.feeRate))/(b0.open*(1+halfSpread)*(1+slippage)*(1+options.feeRate))-1)*100:null;
 return {strategy:study?'paper-mock-study':'actual-rule-provider',fromTs:times[0]!,toTs:times.at(-1)!+900000,bars:times.length,startingBalance:options.startingBalance,finalEquity:end.equity,returnPct:(end.equity/options.startingBalance-1)*100,benchmarkReturnPct,maxDrawdownPct:maxDrawdown*100,fees,closedTrades:sales.length,winRatePct:sales.length?wins/sales.length*100:null,paused,decisions,signals,rejections,missingValuationBars,unliquidatedPositions:positions.size,fills,curve,assumptions:[
  study?'Explicit mock study: supplied simulated provider, effective AI policy, entries-only daily cap, global entry pause, uncapped strategy exits and fee-inclusive stop basis. No live execution.':'Actual RuleBasedProvider, shared feature calculations and common entry/risk guards. No strategy or parameter selection.',
  'Signals see only candles closed before the execution bar; decisions nominally occur +5s after the boundary. OHLC cannot resolve those five seconds or real latency.',
  'Entry/exit fills approximate next-open/trigger plus configured spread and slippage. Historical books, queue position and market impact are unavailable.',
  'UTC daily trade limits, coin cooldown, shared cash, lot rounding, exchange minimums, portfolio stop-risk and drawdown pause are modelled.',
  ...(options.protectionTrigger==='synthetic-bid'?['Stops and targets trigger on synthetic bid OHLC with constant half-spread. Trigger-level fills apply slippage without charging the spread again.']:[]),
  'Stop-first on simultaneous intrabar levels; gap stops use the worse open. Liquidation at the evaluation end is artificial.',
  'Protective intrabar exits assume executable liquidity. Known quantity/notional minimums are enforced; unliquidated dust remains marked at bid, not converted into fictional cash.',
  'Paused accounts do not consult the provider. Failed protective exits latch and pause entries; retries use the next available bar open, a coarse approximation of live paper ticks/backoff. Successful recovery does not automatically resume.',
  'Current surviving market universe and current exchange metadata introduce survivorship/metadata bias. No future profitability is established.',
  ...(finalMarkStale ? ['The requested final bar is unavailable for an open position. Final equity carries its last observed mark, and the position remains unliquidated.'] : [])
 ]};
}
