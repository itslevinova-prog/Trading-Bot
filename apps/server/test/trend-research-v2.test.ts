import {test,expect,vi} from 'vitest';
import {developmentSource,runTrendResearchV2,validateV2Inputs,v2Markdown,v2ProfilesMarkdown} from '../src/backtest/trend-research-v2.js';
import {TREND_RESEARCH_ASSUMPTIONS as a,DAY} from '../src/backtest/trend-research.js';
import {SimulatedBroker} from '../src/backtest/simulated-broker.js';
import {ConservativeOhlcModel} from '../src/backtest/fill-models.js';
import {defaultRisk} from '../src/backtest/runner.js';
import {floorLot} from '../src/forward/lots.js';
import {resolvePaperRiskProfile} from '../src/risk-engine/profiles.js';
import {DEFAULT_RISK_LIMITS} from '../src/risk-engine/engine.js';
import {diagnosticRiskStatus,analyzeDiagnosticTrace,diagnosticsMarkdown,emptyDiagnosticReasons,countDiagnosticReason,type DiagnosticTrace} from '../src/backtest/trend-diagnostics.js';

import type {CandleSource} from '../src/backtest/candle-source.js';

const rule={stepSize:'0.00500000',minQty:'0.00500000',minNotional:'5.00000000'};
test('optional exact step rounding applies to entry and exit; legacy decimal path remains unchanged',()=>{
 const make=(stepSize?:string)=>new SimulatedBroker(1000,new Map([['BTCUSDT',{symbol:'BTCUSDT',ordermin:.005,costmin:5,lotDecimals:3,...(stepSize?{stepSize}:{})}]]),new ConservativeOhlcModel({spreadBps:0,slippageBps:0}),{...defaultRisk,feeRate:0});
 const exact=make(rule.stepSize),legacy=make();
 for(const b of [exact,legacy]){
  expect(b.queue({type:'buy',pair:'BTCUSDT',amountEur:123.4,stopLossPct:.05,confidence:1,reasoning:'fixture'},0,'hold')).toBe(true);
  b.onCandle('BTCUSDT',{ts:0,open:100,close:100,high:100,low:100,volume:1e6},15);
 }
 expect(exact.trades[0]!.qty).toBe(1.23);expect(legacy.trades[0]!.qty).toBe(1.234);
 expect(exact.queue({type:'sell',pair:'BTCUSDT',sellFraction:.333,confidence:1,reasoning:'fixture'},900000,'hold')).toBe(true);
 exact.onCandle('BTCUSDT',{ts:900000,open:100,close:100,high:100,low:100,volume:1e6},15);
 expect(exact.trades[1]!.qty).toBe(.405);
});
test('fixed full-universe inputs and sealed source reject validation/holdout before reading',async()=>{
 validateV2Inputs('2020-01','2023-12','1d,1h','');
 for(const args of [['2024-01','2024-12','1d,1h',''],['2020-01','2023-12','1d',''],['2020-01','2023-12','1d,1h','BTCUSDT']])
  expect(()=>validateV2Inputs(...args as [string,string,string,string])).toThrow();
 const get=vi.fn(async()=>[]),source=developmentSource({listSymbols:async()=>[],getCandles:get});
 await expect(source.getCandles('BTCUSDT',1440,a.fromMs,Date.UTC(2025,0,1))).rejects.toThrow('sealed');
 expect(get).not.toHaveBeenCalled();
 await source.getCandles('BTCUSDT',1440,a.fromMs-DAY,a.fromMs+DAY);
 expect(get.mock.calls[0]).toEqual(['BTCUSDT',1440,a.fromMs,a.fromMs+DAY]);
 const leaking=developmentSource({listSymbols:async()=>[],getCandles:async()=>[{ts:a.toMs,open:1,high:1,low:1,close:1,volume:1}]});
 await expect(leaking.getCandles('BTCUSDT',1440,a.fromMs,a.toMs)).rejects.toThrow('Look-ahead');
});
test('complete development fixture retains delisted history without granting fabricated lots or accessing 2024',async()=>{
 const requests:{from:number;to:number}[]=[];
 const source:CandleSource={listSymbols:async()=>['BTCUSDT','ETHUSDT','DEADUSDT','NEWUSDT'],getCandles:async(symbol,minutes,from,to)=>{
  requests.push({from,to});if(from<a.fromMs||to>a.toMs)throw Error('SEALED');
  if(symbol==='NEWUSDT')return [];
  const end=symbol==='DEADUSDT'?Math.min(to,Date.UTC(2021,0,1)):to,step=minutes*60000;
  return Array.from({length:Math.max(0,Math.floor((end-from)/step))},(_,i)=>{
   const ts=from+i*step,p=50000+((ts-a.fromMs)/DAY)*20+Math.sin(ts/DAY)*100;
   return {ts,open:p,high:p+200,low:p-200,close:p+10,volume:1e6,quoteVolume:1e8};
  });
 }};
 const options={source,lotRules:{BTCUSDT:rule,ETHUSDT:rule},lotSnapshotAt:'2026-11-11T00:00:00Z',codeBuild:'fixture-build',
  universeAt:(day:number)=>day<Date.UTC(2021,0,1)?['BTCUSDT','ETHUSDT','DEADUSDT']:['BTCUSDT','ETHUSDT']};
 const report=await runTrendResearchV2(options);
 expect(report.importedCoins).toBe(3);expect(report.backtest.universe).toContain('DEADUSDT');
 expect(report.missingRules).toEqual(['DEADUSDT']);expect(report.backtest.trades.some(t=>t.symbol==='DEADUSDT')).toBe(false);
 expect(report.backtest.equity.length).toBeGreaterThan(1400);
 expect(report.backtest.trades.length).toBeGreaterThan(0);
 expect(requests.every(r=>r.from>=a.fromMs&&r.to<=a.toMs)).toBe(true);
 expect(report.pipelineEligible).toBe(false);expect(report.lotSnapshot.assumption).toContain('not-historical');
 expect(report.backtest.diagnostics?.days.length).toBeGreaterThan(1400);
 expect(report.backtest.diagnostics?.days.every(d=>d.day<'2024-01-01')).toBe(true);
 expect(v2Markdown(report)).toContain('Diagnose: Entscheidungs- und Ausführungsengpässe');
 for(const t of report.backtest.trades)expect(floorLot(t.qty,rule)).toBeCloseTo(t.qty,8);
 expect(v2Markdown(report)).toContain('Keine Pipeline-Freigabe');expect(v2Markdown(report)).toContain('DEADUSDT');
 const cautious=await runTrendResearchV2({...options,profileName:'vorsichtig'});
 expect(cautious.profile?.name).toBe('vorsichtig');
 expect(cautious.profile?.engineLimits.targetAnnualVol).toBe(cautious.profile?.effective.targetAnnualVol);
 expect(cautious.profile?.cappedFields).toEqual([]);
 expect(cautious.backtest.fingerprints.configuration).not.toBe(report.backtest.fingerprints.configuration);
 expect(requests.every(r=>r.from>=a.fromMs&&r.to<=a.toMs)).toBe(true);
},90000);

