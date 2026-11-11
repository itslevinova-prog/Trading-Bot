import {expect,test} from 'vitest';
import {measureMakerSelection,type MakerSelectionSignal} from '../src/recorder/maker-selection.js';
import {makerSelectionWindowFromReplay,type MakerSelectionWindow,type RecorderReplay} from '../src/recorder/reader.js';

const T=Date.UTC(2022,0,10);
const symbol='BTC/USDT';
const signal=(id:string,decisionAt=T+1000,limitPrice=100):MakerSelectionSignal=>({
  id,symbol,side:'buy',decisionAt,limitObservedAt:decisionAt-5,
  limitPrice,takerReferencePrice:101,takerObservedAt:decisionAt-5,
  qty:2,ttlMs:2000,makerFeeBps:1,takerFeeBps:10
});
const trade=(aggId:number,at:number,price:number,receivedAt:number|null=at)=>({
  aggId,ts:at,receivedAt,symbol,price,qty:2,isBuyerMaker:true
});
const complete=(trades:MakerSelectionWindow['trades']):MakerSelectionWindow=>({
  symbol,from:T,to:T+10_000,status:'complete',sourceStatus:'consistent',
  sourceFingerprint:'test-fixture',trades,gaps:[],missingMonths:[],anomalies:[]
});

test('later strictly-through public trade fills only a hypothetical maker, never a missed order',()=>{
  const signals=[signal('crossed'),signal('missed',T+1100,97)];
  const evidence=complete([trade(1,T+1600,99),trade(2,T+2100,98),trade(3,T+3500,96)]);
  const result=measureMakerSelection(signals,evidence,[1000],500);
  expect(result.status).toBe('ok');
  expect(result.rows[0]!.status).toBe('hypothetical_filled');
  expect(result.rows[0]!.hypotheticalFillTradeId).toBe(1);
  expect(result.rows[0]!.makerNetMarkoutBps).toBeCloseTo(-201,10);
  expect(result.rows[0]!.takerNetMarkoutBps).toBeLessThan(0);
  expect(result.rows[1]!.status).toBe('missed');
  expect(result.rows[1]!.makerNetMarkoutBps).toBeNull();
  expect(result.rows[1]!.takerNetMarkoutBps).not.toBeNull();
  expect(result.horizons[0]!.hypotheticalFills).toBe(1);
  expect(result.horizons[0]!.missed).toBe(1);
  expect(result.horizons[0]!.takerOnFilledMedianBps).toBeCloseTo(result.rows[0]!.takerNetMarkoutBps!,10);
  expect(result.horizons[0]!.pairedDeltaMedianBps).toBeCloseTo(result.rows[0]!.pairedMakerMinusTakerBps!,10);
  expect(result.note).toContain('not an actual queue fill');
});

test('trade touch, insufficient size and too-late reception cannot create a hypothetical fill',()=>{
  const evidence=complete([
    {...trade(1,T+1500,100),qty:2},
    {...trade(2,T+1700,99),qty:1},
    trade(3,T+1900,98,T+2500),
    trade(4,T+2100,98,T+2600)
  ]);
  const result=measureMakerSelection([signal('b')],evidence,[1000],1000);
  expect(result.status).toBe('ok');
  expect(result.rows[0]!.status).toBe('missed');
  expect(result.rows[0]!.hypotheticalFillTradeId).toBeNull();
});

test('no observed future mark or missing trades stays n/a even if a crossing was observed',()=>{
  const result=measureMakerSelection([signal('no-mark')],complete([trade(1,T+1600,99)]),[1000],100);
  expect(result.status).toBe('insufficient_evidence');
  expect(result.rows[0]!.status).toBe('unobservable');
  expect(result.horizons[0]!.makerMedianBps).toBeNull();
  expect(result.horizons[0]!.takerAllMedianBps).toBeNull();
  const empty=measureMakerSelection([signal('empty')],complete([]),[1000],500);
  expect(empty.status).toBe('insufficient_evidence');
  expect(empty.rows).toHaveLength(0);
});

test('recorder event gaps, missing months and old receipt-unknown rows cannot certify markouts',()=>{
  const base=complete([trade(1,T+1600,99),trade(2,T+2100,98)]);
  const gapped=measureMakerSelection([signal('a')],{
    ...base,status:'insufficient_evidence',sourceStatus:'incomplete',
    gaps:[{from:T+1500,to:T+1900,missingSlots:4,kind:'snapshot'}]
  },[1000],500);
  expect(gapped.status).toBe('insufficient_evidence');
  expect(gapped.rows).toHaveLength(0);
  expect(gapped.recorderGapCount).toBe(1);
  const old=makerSelectionWindowFromReplay({
    symbol,from:T,to:T+10_000,status:'incomplete',
    trades:[trade(1,T+1600,99,null)],gaps:[],missingSnapshotSlots:0,
    missingMonths:[],missingReceiptTimes:1,duplicateTradeIds:0,
    anomalies:[{kind:'receipt-unknown',at:null,detail:'legacy row'}],fingerprint:'legacy'
  } satisfies RecorderReplay);
  expect(old.status).toBe('insufficient_evidence');
  expect(measureMakerSelection([signal('a')],old,[1000],500).horizons[0]!.pairedDeltaMedianBps).toBeNull();
});

test('future book quote, invalid time horizon, and out-of-window mark fail closed',()=>{
  const evidence=complete([trade(1,T+1600,99),trade(2,T+2100,98)]);
  expect(measureMakerSelection([{...signal('a'),limitObservedAt:T+1200}],evidence,[1000],500).status)
    .toBe('insufficient_evidence');
  expect(measureMakerSelection([signal('a')],evidence,[10_000],500).status)
    .toBe('insufficient_evidence');
  expect(()=>measureMakerSelection([signal('a')],evidence,[0])).toThrow();
  expect(()=>measureMakerSelection([signal('a')],evidence,[1000,1000])).toThrow();
});

test('fixed receipt-order fixtures reproduce exactly without mutating the source replay',()=>{
  const evidence=complete([trade(1,T+1600,99),trade(2,T+2100,98)]);
  const before=JSON.stringify(evidence),signals=[signal('a')];
  expect(measureMakerSelection(signals,evidence,[1000],500))
    .toEqual(measureMakerSelection(signals,evidence,[1000],500));
  expect(JSON.stringify(evidence)).toBe(before);
});
