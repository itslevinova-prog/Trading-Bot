import {test,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {checkV5DailyRisk,V5_DAILY_RISK} from '../src/backtest/research-v5-daily-risk.js';
import {runTrendResearchV5,V5_PROFILES,v5Markdown} from '../src/backtest/trend-research-v5.js';
import {V5_RESEARCH,V5_WARMUP_FROM,v5DevelopmentSource,validateV5Inputs,V2_RESEARCH,V3_RESEARCH,V4_RESEARCH} from '../src/backtest/trend-research-v2.js';
import {TREND_RESEARCH_ASSUMPTIONS as a,DAY} from '../src/backtest/trend-research.js';
import {planTrendVolTargetV1,type TrendMarket} from '../src/strategy/trend-vol-target-v1.js';
import {SimulatedBroker} from '../src/backtest/simulated-broker.js';
import {ConservativeOhlcModel} from '../src/backtest/fill-models.js';
import {assertLedgerInvariant} from '../src/backtest/ledger-invariant.js';
import {defaultRisk} from '../src/backtest/runner.js';
import {DEFAULT_RISK_LIMITS} from '../src/risk-engine/engine.js';
import {resolvePaperRiskProfile} from '../src/risk-engine/profiles.js';
import type {CandleSource,Candle} from '../src/backtest/candle-source.js';

const END=Date.UTC(2024,0,1),LOT={stepSize:'0.00500000',minQty:'0.00500000',minNotional:'5.00000000'};
const daily=(begin:number,count:number,base=100,slope=.09):Candle[]=>Array.from({length:count},(_,i)=>{
 const ts=begin+i*DAY,price=base+slope*i+Math.sin(i/8)*.9;
 return {ts,open:price-.05,high:price+1,low:price-1,
  close:price,volume:1_000_000,quoteVolume:50_000_000};
});
const trendMarket=(pair:string,rows:Candle[]):TrendMarket=>({
 pair,daily:rows,quality:'allowed',assumedRoundtripBps:40,
 lot:{minQty:.005,minNotional:5,decimals:3}
});
test('v5 profile ceilings, BTC regime, inverse daily volatility, and legacy 30% cap are isolated',()=>{
 const at=Date.UTC(2020,0,1);
 const btc=daily(at-260*DAY,260,100,.18),eth=daily(at-260*DAY,260,60,.11);
 const market=[trendMarket('BTCUSDT',btc),trendMarket('ETHUSDT',eth)];
 const base={asOf:at,quote:'USDT',equity:10_000,cash:10_000,markets:market,positions:[]};
 for(const [maxInvested,expected] of [[1,1],[.5,.5],[.8,.8]] as const){
  const plan=planTrendVolTargetV1({...base,researchV5:true,topK:2,maxPositionPct:1,
   maxInvestedPct:maxInvested,rebalanceTolerance:.2,targetAnnualVol:.20});
  expect(plan.status).toBe('ready');
  expect(plan.ranked).toHaveLength(2);
  expect(plan.ranked.reduce((sum,r)=>sum+r.weight,0)).toBeCloseTo(expected,4);
  expect(plan.ranked[0]!.weight*plan.ranked[0]!.annualVol).toBeCloseTo(
   plan.ranked[1]!.weight*plan.ranked[1]!.annualVol,7);
  expect(plan.actions.filter(x=>x.type==='buy')).toHaveLength(2);
 }
 const normal=planTrendVolTargetV1(base);
 expect(normal.ranked.every(r=>r.weight<=.30)).toBe(true);
 expect(planTrendVolTargetV1({...base,maxPositionPct:1}).status).toBe('blocked');
 expect(V2_RESEARCH.version).toContain('-v2');
 expect(V3_RESEARCH.version).toContain('-v3');
 expect(V4_RESEARCH.v4a.version).toContain('v4a');
 expect(DEFAULT_RISK_LIMITS).toMatchObject({
  cautionDrawdown:.05,exitOnlyDrawdown:.10,hardStopDrawdown:.15
 });
 expect(V5_PROFILES).toEqual([null,'vorsichtig','normal','aggressiv']);
 expect([null,'vorsichtig','normal','aggressiv'].map(name=>
  name===null?1:resolvePaperRiskProfile(name as 'vorsichtig'|'normal'|'aggressiv').effective.maxInvestedPct
 )).toEqual([1,.5,.8,1]);
 const riskOff=planTrendVolTargetV1({...base,researchV5:true,maxPositionPct:1,
  markets:[trendMarket('BTCUSDT',daily(at-260*DAY,260,200,-.18)),market[1]!]});
 expect(riskOff.actions.some(x=>x.type==='buy')).toBe(false);
});

test('daily risk uses 60 contiguous closed returns, not hourly data, and blocks gaps and P99 shocks',()=>{
 const at=Date.UTC(2020,6,1),series=daily(at-65*DAY,65,120,.08);
 const fine=checkV5DailyRisk(at,series,series);
 expect(fine.allowed).toBe(true);
 expect(fine.btcAnnualVol).toBeGreaterThan(0);
 expect(fine.assetAnnualVol).toBeGreaterThan(0);
 const gap=series.filter((_,i)=>i!==39);
 expect(checkV5DailyRisk(at,gap,series).reason).toBe('missing-daily-history');
 const shock=series.map((c,i)=>i===series.length-1?{
  ...c,close:c.close*1.8,open:c.open*1.8,high:c.high*1.8,low:c.low*1.8
 }:c);
 expect(checkV5DailyRisk(at,shock,series).reason).toBe('btc-daily-shock-p99');
 const future=[...series,{...series.at(-1)!,ts:at,close:1e8}];
 expect(checkV5DailyRisk(at,future,series)).toEqual(fine);
 expect(V5_DAILY_RISK.hourlyRequired).toBe(false);
});

test('research broker allows repeated lot-rounded buys without weakening normal ledger duplicate checks',()=>{
 const options={...defaultRisk,maxPositionPct:1,maxOpenPositions:2,maxPortfolioRiskPct:1,
  maxDrawdownPct:1,feeRate:0,cooldownMinutes:0};
 const at=a.fromMs,lot=new Map([['BTCUSDT',{symbol:'BTCUSDT',ordermin:.005,
  costmin:5,lotDecimals:3,stepSize:LOT.stepSize}]]);
 const mk=(v5:boolean)=>new SimulatedBroker(1000,lot,
  new ConservativeOhlcModel({spreadBps:0,slippageBps:0}),options,
  0,undefined,'quote',undefined,v5);
 const broker=mk(true),action=(amountEur:number)=>({
  type:'buy' as const,pair:'BTCUSDT',amountEur,stopLossPct:.05,confidence:1,reasoning:'fixture'
 });
 expect(broker.queue(action(300),at)).toBe(true);
 broker.onCandle('BTCUSDT',{ts:at,open:100,high:100,low:100,close:100,volume:1000},1440);
 expect(broker.positions.get('BTCUSDT')?.qty).toBe(3);
 expect(broker.queue(action(200),at+DAY)).toBe(true);
 broker.onCandle('BTCUSDT',{ts:at+DAY,open:100,high:100,low:100,close:100,volume:1000},1440);
 expect(broker.positions.get('BTCUSDT')?.qty).toBe(5);
 expect(broker.trades).toHaveLength(2);
 expect(()=>assertLedgerInvariant(broker,0)).toThrow('duplicate buy');
 expect(()=>assertLedgerInvariant(broker,0,{researchV5Adds:true})).not.toThrow();
 const control=mk(false);
 expect(control.queue(action(300),at)).toBe(true);
 control.onCandle('BTCUSDT',{ts:at,open:100,high:100,low:100,close:100,volume:1000},1440);
 expect(control.queue(action(200),at+DAY)).toBe(false);
});

test('peak-to-equity entry scaling is exactly linear and 30% initial loss is permanently latched',()=>{
 const broker=new SimulatedBroker(1000,new Map(),
  new ConservativeOhlcModel({spreadBps:0,slippageBps:0}),{
   ...defaultRisk,maxDrawdownPct:1},0,undefined,'quote',undefined,true);
 const at=a.fromMs;
 expect(broker.researchV5EntryScale(at)).toBe(1);
 broker.cash=900;
 expect(broker.researchV5EntryScale(at+DAY)).toBe(1);
 broker.cash=800;
 expect(broker.researchV5EntryScale(at+2*DAY)).toBeCloseTo(.5,9);
 broker.cash=700;
 expect(broker.researchV5EntryScale(at+3*DAY)).toBe(0);
 expect(broker.researchV5PausedAt).toBe(at+3*DAY);
 broker.cash=1100;
 expect(broker.researchV5EntryScale(at+4*DAY)).toBe(0);
 expect(broker.researchV5PausedAt).toBe(at+3*DAY);
 expect(()=>new SimulatedBroker(1000,new Map(),
  new ConservativeOhlcModel({spreadBps:0,slippageBps:0}),defaultRisk)
  .researchV5EntryScale(at)).toThrow(/not enabled/);
});

test('pre-download validation and 2019 indicator-only wrapper cannot access 2024, earlier data or hours',async()=>{
 validateV5Inputs('2019-01','2023-12','1d','BTCUSDT,ETHUSDT');
 for(const args of [
  ['2020-01','2023-12','1d','BTCUSDT,ETHUSDT'],
  ['2019-01','2024-01','1d','BTCUSDT,ETHUSDT'],
  ['2019-01','2023-12','1d,1h','BTCUSDT,ETHUSDT'],
  ['2019-01','2023-12','1d','']
 ])expect(()=>validateV5Inputs(...args as [string,string,string,string])).toThrow();
 const fetch=vi.fn(async()=>[] as Candle[]);
 const wrapped=v5DevelopmentSource({listSymbols:async()=>['BTCUSDT','ETHUSDT'],getCandles:fetch});
 await wrapped.getCandles('BTCUSDT',1440,V5_WARMUP_FROM,a.fromMs);
 expect(fetch).toHaveBeenCalledTimes(1);
 for(const [symbol,minutes,from,to] of [
  ['BTCUSDT',60,V5_WARMUP_FROM,a.fromMs],
  ['ALTUSDT',1440,V5_WARMUP_FROM,a.fromMs],
  ['BTCUSDT',1440,V5_WARMUP_FROM-DAY,a.fromMs],
  ['BTCUSDT',1440,V5_WARMUP_FROM,END+DAY]
 ] as const)
  await expect(wrapped.getCandles(symbol,minutes,from,to)).rejects.toThrow(/sealed/);
 expect(fetch).toHaveBeenCalledTimes(1);
});

test('four sealed v5 reports share daily-only 2019 warmup with no pre-2020 trades or metrics',async()=>{
 const requests:{symbol:string;minutes:number;from:number;to:number}[]=[];
 const source:CandleSource={listSymbols:async()=>['BTCUSDT','ETHUSDT','ALTUSDT'],
  getCandles:vi.fn(async(symbol,minutes,from,to)=>{
   requests.push({symbol,minutes,from,to});
   if(minutes!==1440||from<V5_WARMUP_FROM||to>END)throw Error('Unsafe daily request');
   const count=Math.round((to-from)/DAY),offset=(from-V5_WARMUP_FROM)/DAY;
   return Array.from({length:count},(_,i)=>{
    const n=offset+i,p=(symbol==='ETHUSDT'?75:110)+n*.12+Math.sin(n/8)*.7;
    return {ts:from+i*DAY,open:p-.03,high:p+.7,low:p-.7,
     close:p,volume:1e6,quoteVolume:1e8};
   });
  })};
 const options={source,lotRules:{BTCUSDT:LOT,ETHUSDT:LOT},
  lotSnapshotAt:'2026-11-13T00:00:00Z',codeBuild:'h025-v5-fixture',
  universeAt:(_day:number)=>['BTCUSDT','ETHUSDT']};
 const reports:Awaited<ReturnType<typeof runTrendResearchV5>>[]=[];
 for(const profileName of V5_PROFILES)
  reports.push(await runTrendResearchV5({...options,...(profileName?{profileName}:{})}));
 for(const r of reports){
  expect(r.assumptions.version).toBe(V5_RESEARCH.version);
  expect(r.paperApproved).toBe(false);
  expect(r.pipelineEligible).toBe(false);
  expect(r.researchVariant).toBe('v5');
  expect(r.backtest.universe).toEqual(['BTCUSDT','ETHUSDT']);
  expect(r.backtest.trades.every(t=>t.ts>=a.fromMs&&t.decisionTs>=a.fromMs&&t.ts<a.toMs)).toBe(true);
  expect(r.backtest.equity[0]?.ts).toBe(a.fromMs);
  expect(r.backtest.equity.at(-1)?.ts).toBe(a.toMs);
  expect(r.backtest.daily.every(p=>p.ts>=a.fromMs&&p.ts<=a.toMs)).toBe(true);
  expect(r.backtest.researchV5?.parameters.hourlyRequired).toBe(false);
  expect(r.backtest.researchV3).toBeUndefined();
  expect(r.backtest.diagnostics?.days.length).toBeGreaterThan(1400);
  expect(r.backtest.researchV5?.dailyRiskChecks).toBeGreaterThanOrEqual(0);
 }
 expect(requests.every(x=>x.minutes===1440&&x.from>=V5_WARMUP_FROM&&x.to<=END)).toBe(true);
 expect(requests.some(x=>x.from===V5_WARMUP_FROM)).toBe(true);
 expect(requests.every(x=>x.symbol!=='ALTUSDT')).toBe(true);
 const passive={name:'BTC/ETH 50/50 halten' as const,netReturn:.2,cagr:.05,maxDrawdown:.1,
  sharpe:.6,calmar:.5,trades:2,costs:12,reason:'Test fixture'};
 const spike={protocol:'trend-1d-spike-v1',range:{fromInclusive:'2020-01-01',toExclusive:'2024-01-01'},
  markets:['BTCUSDT','ETHUSDT'],windows:[50,100,200],
  variants:[50,100,200].map(window=>({window,cagr:.1,maxDrawdown:.2,sharpe:.3,calmar:.5,
   trades:8,exposure:.45,costsPctOfInitial:1.5}))};
 const md=v5Markdown(reports,passive,spike);
 expect(md).toContain('Basis');
 expect(md).toContain('vorsichtig');
 expect(md).toContain('aggressiv');
 expect(md).toContain('SMA200');
 expect(md).toContain('50/50 halten');
 expect(md).toContain('Ø investiert');
 expect(md).toContain('2019');
 expect(()=>v5Markdown(reports.slice(0,3),passive,spike)).toThrow(/four/);
},120000);

test('v5 remains manual-off, preregistered +4 with immutable split and privacy comment to #3',()=>{
 const registration=JSON.parse(readFileSync('../../docs/research/hypotheses.json','utf8'))
  .find((x:{id:string})=>x.id==='H-025');
 expect(registration.variantsTested).toBe(21);
 expect(registration.drawdownV5).toMatchObject({
  mode:'run_v5',variantsRegistered:4,historicalRunsCompleted:0,
  historicalRunStatus:'not-executed',noPaperOrForward:true
 });
 const split=JSON.parse(readFileSync('../../docs/data-splits-h025-v5.json','utf8'));
 expect(split.indicatorsOnlyWarmup.fromInclusive).toBe('2019-01-01');
 expect(split.indicatorsOnlyWarmup.toExclusive).toBe('2020-01-01');
 expect(split.developmentEvaluation.toExclusive).toBe('2024-01-01');
 expect(readFileSync('../../docs/data-splits-v1.json','utf8')).toContain('"immutable": true');
 const workflow=readFileSync('../../.github/workflows/research-data.yml','utf8');
 expect(workflow).toContain('run_v5:');
 expect(workflow).toMatch(/run_v5:[\\s\\S]*?default: false/);
 expect(workflow).toContain('RUN_V5: '+'$'+'{{ inputs.run_v5 }}');
 expect(workflow).toContain('"$RUN_V5" == '+ "'true'");
 expect(workflow).toContain('validateV5Inputs(process.env.IMPORT_FROM!');
 expect(workflow.indexOf('validateV5Inputs(process.env.IMPORT_FROM!')).toBeLessThan(
  workflow.indexOf('      - name: Öffentliche Binance-Kerzen importieren'));
 expect(workflow).toContain('src/backtest/trend-research-v5-cli.ts');
 expect(workflow).toContain('data/trend-research-v5/');
 const section=workflow.split('      - name: H-025 v5 – Datenschutzprüfung und Kommentar in Issue #3')[1]!;
 expect(section).toContain('GITHUB_EVENT_NAME=issue_comment GITHUB_EVENT_PATH="$PWD/v5-comment-event.json"');
 expect(section.indexOf('node .github/privacy-guard/check.mjs')).toBeLessThan(section.indexOf('gh issue comment 3'));
 expect(readFileSync('../../.github/workflows/paper-forward.yml','utf8')).not.toContain('run_v5');
});
