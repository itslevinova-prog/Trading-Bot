import {expect,test} from 'vitest';
import {
 diagnoseIntrabarUncertainty,INTRABAR_UNCERTAINTY_VERSION,
 type IntrabarPositionBar
} from '../src/backtest/intrabar-uncertainty.js';
import {ConservativeOhlcModel} from '../src/backtest/fill-models.js';
import {reportHtml,type BacktestReport} from '../src/backtest/report.js';

const FROM=Date.UTC(2022,0,5),MIN=60_000;
const base=(ts=FROM):IntrabarPositionBar=>({
 pair:'BTC/EUR',intervalMinutes:15,
 candle:{ts,open:100,high:115,low:85,close:100,volume:100},
 positionOpenedAtMs:FROM-15*MIN,qty:2,entryBasisPerUnit:100,
 stopPrice:90,targetPrice:110,exitFeeRate:.001
});
const settings=(expectedPositionBars:number)=>({
 expectedPositionBars,spreadBps:10,slippageBps:8
});
test('double-trigger fixture has distinct lower/upper net-PnL scenarios and original stop-first fill',()=>{
 const item=base(),model=new ConservativeOhlcModel({spreadBps:10,slippageBps:8});
 const original=JSON.stringify(item);
 const conservative=model.exit(item.candle,item.stopPrice,item.targetPrice);
 expect(conservative?.reason).toBe('stop');
 const diagnostic=diagnoseIntrabarUncertainty([item],settings(1));
 expect(diagnostic.version).toBe(INTRABAR_UNCERTAINTY_VERSION);
 expect(diagnostic.status).toBe('available');
 expect(diagnostic.doubleTriggerBars).toBe(1);
 expect(diagnostic.openResolvedBars).toBe(0);
 expect(diagnostic.ambiguousBars).toBe(1);
 const row=diagnostic.rows[0]!;
 expect(row.observedAtMs).toBe(FROM+15*MIN);
 expect(row.conservativeExitPrice).toBe(conservative!.quote.price);
 expect(row.targetFirstExitPrice).toBeGreaterThan(row.conservativeExitPrice);
 expect(row.conservativeNetPnl).toBeCloseTo(
  2*conservative!.quote.price*(1-item.exitFeeRate)-200,10);
 expect(row.targetFirstNetPnl).toBeGreaterThan(row.conservativeNetPnl);
 expect(row.deltaNetPnl).toBeCloseTo(row.targetFirstNetPnl-row.conservativeNetPnl,10);
 expect(diagnostic.resultBand?.conservativeNetPnl).toBeCloseTo(row.conservativeNetPnl,10);
 expect(diagnostic.resultBand?.targetFirstNetPnl).toBeCloseTo(row.targetFirstNetPnl,10);
 expect(JSON.stringify(item)).toBe(original);
 expect(model.exit(item.candle,item.stopPrice,item.targetPrice)).toEqual(conservative);
 expect(diagnostic.note).toMatch(/Szenarien/);
 expect(diagnostic).toEqual(diagnoseIntrabarUncertainty([item],settings(1)));
});
test('all position candles are counted; open-gap-first is not falsely ambiguous',()=>{
 const first=base(),second=base(FROM+15*MIN);
 second.candle={...second.candle,open:85,low:80,high:115,close:92};
 const third=base(FROM+30*MIN);
 third.candle={...third.candle,open:100,high:105,low:86,close:97};
 const result=diagnoseIntrabarUncertainty([first,second,third],settings(3));
 expect(result.status).toBe('available');
 expect(result.observedPositionBars).toBe(3);
 expect(result.doubleTriggerBars).toBe(2);
 expect(result.openResolvedBars).toBe(1);
 expect(result.ambiguousBars).toBe(1);
 expect(result.rows).toHaveLength(1);
});
test('full coverage with no dual touch is a zero-case diagnosis, not invented portfolio return',()=>{
 const x=base();x.candle={...x.candle,high:105,low:95};
 const result=diagnoseIntrabarUncertainty([x],settings(1));
 expect(result.status).toBe('available');
 expect(result.doubleTriggerBars).toBe(0);
 expect(result.resultBand).toBeNull();
 expect(result.reason).toContain('Keine ungeklärten');
});
test('missing candles, duplicate rows and unknown position provenance fail closed',()=>{
 const first=base(),again=base();
 expect(diagnoseIntrabarUncertainty([first],settings(2)).status).toBe('insufficient_evidence');
 const duplicate=diagnoseIntrabarUncertainty([first,again],settings(2));
 expect(duplicate.status).toBe('insufficient_evidence');
 expect(duplicate.resultBand).toBeNull();
 expect(duplicate.inputHash).toBeNull();
 const unknown=diagnoseIntrabarUncertainty([{...first,positionOpenedAtMs:Number.NaN}],settings(1));
 expect(unknown.status).toBe('insufficient_evidence');
 expect(unknown.ambiguousBars).toBeNull();
 const invalidCost=diagnoseIntrabarUncertainty([first],{...settings(1),spreadBps:-1});
 expect(invalidCost.status).toBe('insufficient_evidence');
});
test('2024+ validation and 2025+ holdout OHLC cannot be diagnosed',()=>{
 for(const time of [Date.UTC(2024,0,1),Date.UTC(2025,0,1)]){
  const item=base(time);
  item.positionOpenedAtMs=time-15*MIN;
  const result=diagnoseIntrabarUncertainty([item],settings(1));
  expect(result.status).toBe('insufficient_evidence');
  expect(result.rows).toEqual([]);
  expect(result.resultBand).toBeNull();
  expect(result.inputHash).toBeNull();
 }
});
test('HTML/JSON clearly label unrealized order sequence as scenarios, not a fill improvement',()=>{
 const result=diagnoseIntrabarUncertainty([base()],settings(1));
 const report={
  runId:'a'.repeat(16),backtest:{
   configuration:{strategy:'rules',fromMs:FROM,toMs:FROM+15*MIN,fillModel:'conservative-ohlc',
    spreadBps:10,slippageBps:8,feeRate:.001},
   metrics:{},coverage:null,equity:[],daily:[],limitations:[],
   historicalTradability:{unknownMarketDays:null,totalMarketDays:null,restrictedMarketDays:null,
    evidencedTradableMarketDays:null,unknownTrades:0,totalTrades:0,restrictedTrades:0,
    evidencedTradableTrades:0,evidenceSources:[]},
   fingerprints:{data:'b'.repeat(64),configuration:'c'.repeat(64),codeBuild:null}
  },benchmarks:[],bootstrap:null,stress:[],robustness:'insufficient_evidence',
  parity:{},intrabarUncertainty:result
 } as unknown as BacktestReport;
 const html=reportHtml(report);
 expect(html).toContain(INTRABAR_UNCERTAINTY_VERSION);
 expect(html).toContain(result.inputHash!);
 expect(html).toContain('OHLC-Ergebnisband (nur Szenario)');
 expect(html).toContain('Ziel-zuerst');
 expect(html).toContain('Basis-Stop-Fill unverändert');
 expect(JSON.stringify(report)).toContain('intrabarUncertainty');
 const without=reportHtml({...report,intrabarUncertainty:undefined});
 expect(without).toContain('n/a – keine beobachtete');
});
