import {nativeCompletedEntries} from './bracket-lineage.js';
import {PortfolioRiskEngine} from '../risk-engine/engine.js';
import {evaluateNativePortfolioRisk,type NativePortfolioRiskProvider} from './native-portfolio-risk.js';
import {entryPolicyGuard,type TradingPolicy} from '../strategy/trading-policy.js';
import {assertNativePolicyCurrent,nativePolicyLimits,nativeEntryPolicyGuard,nativeEntryBasisAndStop,nativePolicyProtection,type NativePolicyAccess} from './trading-policy.js';
import {checkedBalances,belowNativeQuantity,nativeQuantityStep,nativeQuantityAllowed,nativeNotionalAllowed,limitNotionalAllowed} from './balances.js';
import {ownedNativeOrder,stopCoverage,type NativeOrder} from './protection.js';
import {entryContract,assertNativeList,assertNativeOrder} from './native-contract.js';
import {createHash} from 'node:crypto';
import type {Action} from '@paper/shared';
import type {BinanceSymbol} from '../market/binance-data.js';
import {partialBook} from '../market/binance-data.js';
import {ceilStep,floorStep,plain,addDecimal,compareDecimal,subtractDecimal} from './decimal.js';
import {NativePreSendRejected,type BinanceClient} from './BinanceClient.js';import type {Journal} from './journal.js';

export type LiveLimits={enabled:boolean;acknowledgement:string;quote:string;maxOrderQuote:number;maxPositionPct:number;maxPositions:number;maxTradesPerDay:number;maxDrawdownPct:number;riskPerTradePct:number;maxPortfolioRiskPct?:number;feeReservePct:number;maxSpreadBps:number;maxSlippageBps:number};
type Balance={asset:string;free:string;locked:string};
export type AccountSnapshot={canTrade:boolean;balances:Balance[];equity:number;cash:number;positions:{pair:string;qty:number;qtyText:string;value:number;bid:number;priceAsOf:number;nativeQuantityDust:boolean}[];valuationMethod:string;asOf:number;snapshotCompletedAt:number;policyProtection?:ReturnType<typeof nativePolicyProtection>|null};
const freshAt=(at:number,now:number,maxAge:number)=>Number.isFinite(at)&&at<=now&&now-at<=maxAge;
const idFor=(decisionId:string,pair:string)=>'bot_'+createHash('sha256').update(`${decisionId}:${pair}`).digest('hex').slice(0,24);

/** Separate from the simulator. Buys use an exchange-native bracket with FOK entry.
 * No new order is sent twice after a timeout. No strategy sells cancel native stops.
 */
