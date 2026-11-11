/** Pure, deterministic risk engine: no exchange calls or order submission. */
export type RiskCandle = {ts:number;close:number};
export type RiskAsset = {pair:string;marketValue:number};
export type RiskSnapshot = {
  asOf:number;equity:number;peakEquity:number;cash:number;
  positions:RiskAsset[];
  // Fully closed daily bars, 61+ consecutive closes through prior UTC day.
  daily:Record<string,RiskCandle[]>;
  // Fully closed UTC hourly BTC bars through prior complete hour.
  btcHourly:RiskCandle[];
  feedConnected:boolean;feedLastAt:number;reconnectsLastHour:number;
};
export type RiskLimits = {
 targetAnnualVol:number;maxClusterPct:number;maxPortfolioBeta:number;
 maxPositionPct:number;maxFeedAgeMs:number;maxReconnectsLastHour:number;
 cautionDrawdown:number;exitOnlyDrawdown:number;hardStopDrawdown:number;
};
export const DEFAULT_RISK_LIMITS:Readonly<RiskLimits>=Object.freeze({
 targetAnnualVol:.30,maxClusterPct:.40,maxPortfolioBeta:.80,
 maxPositionPct:.30,maxFeedAgeMs:30000,maxReconnectsLastHour:3,
 cautionDrawdown:.05,exitOnlyDrawdown:.10,hardStopDrawdown:.15,
});
const DAY=86400000,HOUR=3600000;
type Vector={pair:string;returns:number[];vol:number;beta:number};
export type RiskVerdict = {allowed:boolean;approvedAmount:number;status:'ok'|'caution'|'exit-only'|'halted';
 reasons:string[];portfolioVol:number|null;portfolioBeta:number|null;clusterPct:number|null;
 drawdown:number};
