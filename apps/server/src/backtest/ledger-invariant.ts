import type {SimulatedBroker,SimulatedTrade} from './simulated-broker.js';

const near=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&
 Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b));
/** Independently reconstruct cash, inventory and fees from executions. */
export function assertLedgerInvariant(broker:Pick<SimulatedBroker,'trades'|'positions'|'cash'|'startingCash'>,feeRate:number,options:{researchV5Adds?:true}={}):void {
 if(!Number.isFinite(feeRate)||feeRate<0)throw Error('Invalid fee rate for ledger audit');
 let cash=broker.startingCash;
 const inventory=new Map<string,{qty:number;basis:number}>();
 const fillIds=new Set<string>();
 for(const trade of broker.trades as readonly SimulatedTrade[]){
  // The broker fills one pending signal at the bar open, then may close its
  // remaining inventory via one protective stop/target inside that same bar.
  // Keep the original strict time/symbol/side identity for ordinary orders:
  // a second signal still fails even when its quantity or price differs.
  const id=[trade.ts,trade.decisionTs,trade.symbol,trade.side].join('|');
  const kind=trade.side==='sell'&&
   (trade.reason==='stop'||trade.reason==='target')?'protective':'signal';
  const key=id+'|'+kind;
  if(fillIds.has(key))throw Error('Ledger duplicate fill: '+id);
  fillIds.add(key);
  if(!Number.isFinite(trade.qty)||trade.qty<=0||!Number.isFinite(trade.price)||trade.price<=0||
    !near(trade.notional,trade.qty*trade.price)||!near(trade.fee,trade.notional*feeRate)||
    !Number.isFinite(trade.spreadCost)||trade.spreadCost<0||
    !Number.isFinite(trade.slippageCost)||trade.slippageCost<0)
   throw Error('Ledger cost invariant failed (notional, fee or execution costs)');
  const old=inventory.get(trade.symbol);
  if(trade.side==='buy'){
   if(old&&!options.researchV5Adds)throw Error('Ledger duplicate buy before exit');
   inventory.set(trade.symbol,{qty:(old?.qty??0)+trade.qty,
    basis:(old?.basis??0)+trade.notional+trade.fee});
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
