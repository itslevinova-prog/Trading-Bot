import {floorLot,validateRule} from '../forward/lots.js';
import {ResearchV51Drawdown,type ResearchV51Observation} from './research-v51-drawdown.js';
import type {Action,BrokerOrder} from '@paper/shared';
import {validateRisk,positionStopRisk,entryDrawdownGuard} from '../broker/risk.js';
import {entryQuoteGuard,entryFillGuard} from '../broker/executionGuards.js';
import {evaluateCostAdmission,type CostEstimate} from '../broker/cost-hurdle.js';
import {PaperMakerQueue,type MakerFill} from '../broker/paper-maker-queue.js';
import type {Candle,IntervalMinutes} from './candle-source.js';
import {candleStep} from './candle-source.js';
import type {FillModel,FillQuote} from './fill-models.js';
import {FeeSchedule,type FeeLiquidity} from './fee-schedule.js';
export type MarketConstraints={symbol:string;ordermin:number;costmin:number;lotDecimals:number;stepSize?:string;pairDecimals?:number};
/** fee is always a quote-valued equivalent for reporting. When the buy fee
 * is paid in base, grossQty differs from the credited qty and no quote fee
 * is subtracted from cash. The venue's actual fee asset remains unknown. */
export type SimulatedTrade={ts:number;decisionTs:number;symbol:string;side:'buy'|'sell';qty:number;price:number;fee:number;notional:number;realizedPnl:number|null;spreadCost:number;slippageCost:number;reason:string;feeAsset?:'base'|'quote';grossQty?:number;feeBaseQty?:number;feeTariffId?:string;feeRateApplied?:number;feeRounding?:'unrounded'|'round-up-quote-8dp'|'round-up-base-8dp';feeLiquidity?:'maker'|'taker';feeSource?:'synthetic-assumption'|'public-assumption';makerOrderId?:string};
export type MakerBookEvidence={bestBid:number;bestAsk:number;receivedAt:number};
export type MakerCostEvidence={estimate:CostEstimate|null;expectedGrossMoveBps:number|null;maxRoundtripCostBps:number};
export type PublicMakerTrade={symbol:string;price:number;qty:number;exchangeTs:number;receivedAt:number|null};
export type SimulatedPosition={symbol:string;qty:number;basis:number;entryPrice:number;stop:number|null;target:number|null;openedAt:number};
export type RiskConfiguration={maxPositionPct:number;maxOpenPositions:number;maxTradesPerDay:number;cooldownMinutes:number;maxPortfolioRiskPct:number;maxDrawdownPct:number;maxSpreadBps:number;maxSlippageBps:number;minOrderEur:number;feeRate:number};
/** Conservative capacity assumption, NOT a measured market impact or fill model.
 * Only a previously fully closed quote-volume bar can authorize a new entry. */
