import {recordPositionEntry} from '../context/position-entry.js';
import {PaperReconcileGate} from './paper-reconcile.js';
import {TradingPolicyStore,entryPolicyGuard} from '../strategy/trading-policy.js';
import {createHash} from 'node:crypto';
import {markPortfolio} from './valuation.js';
import {SqliteExitFailures} from '../strategy/protectiveExits.js';
import {universeFingerprint,evaluationFingerprint,type RuntimeProvenance} from '../provenance/build.js';
import {randomUUID} from 'node:crypto';import {eq,and,desc,gte,sql} from 'drizzle-orm';
import type {BrokerOrder} from '@paper/shared';import type {MarketFeed} from '../market/types.js';
import {db,sqlite} from '../db.js';import {config} from '../config.js';
import {accounts,positions,trades,rejectedOrders,pairs,tradeProvenance} from '../schema.js';
import {bookVWAP,quantityForBudget} from '../market/orderBook.js';
import {validateRisk,positionStopRisk,entryDrawdownGuard} from './risk.js';
import {entryQuoteGuard,entryFillGuard} from './executionGuards.js';
export interface ExecutionAdapter{placeMarketOrder(order:BrokerOrder):Promise<{ok:boolean;reason:string;trade?:unknown}>;getBalances(accountId:string):{cash:number;equity:number|null};}
const floorQty=(x:number,decimals:number)=>Math.floor((x+Number.EPSILON)*10**decimals)/10**decimals;
const GUARD_TIMEOUT_MS=2500;
type RiskVerdict={allowed:boolean;approvedAmount:number;reasons:string[]};

