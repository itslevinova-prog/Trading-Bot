import type Database from 'better-sqlite3';
import {DEFAULT_QUOTE_EXPOSURE_LIMITS,evaluateQuoteExposure,paperQuoteCrosses,
 type QuoteExposureLimits,type QuoteExposureInputs} from './quote-exposure.js';
import type {MarketFeed} from '../market/types.js';
import type {PaperExecutionAdapter} from '../broker/PaperExecutionAdapter.js';
import {PortfolioRiskEngine,DEFAULT_RISK_LIMITS,evaluatePaperLossBudget,utcRiskPeriodStart,type LossPeriod,type LossPeriodAnchor,type RiskLimits,type RiskSnapshot,type RiskCandle,type RiskVerdict} from './engine.js';

const DAY=86_400_000,HOUR=3_600_000;
function rows(sqlite:Database.Database,pair:string,interval:number,from:number,to:number){
 return sqlite.prepare('SELECT ts,close FROM candles WHERE pair=? AND interval=? AND ts>=? AND ts<? ORDER BY ts')
  .all(pair,interval,from,to) as RiskCandle[];
}
export function completedPaperDaily(sqlite:Database.Database,pair:string,now:number):RiskCandle[] {
 const today=Math.floor(now/DAY)*DAY,from=today-61*DAY;
 const hourly=rows(sqlite,pair,60,from,today);
 if(hourly.length!==61*24)return [];
 for(let i=0;i<hourly.length;i++)
  if(hourly[i]!.ts!==from+i*HOUR||!Number.isFinite(hourly[i]!.close)||hourly[i]!.close<=0)return [];
 return Array.from({length:61},(_,i)=>({ts:from+i*DAY,close:hourly[i*24+23]!.close}));
}
export function completedBtcHours(sqlite:Database.Database,pair:string,now:number):RiskCandle[] {
 const last=Math.floor(now/HOUR)*HOUR-HOUR,from=last-720*HOUR;
 const hourly=rows(sqlite,pair,60,from,last+HOUR);
 if(hourly.length!==721)return [];
 for(let i=0;i<hourly.length;i++)
  if(hourly[i]!.ts!==from+i*HOUR||!Number.isFinite(hourly[i]!.close)||hourly[i]!.close<=0)return [];
 return hourly;
}
export function initPortfolioRiskStore(sqlite:Database.Database) {
 sqlite.exec(`CREATE TABLE IF NOT EXISTS portfolio_risk_latches (
 account_id TEXT PRIMARY KEY, halted INTEGER NOT NULL CHECK(halted IN (0,1)),
 updated_at INTEGER NOT NULL, reason TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS portfolio_risk_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, pair TEXT NOT NULL,
 ts INTEGER NOT NULL, requested REAL NOT NULL, approved REAL NOT NULL,
 allowed INTEGER NOT NULL, state TEXT NOT NULL, reasons TEXT NOT NULL,
 portfolio_vol REAL, btc_beta REAL, cluster_pct REAL, drawdown REAL NOT NULL);
 CREATE TABLE IF NOT EXISTS portfolio_risk_resets (
 id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, ts INTEGER NOT NULL,
 acknowledgement TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS portfolio_risk_period_baselines (
 account_id TEXT NOT NULL, period TEXT NOT NULL CHECK(period IN ('day','week')),
 period_start INTEGER NOT NULL, start_equity REAL NOT NULL CHECK(start_equity>0),
 captured_at INTEGER NOT NULL, PRIMARY KEY(account_id,period,period_start));
 CREATE TABLE IF NOT EXISTS portfolio_risk_external_flows (
 account_id TEXT NOT NULL, reference TEXT NOT NULL, ts INTEGER NOT NULL,
 delta_eur REAL NOT NULL, reason TEXT NOT NULL, recorded_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,reference));`);
}
export function paperRiskSnapshot(
 sqlite:Database.Database,broker:Pick<PaperExecutionAdapter,'valuation'>,market:MarketFeed,
 accountId:string,pair:string,quoteCurrency:string,now:number,
 reconnectsLastHour=0):RiskSnapshot {
 if(!Number.isSafeInteger(now)||now<=0)throw Error('Invalid paper risk clock');
 const account=sqlite.prepare('SELECT cash,peak_equity AS peakEquity FROM accounts WHERE id=?')
  .get(accountId) as {cash:number;peakEquity:number}|undefined;
 if(!account)throw Error('Risk account not found');
 const valuation=broker.valuation(accountId);
 const positions=valuation.positions.map(p=>({pair:p.pair,marketValue:p.value??NaN}));
 const marketPairs=[...new Set([pair,...positions.map(p=>p.pair)])];
 const btc='BTC/'+quoteCurrency;
 const daily:Record<string,RiskCandle[]>={BTCUSDT:completedPaperDaily(sqlite,btc,now)};
 for(const symbol of marketPairs)daily[symbol]=completedPaperDaily(sqlite,symbol,now);
 const books=marketPairs.map(symbol=>market.books.get(symbol));
 const fresh=books.length>0&&books.every(book=>book?.valid===true&&
  Number.isSafeInteger(book.receivedAt)&&book.receivedAt<=now);
 const feedLastAt=fresh?Math.min(...books.map(book=>book!.receivedAt)):0;
 return {
  asOf:now,equity:valuation.equity??NaN,peakEquity:account.peakEquity,cash:account.cash,positions,
  daily,btcHourly:completedBtcHours(sqlite,btc,now),
  feedConnected:market.connected&&fresh,feedLastAt,reconnectsLastHour
 };
}
/** A local-only owner reset is persisted; the paper process must restart to clear its in-memory latch. */
export function resetStoredPortfolioRisk(sqlite:Database.Database,accountId:string,acknowledgement:string,now=Date.now()) {
 if(!['rules','ai'].includes(accountId)||acknowledgement!=='I_ACKNOWLEDGE_MANUAL_RISK_RESET'||
  !Number.isSafeInteger(now)||now<0)throw Error('Invalid account or local reset acknowledgement');
 initPortfolioRiskStore(sqlite);
 sqlite.transaction(()=>{
  sqlite.prepare('INSERT INTO portfolio_risk_resets(account_id,ts,acknowledgement) VALUES(?,?,?)')
   .run(accountId,now,acknowledgement);
  sqlite.prepare('INSERT INTO portfolio_risk_latches(account_id,halted,updated_at,reason) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET halted=excluded.halted,updated_at=excluded.updated_at,reason=excluded.reason')
   .run(accountId,0,now,'Owner reset; restart paper process; risk checks remain active');
 })();
}
/** Each cash deposit/withdrawal needs one unique, locally audited reference.
 * Flows are neutralized when computing performance, never counted as profit.
 * The caller must record only actual external cash movements, never fills.
 */
