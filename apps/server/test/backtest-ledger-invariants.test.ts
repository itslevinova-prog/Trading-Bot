import {expect,test} from 'vitest';
import {ConservativeOhlcModel} from '../src/backtest/fill-models.js';
import {SimulatedBroker,type SimulatedTrade,type MarketConstraints} from '../src/backtest/simulated-broker.js';
import {assertLedgerInvariant} from '../src/backtest/ledger-invariant.js';
import {defaultRisk} from '../src/backtest/runner.js';

const T0=Date.UTC(2022,0,1);
const feeRate=.001;
const mkRandom=(seed:number)=>{
 let state=seed>>>0;
 return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
};
const near=(a:number,b:number)=>Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b));
const pairs=['BTC/EUR','ETH/EUR'] as const;

/** This reference model is independent of the broker's position and cash helpers. */
function reference(trades:readonly SimulatedTrade[],startingCash:number){
 let cash=startingCash;
 const inventory=new Map<string,{qty:number;basis:number}>();
 let realised=0,fees=0;
 for(const fill of trades){
  if(!Number.isFinite(fill.qty)||fill.qty<=0||!Number.isFinite(fill.price)||fill.price<=0)
   throw Error('Invalid fill quantity/price');
  if(!near(fill.notional,fill.price*fill.qty)||!near(fill.fee,fill.notional*feeRate))
   throw Error('Fill notional or fee differs from independent multiplication');
  const old=inventory.get(fill.symbol);
  fees+=fill.fee;
  if(fill.side==='buy'){
   if(old)throw Error('Duplicate buy into open position');
   inventory.set(fill.symbol,{qty:fill.qty,basis:fill.notional+fill.fee});
   cash-=fill.notional+fill.fee;
  }else{
   if(!old||fill.qty>old.qty+1e-8)throw Error('Sell exceeds existing inventory');
   const fraction=fill.qty/old.qty;
   const basis=old.basis*fraction;
   const pnl=fill.notional-fill.fee-basis;
   if(!near(fill.realizedPnl??NaN,pnl))throw Error('Realized pnl differs from basis allocation');
   realised+=pnl;cash+=fill.notional-fill.fee;
   if(near(old.qty,fill.qty))inventory.delete(fill.symbol);
   else inventory.set(fill.symbol,{qty:old.qty-fill.qty,basis:old.basis-basis});
  }
 }
 return {cash,inventory,realised,fees};
}
function checkBroker(b:SimulatedBroker,lotDecimals:ReadonlyMap<string,number>,seed:number,step:number){
 const context='seed='+seed+' step='+step;
 expect(()=>assertLedgerInvariant(b,feeRate),context).not.toThrow();
 const expected=reference(b.trades,b.startingCash);
 expect(near(b.cash,expected.cash),context+' cash').toBe(true);
 expect(b.cash,context+' nonnegative cash').toBeGreaterThanOrEqual(-1e-8);
 expect(b.positions.size,context+' positions').toBe(expected.inventory.size);
 for(const [symbol,held] of expected.inventory){
  const actual=b.positions.get(symbol);
  expect(actual,context+' missing '+symbol).toBeDefined();
  expect(near(actual!.qty,held.qty),context+' qty '+symbol).toBe(true);
  expect(near(actual!.basis,held.basis),context+' basis '+symbol).toBe(true);
 }
 for(const fill of b.trades){
  const decimals=lotDecimals.get(fill.symbol)!;
  const scale=10**decimals;
  expect(Math.abs(fill.qty*scale-Math.round(fill.qty*scale)),
   context+' rounded lot '+fill.symbol).toBeLessThan(1e-7);
 }
 const realizedTrades=b.trades.filter(x=>x.side==='sell');
 expect(near(realizedTrades.reduce((s,x)=>s+x.realizedPnl!,0),expected.realised),
  context+' realised pnl').toBe(true);
 expect(near(b.trades.reduce((s,x)=>s+x.fee,0),expected.fees),
  context+' fee sum').toBe(true);
}

test('seeded multi-market buys, partial sells, fees and lot sizes preserve cash/inventory after every step',()=>{
 for(let seed=1;seed<=12;seed++){
  const random=mkRandom(seed);
  const constraints=new Map<string,MarketConstraints>();
  const decimals=new Map<string,number>();
  for(const symbol of pairs){
   const digits=2+Math.floor(random()*3);
   decimals.set(symbol,digits);
   constraints.set(symbol,{symbol,ordermin:1/10**digits,costmin:10,lotDecimals:digits});
  }
  const broker=new SimulatedBroker(2000,constraints,
   new ConservativeOhlcModel({spreadBps:0,slippageBps:0}),
   {...defaultRisk,feeRate,minOrderEur:10});
  for(let step=0;step<48;step++){
   const symbol=pairs[Math.floor(random()*pairs.length)]!;
   const price=8+Math.floor(random()*3000)/100;
   const ts=T0+step*3_600_000;
   const held=broker.positions.get(symbol);
   if(held){
    // Include both fractional sales and full liquidation. Dust stays recorded.
    const fraction=random()<.3?1:Math.max(.2,Math.ceil(random()*8)/10);
    broker.queue({type:'sell',pair:symbol,sellFraction:fraction,
      confidence:1,reasoning:'seeded paper-only property fixture'},ts,'hold');
   }else{
    broker.queue({type:'buy',pair:symbol,amountEur:40+Math.floor(random()*250),
      stopLossPct:.05,confidence:1,reasoning:'seeded paper-only property fixture'},ts,'hold');
   }
   broker.onCandle(symbol,{ts,open:price,high:price,low:price,close:price,volume:10000},60);
   checkBroker(broker,decimals,seed,step);
  }
 }
});

test('independent ledger rejects a deliberately broken lot rounding adapter',()=>{
 const decimals=new Map<string,number>([['BTC/EUR',2]]);
 const constraints=new Map<string,MarketConstraints>([['BTC/EUR',{
  symbol:'BTC/EUR',ordermin:.01,costmin:10,lotDecimals:2
 }]]);
 const b=new SimulatedBroker(1000,constraints,new ConservativeOhlcModel({spreadBps:0,slippageBps:0}),
  {...defaultRisk,feeRate});
 b.queue({type:'buy',pair:'BTC/EUR',amountEur:150,stopLossPct:.05,
  confidence:1,reasoning:'deliberate mutation fixture'},T0,'hold');
 b.onCandle('BTC/EUR',{ts:T0,open:17,high:17,low:17,close:17,volume:100},60);
 checkBroker(b,decimals,77,0);
 const brokenFill={...b.trades[0]!,qty:b.trades[0]!.qty+.01};
 const withBrokenRounding={
  startingCash:b.startingCash,cash:b.cash,positions:b.positions,trades:[brokenFill]
 };
 expect(()=>assertLedgerInvariant(withBrokenRounding,feeRate))
  .toThrow('Ledger cost invariant failed');
 const brokenCash={...withBrokenRounding,trades:b.trades,cash:b.cash+1};
 expect(()=>assertLedgerInvariant(brokenCash,feeRate))
  .toThrow('Ledger cash/position reconciliation failed');
});
