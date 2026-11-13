import {test,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runTrendResearchV4,v4Markdown,V4_ORDER,V4_PROFILES} from '../src/backtest/trend-research-v4.js';
import {V2_RESEARCH,V3_RESEARCH,V4_RESEARCH,V4_DRAWDOWN_THRESHOLDS,validateV2Inputs} from '../src/backtest/trend-research-v2.js';
import {TREND_RESEARCH_ASSUMPTIONS as a,DAY} from '../src/backtest/trend-research.js';
import {DEFAULT_RISK_LIMITS,PortfolioRiskEngine} from '../src/risk-engine/engine.js';
import {resolvePaperRiskProfile} from '../src/risk-engine/profiles.js';
import type {CandleSource} from '../src/backtest/candle-source.js';

const rule={stepSize:'0.00500000',minQty:'0.00500000',minNotional:'5.00000000'};
test('v4 thresholds are opt-in; unchanged Paper caps and v2/v3 assumptions',()=>{
 expect(V4_DRAWDOWN_THRESHOLDS).toEqual({
  cautionDrawdown:.97,exitOnlyDrawdown:.98,hardStopDrawdown:.99
 });
 expect(DEFAULT_RISK_LIMITS).toMatchObject({
  cautionDrawdown:.05,exitOnlyDrawdown:.10,hardStopDrawdown:.15
 });
 for(const name of ['vorsichtig','normal','aggressiv'] as const){
  const profile=resolvePaperRiskProfile(name);
  expect(profile.engineLimits.hardStopDrawdown).toBe(.15);
  expect(profile.engineLimits.cautionDrawdown).toBeLessThan(.97);
 }
 expect(new PortfolioRiskEngine({...DEFAULT_RISK_LIMITS,...V4_DRAWDOWN_THRESHOLDS}).limits)
  .toMatchObject(V4_DRAWDOWN_THRESHOLDS);
 expect(V2_RESEARCH.version).toContain('-v2');
 expect(V3_RESEARCH.version).toContain('-v3');
 expect(V4_RESEARCH.v4a.diagnosticOnly).toBe(true);
 expect(V4_RESEARCH.v4b.universe).toContain('BTCUSDT');
 expect(V4_ORDER).toEqual(['v4a','v4b']);
 expect(V4_PROFILES).toEqual([null,'vorsichtig','normal','aggressiv']);
 validateV2Inputs('2020-01','2023-12','1d,1h','');
 expect(()=>validateV2Inputs('2020-01','2024-01','1d,1h','')).toThrow();
});
test('v4a keeps historical full PIT universe; v4b intersects BTC/ETH each day; neither reads 2024',async()=>{
 const calls:{symbol:string;from:number;to:number}[]=[];
 const source:CandleSource={listSymbols:async()=>['BTCUSDT','ETHUSDT','ALTUSDT'],
  getCandles:vi.fn(async(symbol,minutes,from,to)=>{
   calls.push({symbol,from,to});
   if(from<a.fromMs||to>a.toMs)throw Error('Outside sealed development');
   const count=Math.max(0,Math.floor((to-from)/(minutes*60000)));
   return Array.from({length:count},(_,i)=>{
    const ts=from+i*minutes*60000,price=100+((ts-a.fromMs)/DAY)*.025+Math.sin(ts/DAY)*1.5;
    return {ts,open:price,high:price+2,low:price-2,
     close:price+.1,volume:1e6,quoteVolume:2e7};
   });
  })};
 const base={source,lotRules:{BTCUSDT:rule,ETHUSDT:rule},
  lotSnapshotAt:'2026-11-13T00:00:00Z',codeBuild:'v4-fixture',
  universeAt:(day:number)=>day<Date.UTC(2022,0,1)?
   ['BTCUSDT','ETHUSDT','ALTUSDT']:['BTCUSDT','ETHUSDT']};
 const full=await runTrendResearchV4({...base,variant:'v4a'});
 expect(full.backtest.universe).toContain('ALTUSDT');
 expect(full.missingRules).toContain('ALTUSDT');
 expect(full.assumptions).toEqual(V4_RESEARCH.v4a);
 expect(full.backtest.researchV3).toBeUndefined();
 const limited=await runTrendResearchV4({...base,variant:'v4b',profileName:'normal'});
 expect(limited.backtest.universe).toEqual(['BTCUSDT','ETHUSDT']);
 expect(limited.backtest.universeHistory.every(x=>x.symbols.every(
  s=>s==='BTCUSDT'||s==='ETHUSDT'))).toBe(true);
 expect(limited.missingRules).toEqual([]);
 expect(limited.assumptions).toEqual(V4_RESEARCH.v4b);
 expect(limited.profile?.name).toBe('normal');
 expect(limited.profile?.engineLimits.hardStopDrawdown).toBe(.15);
 expect(limited.backtest.researchV3).toBeUndefined();
 expect(limited.paperApproved).toBe(false);
 expect(limited.pipelineEligible).toBe(false);
 expect(full.backtest.fingerprints.configuration).not.toBe(limited.backtest.fingerprints.configuration);
 expect(calls.every(x=>x.from>=a.fromMs&&x.to<=a.toMs)).toBe(true);
 expect(()=>v4Markdown([],{} as never)).toThrow(/eight/);
 const reports=V4_ORDER.flatMap(variant=>V4_PROFILES.map(profileName=>{
  const original=variant==='v4a'?full:limited;
  return {...original,diagnosticVariant:variant,
   profile:profileName?resolvePaperRiskProfile(profileName):null};
 }));
 const spike={protocol:'trend-1d-spike-v1',
  range:{fromInclusive:'2020-01-01',toExclusive:'2024-01-01'},
  markets:['BTCUSDT','ETHUSDT'],windows:[50,100,200],
  variants:[50,100,200].map(window=>({window,cagr:.1,maxDrawdown:.2,sharpe:.3,calmar:.5,
   trades:8,exposure:.45,costsPctOfInitial:1.5}))};
 const markdown=v4Markdown(reports,spike);
 expect(markdown).toContain('v4a / Basis');
 expect(markdown).toContain('v4b / aggressiv');
 expect(markdown).toContain('SMA200 (Issue #18');
 expect(markdown).toContain('Portfolio-RiskEngine');
 expect(markdown).toContain('Keine Parametersuche');
 expect(()=>v4Markdown(reports,{...spike,windows:[100,200,400]})).toThrow(/SMA200/);
},90000);
test('the manual v4 workflow gates date range, comments on #3 through privacy event and does not touch forward',()=>{
 const h=JSON.parse(readFileSync('../../docs/research/hypotheses.json','utf8'))
  .find((x:{id:string})=>x.id==='H-025');
 expect(h.variantsTested).toBe(17);
 expect(h.drawdownV4).toMatchObject({
  mode:'run_v4',variantsRegistered:8,historicalRunsCompleted:0,
  noPaperOrForward:true,drawdownThresholds:V4_DRAWDOWN_THRESHOLDS
 });
 const workflow=readFileSync('../../.github/workflows/research-data.yml','utf8');
 expect(workflow).toContain('run_v4:');
 expect(workflow).toContain('RUN_V4: '+'$'+'{{ inputs.run_v4 }}');
 expect(workflow).toContain('"$RUN_V4" == '+"'true'");
 expect(workflow).toContain('pnpm trend:spike');
 expect(workflow).toContain('src/backtest/trend-research-v2-cli.ts --v4');
 expect(workflow).toContain('if: '+'$'+'{{ inputs.run_v4 || (inputs.run_spike && !inputs.run_v3) }}');
 const section=workflow.split('      - name: H-025 v4 – Datenschutzprüfung und Kommentar in Issue #3')[1]!;
 expect(section).toContain('GITHUB_EVENT_NAME=issue_comment GITHUB_EVENT_PATH="$PWD/v4-comment-event.json"');
 expect(section.indexOf('node .github/privacy-guard/check.mjs'))
  .toBeLessThan(section.indexOf('gh issue comment 3'));
 expect(readFileSync('../../.github/workflows/paper-forward.yml','utf8')).not.toContain('run_v4');
});
