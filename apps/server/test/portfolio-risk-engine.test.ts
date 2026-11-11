import {test,expect} from 'vitest';
import {PortfolioRiskEngine,bitcoinShock,assetRiskVectors,type RiskSnapshot} from '../src/risk-engine/engine.js';
const DAY=86_400_000,HOUR=3_600_000,asOf=Date.UTC(2023,7,1);
function fixture():RiskSnapshot{
 const lastDay=asOf-DAY,lastHour=asOf-HOUR;
 const daily=Array.from({length:91},(_,i)=>{
  const ts=lastDay-(90-i)*DAY,close=100*Math.exp(i*.001+Math.sin(i*.2)*.02);
  return {ts,close};
 });
 const hourly=Array.from({length:750},(_,i)=>({
  ts:lastHour-(749-i)*HOUR,close:100*Math.exp(i*.0003+Math.sin(i*.18)*.0004)
 }));
 return {asOf,equity:10000,peakEquity:10000,cash:10000,positions:[],
  daily:{BTCUSDT:daily,ETHUSDT:daily.map(p=>({...p,close:p.close*.8}))},
  btcHourly:hourly,feedConnected:true,feedLastAt:asOf,reconnectsLastHour:0};
}
test('safety gate sizes a conservative portfolio and never opens entries after data loss',()=>{
 const e=new PortfolioRiskEngine();
 const first=e.evaluateBuy('ETHUSDT',5000,fixture());
 expect(first.allowed).toBe(true);
 expect(first.approvedAmount).toBeGreaterThan(0);
 expect(first.approvedAmount).toBeLessThanOrEqual(3000);
 expect(first.portfolioVol).not.toBeNull();
 const stale=fixture();stale.feedLastAt=asOf-40000;
 expect(e.evaluateBuy('ETHUSDT',1000,stale).reasons.join()).toMatch(/stale/);
 const missing=fixture();missing.daily.ETHUSDT!.splice(85,1);
 expect(e.evaluateBuy('ETHUSDT',1000,missing).reasons.join()).toMatch(/Incomplete/);
 expect(e.evaluateExit().allowed).toBe(true);
});
test('risk decisions never read future daily or hourly closes',()=>{
 const source=fixture(),e=new PortfolioRiskEngine();
 const before=e.evaluateBuy('ETHUSDT',2000,source);
 const later=fixture();later.daily.BTCUSDT!.push({ts:asOf+DAY,close:1e9});
 later.daily.ETHUSDT!.push({ts:asOf+DAY,close:1e-5});
 later.btcHourly.push({ts:asOf+HOUR,close:1e9});
 const after=e.evaluateBuy('ETHUSDT',2000,later);
 expect(after).toEqual(before);
 expect(assetRiskVectors(later,['BTCUSDT','ETHUSDT'])).not.toBeNull();
});
test('drawdown caution halves size; exit-only and hard-stop require manual release',()=>{
 const e=new PortfolioRiskEngine();
 const normal=e.evaluateBuy('BTCUSDT',1000,fixture());
 const caution=fixture();caution.equity=9400;caution.cash=9400;caution.peakEquity=10000;
 const reduced=e.evaluateBuy('BTCUSDT',1000,caution);
 expect(reduced.status).toBe('caution');expect(reduced.approvedAmount).toBeLessThan(normal.approvedAmount);
 const stop=fixture();stop.equity=8800;stop.cash=8800;
 expect(e.evaluateBuy('BTCUSDT',1000,stop).status).toBe('exit-only');
 const hard=fixture();hard.equity=8400;hard.cash=8400;
 expect(e.evaluateBuy('BTCUSDT',1000,hard).status).toBe('halted');
 expect(e.evaluateBuy('BTCUSDT',1000,fixture()).status).toBe('halted');
 expect(()=>e.resetByOwner('no')).toThrow(/acknowledgement/);
 e.resetByOwner('I_ACKNOWLEDGE_MANUAL_RISK_RESET');
 expect(e.evaluateBuy('BTCUSDT',1000,fixture()).status).toBe('ok');
});
test('hourly P99 shock suspends new entries, without relaxing exit permissions',()=>{
 const s=fixture(),e=new PortfolioRiskEngine();
 expect(bitcoinShock(s)).toBe(false);
 s.btcHourly[s.btcHourly.length-1]!.close*=2;
 expect(bitcoinShock(s)).toBe(true);
 expect(e.evaluateBuy('BTCUSDT',300,s).allowed).toBe(false);
 expect(e.evaluateExit().allowed).toBe(true);
});
test('invalid or duplicate market inputs fail closed',()=>{
 const e=new PortfolioRiskEngine(),s=fixture();
 s.daily.BTCUSDT!.push({...s.daily.BTCUSDT!.at(-1)!});
 expect(e.evaluateBuy('BTCUSDT',100,s).allowed).toBe(false);
 expect(()=>new PortfolioRiskEngine({targetAnnualVol:0,maxClusterPct:.4,maxPortfolioBeta:.8,maxPositionPct:.3,
  maxFeedAgeMs:30000,maxReconnectsLastHour:3,cautionDrawdown:.05,exitOnlyDrawdown:.1,hardStopDrawdown:.15})).toThrow();
});