export class BinanceSpotExecutionAdapter {
 private queue:Promise<unknown>=Promise.resolve();
 private readonly portfolioRiskEngine=new PortfolioRiskEngine();
 private portfolioRiskProvider:NativePortfolioRiskProvider|undefined;
 /** Installs a local-only, read-only history provider once. Never a live-data fetch fallback. */
 setNativePortfolioRiskProvider(provider:NativePortfolioRiskProvider){
  if(this.portfolioRiskProvider)throw Error('Native portfolio risk provider already installed');
  this.portfolioRiskProvider=provider;
 }
 constructor(private client:BinanceClient,private journal:Journal,readonly limits:LiveLimits,private policySource?:NativePolicyAccess){
  if(this.journal.getMeta('nativePortfolioRiskHalt')==='1')
   this.portfolioRiskEngine.restoreHaltFromStore();
 }
 private gate(){if(!this.limits.enabled)throw Error('Private Order-Ausführung deaktiviert');if(this.client.environment==='live'&&this.limits.acknowledgement!=='I_ACCEPT_REAL_MONEY_RISK')throw Error('Echtgeld-Ausführung ist nicht freigeschaltet');}
 async symbols(){return (await this.client.public<{symbols:BinanceSymbol[]}>('/api/v3/exchangeInfo')).symbols;}
 async snapshot(symbols:BinanceSymbol[]):Promise<AccountSnapshot>{
  this.gate();const startedAt=Date.now();const account=await this.client.signed<{canTrade:boolean;balances:Balance[]}>('GET','/api/v3/account',{omitZeroBalances:'true'});
  const balances=checkedBalances(account);
  let equity=0,cash=0;const positions:AccountSnapshot['positions']=[];
  for(const b of balances){const qtyText=addDecimal(b.free,b.locked),qty=Number(qtyText);if(!Number.isFinite(qty)||qty<0)throw Error('Ungültiger Börsensaldo');if(compareDecimal(qtyText,'0')===0)continue;if(b.asset===this.limits.quote){equity+=qty;cash=Number(b.free);continue;}
   const s=symbols.find(s=>s.baseAsset===b.asset&&s.quoteAsset===this.limits.quote&&s.status==='TRADING');
   if(!s)throw Error(`Nicht bewertbarer Vermögenswert ${b.asset}; dediziertes Spot-Konto erforderlich`);
   const priceAsOf=Date.now();const depth=await this.client.public<{bids:string[][];asks:string[][]}>('/api/v3/depth',{symbol:s.symbol,limit:'5'}),book=partialBook(`${s.baseAsset}/${s.quoteAsset}`,depth);if(!book.valid)throw Error('Keine belastbare Bewertung');const bid=Number(book.bids[0]!.price),value=qty*bid;if(!Number.isFinite(value)||value<=0)throw Error('Nicht bewertbarer positiver Börsensaldo');equity+=value;positions.push({pair:`${s.baseAsset}/${s.quoteAsset}`,qty,qtyText,value,bid,priceAsOf,nativeQuantityDust:belowNativeQuantity(qtyText,s)});
  }
  if(!Number.isFinite(equity)||equity<=0)throw Error('Leeres oder ungültiges Spot-Konto');
  const snapshotCompletedAt=Date.now();if(!freshAt(startedAt,snapshotCompletedAt,15000)||positions.some(p=>!freshAt(p.priceAsOf,snapshotCompletedAt,5000)))throw Error('Kontoprüfdaten veraltet oder Zeit zurückgesprungen');
  const previousPeak=Number(this.journal.getMeta('peak')??0);if(!Number.isFinite(previousPeak)||previousPeak<0){this.journal.setMeta('halt','Invalid peak equity metadata');throw Error('Ungültiger persistierter Equity-Höchststand');}
  const peak=Math.max(previousPeak,equity);this.journal.setMeta('peak',String(peak));if((peak-equity)/peak>=this.limits.maxDrawdownPct)this.journal.setMeta('halt','Drawdown limit');
  return {...account,balances,equity,cash,positions,valuationMethod:'All positive assets marked at fresh public top bid, including quantity dust; not a guaranteed liquidation value',asOf:startedAt,snapshotCompletedAt};
 }
 async reconcile(){const task=this.queue.catch(()=>{}).then(()=>this.reconcileIntents());this.queue=task;return task;}
 private async reconcileIntents(){
  this.gate();for(const intent of this.journal.unresolved()){
   if(intent.side!=='buy'||!['pending','unknown'].includes(intent.state)){this.journal.setMeta('halt','Unresolved typed native phase; no entry-list fallback or automatic mutation');continue;}
   try{const contract=entryContract(intent),result=await this.client.signed<any>('GET','/api/v3/orderList',{origClientOrderId:intent.id});assertNativeList(result,contract);this.journal.update(intent.id,'accepted',JSON.stringify(result));}
   catch{this.journal.setMeta('halt','Unresolved order intent; inspect exchange before any reset');}
  }
  return {halt:this.journal.getMeta('halt')??null,unresolved:this.journal.unresolved().length};
 }
 async auditProtection(symbols:BinanceSymbol[]){
  const account=await this.snapshot(symbols);
  const open=await this.client.signed<NativeOrder[]>('GET','/api/v3/openOrders');
  if(!Array.isArray(open)||open.some(order=>!ownedNativeOrder(order,this.journal))){this.journal.setMeta('halt','Foreign or unattributed open order');throw Error('Offene Order ohne bestätigte Journal-Herkunft; neue Einstiege gesperrt');}
  let riskAtStops=0,dustRiskQuote=0;const auditedPositions=[];
  for(const p of account.positions){
   const coverage=stopCoverage(p,open,this.journal);
   const symbol=symbols.find(s=>s.symbol===p.pair.replace('/',''))!;
   if(!coverage.valid||compareDecimal(coverage.quantityText,p.qtyText)>0){this.journal.setMeta('halt',`Invalid native protection ${p.pair}`);throw Error('Native Schutzorder-Menge oder Status widersprüchlich');}
   const residual=subtractDecimal(p.qtyText,coverage.quantityText),unprotected=compareDecimal(residual,'0')>0;
   if(unprotected&&!belowNativeQuantity(residual,symbol)){this.journal.setMeta('halt',`Unprotected or foreign balance ${p.pair}`);throw Error('Live-Bestand ohne bestätigten nativen Stop; neue Einstiege gesperrt');}
   const residualValue=Number(residual)*p.bid,protectedValue=coverage.quantity*p.bid;
   if(!Number.isFinite(residualValue)||!Number.isFinite(protectedValue))throw Error('Native Schutzbewertung nicht endlich');
   const fullResidualRisk=residualValue*(1+this.limits.feeReservePct+this.limits.maxSlippageBps/10000);
   dustRiskQuote+=fullResidualRisk;riskAtStops+=fullResidualRisk+Math.max(0,protectedValue-coverage.stopValue)+protectedValue*(this.limits.feeReservePct+this.limits.maxSlippageBps/10000);
   auditedPositions.push({...p,protectedQty:coverage.quantity,unprotectedResidualQty:residual,unprotectedResidualValue:residualValue});
  }
  if(!Number.isFinite(riskAtStops)||!Number.isFinite(dustRiskQuote)){this.journal.setMeta('halt','Invalid protection risk valuation');throw Error('Gesamtes Schutzrisiko nicht bewertbar');}
  const policyProtection=this.policySource?nativePolicyProtection(account,open,this.journal,symbols,this.policySource.read(),this.limits.feeReservePct):null;
  return {...account,positions:auditedPositions,riskAtStops,dustRiskQuote,policyProtection};
 }
 async place(action:Action,decisionId:string,policyFingerprint?:string){const task=this.queue.catch(()=>{}).then(()=>this.execute(action,decisionId,policyFingerprint));this.queue=task;return task;}
 private async confirmBracket(id:string,symbol:string,symbols:BinanceSymbol[]):Promise<'protected'|'not_filled'|'closed'|'unconfirmed'>{
  // Read-only bounded polling handles asynchronous contingent-order activation.
  for(let attempt=0;attempt<3;attempt++){
   if(attempt)await new Promise(resolve=>setTimeout(resolve,attempt===1?250:750));
   try{
    const intent=this.journal.get(id)!,contract=entryContract(intent),ack=JSON.parse(intent.result),list=assertNativeList(ack,contract);
    const record=(status:'not_filled'|'closed'|'protected',observations:unknown)=>{this.journal.update(id,'accepted',JSON.stringify({...ack,nativeConfirmation:{kind:'native-order-observations-v1',status,recordedAt:Date.now(),observations,exchangeOutcomeAttested:false}}));return status;};
    const entry=await this.client.signed<any>('GET','/api/v3/order',{symbol,origClientOrderId:id+'_e'});assertNativeOrder(entry,list,contract.children[0]!);
    if(['EXPIRED','EXPIRED_IN_MATCH','CANCELED','REJECTED'].includes(entry.status)&&Number(entry.executedQty)===0)return record('not_filled',{entry});
    if(entry.status!=='FILLED'||Number(entry.executedQty)<=0)continue;
    const [stop,target]=await Promise.all(['_s','_t'].map(suffix=>this.client.signed<any>('GET','/api/v3/order',{symbol,origClientOrderId:id+suffix})));
    assertNativeOrder(stop,list,contract.children[1]!);assertNativeOrder(target,list,contract.children[2]!);
    if(stop.status==='NEW'&&target.status==='NEW'&&compareDecimal(stop.origQty,target.origQty)!==0)continue;
    if(stop.status==='FILLED'||target.status==='FILLED'){
     const account=await this.snapshot(symbols);if(account.positions.some(p=>p.pair.replace('/','')===symbol&&!p.nativeQuantityDust))continue;
     const audit=await this.auditProtection(symbols);return record('closed',{entry,stop,target,account:audit});
    }
    if(stop.status==='NEW'&&stop.type==='STOP_LOSS'&&target.status==='NEW'&&target.type==='TAKE_PROFIT'&&Number(stop.origQty)>0&&Number(target.origQty)>0&&Number(stop.stopPrice)>0){const audit=await this.auditProtection(symbols);return record('protected',{entry,stop,target,account:audit});}
   }catch{/* Read failure is never a reason to resubmit an order. */}
  }
  return 'unconfirmed';
 }
 private async execute(action:Action,decisionId:string,policyFingerprint?:string):Promise<{ok:boolean;reason:string;result?:unknown}>{
  this.gate();if(action.type==='hold')return {ok:true,reason:'Hold'};
  // Leaving a native bracket in place is safer than opening a cancel/sell race.
  if(action.type==='sell')return {ok:false,reason:'Live-Verkäufe erfolgen durch native Stop-/Zielorders. Modell-Verkäufe sind derzeit gesperrt.'};
  if(this.journal.getMeta('halt')||this.journal.unresolved().length)return {ok:false,reason:'Live-Kill-Switch oder ungeklärte Order aktiv'};
  const id=idFor(decisionId,action.pair),old=this.journal.get(id);if(old)return {ok:['accepted','not_filled','closed'].includes(old.state),reason:`Bereits verarbeitet: ${old.state}`};
  if(!this.policySource||!policyFingerprint)return {ok:false,reason:'Native Trading-Policy und Entscheidungs-Pin fehlen; kein Einstieg'};
  let policy:TradingPolicy;try{policy=assertNativePolicyCurrent(this.policySource,policyFingerprint);}catch{return {ok:false,reason:'Native Trading-Policy fehlt oder wurde geändert; neue Entscheidung erforderlich'};}
  const limits=nativePolicyLimits(this.limits,policy);
  const earlyConfidence=entryPolicyGuard(policy,{revision:policy.revision,confidence:action.confidence,now:Date.now()});if(earlyConfidence)return {ok:false,reason:earlyConfidence};
  const symbols=await this.symbols(),symbol=symbols.find(s=>`${s.baseAsset}/${s.quoteAsset}`===action.pair);
  if(!symbol||symbol.status!=='TRADING'||symbol.quoteAsset!==this.limits.quote||symbol.isSpotTradingAllowed===false||!symbol.ocoAllowed||!symbol.otoAllowed||!symbol.opoAllowed||!['LIMIT','STOP_LOSS','TAKE_PROFIT'].every(t=>symbol.orderTypes.includes(t)))return {ok:false,reason:'Spot-Paar unterstützt die benötigte native OPOCO-Schutzorder nicht'};
  const completed=nativeCompletedEntries(this.journal);
  const predecessors=this.journal.recent(0).filter(i=>i.side==='buy'&&i.pair===action.pair&&i.state==='accepted'&&!completed[i.id]);
  if(predecessors.length>32)return {ok:false,reason:'Zu viele ungeklärte native Vorgänger; kein automatischer Einstieg'};
  for(const previous of predecessors){const result=await this.confirmBracket(previous.id,symbol.symbol,symbols);if(result==='closed'||result==='not_filled')this.journal.update(previous.id,result==='closed'?'closed':'not_filled',this.journal.get(previous.id)!.result);}
  const activity=nativeEntryPolicyGuard(policy,limits,this.journal,action.pair,action.confidence);if(activity)return {ok:false,reason:activity};
  const account=await this.auditProtection(symbols);if(account.policyProtection?.matches===false)return {ok:false,reason:'Gewählte Verlustlinie ist für bestehende native Schutzorders noch nicht bestätigt; keine neuen Einstiege'};if(this.journal.getMeta('halt'))return {ok:false,reason:'Drawdown-Kill-Switch'};
  if(account.positions.some(p=>p.pair===action.pair))return {ok:false,reason:'Keine Aufstockung bestehender Live-Positionen'};
  if(account.positions.filter(p=>!p.nativeQuantityDust).length>=limits.maxPositions)return {ok:false,reason:'Positionsanzahl erreicht'};
  const open=await this.client.signed<{clientOrderId:string;symbol:string;side:string;type:string}[]>('GET','/api/v3/openOrders');
  if(open.some(o=>!ownedNativeOrder(o,this.journal)))return {ok:false,reason:'Fremde offene Orders; dediziertes Spot-Konto erforderlich'};
  // A pending buy reserves risk even before it becomes a balance.
  if(open.some(o=>o.side==='BUY'))return {ok:false,reason:'Noch offene Einstiegsorder'};
  const stop=Math.min(action.stopLossPct,policy.stopLossPct),target=action.takeProfitPct??.10;
  if(!Number.isFinite(action.amountEur)||action.amountEur<=0||!Number.isFinite(action.stopLossPct)||action.stopLossPct<.02||action.stopLossPct>.15||!Number.isFinite(stop)||stop<.02||stop>.15||!Number.isFinite(target)||target<.03||target>.4)return {ok:false,reason:'Ungültige Aktion'};
  const asOf=Date.now();const depth=await this.client.public<{bids:string[][];asks:string[][]}>('/api/v3/depth',{symbol:symbol.symbol,limit:'20'});const book=partialBook(action.pair,depth);if(!book.valid)return {ok:false,reason:'Ungültiges Orderbuch'};
  const bid=Number(book.bids[0]!.price),ask=Number(book.asks[0]!.price),spread=(ask/bid-1)*10000;
  if(spread>limits.maxSpreadBps)return {ok:false,reason:'Spread zu gross'};
  const priceFilter=symbol.filters.find(f=>f.filterType==='PRICE_FILTER'),lot=symbol.filters.find(f=>f.filterType==='LOT_SIZE');
  if(!priceFilter?.tickSize||!lot?.stepSize)return {ok:false,reason:'Börsenfilter fehlen'};
  const price=ceilStep(plain(ask*(1+limits.maxSlippageBps/10000)),priceFilter.tickSize);
  const quantum=nativeQuantityStep(symbol),roundingRiskReserve=Number(quantum)*Number(price)*(1+this.limits.feeReservePct+limits.maxSlippageBps/10000);if(!Number.isFinite(roundingRiskReserve)||roundingRiskReserve<=0)return {ok:false,reason:'Native Mengenrundung nicht bewertbar'};
  const riskFraction=stop+2*this.limits.feeReservePct+limits.maxSlippageBps/10000;
  const remainingRisk=account.equity*(limits.maxPortfolioRiskPct??.025)-account.riskAtStops;
  const riskBudget=Math.max(0,Math.min(account.equity*this.limits.riskPerTradePct,remainingRisk)-roundingRiskReserve)/riskFraction;
  const preRiskBudget=Math.min(action.amountEur,this.limits.maxOrderQuote,account.cash,account.equity*limits.maxPositionPct,riskBudget);
  // The shared Paper/Backtest engine is mandatory for native buys, even in
  // isolated testnet fixtures. No history provider -> no entry authorization.
  const portfolioRiskAt=Date.now();
  let risk;
  try{
   const observations=this.portfolioRiskProvider?.(
    [...new Set([action.pair,...account.positions.map(p=>p.pair)])],portfolioRiskAt)??null;
   risk=evaluateNativePortfolioRisk(this.portfolioRiskEngine,account,
    Number(this.journal.getMeta('peak')),action.pair,preRiskBudget,portfolioRiskAt,observations);
  }catch{
   return {ok:false,reason:'Native Portfolio-RiskEngine: provider unavailable; keine neuen Einstiege'};
  }
  this.journal.setMeta('nativePortfolioRiskLast',JSON.stringify({
   at:portfolioRiskAt,pair:action.pair,allowed:risk.allowed,
   approvedAmount:risk.approvedAmount,status:risk.status,reasons:risk.reasons
  }));
  if(this.portfolioRiskEngine.halted){
   this.journal.setMeta('nativePortfolioRiskHalt','1');
   this.journal.setMeta('halt','Portfolio-RiskEngine hard stop; manual local review required');
  }
  if(!risk.allowed||!Number.isFinite(risk.approvedAmount)||risk.approvedAmount<=0)
   return {ok:false,reason:'Native Portfolio-RiskEngine: '+risk.reasons.join('; ')};
  const budget=Math.min(preRiskBudget,risk.approvedAmount);
  const qty=floorStep(plain(budget/(Number(price)*(1+this.limits.feeReservePct))),lot.stepSize),quantity=Number(qty),cost=quantity*Number(price);
  const entryBasis=nativeEntryBasisAndStop(price,stop,this.limits.feeReservePct,priceFilter.tickSize),stopPrice=entryBasis.stopPrice,targetPrice=ceilStep(plain(Number(price)*(1+target)),priceFilter.tickSize);
  const conservativePending=floorStep(plain(quantity*(1-this.limits.feeReservePct)),quantum);
  if(!nativeQuantityAllowed(conservativePending,symbol)||!nativeNotionalAllowed(Number(conservativePending),Number(stopPrice),symbol)||!nativeNotionalAllowed(Number(conservativePending),Number(targetPrice),symbol))return {ok:false,reason:'Netto-Schutzmenge nach Gebühren/Rundung verletzt native Filter'};
  if(quantity<=0||quantity<Number(lot.minQty)||quantity>Number(lot.maxQty)||Number(stopPrice)>=bid||Number(targetPrice)<=ask||Number(stopPrice)<=0||!limitNotionalAllowed(quantity,Number(price),symbol)||cost*(1+this.limits.feeReservePct)>account.cash)return {ok:false,reason:'Menge, Preis oder Schutzorder verletzt Börsenfilter/Budget'};
  if(account.equity-account.cash+cost>account.equity*limits.maxPositionPct*limits.maxPositions)return {ok:false,reason:'Gesamtexponierung überschritten'};
  const preparedAt=Date.now();if(!freshAt(asOf,preparedAt,2000)||!freshAt(account.asOf,preparedAt,15000)||account.positions.some(p=>!freshAt(p.priceAsOf,preparedAt,5000)))return {ok:false,reason:'Prüfdaten während Vorbereitung veraltet'};
  const params={symbol:symbol.symbol,listClientOrderId:id,workingClientOrderId:id+'_e',workingType:'LIMIT',workingSide:'BUY',workingPrice:price,workingQuantity:qty,workingTimeInForce:'FOK',pendingSide:'SELL',pendingAboveType:'TAKE_PROFIT',pendingAboveStopPrice:targetPrice,pendingAboveClientOrderId:id+'_t',pendingBelowType:'STOP_LOSS',pendingBelowStopPrice:stopPrice,pendingBelowClientOrderId:id+'_s',newOrderRespType:'FULL'};
  // FULL synchronous commit BEFORE network I/O; a crash cannot silently retry.
  this.journal.put({id,pair:action.pair,side:'buy',state:'pending',createdAt:Date.now(),payload:JSON.stringify({...params,_policy:{format:'native-entry-policy-v1',policy,effectiveLimits:limits,feeReservePct:this.limits.feeReservePct,selectedStopLossPct:policy.stopLossPct,appliedStopLossPct:stop,entryBasis}}),result:''});
  let result:any;
  try{result=await this.client.signed<any>('POST','/api/v3/orderList/opoco',params,()=>{assertNativePolicyCurrent(this.policySource!,policyFingerprint!);const activity=nativeEntryPolicyGuard(policy,limits,this.journal,action.pair,action.confidence,Date.now(),id);if(activity)throw Error(activity);const sendAt=Date.now();if(!freshAt(asOf,sendAt,2000)||!freshAt(account.asOf,sendAt,15000)||account.positions.some(p=>!freshAt(p.priceAsOf,sendAt,5000))||sendAt-portfolioRiskAt>this.portfolioRiskEngine.limits.maxFeedAgeMs||this.portfolioRiskEngine.halted)throw Error('Native pre-send data stale');});assertNativeList(result,entryContract(this.journal.get(id)!));this.journal.update(id,'accepted',JSON.stringify(result));}
  catch(error){if(error instanceof NativePreSendRejected){this.journal.update(id,'rejected','Not submitted: final policy/activity/freshness checks rejected before network mutation');return {ok:false,reason:'Policy oder Prüfdaten nach Journal-Commit/Zeitabgleich geändert/veraltet; keine Order gesendet.'};}this.journal.update(id,'unknown','Response unavailable or rejected; reconciliation required');this.journal.setMeta('halt','Unknown order outcome; no retry');return {ok:false,reason:'Orderstatus ungeklärt; Live-Kill-Switch gesetzt. Keine Wiederholung.'};}
  const confirmation=await this.confirmBracket(id,symbol.symbol,symbols);
  if(confirmation==='unconfirmed'){this.journal.setMeta('halt','Native protection unconfirmed; inspect accepted order before reset');return {ok:false,reason:'Order angenommen, Schutzstatus nicht bestätigt; weitere Einstiege gesperrt.',result};}
  if(confirmation==='not_filled')this.journal.update(id,'not_filled',this.journal.get(id)!.result);
  if(confirmation==='closed')this.journal.update(id,'closed',this.journal.get(id)!.result);
  return {ok:true,reason:confirmation==='protected'?'Einstieg gefüllt und native Schutzorders bestätigt':confirmation==='closed'?'Position bereits durch native Schutzorder geschlossen':'FOK-Einstieg nicht gefüllt; keine neue Position',result};
 }
}
