import {test,expect} from 'vitest';
import {inspectPortfolioRisk,DEFAULT_RISK_LIMITS,type RiskSnapshot} from '../src/risk-engine/engine.js';
const DAY=86_400_000,HOUR=3_600_000,asOf=Date.UTC(2023,7,1);
function fixture():RiskSnapshot {
 const daily=Array.from({length:91},(_,i)=>({ts:asOf-DAY-(90-i)*DAY,
  close:100*Math.exp(i*.001+Math.sin(i*.2)*.02)}));
 const hourly=Array.from({length:750},(_,i)=>({ts:asOf-HOUR-(749-i)*HOUR,
  close:100*Math.exp(i*.0003+Math.sin(i*.18)*.0004)}));
 return {asOf,equity:10000,peakEquity:11000,cash:9500,
  positions:[{pair:'ETHUSDT',marketValue:500}],
  daily:{BTCUSDT:daily,ETHUSDT:daily.map(c=>({...c,close:c.close*.8}))},
  btcHourly:hourly,feedConnected:true,feedLastAt:asOf,reconnectsLastHour:0};
}
test('read-only diagnostic calculates exposure, risk and distance to circuit breakers',()=>{
 const state=fixture(),unchanged=structuredClone(state),risk=inspectPortfolioRisk(state);
 expect(risk.dataReady).toBe(true);
 expect(risk.investedPct).toBeCloseTo(.05);
 expect(risk.drawdown).toBeCloseTo(1-10000/11000);
 expect(risk.toCaution).toBe(0);
 expect(risk.toExitOnly).toBeCloseTo(.10-(1-10000/11000));
 expect(risk.toHardStop).toBeCloseTo(.15-(1-10000/11000));
 expect(risk.portfolioVol).toBeGreaterThan(0);
 expect(risk.btcBeta).toBeGreaterThan(0);
 expect(risk.clusterPct).toBeCloseTo(.05);
 expect(state).toEqual(unchanged);
});
test('no complete market or feed history produces no invented volatility/beta',()=>{
 const stale=fixture();stale.feedLastAt=asOf-40000;
 const noFeed=inspectPortfolioRisk(stale);
 expect(noFeed.dataReady).toBe(false);
 expect(noFeed.portfolioVol).toBeNull();
 expect(noFeed.btcBeta).toBeNull();
 const missing=fixture();missing.daily.ETHUSDT!.splice(85,1);
 expect(inspectPortfolioRisk(missing).dataReady).toBe(false);
 const broken=fixture();broken.positions[0]!.marketValue=NaN;
 expect(inspectPortfolioRisk(broken)).toMatchObject({dataReady:false,investedPct:null,drawdown:null});
});
test('empty positions are cash-only, not a buy authorization',()=>{
 const state=fixture();state.positions=[];state.cash=state.equity;
 const result=inspectPortfolioRisk(state,DEFAULT_RISK_LIMITS);
 expect(result).toMatchObject({dataReady:true,investedPct:0,portfolioVol:0,btcBeta:0,clusterPct:0});
});
