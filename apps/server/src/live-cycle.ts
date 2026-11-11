import {DashboardNativePolicy,assertNativePolicyCurrent,assertNativeModelInput,nativePolicyLimits,nativePolicyActivity} from './live/trading-policy.js';
import {NativeHistoryStore} from './live/history-store.js';import {NativePublicHistory} from './live/public-history.js';
import {externalContext} from './context/external.js';
import {nativeIntentContext} from './live/intent-context.js';
import {captureNativeContext,assertNativeCaptureFresh} from './live/context-capture.js';
import {createHash,randomUUID} from 'node:crypto';import {resolve,dirname} from 'node:path';import {mkdirSync,openSync,closeSync,unlinkSync,writeFileSync} from 'node:fs';
import {config,projectRoot} from './config.js';
import {BinanceClient} from './live/BinanceClient.js';import {BinanceSpotExecutionAdapter,type LiveLimits} from './live/BinanceSpotExecutionAdapter.js';import {SqliteJournal} from './live/journal.js';
import {marketContext} from './context/market-context.js';
import {CompatibleDecisionProvider} from './ai/CompatibleDecisionProvider.js';import type {DecisionContext} from '@paper/shared';

/** Explicit one-cycle entry point, deliberately separate from the paper dashboard. */
async function main(){
 if(process.env.LIVE_ENABLED!=='true'){console.log('Live/Testnet deaktiviert. Keine privaten Börsen- oder Modellanfragen.');return;}
 if(config.EXCHANGE!=='binance')throw Error('Live-Ausführung erfordert EXCHANGE=binance');
 const network=process.env.LIVE_NETWORK??'testnet';if(network!=='testnet'&&network!=='live')throw Error('LIVE_NETWORK muss testnet oder live sein');
 if(network==='live'&&process.env.LIVE_ACK!=='I_ACCEPT_REAL_MONEY_RISK')throw Error('Echtgeld-Modus nicht freigeschaltet');
 const key=process.env.BINANCE_API_KEY??'',secret=process.env.BINANCE_API_SECRET??'';if(!key||!secret)throw Error('Börsenschlüssel fehlen. Es werden keine Schlüssel angelegt.');
 const number=(key:string,fallback:number,min:number,max:number)=>{const value=Number(process.env[key]??fallback);if(!Number.isFinite(value)||value<min||value>max)throw Error(`Ungültiges Limit ${key}`);return value;};
 const fingerprint=createHash('sha256').update(key).digest('hex').slice(0,12),base=resolve(projectRoot,`data/${network}-${config.QUOTE_CURRENCY.toLowerCase()}-${fingerprint}`);mkdirSync(dirname(base),{recursive:true});
 const lock=base+'.lock';const fd=openSync(lock,'wx');writeFileSync(fd,String(process.pid));
 let journal:SqliteJournal|undefined,historyStore:NativeHistoryStore|undefined;
 try{
  journal=new SqliteJournal(base+'.db',`${network}:${config.QUOTE_CURRENCY}:${fingerprint}`);
  const client=new BinanceClient(network,key,secret);
  const limits:LiveLimits={enabled:true,acknowledgement:process.env.LIVE_ACK??'',quote:config.QUOTE_CURRENCY,maxOrderQuote:number('LIVE_MAX_ORDER_QUOTE',10,1,100000),maxPositionPct:config.MAX_POSITION_PCT,maxPositions:config.MAX_OPEN_POSITIONS,maxTradesPerDay:config.MAX_TRADES_PER_DAY,maxDrawdownPct:number('LIVE_MAX_DRAWDOWN_PCT',.10,.01,.25),maxPortfolioRiskPct:config.MAX_TOTAL_RISK_PCT,riskPerTradePct:number('LIVE_RISK_PER_TRADE_PCT',.005,.0001,.01),feeReservePct:number('LIVE_FEE_RESERVE_PCT',.005,.001,.05),maxSpreadBps:number('LIVE_MAX_SPREAD_BPS',20,1,100),maxSlippageBps:number('LIVE_MAX_SLIPPAGE_BPS',10,1,100)};
  const policySource=new DashboardNativePolicy(resolve(projectRoot,config.DATABASE_PATH),config,config.QUOTE_CURRENCY),policy=policySource.read(),effectiveLimits=nativePolicyLimits(limits,policy);
  const broker=new BinanceSpotExecutionAdapter(client,journal,limits,policySource);const state=await broker.reconcile();if(state.halt)throw Error('Live-Journal ist gesperrt; Orderstatus am Börsenkonto prüfen.');
  const earlyCycle=Math.floor(Date.now()/(config.DECISION_INTERVAL_MINUTES*60000));if(journal.getMeta('lastCycle')===String(earlyCycle)){console.log('Zyklus bereits verarbeitet.');return;}
  const symbols=await broker.symbols(),initialAccount=await broker.auditProtection(symbols);
  historyStore=new NativeHistoryStore(resolve(projectRoot,'data/native-public-history'),network,config.QUOTE_CURRENCY);
  const history=new NativePublicHistory(client,historyStore);
  const capture=await captureNativeContext({source:client,network,quote:config.QUOTE_CURRENCY,top:config.TOP_N_PAIRS,symbols,initialAccount,history,auditAccount:()=>broker.auditProtection(symbols),beforeFinalReads:()=>externalContext.refresh(config.CONTEXT_EXTERNAL_ENABLED)});
  const {inputs,account}=capture,now=capture.asOf,cycle=Math.floor(now/(config.DECISION_INTERVAL_MINUTES*60000)),decisionId=`${network}:${config.QUOTE_CURRENCY}:${cycle}`;
  if(journal.getMeta('lastCycle')===String(cycle)){console.log('Zyklus bereits verarbeitet.');return;}
  const context:DecisionContext={tradingPolicy:policy,externalContext:externalContext.snapshot(),timeUTC:new Date(now).toISOString(),timeZurich:new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',dateStyle:'short',timeStyle:'medium'}).format(now),account:{...account,status:journal.getMeta('halt')?'paused':'active'},positions:account.positions,features:inputs.flatMap(i=>i.feature&&now-(i.feature.ts+900000)<20*60000?[i.feature]:[]),recentTrades:[],limits:{MAX_POSITION_PCT:effectiveLimits.maxPositionPct,MAX_TOTAL_RISK_PCT:effectiveLimits.maxPortfolioRiskPct??.025,MAX_ENTRY_SPREAD_BPS:effectiveLimits.maxSpreadBps,MAX_ENTRY_SLIPPAGE_BPS:effectiveLimits.maxSlippageBps,NOMINAL_RISK_PER_TRADE_PCT:limits.riskPerTradePct,FEE_RESERVE_PCT:limits.feeReservePct,MAX_OPEN_POSITIONS:effectiveLimits.maxPositions,MAX_TRADES_PER_DAY:effectiveLimits.maxEntryAttemptsPerDay,MIN_ENTRY_MINUTES:effectiveLimits.minEntryMinutes,COOLDOWN_MINUTES:effectiveLimits.cooldownMinutes,MIN_ORDER_EUR:config.MIN_ORDER_EUR,TAKER_FEE_RATE:limits.feeReservePct,MAX_DRAWDOWN_PCT:limits.maxDrawdownPct,MAX_ORDER_QUOTE:limits.maxOrderQuote},memory:[],lessons:[],marketContext:marketContext(inputs,`binance-${network}`,config.QUOTE_CURRENCY,now),execution:{nativePolicy:{source:'Read-only dashboard AI preferences; separate native account/journal',policyFingerprint:policy.fingerprint,effectiveLimits,activity:nativePolicyActivity(journal,now),stopBasis:'Conservative working-limit estimate plus fee reserve, upward tick rounding; actual fill/fees unverified',existingProtection:account.policyProtection,newEntriesOnly:true},publicCapture:capture.quality,mode:network,quoteCurrency:config.QUOTE_CURRENCY,nativeOrderHistory:nativeIntentContext(journal.recent(now-7*86400000),now),valuationPolicy:'All positive assets included. Only provably sub-quantity native remainders may lack a stop; their full marked value plus buffers consumes portfolio risk. Current bid alone cannot prove a market-notional exemption.',exitPolicy:'Only native exchange stop-loss / take-profit exits; discretionary model sells are unavailable.',riskLimits:limits,missing:['Native intents are not a verified fills/commissions ledger. No live memory yet; paper memories are isolated.','Testnet prices/liquidity are not production fills.','Fee reserve is an estimate, not a verified account/symbol commission. No automatic same-asset dust consolidation.']}};
  const evidenceRoot=base+'-decisions';mkdirSync(evidenceRoot,{recursive:true});const attempt=resolve(evidenceRoot,`${cycle}-${Date.now()}-${randomUUID()}`);writeFileSync(attempt+'-context.json',JSON.stringify(context,null,2),{flag:'wx'});
  writeFileSync(base+'-context.json',JSON.stringify(context,null,2));
  if(!config.AI_ENABLED||config.AI_PROVIDER!=='openai-compatible'){console.log('Kontext gespeichert. KI inaktiv; keine Orders.');return;}
  assertNativePolicyCurrent(policySource,policy.fingerprint);if(account.policyProtection?.matches===false)throw Error('Native Verlustlinie wartet auf verifizierten Schutzorder-Austausch; kein Modellaufruf');
  if(!capture.quality.readyForModel)throw Error('Native Eingabe unvollständig/veraltet; kein KI-Aufruf');
  assertNativeModelInput(capture,policySource,policy.fingerprint);
  journal.setMeta('lastCycle',String(cycle));
  const model=new CompatibleDecisionProvider({enabled:true,baseUrl:config.AI_BASE_URL,model:config.AI_MODEL,apiKey:config.AI_API_KEY,allowRemote:config.AI_ALLOW_REMOTE,maxChars:config.AI_MAX_CONTEXT_CHARS,maxOutputTokens:config.AI_MAX_OUTPUT_TOKENS,mode:config.AI_MODEL_MODE,expectedFingerprint:config.AI_EXPECTED_MODEL_FINGERPRINT,contextTokens:config.AI_CONTEXT_TOKENS,onPrepared:input=>{writeFileSync(attempt+'-model-input.json',JSON.stringify(input.context,null,2),{flag:'wx'});writeFileSync(attempt+'-transmission.json',JSON.stringify({systemPrompt:input.systemPrompt,userPrompt:input.userPrompt,evidence:input.evidence},null,2),{flag:'wx'});writeFileSync(base+'-context.json',JSON.stringify(input.context,null,2));assertNativeModelInput(capture,policySource,policy.fingerprint);}});
  let answer;try{answer=await model.decide(context);}finally{writeFileSync(attempt+'-model-evidence.json',JSON.stringify(model.getEvidence(),null,2),{flag:'wx'});}writeFileSync(attempt+'-decision.json',JSON.stringify({decisionId,answer,modelEvidence:model.getEvidence()},null,2),{flag:'wx'});writeFileSync(base+'-decision.json',JSON.stringify({decisionId,answer,modelEvidence:model.getEvidence()},null,2));
  for(const action of answer.actions){if(action.pair&&!context.features.some(f=>f.pair===action.pair))continue;const result=await broker.place(action,decisionId,policy.fingerprint);console.log(JSON.stringify({pair:action.pair??null,type:action.type,ok:result.ok,reason:result.reason}));}
 }finally{historyStore?.close();journal?.close();closeSync(fd);unlinkSync(lock);}
}
main().catch(()=>{console.error('Live-Zyklus sicher gestoppt. Konfiguration, Journal-Sperre, Daten und Börsenstatus prüfen. Keine automatische Orderwiederholung.');process.exitCode=1;});
