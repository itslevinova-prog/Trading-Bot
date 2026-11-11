import {expect,test} from 'vitest';
import {diagnoseTradeEvidence,EVIDENCE_DENSITY_VERSION,type EvidenceTrade} from '../src/backtest/evidence-density.js';
import {reportHtml,type BacktestReport} from '../src/backtest/report.js';

const FROM=Date.UTC(2022,0,3),HOUR=3_600_000,MIN=60_000;
const trade=(id:string,decision:number,start:number,end:number,regime:string|null='risk-on',net:number|null=5):EvidenceTrade=>({
 id,pair:'BTC/EUR',decisionAtMs:decision,openedAtMs:start,closedAtMs:end,
 regimeAtDecision:regime,realizedNetPnl:net
});
test('ten simultaneous correlated trades count as one event, never ten independent outcomes',()=>{
 const trades=Array.from({length:10},(_,i)=>({...trade('t'+i,FROM,FROM+HOUR,FROM+3*HOUR),pair:i%2?'ETH/EUR':'BTC/EUR'}));
 const result=diagnoseTradeEvidence(trades);
 expect(result.version).toBe(EVIDENCE_DENSITY_VERSION);
 expect(result.status).toBe('available');
 expect(result.totalTrades).toBe(10);
 expect(result.decisionDays).toBe(1);
 expect(result.eventClusters).toBe(1);
 expect(result.maxTradesPerCluster).toBe(10);
 expect(result.clusters[0]!.tradeIds).toHaveLength(10);
 expect(result.clusters[0]!.symbols).toEqual(['BTC/EUR','ETH/EUR']);
 expect(result.regimeCounts['risk-on']).toEqual({trades:10,clusters:1});
 expect(result.confidenceBand).toBeNull();
 expect(result.confidenceStatus).toBe('unavailable');
 expect(result.reason).toContain('Zu wenige Cluster');
});
test('an overlapping chain and same-decision trades collapse into one causal event across regimes',()=>{
 const ts=FROM+DAY_2;
 const trades=[
  trade('a',ts,ts+HOUR,ts+3*HOUR,'risk-on',1),
  trade('b',ts+HOUR,ts+2*HOUR,ts+4*HOUR,'risk-off',-1),
  trade('c',ts+2*HOUR,ts+3*HOUR+30*MIN,ts+5*HOUR,'neutral',2),
  trade('d',ts,ts+8*HOUR,ts+9*HOUR,null,2)
 ];
 const out=diagnoseTradeEvidence(trades);
 expect(out.status).toBe('available');
 expect(out.eventClusters).toBe(1);
 expect(out.clusters[0]!.regime).toBe('mixed');
 expect(out.regimeCounts['mixed']).toEqual({trades:4,clusters:1});
 expect(out.clusters[0]!.realizedNetPnl).toBe(4);
});
const DAY_2=2*24*HOUR;
test('ten non-overlapping clusters permit only a cluster-level descriptive confidence band',()=>{
 const trades=Array.from({length:12},(_,i)=>{
  const start=FROM+i*4*HOUR;
  return trade('ind-'+i,start,start+10*MIN,start+30*MIN,
   i%2?'risk-off':'risk-on',i%2?-3:5);
 });
 const a=diagnoseTradeEvidence(trades,{seed:19,paths:100});
 expect(a.status).toBe('available');
 expect(a.eventClusters).toBe(12);
 expect(a.decisionDays).toBe(2);
 expect(a.confidenceStatus).toBe('diagnostic_only');
 expect(a.confidenceBand).not.toBeNull();
 expect(a.confidenceBand!.p10).toBeLessThanOrEqual(a.confidenceBand!.p50);
 expect(a.confidenceBand!.p50).toBeLessThanOrEqual(a.confidenceBand!.p90);
 expect(a.reason).toContain('keine genaue Zahl');
 expect(a).toEqual(diagnoseTradeEvidence(trades,{seed:19,paths:100}));
});
test('missing or future timestamps and unfinished exits block independence claims',()=>{
 const valid=trade('good',FROM,FROM+HOUR,FROM+2*HOUR);
 for(const broken of [
  {...valid,id:'missing',decisionAtMs:null},
  {...valid,id:'open',closedAtMs:null},
  {...valid,id:'future',decisionAtMs:Date.UTC(2025,0,1),
   openedAtMs:Date.UTC(2025,0,1)+HOUR,closedAtMs:Date.UTC(2025,0,1)+2*HOUR},
  {...valid,id:'reverse',openedAtMs:FROM-MIN}
 ]) {
  const result=diagnoseTradeEvidence([valid,broken]);
  expect(result.status).toBe('unavailable');
  expect(result.eventClusters).toBeNull();
  expect(result.confidenceBand).toBeNull();
  expect(result.dataFingerprint).toBeNull();
 }
 expect(diagnoseTradeEvidence([valid,valid]).status).toBe('unavailable');
});
test('unknown regimes stay explicitly unknown and cannot silently invent realized PnL',()=>{
 const result=diagnoseTradeEvidence([
  trade('known',FROM,FROM+HOUR,FROM+2*HOUR,'risk-on',1),
  trade('unknown',FROM+3*HOUR,FROM+4*HOUR,FROM+5*HOUR,null,null)
 ]);
 expect(result.regimeCounts['risk-on']).toEqual({trades:1,clusters:1});
 expect(result.regimeCounts['unknown']).toEqual({trades:1,clusters:1});
 expect(result.clusters[1]!.realizedNetPnl).toBeNull();
 expect(result.confidenceBand).toBeNull();
});
test('report includes events, UTC days, regimes and transparent n/a confidence',()=>{
 const density=diagnoseTradeEvidence(Array.from({length:10},(_,i)=>trade('t'+i,FROM,FROM+HOUR,FROM+3*HOUR)));
 const report={
  runId:'a'.repeat(16),backtest:{
   configuration:{strategy:'rules',fromMs:FROM,toMs:FROM+3*HOUR,fillModel:'conservative-ohlc',
    spreadBps:10,slippageBps:8,feeRate:.001},
   metrics:{},coverage:null,equity:[],daily:[],limitations:[],
   historicalTradability:{unknownMarketDays:null,totalMarketDays:null,restrictedMarketDays:null,
    evidencedTradableMarketDays:null,unknownTrades:0,totalTrades:0,restrictedTrades:0,
    evidencedTradableTrades:0,evidenceSources:[]},
   fingerprints:{data:'b'.repeat(64),configuration:'c'.repeat(64),codeBuild:null}
  },benchmarks:[],bootstrap:null,stress:[],robustness:'insufficient_evidence',
  parity:{},evidenceDensity:density
 } as unknown as BacktestReport;
 const html=reportHtml(report);
 expect(html).toContain(EVIDENCE_DENSITY_VERSION);
 expect(html).toContain(density.dataFingerprint!);
 expect(html).toContain('Ereigniscluster');
 expect(html).toContain('UTC-Entscheidungstage');
 expect(html).toContain('risk-on');
 expect(html).toContain('n/a');
 expect(JSON.stringify(report)).toContain('evidenceDensity');
});
