import type {SimulatedPosition,SimulatedTrade} from '../backtest/simulated-broker.js';

/** Read-only attribution of existing simulated fills. Neither spread nor
 * slippage fields establish real historical execution or observed impact. */
export type CostComponents = {
  feeQuoteEquivalent:number;
  modeledSpread:number;
  modeledSlippage:number;
};
export type MarketCostContribution = CostComponents & {
  symbol:string;
  realizedNetPnl:number;
  unrealizedNetPnl:number;
  netPnl:number;
  /** Counterfactual gross PnL = net plus modeled costs, NOT a second fill simulation. */
  modeledGrossPnl:number;
};
export type ExecutionCostContribution = CostComponents & {
  symbol:string;
  utcMonth:string;
  liquidity:'maker'|'taker'|'unknown';
  feeSource:'synthetic-assumption'|'public-assumption'|'unknown';
  fillCount:number;
  tradedQuoteNotional:number;
};
export type CostAttributionInput = {
  startingCash:number;
  cash:number;
  trades:readonly SimulatedTrade[];
  positions:ReadonlyMap<string,SimulatedPosition>;
  marks:ReadonlyMap<string,number>;
};
export type CostAttribution = {
  markets:MarketCostContribution[];
  executions:ExecutionCostContribution[];
  totals:Omit<MarketCostContribution,'symbol'>;
  cashEquityNetPnl:number;
  reconciled:true;
  provenance:'simulated-fill-fields-not-exchange-measurements';
  limitations:string[];
};

const near=(a:number,b:number)=>
  Number.isFinite(a)&&Number.isFinite(b)&&
  Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b));
const zero=():CostComponents=>({feeQuoteEquivalent:0,modeledSpread:0,modeledSlippage:0});
const newMarket=(symbol:string):MarketCostContribution=>({
  ...zero(),symbol,realizedNetPnl:0,unrealizedNetPnl:0,netPnl:0,modeledGrossPnl:0
});
const validNonnegative=(n:number)=>Number.isFinite(n)&&n>=0;

/**
 * Reconstruct a market-level cost waterfall and a separate execution
 * month/liquidity breakdown. Realized and open-position PnL are distinct:
 * capital already allocated to a partially sold position is never counted twice.
 * Throws rather than printing a misleading reconciliation when observations
 * or accounting disagree.
 */