export class PaperExecutionAdapter implements ExecutionAdapter{
 readonly policies=new TradingPolicyStore(sqlite,config);
 private portfolioRiskGuard:((accountId:string,pair:string,amount:number)=>Promise<{allowed:boolean;approvedAmount:number;reasons:string[]}>|{allowed:boolean;approvedAmount:number;reasons:string[]})|undefined;
 setPortfolioRiskGuard(guard:(accountId:string,pair:string,amount:number)=>Promise<{allowed:boolean;approvedAmount:number;reasons:string[]}>|{allowed:boolean;approvedAmount:number;reasons:string[]}){
  if(this.portfolioRiskGuard)throw Error('Portfolio RiskEngine already installed');
  this.portfolioRiskGuard=guard;
 }
 /** A stalled/throwing asynchronous risk provider never authorizes a new fill.
  * Late resolution is ignored by Promise.race, without any additional orders. */
 private async checkedRiskDecision(accountId:string,pair:string,amount:number):Promise<RiskVerdict>{
  const guard=this.portfolioRiskGuard;
  if(!guard)return {allowed:false,approvedAmount:0,reasons:['RiskEngine fehlt']};
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<RiskVerdict>(resolve=>{
   timer=setTimeout(()=>resolve({allowed:false,approvedAmount:0,reasons:['RiskEngine timeout; keine neuen Einstiege']}),GUARD_TIMEOUT_MS);
  });
  try{
   const verdict=await Promise.race([
    Promise.resolve().then(()=>guard(accountId,pair,amount)),timeout
   ]);
   if(!verdict||typeof verdict.allowed!=='boolean'||!Number.isFinite(verdict.approvedAmount)||
      !Array.isArray(verdict.reasons)||verdict.reasons.some(r=>typeof r!=='string'))
    return {allowed:false,approvedAmount:0,reasons:['RiskEngine ungueltige Antwort']};
   return verdict;
  }catch{
   return {allowed:false,approvedAmount:0,reasons:['RiskEngine unavailable; keine neuen Einstiege']};
  }finally{if(timer!==undefined)clearTimeout(timer);}
 }
 private coinQualityGuard:((pair:string,asOf:number)=>Promise<{allowed:boolean;reason:string}>)|undefined;
 setCoinQualityGuard(guard:(pair:string,asOf:number)=>Promise<{allowed:boolean;reason:string}>){
  if(this.coinQualityGuard)throw Error('Coin quality entry gate already installed');
  this.coinQualityGuard=guard;
 }
 private async coinQualityDenied(pair:string):Promise<string|null> {
  const guard=this.coinQualityGuard;
  if(!guard)return null;
  const asOf=Date.now();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<null>(resolve=>{
   timer=setTimeout(()=>resolve(null),GUARD_TIMEOUT_MS);
  });
  try{
   const verdict=await Promise.race([
    Promise.resolve().then(()=>guard(pair,asOf)),timeout
   ]);
   if(verdict===null)return 'Coin quality: timeout; no new exposure';
   return verdict?.allowed===true?null:'Coin quality: '+(verdict?.reason??'missing verdict');
  }catch{return 'Coin quality: unavailable; no new exposure';}
  finally{if(timer!==undefined)clearTimeout(timer);}
 }
 private experimentEntryGuard:(()=>void)|undefined;
 private pipelineEntryGuard:((accountId:string,strategy:string)=>void)|undefined;
 setPipelineEntryGuard(guard:(accountId:string,strategy:string)=>void){if(this.pipelineEntryGuard)throw Error('Paper pipeline guard already attached');this.pipelineEntryGuard=guard;}
 private pipelineBlock(accountId:string,strategy:string):string|null {try{this.pipelineEntryGuard?.(accountId,strategy);return null;}catch(error){return 'Paper pipeline admission denied: '+String(error instanceof Error?error.message:error);}}
 setPaperExperimentEntryGuard(guard:()=>void){if(this.experimentEntryGuard)throw Error('Paper experiment guard already attached');this.experimentEntryGuard=guard;}
 private experimentEntryAllowed(){try{this.experimentEntryGuard?.();return true;}catch{return false;}}
 private locks=new Map<string,Promise<unknown>>();private exitFailures=new SqliteExitFailures(sqlite);
 readonly reconciliation=new PaperReconcileGate(sqlite);
 private reconciliationStartupError:string|null=null;
 private readonly isolatedLedgerFixture:boolean;
 constructor(private market:MarketFeed,private emit:(type:string,payload:unknown)=>void,
  readonly provenance?:RuntimeProvenance,
  testOptions?:{isolatedLedgerFixture?:true}){
  // Existing risk/quality fixtures deliberately insert unjournalled synthetic
  // positions. Their explicit opt-in is available ONLY under Vitest; default
  // paper/production execution is always reconciled, including every buy.
  if(testOptions?.isolatedLedgerFixture&&process.env.VITEST!=='true')
   throw Error('Isolated ledger fixture requires Vitest');
  this.isolatedLedgerFixture=testOptions?.isolatedLedgerFixture===true;
  if(this.isolatedLedgerFixture)return;
  // A malformed ledger must not prevent protective exits; new buys fail closed.
  try{this.reconciliation.scanAll();}
  catch(error){
   this.reconciliationStartupError='PAPER_RECONCILE_UNAVAILABLE: '+String(error instanceof Error?error.message:error);
   this.emit('system_status',{message:this.reconciliationStartupError,entryOnly:true});
  }
 }