export type QuoteParticipationLimit=Readonly<{maxQuoteVolumeFraction:number}>;
type Pending={action:Exclude<Action,{type:'hold'}>;decisionTs:number;strategy:'rules'|'hold';v5RequestedAmount?:number};
export class SimulatedBroker {
  readonly trades:SimulatedTrade[]=[];
  readonly positions=new Map<string,SimulatedPosition>();
  readonly rejectionReasons:string[]=[];
  readonly marks=new Map<string,number>();
  readonly orders:Pending[]=[];
  /** Paper-only: observed public trades may establish a hypothetical maker fill.
   * Neither the book nor the public trade proves an actual queue position. */
  readonly makerQueue=new PaperMakerQueue();
  private readonly makerActions=new Map<string,{pending:Pending;feeRate:number}>();
  private makerSerial=0;
  private v5PausedAt:number|null=null;
  private readonly v51Drawdown:ResearchV51Drawdown|null;
  private readonly lastClosedQuoteVolume=new Map<string,{
    closedAt:number;quoteVolume:number|null;intervalMs:number
  }>();
  cash:number;
  peak:number;
  /** feeAsset applies to buy-side commissions. Sell-side commissions remain
   * in quote, never silently deducting additional base inventory. */
  constructor(readonly startingCash:number,private readonly pairs:Map<string,MarketConstraints>,readonly model:FillModel,readonly limits:RiskConfiguration,private readonly delayBars=0,private readonly feeSchedule?:FeeSchedule,readonly feeAsset:'base'|'quote'='quote',readonly participation?:QuoteParticipationLimit,private readonly researchV5=false,private readonly researchV51=false) {
    if(startingCash<=0||!Number.isFinite(startingCash)||!Number.isSafeInteger(delayBars)||delayBars<0)throw Error('Invalid starting cash/delay');
    if(feeAsset!=='base'&&feeAsset!=='quote')throw Error('Unknown fee asset');
    if(participation&&(!Number.isFinite(participation.maxQuoteVolumeFraction)||
      participation.maxQuoteVolumeFraction<=0||participation.maxQuoteVolumeFraction>1))
      throw Error('Invalid quote-volume participation limit');
    for(const pair of pairs.values())if(pair.stepSize)validateRule({stepSize:pair.stepSize,minQty:pair.ordermin.toFixed(8),minNotional:pair.costmin.toFixed(8)});
    if(researchV51&&!researchV5)throw Error('H-025 v5.1 requires isolated v5 research broker');
    this.v51Drawdown=researchV51?new ResearchV51Drawdown(startingCash):null;
    this.cash=startingCash;this.peak=startingCash;
  }
  /** Research-only irreversible entry pause. No Paper or production reset path. */
  get researchV5PausedAt(){return this.v51Drawdown?.permanentStopAt??this.v5PausedAt;}
  get researchV51Resets(){return this.v51Drawdown?.resets??[];}
  observeResearchV51Day(input:Omit<ResearchV51Observation,'equity'|'historicalPeak'|'openPositions'>){
    if(!this.v51Drawdown)throw Error('H-025 v5.1 not enabled on this broker');
    return this.v51Drawdown.observeDay({...input,equity:this.equity,
      historicalPeak:this.peak,openPositions:this.positions.size});
  }
  researchV5EntryScale(asOf:number):number {
    if(!this.researchV5)throw Error('H-025 v5 not enabled on this broker');
    if(!Number.isSafeInteger(asOf)||asOf<0)throw Error('Invalid research daily clock');
    const equity=this.equity;
    if(!Number.isFinite(equity)||equity<=0)throw Error('Invalid research account equity');
    if(this.v51Drawdown)return this.v51Drawdown.entryScale(asOf,equity,this.peak);
    if(equity<=this.startingCash*.70+1e-8&&this.v5PausedAt===null)this.v5PausedAt=asOf;
    if(this.v5PausedAt!==null)return 0;
    const dd=Math.max(0,1-equity/Math.max(this.peak,equity));
    return dd<=.10?1:dd>=.30?0:(.30-dd)/.20;
  }
  get rejected(){return this.rejectionReasons.length;}
  get missedMakerFills(){return this.makerQueue.missed.length;}
  get equity(){return this.cash+[...this.positions.values()].reduce((sum,p)=>sum+p.qty*(this.marks.get(p.symbol)??p.entryPrice),0);}
  private reject(reason:string){this.rejectionReasons.push(reason);return false;}
  /** Match the Paper adapter's post-lot entry admission: the final rounded
   * debit, account state, position cap and executable stop risk must all fit
   * at the actual fill clock. Never reuse the earlier signal-time approval.
   * Historical candles cannot prove a live PortfolioRiskEngine verdict. */
  private finalRoundedBuyRisk(pending:Pending,atMs:number,fillPrice:number,
    netQty:number,notional:number,quoteFee:number,feeQuoteValue:number,
    stop:number|null):string|null{
    const action=pending.action;
    if(action.type!=='buy')return null;
    const debit=notional+quoteFee;
    if(!Number.isSafeInteger(atMs)||atMs<pending.decisionTs||
      ![fillPrice,netQty,notional,quoteFee,feeQuoteValue,debit].every(Number.isFinite)||
      fillPrice<=0||netQty<=0||notional<=0||quoteFee<0||feeQuoteValue<0||debit<=0)
      return 'Invalid fill clock, quantity or costs after lot rounding';
    if(this.researchV5&&this.researchV5EntryScale(atMs)<=0)
      return 'H-025 v5 permanent pause or 30% peak drawdown at fill';
    if(debit>action.amountEur+1e-7)
      return 'Post-rounding debit including fees exceeds approved order budget';
    if(debit>this.cash+1e-8)
      return 'Insufficient cash after lot rounding';
    // Paper's hold/DCA entries bypass strategy-risk sizing but never bypass
    // the exact debit, cash, lot and minimum-notional requirements.
    if(pending.strategy==='hold')return null;
    if(this.trades.some(t=>t.ts>atMs))
      return 'Future-dated broker trades cannot authorize a historical entry';
    const marks=[...this.positions.values()].map(p=>{
      const marked=this.marks.get(p.symbol);
      return {position:p,marked};
    });
    if(marks.some(({marked})=>marked===undefined||
      !Number.isFinite(marked)||marked<=0))
      return 'Missing or invalid existing-position valuation at fill';
    const equity=this.equity,feeRate=this.riskFeeRate();
    if(!Number.isFinite(equity)||equity<=0||!Number.isFinite(feeRate)||
      feeRate<0||feeRate>=1)
      return 'Invalid equity or risk fee assumption at fill';
    const state={
      equity,cash:this.cash,status:'active',
      positions:marks.map(({position:p,marked})=>({
        pair:p.symbol,value:p.qty*marked!,
        stopRisk:positionStopRisk(p.qty,marked!,p.stop,feeRate,this.limits.minOrderEur)
      })),
      tradesToday:this.trades.filter(t=>t.side==='buy'&&
        new Date(t.ts).toISOString().slice(0,10)===
        new Date(atMs).toISOString().slice(0,10)).length,
      lastSellAt:this.trades.filter(t=>t.symbol===action.pair&&t.side==='sell')
        .at(-1)?.ts,now:atMs
    };
    const approval=validateRisk({
      accountId:'backtest',pair:action.pair,side:'buy',amountEur:debit,
      stopLossPct:action.stopLossPct,reason:action.reasoning,decisionId:'backtest'
    } satisfies BrokerOrder,state,{
      maxPositionPct:this.limits.maxPositionPct,
      maxOpenPositions:this.limits.maxOpenPositions,
      maxTradesPerDay:this.limits.maxTradesPerDay,
      cooldownMinutes:this.limits.cooldownMinutes,
      maxPortfolioRiskPct:this.researchV5?undefined:this.limits.maxPortfolioRiskPct,
      feeRate
    });
    if(!approval.allowed||!Number.isFinite(approval.amountEur)||
      approval.amountEur!+1e-7<debit)
      return 'Post-rounding risk limits: '+approval.reason;
    // Base-denominated fees also reduce the account's mark-to-market equity,
    // though they do not debit quote cash. Count their known fill-time value.
    const postEquity=equity-feeQuoteValue;
    const drawdownReason=entryDrawdownGuard(postEquity,this.peak,this.limits.maxDrawdownPct);
    if(drawdownReason)return 'Post-fill drawdown: '+drawdownReason;
    if(netQty*fillPrice>postEquity*this.limits.maxPositionPct+1e-7)
      return 'Post-fill position exposure exceeds post-fee equity limit';
    const existingRisk=state.positions.reduce((sum,p)=>sum+p.stopRisk,0);
    const pair=this.pairs.get(action.pair)!;
    const newRisk=positionStopRisk(netQty,fillPrice,stop,feeRate,
      Math.max(this.limits.minOrderEur,pair.costmin))+feeQuoteValue;
    if(!Number.isFinite(existingRisk+newRisk)||
      (!this.researchV5&&existingRisk+newRisk>postEquity*this.limits.maxPortfolioRiskPct+1e-7))
      return 'Post-fill aggregate stop-risk budget exceeded';
    return null;
  }
  /** Admission uses data whose candle CLOSE is no later than fill/placement.
   * An absent, zero-volume, non-contiguous or expired bar always blocks entry.
   * Protective exits are not delayed by an entry-capacity assumption. */
  private entryParticipationReason(symbol:string,atMs:number,notional:number):string|null {
    if(!this.participation)return null;
    const prior=this.lastClosedQuoteVolume.get(symbol);
    if(!prior||prior.quoteVolume===null||prior.quoteVolume<=0||
      !Number.isSafeInteger(atMs)||atMs<prior.closedAt||
      atMs-prior.closedAt>=prior.intervalMs)
      return 'Participation: missing or stale previously closed quote volume';
    if(!Number.isFinite(notional)||notional<=0||
      notional>prior.quoteVolume*this.participation.maxQuoteVolumeFraction+1e-8)
      return 'Participation: entry exceeds previously closed quote-volume cap';
    return null;
  }
  /** Until actual maker fills exist this broker only books taker executions. */
  private riskFeeRate():number {
    const schedule=this.feeSchedule;
    return schedule?Math.max(this.limits.feeRate,...schedule.tariffs.map(t=>t.takerRate*schedule.stressMultiplier)):this.limits.feeRate;
  }
  private chargedFee(symbol:string,ts:number,notional:number,
    liquidity:FeeLiquidity='taker',fallbackMakerRate?:number) {
    if (!this.feeSchedule){
      const rate=liquidity==='maker'?(fallbackMakerRate??this.limits.feeRate):this.limits.feeRate;
      return {fee:notional*rate,
        feeTariffId:liquidity==='maker'?'legacy-maker-assumption':'legacy-flat',
        feeRateApplied:rate,feeRounding:'unrounded' as const,
        feeLiquidity:liquidity,feeSource:'synthetic-assumption' as const};
    }
    // The actual fill clock selects the tariff; placement cannot freeze a cheaper rate.
    const result=this.feeSchedule.charge(symbol,ts,liquidity,notional);
    return {fee:result.fee,feeTariffId:result.tariffId,feeRateApplied:result.rate,
      feeRounding:result.rounding,feeLiquidity:result.liquidity,feeSource:result.source};
  }
  queue(action:Action,decisionTs:number,strategy:'rules'|'hold'='rules'):boolean {
    if(action.type==='hold')return false;
    if(!this.pairs.has(action.pair))return this.reject('Unknown pair');
    if(this.orders.some(o=>o.action.pair===action.pair)||[...this.makerQueue.pending.values()].some(o=>o.symbol===action.pair))return this.reject('Order already pending');
    if(action.type==='sell'&&!this.positions.has(action.pair))return this.reject('No position');
    let v5RequestedAmount:number|undefined;
    if(action.type==='buy') {
      if(this.positions.has(action.pair)&&!this.researchV5)return this.reject('Existing position');
      if(this.researchV5){
        v5RequestedAmount=action.amountEur;
        const scale=this.researchV5EntryScale(decisionTs);
        if(scale<=0)return this.reject('H-025 v5 peak drawdown or permanent entry pause');
        action={...action,amountEur:action.amountEur*scale};
      }
      if(strategy==='rules') {
        const state={equity:this.equity,cash:this.cash,status:'active',positions:[...this.positions.values()].map(p=>({pair:p.symbol,value:p.qty*(this.marks.get(p.symbol)??p.entryPrice),stopRisk:positionStopRisk(p.qty,this.marks.get(p.symbol)??p.entryPrice,p.stop,this.riskFeeRate(),this.limits.minOrderEur)})),tradesToday:this.trades.filter(t=>t.side==='buy'&&new Date(t.ts).toISOString().slice(0,10)===new Date(decisionTs).toISOString().slice(0,10)).length,lastSellAt:this.trades.filter(t=>t.symbol===action.pair&&t.side==='sell').at(-1)?.ts,now:decisionTs};
        const guard=entryDrawdownGuard(state.equity,this.peak,this.limits.maxDrawdownPct);
        if(guard)return this.reject(guard);
        const risk=validateRisk({accountId:'backtest',pair:action.pair,side:'buy',amountEur:action.amountEur,stopLossPct:action.stopLossPct,reason:action.reasoning,decisionId:'backtest'} satisfies BrokerOrder,state,{maxPositionPct:this.limits.maxPositionPct,maxOpenPositions:this.limits.maxOpenPositions,maxTradesPerDay:this.limits.maxTradesPerDay,cooldownMinutes:this.limits.cooldownMinutes,maxPortfolioRiskPct:this.researchV5?undefined:this.limits.maxPortfolioRiskPct,feeRate:this.riskFeeRate()});
        if(!risk.allowed)return this.reject(risk.reason);
        action={...action,amountEur:risk.amountEur??action.amountEur};
      }
    }
    this.orders.push({action,decisionTs,strategy,...(v5RequestedAmount!==undefined?{v5RequestedAmount}:{})});
    return true;
  }
  /** Require a received, non-stale book and an assumption-based 2x edge gate.
   * The order is NOT booked until a subsequent received trade crosses the limit.
   * Caller must provide chronological book/trade evidence, never OHLC-derived fills.
   * The existing risk and quote guards run before the maker order is parked. */
  queuePostOnly(action:Action,decisionTs:number,book:MakerBookEvidence|null,
    ttlMs:number,makerFeeRate:number,cost:MakerCostEvidence,
    strategy:'rules'|'hold'='rules'):string|null{
    if(action.type==='hold')return null;
    if(!Number.isSafeInteger(decisionTs)||decisionTs<0||
      !Number.isSafeInteger(ttlMs)||ttlMs<1||
      !Number.isFinite(makerFeeRate)||makerFeeRate<0||makerFeeRate>0.05)
      throw Error('Invalid maker placement parameters');
    if(!book||!Number.isSafeInteger(book.receivedAt)||book.receivedAt<0||
      book.receivedAt>decisionTs||decisionTs-book.receivedAt>5000)
      {this.reject('Missing, future or stale received book');return null;}
    if(!Number.isFinite(book.bestBid)||!Number.isFinite(book.bestAsk)||
      book.bestBid<=0||book.bestAsk<=book.bestBid)
      {this.reject('Invalid post-only book');return null;}
    if(!entryQuoteGuard(book.bestBid,book.bestAsk,{
      maxSpreadBps:this.limits.maxSpreadBps,maxSlippageBps:this.limits.maxSlippageBps
    }).allowed){this.reject('Entry cost guards');return null;}
    // If a tariff schedule is provided the caller cannot substitute a cheaper
    // fee rate at placement. Actual charges are reselected at fill time.
    if(this.feeSchedule&&Math.abs(
      this.feeSchedule.select(action.pair,decisionTs,'maker').rate-makerFeeRate)>1e-12){
      this.reject('Maker fee assumption disagrees with versioned tariff');return null;
    }
    // Never trust an externally supplied zero-cost estimate: a maker entry
    // still pays its fee, and a protective stop must assume a taker exit.
    const observedSpreadBps=20000*(book.bestAsk-book.bestBid)/
      (book.bestAsk+book.bestBid);
    const feeAndExitSpreadFloorBps=10000*(makerFeeRate+this.riskFeeRate())+
      observedSpreadBps/2;
    if(!cost.estimate||!Number.isFinite(cost.estimate.roundtripBps)||
      cost.estimate.roundtripBps+1e-8<feeAndExitSpreadFloorBps){
      this.reject('Maker cost estimate omits maker/taker fees or exit half-spread');
      return null;
    }
    const admission=evaluateCostAdmission(cost);
    if(!admission.allowed){this.reject('Maker cost gate: '+admission.reason);return null;}
    // queue() applies existing position, drawdown and risk restrictions.
    if(!this.queue(action,decisionTs,strategy))return null;
    const pending=this.orders.pop()!;
    const pair=this.pairs.get(action.pair)!;
    const price=action.type==='buy'?book.bestBid:book.bestAsk;
    const scale=10**pair.lotDecimals;
    const reserved=[...this.makerQueue.pending.values()]
      .filter(o=>o.side==='buy').reduce((sum,o)=>
        sum+o.qty*o.limitPrice*(1+o.makerFeeRate),0);
    const cashAvailable=Math.max(0,this.cash-reserved);
    let qty=action.type==='buy'?
      Math.floor(Math.min(pending.action.type==='buy'?pending.action.amountEur:0,cashAvailable)/
        (price*(this.feeAsset==='quote'?1+makerFeeRate:1))*scale+1e-9)/scale:
      Math.floor(((this.positions.get(action.pair)?.qty??0)*
        (pending.action.type==='sell'?pending.action.sellFraction:0))*scale+1e-9)/scale;
    if(pair.stepSize)qty=floorLot(qty,{stepSize:pair.stepSize,minQty:String(pair.ordermin),minNotional:String(pair.costmin)});
    const notional=qty*price;
    if(!Number.isFinite(qty)||qty<=0||qty+1e-9<pair.ordermin||
      notional+1e-9<Math.max(pair.costmin,this.limits.minOrderEur)){
      this.reject('Maker minimum order or available cash');return null;
    }
    if(action.type==='buy'){
      const reason=this.entryParticipationReason(action.pair,decisionTs,notional);
      if(reason){this.reject(reason);return null;}
    }
    const id='backtest-maker-'+(++this.makerSerial);
    this.makerQueue.place({id,symbol:action.pair,side:action.type,qty,
      bestBid:book.bestBid,bestAsk:book.bestAsk,placedAt:decisionTs,ttlMs,makerFeeRate});
    this.makerActions.set(id,{pending,feeRate:makerFeeRate});
    return id;
  }
  /** Replay is observable only as of the *local receipt* clock, not exchange
   * event time. Missing receipt or clock contradictions never create a fill. */
  observeMakerTrade(trade:PublicMakerTrade,decisionCutoffMs:number):MakerFill[]{
    if(!Number.isSafeInteger(decisionCutoffMs)||decisionCutoffMs<0||
      !Number.isSafeInteger(trade.exchangeTs)||trade.exchangeTs<0)
      throw Error('Invalid maker replay clock');
    if(trade.receivedAt===null||!Number.isSafeInteger(trade.receivedAt)||
      trade.receivedAt<0||trade.receivedAt>decisionCutoffMs||
      trade.exchangeTs>trade.receivedAt){
      this.reject('Maker public trade receipt unknown, future or clock conflict');
      return [];
    }
    // A delayed print cannot fill an order placed AFTER its exchange event.
    // There is at most one pending order per symbol (enforced at placement).
    const pendingForSymbol=[...this.makerQueue.pending.values()]
      .find(order=>order.symbol===trade.symbol);
    if(pendingForSymbol&&trade.exchangeTs<=pendingForSymbol.placedAt)return [];
    const fills=this.makerQueue.observeTrade({
      symbol:trade.symbol,price:trade.price,qty:trade.qty,ts:trade.receivedAt
    });
    for(const fill of fills){
      const context=this.makerActions.get(fill.id);
      if(!context)throw Error('Maker fill missing pending broker action');
      this.makerActions.delete(fill.id);
      const previous=this.trades.length;
      // Use the documented maker limit, never the possibly better crossing trade.
      const candle:Candle={ts:fill.observedAt,open:fill.price,high:fill.price,
        low:fill.price,close:fill.price,volume:0};
      this.execute(context.pending,candle,{
        quote:{price:fill.price,spreadCost:0,slippageCost:0},
        feeRate:context.feeRate,liquidity:'maker',qty:fill.qty,orderId:fill.id
      });
      if(this.trades.length===previous)this.reject('Hypothetical maker fill failed broker ledger checks');
    }
    return fills;
  }
  expireMakerOrders(now:number):number{
    const expired=this.makerQueue.expire(now);
    for(const order of expired){
      this.makerActions.delete(order.id);
      this.reject('Maker order expired without fill: '+order.id);
    }
    return expired.length;
  }
  /** Process one already-closed candle, simulating its opening fill and intrabar exits. */
  onCandle(symbol:string,candle:Candle,interval:IntervalMinutes):void {
    // Opening fills must not see the current bar's not-yet-observed CLOSE.
    this.marks.set(symbol,candle.open);
    for(let i=this.orders.length-1;i>=0;i--){
      const pending=this.orders[i]!;
      if(pending.action.pair!==symbol||candle.ts<pending.decisionTs+this.delayBars*candleStep(interval))continue;
      this.orders.splice(i,1);
      this.execute(pending,candle);
    }
    const position=this.positions.get(symbol);
    if(position){
      const stopped=this.model.exit(candle,position.stop,position.target);
      if(stopped)this.sell(symbol,position.qty,stopped.quote,candle.ts,candle.ts,stopped.reason);
    }
    this.marks.set(symbol,candle.close);
    this.peak=Math.max(this.peak,this.equity);
    // The current bar's volume is unavailable at its opening fill clock.
    // Publish it only for subsequent candles/decisions.
    this.lastClosedQuoteVolume.set(symbol,{
      closedAt:candle.ts+candleStep(interval),
      quoteVolume:Number.isFinite(candle.quoteVolume)&&
        (candle.quoteVolume??0)>0?candle.quoteVolume!:null,
      intervalMs:candleStep(interval)
    });
  }
  private execute(pending:Pending,candle:Candle,maker?:{
    quote:FillQuote;feeRate:number;liquidity:'maker';qty:number;orderId:string
  }):void {
    const action=pending.action;
    const quote=maker?.quote??this.model.entry(candle,action.type);
    if(action.type==='sell'){
      const position=this.positions.get(action.pair);
      if(!position){this.reject('Missing position at fill');return;}
      const lot=this.pairs.get(action.pair)!;
      const qty=maker?.qty??(action.sellFraction===1?position.qty:Math.floor(position.qty*action.sellFraction*10**lot.lotDecimals+1e-9)/10**lot.lotDecimals);
      this.sell(action.pair,qty,quote,candle.ts,pending.decisionTs,'signal',
        maker?'maker':'taker',maker?.feeRate,maker?.orderId);
      return;
    }
    const pair=this.pairs.get(action.pair)!;
    if(!maker){
      const spread=quote.price/((1+(this.model.spreadBps/2+this.model.slippageBps)/10000));
      const bid=spread*(1-this.model.spreadBps/20000),ask=spread*(1+this.model.spreadBps/20000);
      if(!entryQuoteGuard(bid,ask,{maxSpreadBps:this.limits.maxSpreadBps,maxSlippageBps:this.limits.maxSlippageBps}).allowed||!entryFillGuard(quote.price,spread,{maxSpreadBps:this.limits.maxSpreadBps,maxSlippageBps:this.limits.maxSlippageBps}).allowed){this.reject('Entry cost guards');return;}
    }
    const v5Scale=this.researchV5?this.researchV5EntryScale(candle.ts):1;
    if(this.researchV5&&v5Scale<=0){this.reject('H-025 v5 permanent pause or peak drawdown at fill');return;}
    const budget=Math.min(action.amountEur,this.cash,
      pending.v5RequestedAmount===undefined?Infinity:pending.v5RequestedAmount*v5Scale);
    const rate=this.feeSchedule?.select(action.pair,candle.ts,maker?'maker':'taker').rate??
      (maker?.feeRate??this.limits.feeRate);
    const rawQty=budget/(quote.price*(this.feeAsset==='quote'?1+rate:1));
    const grossQty=maker?.qty??(pair.stepSize?floorLot(rawQty,{stepSize:pair.stepSize,minQty:String(pair.ordermin),minNotional:String(pair.costmin)}):
      Math.floor(rawQty*10**pair.lotDecimals+1e-9)/10**pair.lotDecimals);
    const notional=grossQty*quote.price;
    const charged=this.chargedFee(action.pair,candle.ts,notional,
      maker?'maker':'taker',maker?.feeRate);
    // Fees charged in base reduce the delivered position, not quote cash.
    // Always round against the simulated account and value the charge at
    // the known fill price, never at a future mark or invented exchange tier.
    const feeBaseQty=this.feeAsset==='base'?
      Math.ceil(grossQty*charged.feeRateApplied*1e8-1e-9)/1e8:0;
    const qty=grossQty-feeBaseQty;
    const fee=this.feeAsset==='base'?feeBaseQty*quote.price:charged.fee;
    const quoteFee=this.feeAsset==='quote'?fee:0;
    if(!Number.isFinite(qty)||qty<=0||qty+1e-9<pair.ordermin||
      notional+1e-9<Math.max(pair.costmin,this.limits.minOrderEur)){
      this.reject('Minimum order or base fee consumes position');return;
    }
    const capacity=this.entryParticipationReason(action.pair,candle.ts,notional);
    if(capacity){this.reject(capacity);return;}
    const stop=pending.strategy==='hold'?null:quote.price*(1-action.stopLossPct);
    const target=pending.strategy==='hold'||!action.takeProfitPct?null:quote.price*(1+action.takeProfitPct);
    const finalRisk=this.finalRoundedBuyRisk(pending,candle.ts,quote.price,
      qty,notional,quoteFee,fee,stop);
    if(finalRisk){this.reject(finalRisk);return;}
    this.cash-=notional+quoteFee;
    const existing=this.researchV5?this.positions.get(action.pair):undefined;
    this.positions.set(action.pair,existing?{
      symbol:action.pair,qty:existing.qty+qty,basis:existing.basis+notional+quoteFee,
      entryPrice:(existing.entryPrice*existing.qty+quote.price*qty)/(existing.qty+qty),
      stop:existing.stop===null?stop:stop===null?existing.stop:Math.max(existing.stop,stop),
      target:null,openedAt:existing.openedAt
    }:{symbol:action.pair,qty,basis:notional+quoteFee,entryPrice:quote.price,stop,target,openedAt:candle.ts});
    this.trades.push({ts:candle.ts,decisionTs:pending.decisionTs,symbol:action.pair,side:'buy',qty,price:quote.price,
      ...charged,fee,feeAsset:this.feeAsset,grossQty,feeBaseQty,
      feeRounding:this.feeAsset==='base'?'round-up-base-8dp':charged.feeRounding,
      notional,realizedPnl:null,spreadCost:quote.spreadCost*grossQty,slippageCost:quote.slippageCost*grossQty,reason:'signal',
      ...(maker?{makerOrderId:maker.orderId}:{})});
  }
  private sell(symbol:string,qty:number,quote:FillQuote,ts:number,decisionTs:number,
    reason:string,liquidity:FeeLiquidity='taker',fallbackMakerRate?:number,makerOrderId?:string):void {
    const p=this.positions.get(symbol),lot=this.pairs.get(symbol);
    if(!p||!lot||qty<=0||qty>p.qty+1e-9)return;
    if(lot.stepSize)qty=floorLot(qty,{stepSize:lot.stepSize,minQty:String(lot.ordermin),minNotional:String(lot.costmin)});
    const notional=qty*quote.price,charged=this.chargedFee(symbol,ts,notional,
      liquidity,fallbackMakerRate),fee=charged.fee;
    if(qty+1e-9<lot.ordermin||notional+1e-9<Math.max(lot.costmin,this.limits.minOrderEur)){this.reject('Minimum exit order');return;}
    const basis=p.basis*(qty/p.qty),pnl=notional-fee-basis;
    this.cash+=notional-fee;
    this.trades.push({ts,decisionTs,symbol,side:'sell',qty,price:quote.price,...charged,feeAsset:'quote',notional,realizedPnl:pnl,spreadCost:quote.spreadCost*qty,slippageCost:quote.slippageCost*qty,reason,
      ...(makerOrderId?{makerOrderId}:{})});
    if(qty>=p.qty-1e-9)this.positions.delete(symbol);
    else this.positions.set(symbol,{...p,qty:p.qty-qty,basis:p.basis-basis});
  }
}