const finite=(n:number)=>Number.isFinite(n);
function returnsAt(bars:RiskCandle[],asOf:number,step:number,length:number):number[]|null {
 // Only bars whose close time is <= asOf. Last expected bar opens one full step before.
 const last=Math.floor(asOf/step)*step-step;
 if(!Array.isArray(bars)||bars.some(b=>!Number.isSafeInteger(b.ts)||!finite(b.close)||b.close<=0))return null;
 const byTs=new Map<number,number>();
 for(const bar of bars){if(bar.ts+step>asOf)continue;
  if(byTs.has(bar.ts))return null;byTs.set(bar.ts,bar.close);}
 const r:number[]=[];
 for(let i=length;i>=1;i--){
  const a=byTs.get(last-i*step),b=byTs.get(last-(i-1)*step);
  if(a===undefined||b===undefined)return null;
  const value=Math.log(b/a);
  if(!finite(value))return null;r.push(value);
 }
 return r;
}
function mean(v:number[]){return v.reduce((a,b)=>a+b,0)/v.length;}
function covariance(a:number[],b:number[]):number {
 const ma=mean(a),mb=mean(b);
 return a.reduce((n,x,i)=>n+(x-ma)*(b[i]!-mb),0)/(a.length-1);
}
export function assetRiskVectors(snapshot:RiskSnapshot,pairs:readonly string[]):Vector[]|null {
 if(!Number.isSafeInteger(snapshot.asOf)||snapshot.asOf<0||new Set(pairs).size!==pairs.length||!pairs.includes('BTCUSDT'))return null;
 const btc=returnsAt(snapshot.daily.BTCUSDT??[],snapshot.asOf,DAY,60);
 if(!btc)return null;
 const btcVariance=covariance(btc,btc);
 if(!finite(btcVariance)||btcVariance<=0)return null;
 const output:Vector[]=[];
 for(const pair of pairs){
  const r=returnsAt(snapshot.daily[pair]??[],snapshot.asOf,DAY,60);
  if(!r)return null;
  const variance=covariance(r,r);
  if(!finite(variance)||variance<=0)return null;
  output.push({pair,returns:r,vol:Math.sqrt(variance*365),beta:covariance(r,btc)/btcVariance});
 }
 return output;
}
function estimateVol(positions:RiskAsset[],vectors:Vector[],equity:number):number {
 let variance=0;
 for(const a of positions)for(const b of positions){
  const av=vectors.find(v=>v.pair===a.pair)!,bv=vectors.find(v=>v.pair===b.pair)!;
  variance+=(a.marketValue/equity)*(b.marketValue/equity)*covariance(av.returns,bv.returns)*365;
 }
 return Math.sqrt(Math.max(0,variance));
}
export function bitcoinShock(snapshot:RiskSnapshot):boolean|null {
 const hourly=returnsAt(snapshot.btcHourly,snapshot.asOf,HOUR,24*30);
 if(!hourly)return null;
 const last=Math.abs(hourly[hourly.length-1]!);
 const history=hourly.slice(0,-1).map(Math.abs).sort((a,b)=>a-b);
 return last>history[Math.min(history.length-1,Math.ceil(history.length*.99)-1)]!;
}
/** Circuit breaker remains latched until a documented local manual reset. */
export class PortfolioRiskEngine {
 private latched=false;
 constructor(readonly limits:RiskLimits={...DEFAULT_RISK_LIMITS}) {
  const l=limits;
  if(![l.targetAnnualVol,l.maxClusterPct,l.maxPortfolioBeta,l.maxPositionPct,
     l.cautionDrawdown,l.exitOnlyDrawdown,l.hardStopDrawdown,l.maxFeedAgeMs,l.maxReconnectsLastHour].every(finite)||
    l.targetAnnualVol<=0||l.maxClusterPct<=0||l.maxClusterPct>1||l.maxPositionPct<=0||l.maxPositionPct>1||
    l.maxPortfolioBeta<=0||l.maxFeedAgeMs<1||!Number.isSafeInteger(l.maxReconnectsLastHour)||
    l.cautionDrawdown<0||l.cautionDrawdown>=l.exitOnlyDrawdown||
    l.exitOnlyDrawdown>=l.hardStopDrawdown||l.hardStopDrawdown>1)
    throw Error('Invalid risk limits');
 }
 get halted(){return this.latched;}
 /** Restore an already persisted hard stop; never restore an unlocked state here. */
 restoreHaltFromStore(){this.latched=true;}
 /** Explicit human action; next risk evaluation still enforces all current checks. */
 resetByOwner(acknowledgement:string){
  if(acknowledgement!=='I_ACKNOWLEDGE_MANUAL_RISK_RESET')throw Error('Manual risk reset requires explicit acknowledgement');
  this.latched=false;
 }
 evaluateBuy(pair:string,amount:number,s:RiskSnapshot):RiskVerdict {
  const reasons:string[]=[];
  const dd=finite(s.peakEquity)&&s.peakEquity>0&&finite(s.equity)&&s.equity>=0?
    Math.max(0,1-s.equity/Math.max(s.equity,s.peakEquity)):1;
  if(dd>=this.limits.hardStopDrawdown)this.latched=true;
  const status=this.latched?'halted':dd>=this.limits.exitOnlyDrawdown?'exit-only':
    dd>=this.limits.cautionDrawdown?'caution':'ok';
  const result=(approvedAmount:number,portfolioVol:number|null=null,portfolioBeta:number|null=null,clusterPct:number|null=null):RiskVerdict=>
   ({allowed:approvedAmount>0,approvedAmount,status,reasons,portfolioVol,portfolioBeta,clusterPct,drawdown:dd});
  if(this.latched){reasons.push('Hard-stop drawdown latched; manual owner reset required');return result(0);}
  if(status==='exit-only'){reasons.push('Portfolio drawdown >= exit-only threshold');return result(0);}
  if(!Number.isSafeInteger(s.asOf)||s.asOf<0||!finite(s.equity)||s.equity<=0||
     !finite(s.peakEquity)||s.peakEquity<=0||!finite(s.cash)||s.cash<0||
     !finite(amount)||amount<=0||typeof pair!=='string'||!pair||
     !Array.isArray(s.positions)||new Set(s.positions.map(p=>p.pair)).size!==s.positions.length||
     s.positions.some(p=>!p.pair||!finite(p.marketValue)||p.marketValue<0)){
    reasons.push('Invalid account, position or order state');return result(0);
  }
  if(!s.feedConnected||!Number.isSafeInteger(s.feedLastAt)||s.feedLastAt>s.asOf||
     s.asOf-s.feedLastAt>this.limits.maxFeedAgeMs||
     !Number.isSafeInteger(s.reconnectsLastHour)||s.reconnectsLastHour>this.limits.maxReconnectsLastHour){
    reasons.push('Market feed stale, disconnected or reconnect storm');return result(0);
  }
  const shock=bitcoinShock(s);
  if(shock===null||shock){reasons.push(shock===null?'BTC hourly shock history incomplete':'BTC hourly volatility exceeds historical P99');return result(0);}
  const pairs=[...new Set(['BTCUSDT',pair,...s.positions.map(p=>p.pair)])];
  const vectors=assetRiskVectors(s,pairs);
  if(!vectors){reasons.push('Incomplete contiguous 60-day risk history; no new entries');return result(0);}
  const byPair=new Map(vectors.map(v=>[v.pair,v]));
  const existing=s.positions.filter(p=>p.marketValue>0);
  const current=existing.find(p=>p.pair===pair)?.marketValue??0;
  let cap=Math.min(amount,s.cash,Math.max(0,s.equity*this.limits.maxPositionPct-current));
  const candidate=byPair.get(pair)!;
  // Inverse volatility per-asset cap. Never multiply exposure by a positive estimate.
  cap=Math.min(cap,s.equity*this.limits.targetAnnualVol/candidate.vol);
  if(status==='caution'){cap*=.5;reasons.push('Drawdown caution: new entry size halved');}
  const values=new Map(existing.map(p=>[p.pair,p.marketValue]));
  const riskStats=(additional:number)=>{
   const projected=[...values.entries()].map(([p,value])=>({pair:p,marketValue:value}));
   const index=projected.findIndex(p=>p.pair===pair);
   if(index>=0)projected[index]!.marketValue+=additional;
   else projected.push({pair,marketValue:additional});
   const vol=estimateVol(projected,vectors,s.equity);
   const beta=projected.reduce((sum,p)=>sum+p.marketValue/s.equity*byPair.get(p.pair)!.beta,0);
   const cluster=projected.filter(p=>byPair.get(p.pair)!.beta>=.8)
     .reduce((sum,p)=>sum+p.marketValue/s.equity,0);
   return {vol,beta,cluster};
  };
  const allowed=(n:number)=>{const {vol,beta,cluster}=riskStats(n);
    return vol<=this.limits.targetAnnualVol+1e-10&&beta<=this.limits.maxPortfolioBeta+1e-10&&
      cluster<=this.limits.maxClusterPct+1e-10;};
  if(!allowed(cap)){
   let low=0,high=cap;
   if(!allowed(0)){reasons.push('Existing portfolio breaches volatility/beta/cluster limits');return result(0);}
   for(let i=0;i<48;i++){const mid=(low+high)/2;if(allowed(mid))low=mid;else high=mid;}
   cap=low;reasons.push('Entry size reduced to portfolio volatility/beta/cluster cap');
  }
  const stats=riskStats(cap);
  if(cap<.00000001){reasons.push('Insufficient conservative portfolio budget');return result(0,stats.vol,stats.beta,stats.cluster);}
  return result(cap,stats.vol,stats.beta,stats.cluster);
 }
 /** A sell is always allowed by this engine, including under a latched stop. */
 evaluateExit():{allowed:true;reason:string}{return {allowed:true,reason:'Exits remain authorized under every circuit-breaker'};}
}