 executionProvenance(accountId?:string){
  const identity=this.provenance,policy=accountId?this.policies.get(accountId):null;const strategyVersion=identity?(policy?createHash('sha256').update(identity.strategyVersion+':'+policy.fingerprint).digest('hex'):identity.strategyVersion):null;let universeHash:string|null=null;
  try{universeHash=universeFingerprint(db.select().from(pairs).where(eq(pairs.active,true)).all());}catch{/* Unknown universe is never verified evidence. */}
  return {runId:identity?.runId??null,buildId:identity?.build.buildId??null,strategyVersion,universeHash,evaluationVersion:strategyVersion&&universeHash?evaluationFingerprint(strategyVersion,universeHash):null,buildVerified:!!identity?.verified&&universeHash!==null};
 }
 getBalances(id:string){const a=db.select().from(accounts).where(eq(accounts.id,id)).get();if(!a)throw Error('Unbekanntes Konto');return {cash:a.cash,equity:this.equity(id)};}
 valuation(id:string){const a=db.select().from(accounts).where(eq(accounts.id,id)).get();if(!a)throw Error('Unbekanntes Konto');return markPortfolio(a.cash,db.select().from(positions).where(eq(positions.accountId,id)).all(),this.market,config.MAX_BOOK_AGE_MS);}
 equity(id:string):number|null{return this.valuation(id).equity;}
 async placeMarketOrder(order:BrokerOrder){const previous=this.locks.get(order.accountId)??Promise.resolve();const current=previous.catch(()=>{}).then(()=>this.execute(order));this.locks.set(order.accountId,current);try{return await current}finally{if(this.locks.get(order.accountId)===current)this.locks.delete(order.accountId);}}
 private reject(order:BrokerOrder,reason:string){const record={id:randomUUID(),accountId:order.accountId,pair:order.pair,side:order.side,requested:JSON.stringify(order),reason,decisionId:order.decisionId,ts:Date.now()};db.insert(rejectedOrders).values(record).run();this.emit('order_rejected',record);return {ok:false,reason};}
 private async execute(order:BrokerOrder){const a=db.select().from(accounts).where(eq(accounts.id,order.accountId)).get(),p=db.select().from(pairs).where(eq(pairs.symbol,order.pair)).get(),b=this.market.books.get(order.pair);
 if(order.side==='buy'&&!this.experimentEntryAllowed())return this.reject(order,'Paper-Experiment nicht registriert oder Identität geändert');
 if(!a||!p)return this.reject(order,'Unbekanntes Konto oder Paar');
 if(order.side==='buy'){
  const reconciliationError=this.isolatedLedgerFixture?null:(this.reconciliationStartupError??this.reconciliation.entryBlock(a.id));
  if(reconciliationError)return this.reject(order,reconciliationError);
 }
 if(order.side==='buy'){const denied=this.pipelineBlock(a.id,a.strategy);if(denied)return this.reject(order,denied);}
 if(order.side==='buy'&&this.coinQualityGuard){const denied=await this.coinQualityDenied(order.pair);if(denied)return this.reject(order,denied);}
 if(!p.active)return this.reject(order,'Paar nicht aktiv');
 if(!b||!b.valid||!Number.isFinite(b.receivedAt)||b.receivedAt>Date.now()||Date.now()-b.receivedAt>config.MAX_BOOK_AGE_MS)return this.reject(order,'Orderbuch veraltet oder ungültig');
 const mid=(Number(b.asks[0]?.price)+Number(b.bids[0]?.price))/2;if(!Number.isFinite(mid)||mid<=0)return this.reject(order,'Ungültiger Mittelkurs');
 const policy=this.policies.get(a.id),originalRevision=policy?.revision;
 const entryLimits={maxSpreadBps:policy?.maxSpreadBps??config.MAX_ENTRY_SPREAD_BPS,maxSlippageBps:policy?.maxSlippageBps??config.MAX_ENTRY_SLIPPAGE_BPS};
 const stopPct=policy?Math.min(order.stopLossPct??policy.stopLossPct,policy.stopLossPct):(order.stopLossPct??config.DEFAULT_STOP_LOSS_PCT);
 if(order.side==='buy'&&(!Number.isFinite(stopPct)||stopPct<.02||stopPct>.15))return this.reject(order,'Ungültige Stop-Grenze');
 if(order.side==='buy'&&policy){const last=sqlite.prepare("SELECT max(ts) AS ts FROM trades WHERE account_id=? AND side='buy'").get(a.id) as {ts:number|null};const why=entryPolicyGuard(policy,{revision:order.policyRevision,confidence:order.confidence,lastEntryAt:last.ts??undefined,now:Date.now()});if(why)return this.reject(order,why);}
 if(order.side==='buy'&&this.exitFailures.has(order.accountId))return this.reject(order,'Ungelöster Schutzverkaufsfehler; neue Einstiege gesperrt');
 if(order.side==='buy'){const guard=entryQuoteGuard(Number(b.bids[0]?.price),Number(b.asks[0]?.price),entryLimits);if(!guard.allowed)return this.reject(order,guard.reason);}
 if(order.side==='buy'&&!this.market.connected)return this.reject(order,'Börsenverbindung unterbrochen; neue Einstiege gesperrt');
 const valuation=this.valuation(a.id);if(order.side==='buy'&&valuation.equity===null)return this.reject(order,'Portfoliobewertung fehlt oder ist veraltet; neue Einstiege gesperrt');
 if(order.side==='buy'&&a.strategy!=='hold'&&a.strategy!=='dca'){const why=entryDrawdownGuard(valuation.equity!,a.peakEquity,config.MAX_DRAWDOWN_PCT);if(why)return this.reject(order,why);}
 let amount=order.amountEur??0;
 if(order.side==='buy'&&a.strategy!=='hold'&&a.strategy!=='dca'){
  const midnight=new Date();midnight.setUTCHours(0,0,0,0);
  const today=db.select({count:sql<number>`count(*)`}).from(trades).where(and(eq(trades.accountId,a.id),gte(trades.ts,midnight.getTime()),policy?eq(trades.side,'buy'):undefined)).get()?.count??0;
  const lastSell=db.select().from(trades).where(and(eq(trades.accountId,a.id),eq(trades.pair,order.pair),eq(trades.side,'sell'))).orderBy(desc(trades.ts)).limit(1).get();
  const risk=validateRisk({...order,stopLossPct:stopPct},{equity:valuation.equity!,cash:a.cash,status:a.status,positions:valuation.positions.map(x=>({pair:x.pair,value:x.value!,stopRisk:positionStopRisk(x.qty,x.bid!,x.stopLossPrice,config.TAKER_FEE_RATE,config.MIN_ORDER_EUR)})),tradesToday:Number(today),lastSellAt:lastSell?.ts,now:Date.now()},{maxPositionPct:policy?.maxPositionPct??config.MAX_POSITION_PCT,maxOpenPositions:policy?.maxOpenPositions??config.MAX_OPEN_POSITIONS,maxTradesPerDay:policy?.maxEntriesPerDay??config.MAX_TRADES_PER_DAY,cooldownMinutes:policy?.cooldownMinutes??config.COIN_COOLDOWN_MINUTES,maxPortfolioRiskPct:policy?.maxPortfolioRiskPct??config.MAX_TOTAL_RISK_PCT,feeRate:config.TAKER_FEE_RATE});
  if(!risk.allowed)return this.reject(order,risk.reason);amount=risk.amountEur??0;if(amount<(order.amountEur??0))this.emit('system_status',{message:`${order.pair}: ${risk.reason}`,requested:order.amountEur,approved:amount});
 }
 if(order.side==='sell'&&a.strategy!=='hold'&&a.strategy!=='dca'&&!policy&&!order.protectiveExit){
  const midnight=new Date();midnight.setUTCHours(0,0,0,0);
  const today=db.select({count:sql<number>`count(*)`}).from(trades).where(and(eq(trades.accountId,a.id),gte(trades.ts,midnight.getTime()))).get()?.count??0;
  if(today>=config.MAX_TRADES_PER_DAY)return this.reject(order,'Tageslimit erreicht');
 }
 if(order.side==='buy'&&a.strategy!=='hold'&&a.strategy!=='dca'&&this.portfolioRiskGuard){
  const decision=await this.checkedRiskDecision(a.id,order.pair,amount);
  if(!decision.allowed||!Number.isFinite(decision.approvedAmount)||decision.approvedAmount<=0)
   return this.reject(order,'Portfolio-RiskEngine: '+decision.reasons.join('; '));
  amount=Math.min(amount,decision.approvedAmount);
 }
 if(order.side==='buy'&&(!Number.isFinite(amount)||amount<=0))return this.reject(order,'Ungültiger Kaufbetrag');
 if(order.side==='sell'&&(!order.sellFraction||order.sellFraction<=0||order.sellFraction>1))return this.reject(order,'Ungültiger Verkaufsanteil');
 const latency=config.SIMULATED_LATENCY_MS_MIN+Math.random()*(config.SIMULATED_LATENCY_MS_MAX-config.SIMULATED_LATENCY_MS_MIN);await new Promise(r=>setTimeout(r,latency));
 if(order.side==='buy'&&!this.experimentEntryAllowed())return this.reject(order,'Paper-Experiment während Ausführung geändert');
 if(order.side==='buy'){
  const reconciliationError=this.isolatedLedgerFixture?null:(this.reconciliationStartupError??this.reconciliation.entryBlock(a.id));
  if(reconciliationError)return this.reject(order,reconciliationError);
 }
 if(order.side==='buy'){const denied=this.pipelineBlock(a.id,a.strategy);if(denied)return this.reject(order,denied);}
 if(order.side==='buy'&&this.coinQualityGuard){const denied=await this.coinQualityDenied(order.pair);if(denied)return this.reject(order,denied);}
 if(order.side==='buy'&&policy&&this.policies.get(a.id)?.revision!==originalRevision)return this.reject(order,'Trading-Modus während der Ausführung geändert; neue Entscheidung erforderlich');
 const currentBook=this.market.books.get(order.pair);if(!currentBook?.valid||!Number.isFinite(currentBook.receivedAt)||currentBook.receivedAt>Date.now()||Date.now()-currentBook.receivedAt>config.MAX_BOOK_AGE_MS)return this.reject(order,'Orderbuch nach Latenz veraltet');
 if(order.side==='buy'&&this.exitFailures.has(order.accountId))return this.reject(order,'Ungelöster Schutzverkaufsfehler; neue Einstiege gesperrt');
 if(order.side==='buy'){const guard=entryQuoteGuard(Number(currentBook.bids[0]?.price),Number(currentBook.asks[0]?.price),entryLimits);if(!guard.allowed)return this.reject(order,guard.reason);}
 if(order.side==='buy'&&a.strategy!=='hold'&&a.strategy!=='dca'&&this.portfolioRiskGuard){
  const verdict=await this.checkedRiskDecision(a.id,order.pair,amount);
  if(!verdict.allowed||!Number.isFinite(verdict.approvedAmount)||verdict.approvedAmount<=0)
   return this.reject(order,'Portfolio-RiskEngine nach Latenz: '+verdict.reasons.join('; '));
  amount=Math.min(amount,verdict.approvedAmount);
 }
 const currentPosition=db.select().from(positions).where(and(eq(positions.accountId,a.id),eq(positions.pair,order.pair))).get();
 const latestAccount=db.select().from(accounts).where(eq(accounts.id,a.id)).get()!;
 if(order.side==='buy'&&a.strategy!=='hold'&&a.strategy!=='dca'&&latestAccount.status!=='active')return this.reject(order,'Konto während der Ausführung pausiert oder inaktiv');
 if(order.side==='buy'&&!this.market.connected)return this.reject(order,'Börsenverbindung während der Latenz unterbrochen');
 const latestValuation=this.valuation(a.id);if(order.side==='buy'&&latestValuation.equity===null)return this.reject(order,'Portfoliobewertung nach Latenz fehlt oder ist veraltet');
 if(order.side==='buy'&&a.strategy!=='hold'&&a.strategy!=='dca'){const why=entryDrawdownGuard(latestValuation.equity!,latestAccount.peakEquity,config.MAX_DRAWDOWN_PCT);if(why)return this.reject(order,why);}
 let qty:number,fill:number|null;
 if(order.side==='buy'){
  // amount is the all-in debit (including the taker fee).
  const budget=Math.min(amount,latestAccount.cash)/(1+config.TAKER_FEE_RATE);
  const raw=quantityForBudget(currentBook.asks,budget);if(raw===null)return this.reject(order,'Nicht genügend Liquidität in 10 Ask-Stufen');
  qty=floorQty(raw,p.lotDecimals);fill=qty>0?bookVWAP(currentBook.asks,'buy',qty):null;
 }else{
  if(!currentPosition)return this.reject(order,'Keine Position vorhanden');
  qty=order.sellFraction===1?currentPosition.qty:floorQty(currentPosition.qty*order.sellFraction!,p.lotDecimals);
  fill=qty>0?bookVWAP(currentBook.bids,'sell',qty):null;
 }
 if(fill===null||!Number.isFinite(fill)||qty<=0)return this.reject(order,'Nicht genügend Orderbuchtiefe');
 if(order.side==='buy'){const guard=entryFillGuard(fill,mid,entryLimits);if(!guard.allowed)return this.reject(order,guard.reason);}
 const cost=qty*fill,fee=cost*config.TAKER_FEE_RATE;
 if(!Number.isFinite(cost)||!Number.isFinite(fee)||fee<0||!Number.isFinite(cost+fee))
  return this.reject(order,'Orderkosten nach Lot-Rundung ungültig; Einstieg gesperrt');
 const proposedStop=policy?Math.max(currentPosition?.stopLossPrice??0,((currentPosition?.costBasisEur??0)+cost+fee)/((currentPosition?.qty??0)+qty)*(1-stopPct)):(currentPosition?.stopLossPrice??fill*(1-stopPct));
 if(qty+1e-12<p.ordermin||cost+1e-9<Math.max(config.MIN_ORDER_EUR,p.costmin))return this.reject(order,'Mindestgrösse (ordermin/costmin/MIN_ORDER_EUR) unterschritten');
 if(order.side==='buy'&&cost+fee>latestAccount.cash+1e-8)return this.reject(order,'Unzureichendes Cash');
 if(order.side==='buy'&&cost+fee>amount+1e-7)
  return this.reject(order,'Orderkosten inklusive Gebühren überschreiten das freigegebene Budget nach Lot-Rundung');
 // Re-evaluate the latest position, trading and stop-risk caps using the exact debit.
 // These are entry-only checks: protective sells remain independently authorized.
 if(order.side==='buy'&&a.strategy!=='hold'&&a.strategy!=='dca'){
  const midnight=new Date();midnight.setUTCHours(0,0,0,0);
  const today=db.select({count:sql<number>`count(*)`}).from(trades).where(and(
   eq(trades.accountId,a.id),gte(trades.ts,midnight.getTime()),policy?eq(trades.side,'buy'):undefined
  )).get()?.count??0;
  const lastSell=db.select().from(trades).where(and(eq(trades.accountId,a.id),
   eq(trades.pair,order.pair),eq(trades.side,'sell'))).orderBy(desc(trades.ts)).limit(1).get();
  const exactDebit=cost+fee;
  const finalRisk=validateRisk({...order,amountEur:exactDebit,stopLossPct:stopPct},{
   equity:latestValuation.equity!,cash:latestAccount.cash,status:latestAccount.status,
   positions:latestValuation.positions.map(x=>({pair:x.pair,value:x.value!,
    stopRisk:positionStopRisk(x.qty,x.bid!,x.stopLossPrice,config.TAKER_FEE_RATE,config.MIN_ORDER_EUR)})),
   tradesToday:Number(today),lastSellAt:lastSell?.ts,now:Date.now()
  },{maxPositionPct:policy?.maxPositionPct??config.MAX_POSITION_PCT,
   maxOpenPositions:policy?.maxOpenPositions??config.MAX_OPEN_POSITIONS,
   maxTradesPerDay:policy?.maxEntriesPerDay??config.MAX_TRADES_PER_DAY,
   cooldownMinutes:policy?.cooldownMinutes??config.COIN_COOLDOWN_MINUTES,
   maxPortfolioRiskPct:policy?.maxPortfolioRiskPct??config.MAX_TOTAL_RISK_PCT,
   feeRate:config.TAKER_FEE_RATE});
  if(!finalRisk.allowed||!Number.isFinite(finalRisk.amountEur)||
   finalRisk.amountEur!+1e-7<exactDebit)
   return this.reject(order,'Risikolimits nach Lot-Rundung: '+finalRisk.reason);
  const exposure=(currentPosition?.qty??0)*fill+cost;const entryBid=Number(currentBook.bids[0]?.price);const postEquity=latestValuation.equity!-cost-fee+qty*entryBid;
  const drawdownWhy=entryDrawdownGuard(postEquity,latestAccount.peakEquity,config.MAX_DRAWDOWN_PCT);if(drawdownWhy)return this.reject(order,drawdownWhy);
  if(exposure>postEquity*(policy?.maxPositionPct??config.MAX_POSITION_PCT)+1e-7)return this.reject(order,'Positionslimit nach Kursänderung überschritten');
  const existingRisk=latestValuation.positions.reduce((sum,x)=>sum+positionStopRisk(x.qty,x.bid!,x.stopLossPrice,config.TAKER_FEE_RATE,config.MIN_ORDER_EUR),0);
  const effectiveStop=proposedStop;
  const newRisk=positionStopRisk(qty,fill,effectiveStop,config.TAKER_FEE_RATE,Math.max(config.MIN_ORDER_EUR,p.costmin))+fee;
  if(!Number.isFinite(existingRisk+newRisk)||existingRisk+newRisk>postEquity*(policy?.maxPortfolioRiskPct??config.MAX_TOTAL_RISK_PCT)+1e-7)
   return this.reject(order,'Gesamtes Stop-Risikobudget nach Ausführungskurs überschritten');
  // Last provider approval covers the actual rounded debit including fee.
  if(this.portfolioRiskGuard){
   const verdict=await this.checkedRiskDecision(a.id,order.pair,cost+fee);
   if(!verdict.allowed||verdict.approvedAmount+1e-7<cost+fee)
    return this.reject(order,'Portfolio-RiskEngine nach Lot-Rundung: '+verdict.reasons.join('; '));
  }
  // A provider may be asynchronous: invalidate the quote and account snapshot
  // if either changed while awaiting this final authorization.
  const bookBeforeCommit=this.market.books.get(order.pair);
  if(bookBeforeCommit!==currentBook||!currentBook.valid||
   !Number.isSafeInteger(currentBook.receivedAt)||currentBook.receivedAt>Date.now()||
   Date.now()-currentBook.receivedAt>config.MAX_BOOK_AGE_MS||!this.market.connected||
   Number(currentBook.bids[0]?.price)!==entryBid||
   bookVWAP(currentBook.asks,'buy',qty)!==fill||
   !entryQuoteGuard(Number(currentBook.bids[0]?.price),
    Number(currentBook.asks[0]?.price),entryLimits).allowed)
   return this.reject(order,'Orderbuch vor Persistenz geändert, veraltet oder Feed getrennt');
  const accountBeforeCommit=db.select().from(accounts).where(eq(accounts.id,a.id)).get();
  if(!accountBeforeCommit||accountBeforeCommit.cash!==latestAccount.cash||
   accountBeforeCommit.peakEquity!==latestAccount.peakEquity||accountBeforeCommit.status!==latestAccount.status)
   return this.reject(order,'Konto während abschliessender Risikoprüfung geändert');
  const valuationBeforeCommit=this.valuation(a.id);
  if(valuationBeforeCommit.equity===null||
   valuationBeforeCommit.positions.length!==latestValuation.positions.length||
   valuationBeforeCommit.positions.some((position,index)=>{
    const previous=latestValuation.positions[index];
    return !previous||position.pair!==previous.pair||position.qty!==previous.qty||
     position.bid!==previous.bid||position.value!==previous.value||
     position.stopLossPrice!==previous.stopLossPrice;
   }))
   return this.reject(order,'Positionen oder Bewertung während abschliessender Risikoprüfung geändert');
 }
 const realized=order.side==='sell'&&currentPosition?cost-fee-currentPosition.costBasisEur*(qty/currentPosition.qty):null;
 const record={id:randomUUID(),accountId:a.id,pair:order.pair,side:order.side,qty,fillPrice:fill,costEur:cost,feeEur:fee,midPriceAtDecision:mid,slippageBps:(order.side==='buy'?1:-1)*(fill/mid-1)*10000,latencyMs:Math.round(latency),reason:order.reason,decisionId:order.decisionId,realizedPnlEur:realized,ts:Date.now()};
 const provenance=this.executionProvenance(a.id),positionId=order.side==='buy'?(currentPosition?.id??randomUUID()):currentPosition?.id;
 db.transaction(tx=>{
  tx.insert(trades).values(record).run();
  if(policy)sqlite.prepare('INSERT INTO paper_trade_policy VALUES (?,?,?)').run(record.id,JSON.stringify(policy),record.ts);
  if(provenance.runId&&provenance.strategyVersion&&provenance.universeHash&&provenance.evaluationVersion)tx.insert(tradeProvenance).values({tradeId:record.id,runId:provenance.runId,buildId:provenance.buildId,strategyVersion:provenance.strategyVersion,universeHash:provenance.universeHash,evaluationVersion:provenance.evaluationVersion,verified:provenance.buildVerified,recordedAt:record.ts}).run();
  tx.update(accounts).set({cash:Math.max(0,latestAccount.cash+(order.side==='buy'?-(cost+fee):cost-fee))}).where(eq(accounts.id,a.id)).run();
  if(order.side==='buy'){
   const basis=(currentPosition?.costBasisEur??0)+cost+fee;const total=(currentPosition?.qty??0)+qty;
   const tp=order.takeProfitPct&&order.takeProfitPct>=.03&&order.takeProfitPct<=.4?order.takeProfitPct:undefined;
   recordPositionEntry(sqlite,record,positionId!,currentPosition?'scale-in':'open',order,provenance.evaluationVersion,{stopLossPrice:(a.strategy==='hold'||a.strategy==='dca')?null:proposedStop,takeProfitPrice:currentPosition?.takeProfitPrice??(tp?fill*(1+tp):null),policyFingerprint:policy?.fingerprint??null});
   if(currentPosition)tx.update(positions).set({qty:total,costBasisEur:basis,avgEntryPrice:basis/total,stopLossPrice:(a.strategy==='hold'||a.strategy==='dca')?null:proposedStop,takeProfitPrice:currentPosition.takeProfitPrice??(tp?fill*(1+tp):null)}).where(eq(positions.id,currentPosition.id)).run();
   else tx.insert(positions).values({id:positionId!,accountId:a.id,pair:order.pair,qty,avgEntryPrice:basis/total,costBasisEur:basis,stopLossPrice:(a.strategy==='hold'||a.strategy==='dca')?null:proposedStop,takeProfitPrice:tp?fill*(1+tp):null,openedAt:Date.now()}).run();
  }else if(currentPosition){const remains=currentPosition.qty-qty;if(remains<1e-12)tx.delete(positions).where(eq(positions.id,currentPosition.id)).run();else {const basis=currentPosition.costBasisEur*remains/currentPosition.qty;tx.update(positions).set({qty:remains,costBasisEur:basis,avgEntryPrice:basis/remains}).where(eq(positions.id,currentPosition.id)).run();}}
 });
 this.emit('trade',record);return {ok:true,reason:'Ausgeführt',trade:record};
 }
}