export function recordPaperRiskExternalFlow(
 sqlite:Database.Database,accountId:string,reference:string,deltaEur:number,
 reason:string,now:number
):void {
 if(!accountId||!reference||reference.length>128||
   !Number.isFinite(deltaEur)||deltaEur===0||
   !Number.isSafeInteger(now)||now<0||reason.trim().length<10)
  throw Error('Invalid or unexplained external paper cash movement');
 initPortfolioRiskStore(sqlite);
 sqlite.prepare('INSERT INTO portfolio_risk_external_flows(account_id,reference,ts,delta_eur,reason,recorded_at) VALUES(?,?,?,?,?,?)')
  .run(accountId,reference,now,deltaEur,reason.trim(),Date.now());
}
function periodBoundary(
 sqlite:Database.Database,accountId:string,period:LossPeriod,now:number
):LossPeriodAnchor|null {
 const startMs=utcRiskPeriodStart(now,period);
 const found=sqlite.prepare('SELECT start_equity AS equity FROM portfolio_risk_period_baselines WHERE account_id=? AND period=? AND period_start=?')
  .get(accountId,period,startMs) as {equity:number}|undefined;
 let equity=found?.equity;
 if(equity===undefined){
  // The one-minute scheduler persists equity at *exact* UTC midnight each day.
  // Never treat a later/current equity value as the missing boundary.
  let row:{equity:number}|undefined;
  try{row=sqlite.prepare('SELECT equity FROM equity_snapshots WHERE account_id=? AND ts=?')
   .get(accountId,startMs) as {equity:number}|undefined;}catch{return null;}
  if(!row||!Number.isFinite(row.equity)||row.equity<=0)return null;
  sqlite.prepare('INSERT OR IGNORE INTO portfolio_risk_period_baselines(account_id,period,period_start,start_equity,captured_at) VALUES(?,?,?,?,?)')
   .run(accountId,period,startMs,row.equity,now);
  equity=(sqlite.prepare('SELECT start_equity AS equity FROM portfolio_risk_period_baselines WHERE account_id=? AND period=? AND period_start=?')
   .get(accountId,period,startMs) as {equity:number}).equity;
 }
 const flows=sqlite.prepare('SELECT COALESCE(SUM(delta_eur),0) AS amount FROM portfolio_risk_external_flows WHERE account_id=? AND ts>? AND ts<=?')
  .get(accountId,startMs,now) as {amount:number};
 return {period,startMs,equity,netExternalFlow:flows.amount};
}
export function paperLossBudgetStatus(sqlite:Database.Database,accountId:string,
 equity:number,now:number) {
 initPortfolioRiskStore(sqlite);
 return evaluatePaperLossBudget(now,equity,
  periodBoundary(sqlite,accountId,'day',now),
  periodBoundary(sqlite,accountId,'week',now));
}

