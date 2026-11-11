import {expect,test,vi} from 'vitest';
import {analyzeRegimeAttribution,REGIME_ATTRIBUTION_VERSION} from '../src/backtest/regime-attribution.js';
import type {RegimeProvider,RegimeState} from '../src/regime/types.js';
import type {RecordedDecision} from '../src/backtest/runner.js';
import type {SimulatedTrade} from '../src/backtest/simulated-broker.js';
import type {EquityPoint} from '../src/backtest/metrics.js';
import {reportHtml,type BacktestReport} from '../src/backtest/report.js';

const DAY=86_400_000,START=Date.UTC(2022,0,2);
const decision=(ts:number,symbol='BTCUSDT'):RecordedDecision=>({ts,symbol,actions:[]});
const trade=(side:'buy'|'sell',ts:number,decisionTs:number,fee:number,pnl:number|null):SimulatedTrade=>({
 side,ts,decisionTs,symbol:'BTCUSDT',qty:1,price:100,notional:100,fee,
 realizedPnl:pnl,spreadCost:0.1,slippageCost:0.1,reason:'fixture'
});
const point=(ts:number,exposed:boolean):EquityPoint=>({ts,equity:100,exposed});
const provider=(fn:(ts:number)=>RegimeState):RegimeProvider=>({getRegime:async ts=>fn(ts)});
const state=(ts:number,regime:'risk-on'|'risk-off'|'neutral',reasons:string[]=[]):RegimeState=>({
 asOf:ts,regime,score:regime==='risk-on'?0.8:regime==='risk-off'?0.2:0.5,
 components:{trend:0.5,volatility:0.5,breadth:0.5},reasons
});
const fixture=()=>({
 fromMs:START,toMs:START+4*DAY,
 decisions:[decision(START),decision(START+DAY,'ETHUSDT'),decision(START+2*DAY)],
 trades:[trade('buy',START,START,1,null),trade('sell',START+2*DAY,START+2*DAY,0.5,-7)],
 equity:[point(START,true),point(START+DAY,true),point(START+2*DAY,false)]
});
test('entry-time causal PnL attribution survives an exit after the regime changes',async()=>{
 const input=fixture();
 const snapshot=JSON.stringify(input);
 const result=await analyzeRegimeAttribution({...input,
  provider:provider(ts=>state(ts,ts<START+DAY?'risk-on':'risk-off'))});
 expect(result.version).toBe(REGIME_ATTRIBUTION_VERSION);
 expect(result.status).toBe('available');
 const up=result.rows.find(r=>r.regime==='risk-on')!;
 const down=result.rows.find(r=>r.regime==='risk-off')!;
 expect(up.decisions).toBe(1);
 expect(up.tradeFills).toBe(2);
 expect(up.closedTrades).toBe(1);
 expect(up.netRealizedPnl).toBe(-7);
 expect(up.fees).toBe(1.5);
 expect(down.decisions).toBe(2);
 expect(down.netRealizedPnl).toBe(0);
 expect(up.exposureFraction).toBe(1);
 expect(down.exposureFraction).toBe(0.5);
 expect(up.observedUtcDays).toBe(1);
 expect(down.observedUtcDays).toBe(2);
 expect(JSON.stringify(input)).toEqual(snapshot);
 expect(result.note).toContain('keine interpolierten Tage');
 const same=await analyzeRegimeAttribution({...input,
  provider:provider(ts=>state(ts,ts<START+DAY?'risk-on':'risk-off'))});
 expect(result).toEqual(same);
});
test('unknown and unavailable past regimes are not relabelled as neutral or risk-on',async()=>{
 const input=fixture();
 const result=await analyzeRegimeAttribution({...input,
  provider:provider(ts=>ts===START?state(ts,'neutral',['Daten unvollständig: keine BTC-Vorgeschichte']):state(ts,'risk-off'))});
 expect(result.status).toBe('available');
 expect(result.unknownRegimeDecisions).toBe(1);
 expect(result.rows.find(r=>r.regime==='unknown')?.netRealizedPnl).toBe(-7);
 expect(result.rows.find(r=>r.regime==='neutral')?.decisions).toBe(0);
});
test('future-dated provider responses, failures and absent buy provenance fail to unknown',async()=>{
 const input=fixture();
 const queried=vi.fn(async(ts:number)=>ts===START?state(ts+DAY,'risk-on'):Promise.reject(new Error('missing')));
 const result=await analyzeRegimeAttribution({...input,provider:{getRegime:queried}});
 expect(result.status).toBe('available');
 expect(result.unknownRegimeDecisions).toBe(3);
 expect(result.rows.find(r=>r.regime==='unknown')?.tradeFills).toBe(2);
 expect(result.rows.find(r=>r.regime==='unknown')?.fees).toBe(1.5);
 expect(queried).toHaveBeenCalledTimes(3);
});
test('strict development boundary rejects validation/holdout before calling provider',async()=>{
 const input=fixture();
 const getRegime=vi.fn(async(ts:number)=>state(ts,'risk-on'));
 const blocked=await analyzeRegimeAttribution({...input,
  fromMs:Date.UTC(2024,0,1),toMs:Date.UTC(2024,0,2),provider:{getRegime}});
 expect(blocked.status).toBe('insufficient_evidence');
 expect(blocked.rows).toEqual([]);
 expect(blocked.inputHash).toBeNull();
 expect(getRegime).not.toHaveBeenCalled();
});
test('inconsistent duplicates and overstated sales do not produce attribution',async()=>{
 const input=fixture();
 const p=provider(ts=>state(ts,'risk-on'));
 const duplicate=await analyzeRegimeAttribution({...input,decisions:[input.decisions[0]!,input.decisions[0]!],provider:p});
 expect(duplicate.status).toBe('insufficient_evidence');
 const overstated=await analyzeRegimeAttribution({...input,trades:[
  input.trades[0]!,{...input.trades[1]!,qty:2}
 ],provider:p});
 expect(overstated.status).toBe('insufficient_evidence');
 expect(overstated.rows).toEqual([]);
});
test('report HTML shows all regime groups and descriptive unknown without claiming returns',async()=>{
 const attribution=await analyzeRegimeAttribution({...fixture(),provider:provider(ts=>state(ts,'risk-off'))});
 const report={
  runId:'a'.repeat(16),backtest:{
   configuration:{strategy:'rules',fromMs:START,toMs:START+4*DAY,fillModel:'conservative-ohlc',
    spreadBps:10,slippageBps:8,feeRate:.001},
   metrics:{},coverage:null,equity:[],daily:[],limitations:[],
   historicalTradability:{unknownMarketDays:null,totalMarketDays:null,restrictedMarketDays:null,
    evidencedTradableMarketDays:null,unknownTrades:0,totalTrades:0,restrictedTrades:0,
    evidencedTradableTrades:0,evidenceSources:[]},
   fingerprints:{data:'b'.repeat(64),configuration:'c'.repeat(64),codeBuild:null}
  },benchmarks:[],bootstrap:null,stress:[],robustness:'insufficient_evidence',
  parity:{},regimeAttribution:attribution
 } as unknown as BacktestReport;
 const html=reportHtml(report);
 expect(html).toContain(REGIME_ATTRIBUTION_VERSION);
 expect(html).toContain('Regime-Attribution');
 expect(html).toContain('risk-on');
 expect(html).toContain('unknown');
 expect(html).toContain(attribution.inputHash!);
 expect(JSON.stringify(report)).toContain('regimeAttribution');
});