test('Actions preflight wires v2 to full-history validation before download and keeps artifacts/comments isolated',async()=>{
 const {readFileSync}=await import('node:fs');
 const {spawnSync}=await import('node:child_process');
 const workflow=readFileSync(new URL('../../../.github/workflows/research-data.yml',import.meta.url),'utf8');
 const preflight=workflow.split('      - name: Entwicklungsfenster vor jedem Download prüfen\n')[1]!.split('      - name:')[0]!;
 const script=preflight.split('        run: |\n')[1]!.split('\n').map(s=>s.replace(/^          /,'')).join('\n');
 const rejected=spawnSync('bash',['-e','-o','pipefail','-c',script],{cwd:new URL('../../../',import.meta.url),encoding:'utf8',env:{...process.env,
  LIVE_ENABLED:'false',AI_ALLOW_REMOTE:'false',RUN_TREND:'false',RUN_TREND_V2:'true',IMPORT_FROM:'2020-01',IMPORT_TO:'2023-12',IMPORT_INTERVALS:'1d,1h',IMPORT_SYMBOLS:'BTCUSDT'}});
 expect(rejected.status).not.toBe(0);expect(rejected.stderr).toContain('H-025 v2 requires fixed');
 const profileRejected=spawnSync('bash',['-e','-o','pipefail','-c',script],{cwd:new URL('../../../',import.meta.url),encoding:'utf8',env:{...process.env,
  LIVE_ENABLED:'false',AI_ALLOW_REMOTE:'false',RUN_TREND:'false',RUN_TREND_V2:'false',RUN_PROFILES:'true',IMPORT_FROM:'2024-01',IMPORT_TO:'2024-12',IMPORT_INTERVALS:'1d,1h',IMPORT_SYMBOLS:''}});
 expect(profileRejected.status).not.toBe(0);
 expect(preflight).toContain('RUN_TREND_V2: ${{ inputs.run_trend_v2 }}');
 expect(workflow).toContain('run_profiles:');
 expect(preflight).toContain('RUN_PROFILES: ${{ inputs.run_profiles }}');
 expect(preflight).toContain(`"$RUN_PROFILES" == 'true'`);
 const profiles=workflow.split('      - name: Forschungsergebnis aller Profile in Issue #7 kommentieren')[1]!.split('      - name: Forschungsergebnis v2')[0]!;
 expect(profiles).toContain('gh issue comment 7');
 expect(profiles).toContain('GITHUB_EVENT_PATH=');
 expect(profiles).not.toContain('PG_TEXT_BODY');
 expect(profiles.indexOf('node .github/privacy-guard/check.mjs')).toBeLessThan(profiles.indexOf('gh issue comment 7'));
 const post=workflow.split('      - name: Forschungsergebnis v2 in Issue #3 kommentieren')[1]!;
 expect(post).toContain('inputs.run_trend_v2 && success()');expect(post).toContain('data/trend-research-v2/summary.md');expect(post).toContain('gh issue comment 3');
 expect(post.indexOf('node .github/privacy-guard/check.mjs')).toBeLessThan(post.indexOf('gh issue comment 3'));
},30000);