/** All persisted verdicts and risk latches are local; missing data blocks buys. */
export class PaperPortfolioRiskGateway {
 private readonly engines=new Map<string,PortfolioRiskEngine>();
 private lastConnected:boolean|null=null;
 private reconnects:number[]=[];
 private readonly limits:RiskLimits;
 private readonly quoteLimits:QuoteExposureLimits;
 constructor(private readonly sqlite:Database.Database,
  private readonly broker:Pick<PaperExecutionAdapter,'valuation'>,
  private readonly market:MarketFeed,private readonly quoteCurrency:string,
  env:NodeJS.ProcessEnv=process.env) {
  initPortfolioRiskStore(sqlite);
  this.limits={...DEFAULT_RISK_LIMITS,targetAnnualVol:Number(env.TARGET_PORTFOLIO_VOL??DEFAULT_RISK_LIMITS.targetAnnualVol)};
  // Constructor validates all limits before the first order.
  new PortfolioRiskEngine(this.limits);
  if(!['EUR','USD','USDT','USDC'].includes(this.quoteCurrency))
   throw Error('Unsupported paper settlement quote');
  this.quoteLimits={...DEFAULT_QUOTE_EXPOSURE_LIMITS,
   warningPct:Number(env.PAPER_QUOTE_WARNING_PCT??DEFAULT_QUOTE_EXPOSURE_LIMITS.warningPct),
   blockPct:Number(env.PAPER_QUOTE_BLOCK_PCT??DEFAULT_QUOTE_EXPOSURE_LIMITS.blockPct)};
  if(!Number.isFinite(this.quoteLimits.warningPct)||
     !Number.isFinite(this.quoteLimits.blockPct)||
     this.quoteLimits.warningPct<=0||this.quoteLimits.warningPct>=this.quoteLimits.blockPct||
     this.quoteLimits.blockPct>1)throw Error('Invalid paper quote concentration limits');
 }
 observeConnection(now=Date.now()) {
  const connected=this.market.connected;
  if(this.lastConnected===false&&connected)this.reconnects.push(now);
  this.lastConnected=connected;
  this.reconnects=this.reconnects.filter(ts=>ts>=now-HOUR);
 }
 private engine(id:string){
  let instance=this.engines.get(id);
  if(!instance){
   instance=new PortfolioRiskEngine(this.limits);
   const row=this.sqlite.prepare('SELECT halted FROM portfolio_risk_latches WHERE account_id=?')
    .get(id) as {halted:number}|undefined;
   if(row?.halted===1)instance.restoreHaltFromStore();
   this.engines.set(id,instance);
  }
  return instance;
 }
 evaluateBuy(accountId:string,pair:string,amount:number,now=Date.now()):RiskVerdict {
  this.observeConnection(now);
  const engine=this.engine(accountId);
  const snapshot=paperRiskSnapshot(this.sqlite,this.broker,this.market,accountId,pair,
   this.quoteCurrency,now,this.reconnects.length);
  const engineVerdict=engine.evaluateBuy(pair,amount,snapshot);
  // Paper has no persistent resting-order reservation: reservedQuote is zero,
  // and the proposed entry is separately projected as an all-in quote debit.
  // Never substitute a stablecoin peg when a public cross is absent.
  const quote=this.quoteCurrency as QuoteExposureInputs['quote'];
  const exposure=evaluateQuoteExposure({
   now,quote,equityQuote:snapshot.equity,availableCashQuote:snapshot.cash,
   reservedQuote:0,positions:snapshot.positions.map(p=>({pair:p.pair,valueQuote:p.marketValue})),
   entryDebitQuote:amount,
   ...paperQuoteCrosses(this.market,quote,now,this.quoteLimits.maxCrossAgeMs)
  },this.quoteLimits);
  const exposureReasons=[...exposure.reasons,
   'Quote concentration '+quote+': '+exposure.status+
   ' (cash/reserved/base inventory valued separately in EUR)'];
  // Enforce the same persisted UTC budgets at every gateway call: initial
  // paper admission, after simulated latency, and exact rounded debit check.
  const periodBudget=paperLossBudgetStatus(this.sqlite,accountId,snapshot.equity,now);
  if(periodBudget.status==='halted')engine.restoreHaltFromStore();
  const budgetAllowed=periodBudget.status==='ok';
  const entryAllowed=budgetAllowed&&exposure.allowed;
  const verdict:RiskVerdict={
   ...engineVerdict,
   allowed:entryAllowed&&engineVerdict.allowed,
   approvedAmount:entryAllowed?engineVerdict.approvedAmount:0,
   status:entryAllowed?engineVerdict.status:
    periodBudget.status==='halted'||engine.halted?'halted':'exit-only',
   reasons:[...engineVerdict.reasons,...periodBudget.reasons,...exposureReasons]
  };
  if(engine.halted)this.sqlite.prepare('INSERT INTO portfolio_risk_latches(account_id,halted,updated_at,reason) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET halted=excluded.halted,updated_at=excluded.updated_at,reason=excluded.reason')
   .run(accountId,1,now,periodBudget.status==='halted'?
     periodBudget.reasons.join('; '):'Drawdown hard stop: local owner reset required');
  this.sqlite.prepare('INSERT INTO portfolio_risk_audit(account_id,pair,ts,requested,approved,allowed,state,reasons,portfolio_vol,btc_beta,cluster_pct,drawdown) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(accountId,pair,now,amount,verdict.approvedAmount,verdict.allowed?1:0,verdict.status,
    verdict.reasons.join('; '),verdict.portfolioVol,verdict.portfolioBeta,verdict.clusterPct,verdict.drawdown);
  return verdict;
 }
 /** Local operator action only, not exposed by HTTP. */
 resetByOwner(accountId:string,acknowledgement:string,now=Date.now()) {
  if(!['rules','ai'].includes(accountId))throw Error('Unknown managed paper account');
  const engine=this.engine(accountId);
  resetStoredPortfolioRisk(this.sqlite,accountId,acknowledgement,now);
  engine.resetByOwner(acknowledgement);
 }
}
