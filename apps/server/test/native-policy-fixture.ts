import {BinanceSpotExecutionAdapter,type LiveLimits} from '../src/live/BinanceSpotExecutionAdapter.js';import type {BinanceClient} from '../src/live/BinanceClient.js';import type {Journal} from '../src/live/journal.js';import {effectiveTradingPolicy} from '../src/strategy/trading-policy.js';import type {NativePolicyAccess} from '../src/live/trading-policy.js';import type {Action} from '@paper/shared';
import type {NativePortfolioRiskEvidence} from '../src/live/native-portfolio-risk.js';
const DAY=86_400_000,HOUR=3_600_000;
/** Offline fixtures only: no live market requests or historical-return claims. */
export function fixtureNativePortfolioEvidence(pairs:readonly string[],now:number):NativePortfolioRiskEvidence{
 const lastDay=Math.floor(now/DAY)*DAY-DAY;
 const lastHour=Math.floor(now/HOUR)*HOUR-HOUR;
 const daily=Array.from({length:91},(_,i)=>({
  ts:lastDay-(90-i)*DAY,close:100*Math.exp(i*.001+Math.sin(i*.2)*.02)
 }));
 const btcHourly=Array.from({length:750},(_,i)=>({
  ts:lastHour-(749-i)*HOUR,close:100*Math.exp(i*.0003+Math.sin(i*.18)*.0004)
 }));
 return {asOf:now,feedConnected:true,feedLastAt:now-100,reconnectsLastHour:0,
  btcHourly,daily:Object.fromEntries(['BTCUSDT',...pairs].map(p=>[p,daily.map(x=>({...x}))]))};
}
/** Explicit pinned Safe policy and synthetic risk history for offline broker
 * fixtures only; production has no implicit policy/pin or history provider. */
export class PolicyFixtureBroker extends BinanceSpotExecutionAdapter{
 private fixtureSource:NativePolicyAccess;
 constructor(client:BinanceClient,journal:Journal,limits:LiveLimits,source?:NativePolicyAccess){const policy=effectiveTradingPolicy({mode:'safe',stopLossPct:.05,revision:0,updatedAt:null},{MAX_POSITION_PCT:limits.maxPositionPct,MAX_OPEN_POSITIONS:limits.maxPositions,MAX_TRADES_PER_DAY:limits.maxTradesPerDay,COIN_COOLDOWN_MINUTES:60,MAX_TOTAL_RISK_PCT:limits.maxPortfolioRiskPct??.025,MAX_ENTRY_SPREAD_BPS:limits.maxSpreadBps,MAX_ENTRY_SLIPPAGE_BPS:limits.maxSlippageBps,DEFAULT_STOP_LOSS_PCT:.05}),access=source??{read:()=>policy};super(client,journal,limits,access);this.fixtureSource=access;
  this.setNativePortfolioRiskProvider((pairs,now)=>fixtureNativePortfolioEvidence(pairs,now));
 }
 override place(action:Action,id:string,pin=this.fixtureSource.read().fingerprint){return super.place(action,id,pin);}
}
