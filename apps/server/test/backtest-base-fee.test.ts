import {expect,test} from 'vitest';
import {SimulatedBroker} from '../src/backtest/simulated-broker.js';
import {ConservativeOhlcModel} from '../src/backtest/fill-models.js';
import {FeeSchedule} from '../src/backtest/fee-schedule.js';
import {defaultRisk} from '../src/backtest/runner.js';

const pairs=new Map([['BTC/EUR',{symbol:'BTC/EUR',ordermin:0.0001,costmin:10,lotDecimals:4}]]);
const candle=(ts:number,price:number)=>({
  ts,open:price,high:price,low:price,close:price,volume:1000
});
const buy={type:'buy' as const,pair:'BTC/EUR',amountEur:200,stopLossPct:.05,
  confidence:1,reasoning:'offline base-fee fixture'};
const sell={type:'sell' as const,pair:'BTC/EUR',sellFraction:0.5,
  confidence:1,reasoning:'offline partial exit'};
const make=(asset:'base'|'quote'='base',schedule?:FeeSchedule)=>new SimulatedBroker(
  1000,pairs,new ConservativeOhlcModel({spreadBps:0,slippageBps:0}),
  {...defaultRisk,feeRate:.001},0,schedule,asset
);

test('base buy fee debits delivered inventory, not quote cash; partial sale allocates actual basis',()=>{
  const b=make();
  expect(b.queue(buy,0,'hold')).toBe(true);
  b.onCandle('BTC/EUR',candle(0,100),15);
  const entry=b.trades[0]!,p=b.positions.get('BTC/EUR')!;
  expect(entry.feeAsset).toBe('base');
  expect(entry.feeBaseQty).toBeCloseTo(.002,10);
  expect(entry.grossQty).toBeCloseTo(2,10);
  expect(entry.qty).toBeCloseTo(1.998,10);
  expect(entry.fee).toBeCloseTo(.2,10); // Quote equivalent at fill, not a quote cash debit.
  expect(entry.feeRounding).toBe('round-up-base-8dp');
  expect(entry.notional).toBeCloseTo(200,10);
  expect(p.qty).toBeCloseTo(1.998,10);
  expect(p.basis).toBeCloseTo(200,10);
  expect(b.cash).toBeCloseTo(800,10);
  expect(b.equity).toBeCloseTo(999.8,10);
  expect(b.queue(sell,900000,'hold')).toBe(true);
  b.onCandle('BTC/EUR',candle(900000,110),15);
  const exit=b.trades[1]!,remaining=b.positions.get('BTC/EUR')!;
  expect(exit.feeAsset).toBe('quote');
  expect(exit.qty).toBeCloseTo(.999,10);
  expect(exit.fee).toBeCloseTo(109.89*.001,10);
  expect(exit.realizedPnl).toBeCloseTo(109.89-109.89*.001-100,8);
  expect(remaining.qty).toBeCloseTo(.999,10);
  expect(remaining.basis).toBeCloseTo(100,10);
  expect(b.cash).toBeCloseTo(800+109.89-109.89*.001,8);
  expect(b.equity).toBeCloseTo(b.cash+remaining.qty*110,8);
});

test('stops can close the NET base-fee quantity, not the pre-fee gross fill',()=>{
  const b=make();
  expect(b.queue(buy,0,'hold')).toBe(true);
  b.onCandle('BTC/EUR',candle(0,100),15);
  const p=b.positions.get('BTC/EUR')!;
  b.positions.set('BTC/EUR',{...p,stop:95});
  b.onCandle('BTC/EUR',{ts:900000,open:90,high:90,low:90,close:90,volume:1000},15);
  expect(b.positions.size).toBe(0);
  expect(b.trades[1]?.reason).toBe('stop');
  expect(b.trades[1]?.qty).toBeCloseTo(1.998,10);
  expect(b.trades[1]?.realizedPnl).toBeCloseTo(1.998*90*(1-.001)-200,8);
});

test('quote default remains unchanged, while versioned base fee uses fill-time tariff and base rounding',()=>{
  const legacy=make('quote');
  legacy.queue(buy,0,'hold');
  legacy.onCandle('BTC/EUR',candle(0,100),15);
  expect(legacy.trades[0]?.feeAsset).toBe('quote');
  expect(legacy.trades[0]?.grossQty).toBe(legacy.trades[0]?.qty);
  expect(legacy.positions.get('BTC/EUR')?.basis).toBeCloseTo(
    legacy.trades[0]!.notional+legacy.trades[0]!.fee,10);

  const schedule=new FeeSchedule([
    {id:'fixture-v1',quote:'EUR',fromMs:0,untilMs:1000,
      makerRate:.0002,takerRate:.001,source:'synthetic-assumption'},
    {id:'fixture-v2',quote:'EUR',fromMs:1000,untilMs:2000000,
      makerRate:.0003,takerRate:.0015,source:'synthetic-assumption'}
  ]);
  const b=make('base',schedule);
  b.queue(buy,900000,'hold');
  b.onCandle('BTC/EUR',candle(900000,100),15);
  const t=b.trades[0]!;
  expect(t.feeTariffId).toBe('fixture-v2');
  expect(t.feeRateApplied).toBe(.0015);
  expect(t.feeBaseQty).toBe(.003);
  expect(t.fee).toBeCloseTo(.3,10);
  expect(b.positions.get('BTC/EUR')?.qty).toBeCloseTo(1.997,10);
});

test('unknown fee asset and missing fee period never create an invented fill',()=>{
  expect(()=>make('third-token' as 'base')).toThrow(/Unknown fee asset/);
  const schedule=new FeeSchedule([{
    id:'not-yet-active',quote:'EUR',fromMs:1000,untilMs:2000,
    makerRate:.0002,takerRate:.001,source:'synthetic-assumption'
  }]);
  const b=make('base',schedule);
  b.queue(buy,0,'hold');
  expect(()=>b.onCandle('BTC/EUR',candle(0,100),15))
    .toThrow(/Unknown fee assumption/);
  expect(b.cash).toBe(1000);
  expect(b.trades).toHaveLength(0);
});