test('three frozen profile mappings use capped targets without mutating source profiles',()=>{
 const names=['vorsichtig','normal','aggressiv'] as const;
 const resolved=names.map(name=>resolvePaperRiskProfile(name));
 expect(resolved.map(p=>p.name)).toEqual(names);
 for(const p of resolved){
  expect(p.engineLimits.targetAnnualVol).toBe(p.effective.targetAnnualVol);
  expect(p.engineLimits.maxPositionPct).toBe(p.effective.maxPositionPct);
  expect(p.effective.maxOpenPositions).toBeLessThanOrEqual(4);
  expect(p.effective.maxInvestedPct).toBeLessThanOrEqual(1);
  expect(p.requested.corePct).toBeGreaterThanOrEqual(0);
 }
 expect(resolved[1]!.cappedFields).toContain('maxOpenPositions');
 expect(resolved[2]!.cappedFields).toContain('maxPositionPct');
 expect(resolved[2]!.effective.targetAnnualVol).toBeLessThan(resolved[2]!.requested.targetAnnualVol);
});

test('profile comparison never manufactures benchmark fees, core or missing exposure',()=>{
 const p=['vorsichtig','normal','aggressiv'].map(name=>resolvePaperRiskProfile(name as 'vorsichtig'|'normal'|'aggressiv'));
 const metric={cagr:.1,maxDrawdown:.2,sharpe:.5,calmar:.5,tradeCount:10,costShare:null,exposureTime:.4};
 const fake=p.map(profile=>({profile,backtest:{metrics:metric},importedCoins:2,universeCoins:2,missingRules:[],
  benchmarks:[{name:'BTC Buy & Hold',netReturn:null},{name:'DCA 70/30',netReturn:null}]})) as unknown as Parameters<typeof v2ProfilesMarkdown>[0];
 const md=v2ProfilesMarkdown(fake);
 expect(md).toContain('| vorsichtig |');expect(md).toContain('| normal |');expect(md).toContain('| aggressiv |');
 expect(md).toContain('cappedFields =');expect(md).toContain('corePct');expect(md).toContain('n/a');
 expect(()=>v2ProfilesMarkdown(fake.slice(0,2))).toThrow();
});

