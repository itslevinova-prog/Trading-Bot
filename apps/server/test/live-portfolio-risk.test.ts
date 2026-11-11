import {expect,test} from 'vitest';
import {PortfolioRiskEngine} from '../src/risk-engine/engine.js';
import {evaluateNativePortfolioRisk} from '../src/live/native-portfolio-risk.js';
import {fixtureNativePortfolioEvidence} from './native-policy-fixture.js';

const now=Date.UTC(2023,6,1,12);
const account={
 equity:1000,cash:1000,snapshotCompletedAt:now-1000,
 positions:[] as {pair:string;value:number;priceAsOf:number}[]
};
const evidence=()=>fixtureNativePortfolioEvidence(['BTC/EUR','ETH/EUR'],now);

test('native offline risk approval uses the same volatility/beta/cluster engine and sizes buys down',()=>{
 const engine=new PortfolioRiskEngine();
 const yes=evaluateNativePortfolioRisk(engine,account,1000,'ETH/EUR',600,now,evidence());
 expect(yes.allowed).toBe(true);
 expect(yes.approvedAmount).toBeGreaterThan(0);
 expect(yes.approvedAmount).toBeLessThanOrEqual(300);
 expect(yes.portfolioVol).not.toBeNull();
 expect(yes.portfolioBeta).not.toBeNull();
});

test('missing or stale history and account snapshots fail closed, not a success fallback',()=>{
 const engine=new PortfolioRiskEngine();
 expect(evaluateNativePortfolioRisk(engine,account,1000,'ETH/EUR',50,now,null))
  .toMatchObject({allowed:false,approvedAmount:0,status:'exit-only'});
 const bad=evidence();bad.daily['ETH/EUR']!.splice(30,1);
 expect(evaluateNativePortfolioRisk(engine,account,1000,'ETH/EUR',50,now,bad).allowed).toBe(false);
 const stale=evidence();stale.feedLastAt=now-40_000;
 expect(evaluateNativePortfolioRisk(engine,account,1000,'ETH/EUR',50,now,stale).allowed).toBe(false);
 const future=evidence();future.asOf=now+1;
 expect(evaluateNativePortfolioRisk(engine,account,1000,'ETH/EUR',50,now,future).allowed).toBe(false);
 const old={...account,snapshotCompletedAt:now-15_001};
 expect(evaluateNativePortfolioRisk(engine,old,1000,'ETH/EUR',50,now,evidence()).allowed).toBe(false);
});

test('native risk is based on fresh native account marks, not unverified historical cash',()=>{
 const engine=new PortfolioRiskEngine();
 const mismatched={...account,equity:NaN};
 expect(evaluateNativePortfolioRisk(engine,mismatched,1000,'ETH/EUR',50,now,evidence()).allowed)
  .toBe(false);
 const held={...account,cash:900,positions:[{pair:'BTC/EUR',value:100,priceAsOf:now-1000}]};
 const withExposure=evaluateNativePortfolioRisk(new PortfolioRiskEngine(),held,1000,'ETH/EUR',100,now,evidence());
 expect(withExposure.portfolioVol).not.toBeNull();
 const missingBid={...held,positions:[{pair:'BTC/EUR',value:NaN,priceAsOf:now-1000}]};
 expect(evaluateNativePortfolioRisk(engine,missingBid,1000,'ETH/EUR',50,now,evidence()).allowed)
  .toBe(false);
});

test('persistent drawdown brake cannot be cleared by a new history provider; sells remain unrestricted',()=>{
 const engine=new PortfolioRiskEngine();
 const underwater={...account,equity:800,cash:800};
 const halted=evaluateNativePortfolioRisk(engine,underwater,1000,'ETH/EUR',20,now,evidence());
 expect(halted).toMatchObject({allowed:false,status:'halted'});
 expect(evaluateNativePortfolioRisk(engine,account,1000,'ETH/EUR',20,now,evidence()).status).toBe('halted');
 expect(engine.evaluateExit()).toMatchObject({allowed:true});
});

test('closed-hour observations do not allow a later future candle to change present risk',()=>{
 const first=evidence();
 const base=evaluateNativePortfolioRisk(new PortfolioRiskEngine(),account,1000,'ETH/EUR',40,now,first);
 const later=evidence();
 later.daily['ETH/EUR']!.push({ts:now+86_400_000,close:1});
 later.btcHourly.push({ts:now+3_600_000,close:1});
 expect(evaluateNativePortfolioRisk(new PortfolioRiskEngine(),account,1000,'ETH/EUR',40,now,later))
  .toEqual(base);
});
