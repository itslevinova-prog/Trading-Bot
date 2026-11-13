import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {PortfolioRiskEngine,type RiskSnapshot} from '../src/risk-engine/engine.js';
import {ResearchDrawdownV3,H025_V3_DRAWDOWN} from '../src/risk-engine/research-drawdown-v3.js';
import {validateV2Inputs,V2_RESEARCH,V3_RESEARCH} from '../src/backtest/trend-research-v2.js';
import {v3Markdown} from '../src/backtest/trend-research-v3.js';
import {runBacktest} from '../src/backtest/runner.js';

const DAY=86_400_000,HOUR=3_600_000,at=Date.UTC(2023,0,1);
const limits={targetAnnualVol:.3,maxClusterPct:.4,maxPortfolioBeta:.8,
 maxPositionPct:.3,maxFeedAgeMs:30000,maxReconnectsLastHour:3,
 cautionDrawdown:.05,exitOnlyDrawdown:.10,hardStopDrawdown:.15};

function observed(v:ResearchDrawdownV3,day:number,equity:number,
 regime:'risk-on'|'neutral'|'risk-off'='risk-off',positions=0){
 return v.observe({asOf:at+day*DAY,equity,openPositions:positions,regime},limits);
}
function riskSnapshot(now:number,equity:number):RiskSnapshot{
 const daily=Array.from({length:91},(_,i)=>{
  const ts=now-(91-i)*DAY,price=100*Math.exp(i*.001+Math.sin(i*.2)*.02);
  return {ts,close:price};
 });
 const hourly=Array.from({length:750},(_,i)=>({
  ts:now-(750-i)*HOUR,
  close:100*Math.exp(i*.0003+Math.sin(i*.18)*.0004)
 }));
 return {asOf:now,equity,peakEquity:10000,cash:equity,positions:[],
  daily:{BTCUSDT:daily,ETHUSDT:daily.map(b=>({...b,close:b.close*.8}))},
  btcHourly:hourly,feedConnected:true,feedLastAt:now,reconnectsLastHour:0};
}
test('linear cap is exact between profile caution and exit-only; default engine stays at legacy half-size',()=>{
 const v3=new PortfolioRiskEngine({...limits},{researchV3InitialCash:10000});
 const s=riskSnapshot(at,9400);
 const day=v3.observeResearchV3Day({asOf:at,equity:9400,openPositions:0,regime:'neutral'});
 expect(day.status).toBe('caution');
 expect(day.entryScale).toBeCloseTo(.8,10);
 const proposed=100;
 const newVerdict=v3.evaluateBuy('ETHUSDT',proposed,s);
 const legacyVerdict=new PortfolioRiskEngine({...limits}).evaluateBuy('ETHUSDT',proposed,s);
 expect(newVerdict.approvedAmount).toBeCloseTo(80,6);
 expect(legacyVerdict.approvedAmount).toBeCloseTo(50,6);
 expect(newVerdict.status).toBe('caution');
 expect(legacyVerdict.status).toBe('caution');
 expect(new PortfolioRiskEngine().researchV3State).toBeNull();
 expect(()=>new PortfolioRiskEngine({...limits}).observeResearchV3Day({
  asOf:at,equity:9400,openPositions:0,regime:'risk-on'
 })).toThrow(/not enabled/);
});
test('30 FULL flat days, recoverable exit-only and actual risk-on are all required for one logged reset',()=>{
 const control=new ResearchDrawdownV3(10000);
 expect(observed(control,0,8900,'risk-on').status).toBe('exit-only');
 for(let n=1;n<30;n++)
  expect(observed(control,n,8900,n===29?'neutral':'risk-on').reset).toBeNull();
 const resetDay=observed(control,30,8900,'risk-on');
 expect(resetDay.status).toBe('ok');
 expect(resetDay.referencePeak).toBe(8900);
 expect(resetDay.drawdown).toBe(0);
 expect(resetDay.reset).toMatchObject({
  asOf:at+30*DAY,equity:8900,oldPeak:10000,newPeak:8900,
  reason:'30d-flat-and-risk-on-after-drawdown-stop'
 });
 expect(control.resets).toHaveLength(1);
 expect(observed(control,31,8900,'risk-on').reset).toBeNull();
});
test('open position cancels flat counter; hard-stop can only clear via gated v3 recovery',()=>{
 const control=new ResearchDrawdownV3(10000);
 expect(observed(control,0,8400).status).toBe('halted');
 for(let n=1;n<=29;n++)observed(control,n,8400,'risk-on');
 expect(observed(control,30,8400,'risk-on',1).status).toBe('halted');
 expect(observed(control,31,8400,'risk-on').flatDays).toBe(0);
 for(let n=32;n<61;n++)observed(control,n,8400,'risk-on');
 const recovered=observed(control,61,8400,'risk-on');
 expect(recovered.reset).not.toBeNull();
 expect(recovered.status).toBe('ok');
});
test('missing daily observations must not count as 30 uninterrupted flat days',()=>{
 const controller=new ResearchDrawdownV3(10000);
 observed(controller,0,8900,'risk-on');
 expect(()=>observed(controller,30,8900,'risk-on')).toThrow(/non-contiguous/);
 expect(controller.resets).toHaveLength(0);
});
test('loss 30 percent below ORIGINAL capital locks permanently, including later equity rebound',()=>{
 const control=new ResearchDrawdownV3(10000);
 expect(observed(control,0,7000,'risk-on').permanentStop).toBe(true);
 for(let n=1;n<=35;n++)observed(control,n,7000,'risk-on');
 const rebound=observed(control,36,9500,'risk-on');
 expect(rebound.status).toBe('halted');
 expect(rebound.permanentStop).toBe(true);
 expect(control.permanentStopAt).toBe(at);
 expect(control.resets).toHaveLength(0);
 const engine=new PortfolioRiskEngine({...limits},{researchV3InitialCash:10000});
 engine.observeResearchV3Day({asOf:at,equity:7000,openPositions:0,regime:'risk-on'});
 expect(engine.evaluateBuy('BTCUSDT',100,riskSnapshot(at,7000)).status).toBe('halted');
 expect(()=>engine.resetByOwner('I_ACKNOWLEDGE_MANUAL_RISK_RESET')).toThrow(/cannot reset/);
});
test('stale daily observation fails closed; invalid and future-day observations cannot be reused',()=>{
 const engine=new PortfolioRiskEngine({...limits},{researchV3InitialCash:10000});
 const s=riskSnapshot(at,9000);
 expect(engine.evaluateBuy('ETHUSDT',100,s).allowed).toBe(false);
 engine.observeResearchV3Day({asOf:at,equity:9000,openPositions:0,regime:'neutral'});
 expect(()=>engine.observeResearchV3Day({asOf:at,equity:9000,openPositions:0,regime:'risk-on'})).toThrow();
 expect(engine.evaluateBuy('ETHUSDT',100,riskSnapshot(at+DAY,9000)).allowed).toBe(false);
 expect(()=>new ResearchDrawdownV3(0)).toThrow();
});
test('research v3 remains disabled for non-trend backtests, unsealed ranges and missing diagnostics',async()=>{
 const source={listSymbols:async()=>['BTCUSDT'],getCandles:async()=>[]};
 await expect(runBacktest({source,strategy:'hold',fromMs:Date.UTC(2020,0,1),
  toMs:Date.UTC(2024,0,1),intervalMinutes:1440,enablePortfolioRisk:true,
  collectResearchDiagnostics:true,researchDrawdownV3:{regimeAt:()=> 'risk-on'}})).rejects.toThrow(/v3/);
 validateV2Inputs('2020-01','2023-12','1d,1h','');
 expect(()=>validateV2Inputs('2020-01','2024-01','1d,1h','')).toThrow();
 expect(V2_RESEARCH.version).toBe('H-025-research-binance-lots-v2');
 expect(V3_RESEARCH.version).toContain('-v3');
 expect(()=>v3Markdown([])).toThrow(/four|fixed order/);
});
test('v3 is preregistered with immutable values and manually dispatched behind privacy guard',()=>{
 const registration=JSON.parse(readFileSync('..'+'/..'+'/docs/research/hypotheses.json','utf8'));
 const h=registration.find((r:{id:string})=>r.id==='H-025');
 expect(h.variantsTested).toBe(21);
 expect(h.drawdownV3).toMatchObject({
  mode:'run_v3',historicalRunsCompleted:0,flatDays:30,
  rebalanceToleranceRelative:.2,absoluteLossFromInitial:.3,regimeRequired:'risk-on'
 });
 expect(H025_V3_DRAWDOWN).toMatchObject({
  flatDays:30,rebalanceTolerance:.2,absoluteLossFromInitial:.3
 });
 const workflow=readFileSync('..'+'/..'+'/.github/workflows/research-data.yml','utf8');
 expect(workflow).toMatch(/run_v3:/);
 expect(workflow).toMatch(/GITHUB_EVENT_NAME=issue_comment GITHUB_EVENT_PATH="\$PWD\/v3-comment-event.json"/);
 expect(workflow).toMatch(/gh issue comment 7/);
});