test('daily risk threshold observations are read-only and distinguish actual hard-stop latch',()=>{
 const l=DEFAULT_RISK_LIMITS;
 expect(diagnosticRiskStatus(100,100,l,false)).toBe('ok');
 expect(diagnosticRiskStatus(94,100,l,false)).toBe('caution');
 expect(diagnosticRiskStatus(89.9,100,l,false)).toBe('exit-only');
 expect(diagnosticRiskStatus(84.9,100,l,false)).toBe('halted');
 expect(diagnosticRiskStatus(100,100,l,true)).toBe('halted');
 // Calling the pure observer cannot reset or latch a PortfolioRiskEngine.
 expect(l.exitOnlyDrawdown).toBe(.10);
});

test('rejection attribution and persistent cash lock use observed order rejections, not guesses',()=>{
 const reasons=emptyDiagnosticReasons();
 const blocked='Orderablehnung: Portfolio-RiskEngine: Portfolio drawdown >= exit-only threshold';
 countDiagnosticReason(reasons,'portfolioRisk',blocked);
 countDiagnosticReason(reasons,'portfolioRisk',blocked);
 countDiagnosticReason(reasons,'missingLot','Markt-Tag ohne Einstiegsfreigabe: Keine aktuelle Mengenregel');
 countDiagnosticReason(reasons,'planner','Tag ohne Kaufsignal: Kein täglicher Rebalancingbedarf');
 const row=(day:string,equity:number,cash:number,status:'ok'|'exit-only',buy:boolean,filled:boolean)=>({
  day,asOf:Date.parse(day+'T00:00:00Z')+86400000,equity,cash,investedPct:(equity-cash)/equity,
  allCash:cash===equity,riskStatus:status,riskLatched:false,plannerBuySignal:buy,executedBuy:filled
 });
 const trace:DiagnosticTrace={reasons,days:[
  row('2020-12-30',100,0,'ok',true,true),
  row('2020-12-31',89,89,'exit-only',true,false),
  row('2021-01-01',89,89,'exit-only',true,false),
  row('2021-01-02',89,89,'exit-only',true,false)
 ]};
 const a=analyzeDiagnosticTrace(trace,100);
 expect(a.lockFinding).toBe('bestätigt');
 expect(a.firstExitOnly).toBe('2020-12-31');
 expect(a.exitOnlyRejections).toBe(2);
 expect(a.cashLockedDays).toBe(3);
 expect(a.plannerBuyDays).toBe(4);expect(a.executedBuyDays).toBe(1);
 expect(a.years.map(y=>y.year)).toEqual([2020,2021]);
 expect(a.years[0]!.endEquity).toBe(89);
 expect(a.years[0]!.maxDrawdownPct).toBeCloseTo(.11);
 const markdown=diagnosticsMarkdown(trace,100).join('\n');
 expect(markdown).toContain('Befund: bestätigt');
 expect(markdown).toContain('2020-12-31');
 expect(markdown).toContain('kein Beleg für 188 profitable');
 // An exit-only threshold without a rejected buy does not establish causation.
 const inconclusive:DiagnosticTrace={...trace,reasons:{...reasons,portfolioRisk:{}}};
 expect(analyzeDiagnosticTrace(inconclusive,100).lockFinding).toBe('offen');
 // A later reopening contradicts the permanent-lock hypothesis.
 const reopened:DiagnosticTrace={...trace,days:[...trace.days,
  row('2021-01-03',100,0,'ok',true,true)]};
 expect(analyzeDiagnosticTrace(reopened,100).lockFinding).toBe('widerlegt');
 expect(()=>analyzeDiagnosticTrace({...trace,days:[...trace.days,row('2024-01-01',89,89,'exit-only',false,false)]},100))
  .toThrow('sealed development');
});

test('diagnostic Markdown separates non-order market-day counts from real rejections',()=>{
 const trace:DiagnosticTrace={days:[],reasons:emptyDiagnosticReasons()};
 countDiagnosticReason(trace.reasons,'missingLot','Markt-Tag ohne Einstiegsfreigabe: Mengenregel fehlt');
 countDiagnosticReason(trace.reasons,'coinQuality','Markt-Tag ohne Einstiegsfreigabe: Qualität unbekannt');
 const md=diagnosticsMarkdown(trace,100).join('\n');
 expect(md).toContain('Top 15');expect(md).toContain('Keine addierbare Gesamtzahl');
 expect(md).toContain('Befund: offen');
 expect(md).toContain('n/a');
});