/** Read-only diagnostics of the current portfolio. This never authorizes an entry,
 * clears a halt, or supplies substitute historic price observations. */
export type PortfolioRiskDiagnostics = {
 asOf:number;dataReady:boolean;investedPct:number|null;
 portfolioVol:number|null;btcBeta:number|null;clusterPct:number|null;
 drawdown:number|null;toCaution:number|null;toExitOnly:number|null;toHardStop:number|null;
};
export function inspectPortfolioRisk(
 snapshot:RiskSnapshot,limits:RiskLimits=DEFAULT_RISK_LIMITS
):PortfolioRiskDiagnostics {
 const empty=(drawdown:number|null=null,investedPct:number|null=null):PortfolioRiskDiagnostics=>({
  asOf:snapshot.asOf,dataReady:false,investedPct,portfolioVol:null,btcBeta:null,clusterPct:null,
  drawdown,toCaution:drawdown===null?null:Math.max(0,limits.cautionDrawdown-drawdown),
  toExitOnly:drawdown===null?null:Math.max(0,limits.exitOnlyDrawdown-drawdown),
  toHardStop:drawdown===null?null:Math.max(0,limits.hardStopDrawdown-drawdown)
 });
 if(!Number.isSafeInteger(snapshot.asOf)||snapshot.asOf<0||
   !finite(snapshot.equity)||snapshot.equity<=0||
   !finite(snapshot.peakEquity)||snapshot.peakEquity<=0||
   !finite(snapshot.cash)||snapshot.cash<0||!Array.isArray(snapshot.positions)||
   new Set(snapshot.positions.map(p=>p.pair)).size!==snapshot.positions.length||
   snapshot.positions.some(p=>!p.pair||!finite(p.marketValue)||p.marketValue<0))
   return empty();
 const investedPct=snapshot.positions.reduce((sum,p)=>sum+p.marketValue,0)/snapshot.equity;
 const drawdown=Math.max(0,1-snapshot.equity/Math.max(snapshot.equity,snapshot.peakEquity));
 const fallback=empty(drawdown,investedPct);
 if(!snapshot.feedConnected||!Number.isSafeInteger(snapshot.feedLastAt)||
   snapshot.feedLastAt>snapshot.asOf||
   snapshot.asOf-snapshot.feedLastAt>limits.maxFeedAgeMs||
   !Number.isSafeInteger(snapshot.reconnectsLastHour)||
   snapshot.reconnectsLastHour>limits.maxReconnectsLastHour||
   bitcoinShock(snapshot)===null)return fallback;
 const symbols=[...new Set(['BTCUSDT',...snapshot.positions.map(p=>p.pair)])];
 const vectors=assetRiskVectors(snapshot,symbols);
 if(!vectors)return fallback;
 const byPair=new Map(vectors.map(vector=>[vector.pair,vector]));
 const portfolioVol=estimateVol(snapshot.positions,vectors,snapshot.equity);
 const btcBeta=snapshot.positions.reduce((sum,p)=>sum+
   p.marketValue/snapshot.equity*byPair.get(p.pair)!.beta,0);
 const clusterPct=snapshot.positions.filter(p=>byPair.get(p.pair)!.beta>=.8)
   .reduce((sum,p)=>sum+p.marketValue/snapshot.equity,0);
 if(![investedPct,portfolioVol,btcBeta,clusterPct].every(finite))return fallback;
 return {...fallback,dataReady:true,portfolioVol,btcBeta,clusterPct};
}


