import {expect,test} from 'vitest';
import {
  correlationJumpStress,CORRELATION_STRESS_ASSUMPTION
} from '../src/risk-engine/correlation-stress.js';
import {DEFAULT_RISK_LIMITS,type RiskSnapshot,type RiskCandle} from '../src/risk-engine/engine.js';

const DAY=86_400_000;
const AS_OF=Date.UTC(2023,0,1);
const FIRST=AS_OF-61*DAY;
function series(change:(i:number)=>number):RiskCandle[] {
  let p=100;
  return Array.from({length:61},(_,i)=>{
    if(i>0)p*=Math.exp(change(i));
    return {ts:FIRST+i*DAY,close:p};
  });
}
function snapshot():RiskSnapshot {
  return {
    asOf:AS_OF,equity:1000,peakEquity:1100,cash:400,
    positions:[{pair:'BTCUSDT',marketValue:300},{pair:'ETHUSDT',marketValue:300}],
    daily:{
      BTCUSDT:series(i=>Math.sin(i*.31)*.025),
      ETHUSDT:series(i=>Math.cos(i*.43)*.02)
    },
    btcHourly:[],feedConnected:true,feedLastAt:AS_OF,reconnectsLastHour:0
  };
}
test('fixed positive correlation jump increases joint tail loss for formerly distinct returns',()=>{
  const s=snapshot(),before=JSON.stringify(s);
  const report=correlationJumpStress(s);
  expect(report.status).toBe('diagnostic');
  expect(report.observedDailyReturns).toBe(60);
  expect(report.assumedPairwiseCorrelationFloor).toBe(.95);
  expect(report.stressedTailLossPct!).toBeGreaterThan(report.baselineTailLossPct!);
  expect(report.stressedAnnualVol!).toBeGreaterThan(report.baselineAnnualVol!);
  expect(report.baselineClusterPct).toBeCloseTo(.3);
  expect(report.stressedClusterPct).toBeCloseTo(.6);
  expect(report.stressedFreeClusterBudgetPct).toBeLessThanOrEqual(report.baselineFreeClusterBudgetPct!);
  expect(report.stressedFreeTailBudgetPct).toBeLessThanOrEqual(report.baselineFreeTailBudgetPct!);
  expect(JSON.stringify(s)).toBe(before);
});
test('strong observed co-movement is not reduced by the stress floor',()=>{
  const s=snapshot();
  s.daily.ETHUSDT=s.daily.BTCUSDT!.map(x=>({...x,close:x.close*2}));
  const report=correlationJumpStress(s);
  expect(report.status).toBe('diagnostic');
  expect(report.stressedTailLossPct).toBeCloseTo(report.baselineTailLossPct!,10);
});
test.each(['missing-day','stale-day','wrong-account','unknown-valuation','constant-history','no-positions'] as const)(
  '%s cannot be labelled safe without auditable risk values',kind=>{
    const s=snapshot();
    if(kind==='missing-day')s.daily.ETHUSDT!.splice(20,1);
    if(kind==='stale-day')s.daily.ETHUSDT!.pop();
    if(kind==='wrong-account')s.cash=999;
    if(kind==='unknown-valuation')s.positions[0]!.marketValue=NaN;
    if(kind==='constant-history')s.daily.ETHUSDT=series(()=>0);
    if(kind==='no-positions')s.positions=[];
    const r=correlationJumpStress(s);
    expect(r.status).toBe('insufficient_evidence');
    expect(r.stressedTailLossPct).toBeNull();
    expect(r.stressedFreeTailBudgetPct).toBeNull();
    expect(r.stressedClusterPct).toBeNull();
  }
);
test('an unseen future bar cannot change completed daily risk estimates',()=>{
  const s=snapshot(),before=correlationJumpStress(s);
  s.daily.ETHUSDT!.push({ts:AS_OF,close:1e20});
  expect(correlationJumpStress(s)).toEqual(before);
});
test('assumptions are frozen and scenario never overrides actual order risk limits',()=>{
  const r=correlationJumpStress(snapshot(),{...DEFAULT_RISK_LIMITS,maxClusterPct:.4});
  expect(CORRELATION_STRESS_ASSUMPTION.version).toBe('correlation-jump-stress-v1');
  expect(CORRELATION_STRESS_ASSUMPTION.tailSigma).toBe(2.33);
  expect(r.note).toContain('or permission for a new order');
  expect(r.stressedFreeClusterBudgetPct).toBe(0);
  expect(r.baselineFreeClusterBudgetPct).toBeGreaterThan(0);
  expect(correlationJumpStress(snapshot())).toEqual(correlationJumpStress(snapshot()));
});
