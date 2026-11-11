import {resolveNativeBracket,nativeCompletedEntries} from './bracket-lineage.js';
import {assertNativeCaptureFresh,type NativeCapture} from './context-capture.js';
import Database from 'better-sqlite3';
import {isAbsolute,resolve,dirname} from 'node:path';import {lstatSync} from 'node:fs';
import {TradingPolicyStore,entryPolicyGuard,type TradingPolicy,type HardLimits} from '../strategy/trading-policy.js';
import type {LiveLimits,AccountSnapshot} from './BinanceSpotExecutionAdapter.js';import type {Journal,Intent} from './journal.js';import type {NativeOrder} from './protection.js';
import {entryContract,assertNativeList,assertNativeOrder} from './native-contract.js';
import {addDecimal,subtractDecimal,numberDecimal,multiplyToStep,compareDecimal} from './decimal.js';import type {BinanceSymbol} from '../market/binance-data.js';
export interface NativePolicyAccess{read():TradingPolicy;}
function regularPath(file:string){let at=resolve(file);for(;;){const stat=lstatSync(at);if(stat.isSymbolicLink())throw Error('Native policy source may not use links');const parent=dirname(at);if(parent===at)break;at=parent;}}
/** Fresh read-only connection per check: never creates a paper DB or modifies account state. */
export class DashboardNativePolicy implements NativePolicyAccess{
 constructor(private file:string,private hard:HardLimits,private quote:string){if(!isAbsolute(file)||!['EUR','USDT','USDC'].includes(quote))throw Error('Invalid native policy source');}
 read(){regularPath(this.file);const db=new Database(this.file,{readonly:true,fileMustExist:true,timeout:500});try{return db.transaction(()=>{
  const identity=db.prepare('SELECT venue_quote FROM database_identity WHERE id=1').get() as {venue_quote:string}|undefined;if(identity?.venue_quote!==`binance:${this.quote}`)throw Error('Native policy venue/quote mismatch');
  const policy=new TradingPolicyStore(db,this.hard).get('ai');if(!policy||policy.updatedAt!==null&&(!Number.isSafeInteger(policy.updatedAt)||policy.updatedAt<0||policy.updatedAt>Date.now()))throw Error('Native policy missing or future dated');
  if(policy.revision>0){const row=db.prepare('SELECT policy_json FROM trading_policy_changes WHERE account_id=? AND revision=?').get('ai',policy.revision) as {policy_json:string}|undefined;if(!row)throw Error('Native policy audit missing');const original=JSON.parse(row.policy_json);for(const k of ['mode','stopLossPct','revision','updatedAt'] as const)if(original[k]!==policy[k])throw Error('Native policy audit mismatch');}
  return policy;
 })();}finally{db.close();}}
}
export function assertNativePolicyCurrent(source:NativePolicyAccess,expected:string){const current=source.read();if(!/^[a-f0-9]{64}$/.test(expected)||current.fingerprint!==expected)throw Error('Native Trading-Modus geändert; neue Entscheidung erforderlich');return current;}
/** Policy file I/O happens first; price/account freshness is the final model-call guard. */
export function assertNativeModelInput(capture:NativeCapture,source:NativePolicyAccess,expected:string,now:()=>number=Date.now){assertNativePolicyCurrent(source,expected);assertNativeCaptureFresh(capture,now());}
export function nativePolicyLimits(hard:LiveLimits,policy:TradingPolicy){
 const result={...hard,maxPositionPct:Math.min(hard.maxPositionPct,policy.maxPositionPct),maxPositions:Math.min(hard.maxPositions,policy.maxOpenPositions),maxPortfolioRiskPct:Math.min(hard.maxPortfolioRiskPct??.025,policy.maxPortfolioRiskPct),maxSpreadBps:Math.min(hard.maxSpreadBps,policy.maxSpreadBps),maxSlippageBps:Math.min(hard.maxSlippageBps,policy.maxSlippageBps)};
 if(![result.maxPositionPct,result.maxPositions,result.maxPortfolioRiskPct,result.maxSpreadBps,result.maxSlippageBps,hard.maxTradesPerDay].every(n=>Number.isFinite(n)&&n>0)||!Number.isInteger(result.maxPositions)||!Number.isInteger(hard.maxTradesPerDay))throw Error('Invalid native risk policy limits');
 return {...result,maxEntryAttemptsPerDay:Math.min(policy.maxEntriesPerDay,Math.max(1,Math.floor(hard.maxTradesPerDay/2))),minEntryMinutes:policy.minEntryMinutes,cooldownMinutes:policy.cooldownMinutes,minConfidence:policy.minConfidence};
}
export type NativePolicyLimits=ReturnType<typeof nativePolicyLimits>;
export function nativeEntryBasisAndStop(price:string,stopLossPct:number,feeReservePct:number,tick:string){
 if(!Number.isFinite(stopLossPct)||stopLossPct<.02||stopLossPct>.15||!Number.isFinite(feeReservePct)||feeReservePct<0||feeReservePct>.05)throw Error('Invalid native policy stop');
 const basis=multiplyToStep(price,addDecimal('1',numberDecimal(feeReservePct)),tick,true),stopPrice=multiplyToStep(basis,subtractDecimal('1',numberDecimal(stopLossPct)),tick,true);
 return {basis,stopPrice,definition:'Working-limit price plus fee reserve rounded upward, then stop rounded upward. Conservative estimate; actual fill/commission basis unverified.'};
}
/** Returns a conservative observation time, never an invented exchange fill timestamp. */
export function nativeObservedExitAt(intent:Intent,now:number):number|null{
 try{const ack=JSON.parse(intent.result),r=ack.nativeConfirmation;if(intent.state!=='closed'||r?.kind!=='native-order-observations-v1'||r.status!=='closed'||!Number.isSafeInteger(r.recordedAt)||r.recordedAt<intent.createdAt||r.recordedAt>now)return null;
  const contract=entryContract(intent),list=assertNativeList(ack,contract),entry=assertNativeOrder(r.observations?.entry,list,contract.children[0]!),stop=assertNativeOrder(r.observations?.stop,list,contract.children[1]!),target=assertNativeOrder(r.observations?.target,list,contract.children[2]!);
  if(entry.status!=='FILLED'||stop.status!=='FILLED'&&target.status!=='FILLED')return null;return r.recordedAt;
 }catch{return null;}
}
export function nativePolicyActivity(journal:Journal,now=Date.now(),excludeId?:string){
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid native policy activity clock');const rows=journal.recent(0).filter(i=>i.side==='buy'&&i.state!=='rejected'&&i.id!==excludeId);if(rows.length>10000)throw Error('Native policy activity bound exceeded');
 const completedEntries=nativeCompletedEntries(journal,now);
 const futureOrInvalid=rows.some(i=>!Number.isSafeInteger(i.createdAt)||i.createdAt<0||i.createdAt>now),valid=rows.filter(i=>Number.isSafeInteger(i.createdAt)&&i.createdAt>=0&&i.createdAt<=now),midnight=Math.floor(now/86400000)*86400000,lastAttemptAt=valid.length?Math.max(...valid.map(i=>i.createdAt)):null,observedExits:Record<string,number>={},unprovenClosedPairs=new Set<string>();
 for(const proof of Object.values(completedEntries))observedExits[proof.pair]=Math.max(observedExits[proof.pair]??0,proof.recordedAt);
 for(const row of valid.filter(i=>i.state==='closed'&&!completedEntries[i.id])){const at=nativeObservedExitAt(row,now);if(at===null)unprovenClosedPairs.add(row.pair);else observedExits[row.pair]=Math.max(observedExits[row.pair]??0,at);}
 return {kind:'native-entry-activity-v1',asOf:now,utcDayStart:midnight,entryAttemptsToday:valid.filter(i=>i.createdAt>=midnight).length,lastAttemptAt,observedExits,completedEntries,unprovenClosedPairs:[...unprovenClosedPairs].sort(),futureOrInvalid,scope:'Native non-rejected intent attempts, including no-fill/unknown outcomes; not fills, fees or profit. Exit times are conservative validated observation times, never reconstructed exchange execution timestamps.'};
}
export function nativeEntryPolicyGuard(policy:TradingPolicy,limits:NativePolicyLimits,journal:Journal,pair:string,confidence:number,now=Date.now(),excludeId?:string){
 const activity=nativePolicyActivity(journal,now,excludeId);if(activity.futureOrInvalid)return 'Native Handelshistorie hat ungültige Zukunftszeiten';
 const why=entryPolicyGuard(policy,{revision:policy.revision,confidence,lastEntryAt:activity.lastAttemptAt??undefined,now});if(why)return why;
 if(activity.entryAttemptsToday>=limits.maxEntryAttemptsPerDay)return 'Natives Tageslimit für Einstiegsversuche erreicht (Ein-/Ausstiegsreserve)';
 const rows=journal.recent(0).filter(i=>i.side==='buy'&&i.state!=='rejected'&&i.id!==excludeId);
 for(const row of rows.filter(i=>i.pair===pair)){
  if(!['not_filled','closed'].includes(row.state)&&!activity.completedEntries[row.id])return 'Vorheriger nativer Einstieg/Ausstieg nicht abschliessend bestätigt';
  if(row.state==='closed'||activity.completedEntries[row.id]){const at=activity.completedEntries[row.id]?.recordedAt??nativeObservedExitAt(row,now);if(at===null)return 'Native Ausstiegszeit nicht belastbar belegt';if(now-at<limits.cooldownMinutes*60000)return 'Native Cooldown nach beobachtetem Verkauf';}
 }
 return null;
}
export function nativePolicyProtection(account:AccountSnapshot,open:NativeOrder[],journal:Journal,symbols:BinanceSymbol[],policy:TradingPolicy,feeReservePct:number){
 const pending:{pair:string;clientOrderId:string;currentStop:string|null;requiredEstimatedStop:string|null;reason?:string}[]=[];
 for(const order of open){if(order.side!=='SELL'||order.type!=='STOP_LOSS')continue;const position=account.positions.find(p=>p.pair.replace('/','')===order.symbol);if(!position)continue;
  try{const intent=journal.get(order.clientOrderId.slice(0,-2));if(!intent)throw Error('Native policy protection origin missing');const basis=intent.side==='sell'?resolveNativeBracket(intent.id,journal,account.snapshotCompletedAt).root:intent,p=JSON.parse(basis.payload),symbol=symbols.find(s=>s.symbol===order.symbol),tick=symbol?.filters.find(f=>f.filterType==='PRICE_FILTER')?.tickSize;if(!tick||typeof order.stopPrice!=='string')throw Error('Native policy protection price unknown');
   const originalFee=p._policy?.feeReservePct;const fee=typeof originalFee==='number'&&Number.isFinite(originalFee)?Math.max(originalFee,feeReservePct):feeReservePct;
   const required=nativeEntryBasisAndStop(p.workingPrice,policy.stopLossPct,fee,tick);if(compareDecimal(order.stopPrice,required.stopPrice)<0)pending.push({pair:position.pair,clientOrderId:order.clientOrderId,currentStop:order.stopPrice,requiredEstimatedStop:required.stopPrice});
  }catch{pending.push({pair:position.pair,clientOrderId:order.clientOrderId,currentStop:order.stopPrice??null,requiredEstimatedStop:null,reason:'entry-basis-unavailable'});}
 }
 return {matches:pending.length===0,policyFingerprint:policy.fingerprint,pending,scope:'Existing exchange stops are never canceled or loosened by this bridge. A tighter selected estimate blocks new entries/model calls until a verified native replacement driver exists; actual fill/fees are not a verified ledger.'};
}