/** Fixed protective paper-only drawdown budgets, never tuned to a backtest. */
export const PAPER_LOSS_LIMITS=Object.freeze({dailyLossPct:.03,weeklyLossPct:.06});
export type LossPeriod='day'|'week';
export type LossPeriodAnchor={
 period:LossPeriod;
 startMs:number;
 /** Persisted actual UTC boundary mark, inclusive of past fees and PnL. */
 equity:number;
 /** Audited external account flows since this boundary; not trade proceeds. */
 netExternalFlow:number;
};
export type PaperLossBudgetVerdict={
 status:'ok'|'unknown'|'halted';
 dailyLossPct:number|null;
 weeklyLossPct:number|null;
 dailyStartMs:number;
 weeklyStartMs:number;
 reasons:string[];
};
export function utcRiskPeriodStart(now:number,period:LossPeriod):number {
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid UTC risk budget time');
 const dayStart=Math.floor(now/86400000)*86400000;
 if(period==='day')return dayStart;
 const weekday=new Date(dayStart).getUTCDay(); // Monday 00:00 UTC is the week boundary.
 return dayStart-((weekday+6)%7)*86400000;
}
/** Pure evaluation from persisted boundary equity; no missing data is filled or guessed. */
export function evaluatePaperLossBudget(
 asOf:number,currentEquity:number,
 daily:LossPeriodAnchor|null,weekly:LossPeriodAnchor|null,
 limits:Readonly<typeof PAPER_LOSS_LIMITS>=PAPER_LOSS_LIMITS
):PaperLossBudgetVerdict {
 const dailyStartMs=utcRiskPeriodStart(asOf,'day');
 const weeklyStartMs=utcRiskPeriodStart(asOf,'week');
 const unknown=(reason:string):PaperLossBudgetVerdict=>({
  status:'unknown',dailyLossPct:null,weeklyLossPct:null,dailyStartMs,weeklyStartMs,
  reasons:[reason]
 });
 if(!Number.isFinite(currentEquity)||currentEquity<0||
   !Number.isFinite(limits.dailyLossPct)||!Number.isFinite(limits.weeklyLossPct)||
   limits.dailyLossPct<=0||limits.weeklyLossPct<=0||
   limits.dailyLossPct>=1||limits.weeklyLossPct>=1)
  return unknown('Unbekannte oder unzulässige Bewertung und fixe UTC-Risikobudgets.');
 if(!daily||!weekly||
   daily.period!=='day'||weekly.period!=='week'||
   daily.startMs!==dailyStartMs||weekly.startMs!==weeklyStartMs)
  return unknown('Persistierte Eigenkapitalbewertung zum genauen UTC-Tages-/Wochenbeginn fehlt.');
 for(const anchor of [daily,weekly]){
  if(!Number.isFinite(anchor.equity)||anchor.equity<=0||
     !Number.isFinite(anchor.netExternalFlow))
   return unknown('Ungültiges Startkapital oder ungeklärte externe Kontobewegungen.');
 }
 const dailyLossPct=Math.max(0,1-(currentEquity-daily.netExternalFlow)/daily.equity);
 const weeklyLossPct=Math.max(0,1-(currentEquity-weekly.netExternalFlow)/weekly.equity);
 if(!Number.isFinite(dailyLossPct)||!Number.isFinite(weeklyLossPct))
  return unknown('Risikoverlust nach Einzahlungsbereinigung nicht bestimmbar.');
 const reasons:string[]=[];
 if(dailyLossPct>=limits.dailyLossPct)
  reasons.push('UTC-Tagesverlustbudget erreicht; nur Ausstiege bis zum manuellen Risiko-Reset.');
 if(weeklyLossPct>=limits.weeklyLossPct)
  reasons.push('UTC-Wochenverlustbudget erreicht; nur Ausstiege bis zum manuellen Risiko-Reset.');
 return {status:reasons.length?'halted':'ok',
  dailyLossPct,weeklyLossPct,dailyStartMs,weeklyStartMs,reasons};
}