export function attributeSimulatedCosts(input:CostAttributionInput):CostAttribution {
  if(!Number.isFinite(input.startingCash)||input.startingCash<=0||
    !validNonnegative(input.cash))throw Error('Invalid cost attribution cash');
  const markets=new Map<string,MarketCostContribution>();
  const executions=new Map<string,ExecutionCostContribution>();
  const getMarket=(symbol:string)=>{
    let market=markets.get(symbol);
    if(!market){market=newMarket(symbol);markets.set(symbol,market);}
    return market;
  };
  for(const trade of input.trades){
    if(!trade.symbol||!Number.isSafeInteger(trade.ts)||trade.ts<0||
      !Number.isFinite(trade.qty)||trade.qty<=0||
      !Number.isFinite(trade.price)||trade.price<=0||
      !validNonnegative(trade.notional)||!validNonnegative(trade.fee)||
      !validNonnegative(trade.spreadCost)||!validNonnegative(trade.slippageCost))
      throw Error('Invalid simulated fill for cost attribution');
    if(trade.feeAsset==='base'){
      if(trade.side!=='buy'||!Number.isFinite(trade.grossQty)||
        !validNonnegative(trade.feeBaseQty??NaN)||
        !near(trade.grossQty!,trade.qty+(trade.feeBaseQty??0))||
        !near(trade.notional,trade.grossQty!*trade.price)||
        !near(trade.fee,(trade.feeBaseQty??0)*trade.price))
        throw Error('Inconsistent base fee quote valuation');
    }else if(!near(trade.notional,trade.qty*trade.price))
      throw Error('Inconsistent quote fill notional');
    const market=getMarket(trade.symbol);
    market.feeQuoteEquivalent+=trade.fee;
    market.modeledSpread+=trade.spreadCost;
    market.modeledSlippage+=trade.slippageCost;
    if(trade.side==='sell'){
      if(!Number.isFinite(trade.realizedPnl))
        throw Error('Missing realized net PnL for simulated sale');
      market.realizedNetPnl+=trade.realizedPnl!;
    }else if(trade.realizedPnl!==null)throw Error('Buy cannot realize net PnL');

    const utcMonth=new Date(trade.ts).toISOString().slice(0,7);
    const liquidity=trade.feeLiquidity??'unknown';
    const feeSource=trade.feeSource??'unknown';
    const key=[trade.symbol,utcMonth,liquidity,feeSource].join('|');
    let execution=executions.get(key);
    if(!execution){
      execution={...zero(),symbol:trade.symbol,utcMonth,liquidity,
        feeSource,fillCount:0,tradedQuoteNotional:0};
      executions.set(key,execution);
    }
    execution.fillCount++;
    execution.tradedQuoteNotional+=trade.notional;
    execution.feeQuoteEquivalent+=trade.fee;
    execution.modeledSpread+=trade.spreadCost;
    execution.modeledSlippage+=trade.slippageCost;
  }
  let totalOpenMarketValue=0;
  for(const [symbol,position] of input.positions){
    const mark=input.marks.get(symbol);
    if(!mark||!Number.isFinite(mark)||mark<=0||
      !Number.isFinite(position.qty)||position.qty<=0||
      !validNonnegative(position.basis)||position.symbol!==symbol)
      throw Error('Missing or invalid open-position mark for cost attribution: '+symbol);
    const value=position.qty*mark;
    if(!Number.isFinite(value))throw Error('Invalid marked inventory value');
    totalOpenMarketValue+=value;
    getMarket(symbol).unrealizedNetPnl+=value-position.basis;
  }
  const totals:Omit<MarketCostContribution,'symbol'>={
    ...zero(),realizedNetPnl:0,unrealizedNetPnl:0,netPnl:0,modeledGrossPnl:0
  };
  for(const market of markets.values()){
    market.netPnl=market.realizedNetPnl+market.unrealizedNetPnl;
    market.modeledGrossPnl=market.netPnl+market.feeQuoteEquivalent+
      market.modeledSpread+market.modeledSlippage;
    totals.realizedNetPnl+=market.realizedNetPnl;
    totals.unrealizedNetPnl+=market.unrealizedNetPnl;
    totals.netPnl+=market.netPnl;
    totals.modeledGrossPnl+=market.modeledGrossPnl;
    totals.feeQuoteEquivalent+=market.feeQuoteEquivalent;
    totals.modeledSpread+=market.modeledSpread;
    totals.modeledSlippage+=market.modeledSlippage;
  }
  const cashEquityNetPnl=input.cash+totalOpenMarketValue-input.startingCash;
  if(!near(totals.netPnl,cashEquityNetPnl))
    throw Error('Cost attribution net PnL does not reconcile to cash and open inventory');
  return {
    markets:[...markets.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol)),
    executions:[...executions.values()].sort((a,b)=>
      a.symbol.localeCompare(b.symbol)||a.utcMonth.localeCompare(b.utcMonth)||
      a.liquidity.localeCompare(b.liquidity)||a.feeSource.localeCompare(b.feeSource)),
    totals,cashEquityNetPnl,reconciled:true,
    provenance:'simulated-fill-fields-not-exchange-measurements',
    limitations:[
      'Spread and slippage are modeled execution costs, never measured recorder fills.',
      'Monthly and liquidity breakdown attributes costs only; realized/unrealized PnL is market-level.',
      'Open positions use caller-provided marks without implying historical book depth.'
    ]
  };
}
