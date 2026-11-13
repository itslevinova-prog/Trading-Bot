import type {SimulatedBroker,SimulatedTrade} from './simulated-broker.js';

const near=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&
 Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b));
/** Independently reconstruct cash, inventory and fees from executions. */
export function assertLedgerInvariant(broker:Pick<SimulatedBroker,'trades'|'positions'|'cash'|'startingCash'>,feeRate:number):void {
 if(!Number.isFinite(feeRate)||feeRate<0)throw Error('Invalid fee rate for ledger audit');
 let cash=broker.startingCash;
 const inventory=new Map<string,{qty:number;basis:number}>();
 const fillIds=new Set<string>();
 for(const trade of broker.trades as readonly SimulatedTrade[]){
  // A same-bar signal exit and protective stop are two legitimate partial fills.
  // Keep exact duplicates blocked, but identify the execution rather than only its clock.
  const id=[trade.ts,trade.decisionTs,trade.symbol,trade.side,trade.reason,
   trade.qty,trade.price,trade.makerOrderId??''].join('|');
  if(fillIds.has(id))throw Error('Ledger duplicate fill: '+id);
  fillIds.add(id);
  if(!Number.isFinite(trade.qty)||trade.qty<=0||!Number.isFinite(trade.price)||trade.price<=0||
    !near(trade.notional,trade.qty*trade.price)||!near(trade.fee,trade.notional*feeRate)||
    !Number.isFinite(trade.spreadCost)||trade.spreadCost<0||
    !Number.isFinite(trade.slippageCost)||trade.slippageCost<0)
   throw Error('Ledger cost invariant failed (notional, fee or execution costs)');
  const old=inventory.get(trade.symbol);
  if(trade.side==='buy'){
   if(old)throw Error('Ledger duplicate buy before exit');
   inventory.set(trade.symbol,{qty:trade.qty,basis:trade.notional+trade.fee});
   cash-=trade.notional+trade.fee;
  }else{
   if(!old||trade.qty>old.qty+1e-7)throw Error('Ledger sale exceeds inventory');
   const basis=old.basis*(trade.qty/old.qty);
   if(!near(trade.realizedPnl??NaN,trade.notional-trade.fee-basis))
    throw Error('Ledger realized PnL invariant failed');
   cash+=trade.notional-trade.fee;
   if(near(trade.qty,old.qty))inventory.delete(trade.symbol);
   else inventory.set(trade.symbol,{qty:old.qty-trade.qty,basis:old.basis-basis});
  }
 }
 if(!near(cash,broker.cash)||inventory.size!==broker.positions.size)
  throw Error('Ledger cash/position reconciliation failed');
 for(const [symbol,holding] of inventory){
  const actual=broker.positions.get(symbol);
  if(!actual||!near(actual.qty,holding.qty)||!near(actual.basis,holding.basis))
   throw Error('Ledger inventory reconciliation failed: '+symbol);
 }
}
