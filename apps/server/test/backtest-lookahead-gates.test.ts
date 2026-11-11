import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {DecisionProvider} from '@paper/shared';
import {RuleBasedProvider,BuyAndHoldProvider} from '../src/strategy/providers.js';
import {FixtureCandleSource,type Candle,type CandleSource} from '../src/backtest/candle-source.js';
import {verifyNoLookahead,cutCandleSource,assertHistoricalUniverse} from '../src/backtest/lookahead.js';
import {assertLedgerInvariant} from '../src/backtest/ledger-invariant.js';
import {defaultRisk} from '../src/backtest/runner.js';
import {SimulatedBroker} from '../src/backtest/simulated-broker.js';
import {ConservativeOhlcModel} from '../src/backtest/fill-models.js';
import {PortfolioRiskEngine} from '../src/risk-engine/engine.js';

const MIN=60000,STEP=15*MIN,HOUR=60*MIN;
const candle=(ts:number,price:number):Candle=>({ts,open:price,high:price*1.01,low:price*.99,close:price*1.001,volume:100});
function fixture():FixtureCandleSource {
 return new FixtureCandleSource([
  {symbol:'BTC/EUR',intervalMinutes:15,candles:Array.from({length:310},(_,i)=>candle(i*STEP,100+i*.1))},
  {symbol:'BTC/EUR',intervalMinutes:60,candles:Array.from({length:77},(_,i)=>candle(i*HOUR,100+i*.4))}
 ]);
}
const constraints=new Map([['BTC/EUR',{symbol:'BTC/EUR',ordermin:.0001,costmin:10,lotDecimals:8}]]);
const settings=()=>({source:fixture(),strategy:'rules' as const,fromMs:0,toMs:310*STEP,intervalMinutes:15 as const,initialCash:1000,feeRate:.001,constraints});
const factories:Record<string,(source:CandleSource)=>DecisionProvider>={
 rules:()=>new RuleBasedProvider(),
 hold:()=>new BuyAndHoldProvider()
};

test('CI perturbation covers every executable strategy in the checked-in registry',async()=>{
 const registry=JSON.parse(readFileSync(new URL('../../../docs/strategies/registry.json',import.meta.url),'utf8')) as {
  strategies:Array<{id:string;benchmark:boolean;versions:unknown[]}>;
 };
 const checked:string[]=[];
 for(const strategy of registry.strategies){
  if(!strategy.versions.length){
   if(!strategy.benchmark)throw Error('Unversioned active strategy: '+strategy.id);
   continue; // DCA is a non-provider benchmark without a registered executable version.
  }
  const create=factories[strategy.id];
  if(!create)throw Error('Missing perturbation provider adapter for registered strategy '+strategy.id);
  await verifyNoLookahead({...settings(),strategy:strategy.id as 'rules'|'hold',providerFactory:create,
   cutoffs:[100*STEP,200*STEP,280*STEP]});
  checked.push(strategy.id);
 }
 expect(checked).toEqual(['rules','hold']);
});

test('future_close is caught by perturbation even if its CandleSource is valid',async()=>{
 const providerFactory=(source:CandleSource):DecisionProvider=>({
  decide:async ctx=>{
   const now=Date.parse(ctx.timeUTC);
   const future=await source.getCandles('BTC/EUR',15,now,now+STEP);
   return {marketView:'broken fixture',actions:future.length?
    [{type:'buy',pair:'BTC/EUR',amountEur:20,stopLossPct:.05,confidence:1,reasoning:'future_close'}]:
    [{type:'hold',confidence:1,reasoning:'no future candle'}]};
  }
 });
 await expect(verifyNoLookahead({...settings(),providerFactory,cutoffs:[100*STEP]}))
  .rejects.toThrow(/Look-ahead perturbation failed/);
 const clipped=cutCandleSource(fixture(),100*STEP);
 expect(await clipped.getCandles('BTC/EUR',15,100*STEP,101*STEP)).toEqual([]);
});

test('survivor_universe fixture is rejected by the historical membership contract',()=>{
 const historical=['BTCUSDT','OLDUSDT']; // OLD was delisted later; NEW was listed later.
 const survivorOnly=['BTCUSDT','NEWUSDT'];
 expect(()=>assertHistoricalUniverse(survivorOnly,historical)).toThrow(/Survivorship bias/);
 expect(()=>assertHistoricalUniverse(historical,historical)).not.toThrow();
});

test('free_fill and duplicate_fill fixtures violate independent ledger invariants',()=>{
 const broker=new SimulatedBroker(1000,constraints,new ConservativeOhlcModel(),
  {...defaultRisk,feeRate:.001},0);
 const order={type:'buy' as const,pair:'BTC/EUR',amountEur:100,stopLossPct:.05,
  confidence:1,reasoning:'cost and ledger fixture'};
 expect(broker.queue(order,0)).toBe(true);
 broker.onCandle('BTC/EUR',candle(0,100),15);
 expect(broker.trades).toHaveLength(1);
 expect(()=>assertLedgerInvariant(broker,.001)).not.toThrow();
 const trade=broker.trades[0]!;
 const snapshot=(trades:typeof broker.trades)=>({trades,positions:broker.positions,cash:broker.cash,startingCash:broker.startingCash});
 expect(()=>assertLedgerInvariant(snapshot([{...trade,fee:0}]),.001)).toThrow(/cost invariant/);
 expect(()=>assertLedgerInvariant(snapshot([trade,{...trade}]),.001)).toThrow(/duplicate fill/);
 expect(()=>assertLedgerInvariant({...snapshot(broker.trades),cash:broker.cash+10},.001))
  .toThrow(/reconciliation/);
});

test('stale_feed fixture blocks a new buy through the production risk safety gate',()=>{
 const asOf=Date.UTC(2024,0,1);
 const verdict=new PortfolioRiskEngine().evaluateBuy('BTCUSDT',100,{
  asOf,equity:1000,peakEquity:1000,cash:1000,positions:[],
  daily:{},btcHourly:[],feedConnected:true,feedLastAt:asOf-60000,reconnectsLastHour:0
 });
 expect(verdict.allowed).toBe(false);
 expect(verdict.reasons).toContain('Market feed stale, disconnected or reconnect storm');
});
