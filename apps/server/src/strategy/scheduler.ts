import {runPaperDca} from '../dca/paper-runner.js';
import {positionEntryEvidence} from '../context/position-entry.js';
import {createMockProvider} from './mock-policy.js';
import {readForwardCohort} from '../research/cohort.js';
import {ProtectiveExits,SqliteExitFailures} from './protectiveExits.js';
import {observeForward,forwardSummary} from '../research/forward.js';
import {portfolioEvidence} from '../context/portfolio-evidence.js';
import {researchEvidence} from '../context/research-evidence.js';
import {collectMarketContext} from '../context/collector.js';import {computeAccountAnalytics} from '../research/analytics.js';import {CompatibleDecisionProvider} from '../ai/CompatibleDecisionProvider.js';import {SYSTEM_PROMPT,packContext} from '../ai/prompt.js';
import {externalContext} from '../context/external.js';
import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {randomUUID} from 'node:crypto';import {eq,desc,and,gte,lt} from 'drizzle-orm';
import type {Action,DecisionContext,DecisionProvider,FeatureSnapshot} from '@paper/shared';
import {parseAiAnswer} from '@paper/shared';
import {config,projectRoot} from '../config.js';import {db,sqlite} from '../db.js';import {accounts,positions,trades,decisions,decisionEvidence,lessons,equitySnapshots,candles} from '../schema.js';
import type {MarketFeed} from '../market/types.js';import {PaperExecutionAdapter} from '../broker/PaperExecutionAdapter.js';import {drawdown} from '../broker/risk.js';import {RuleBasedProvider} from './providers.js';import {saveMemory,recall,backfillMemory} from '../memory/index.js';import type {FastifyBaseLogger as Logger} from 'fastify';
function loadPrompt(name:string){return readFileSync(resolve(projectRoot,'prompts',name),'utf8');}
export type SchedulerExperimentHooks={assertReady:()=>void;capture:()=>void};
export class Scheduler{
 private external=externalContext;
 private running=false;private timers:NodeJS.Timeout[]=[];private decisionTimer:NodeJS.Timeout|undefined;private stopping=false;private tasks=new Set<Promise<void>>();
 readonly exitFailures=new SqliteExitFailures(sqlite);private protective:ProtectiveExits;
 constructor(private market:MarketFeed,private broker:PaperExecutionAdapter,private emit:(type:string,payload:unknown)=>void,private logger:Logger,private experiment?:SchedulerExperimentHooks){this.protective=new ProtectiveExits({positions:pair=>db.select().from(positions).where(eq(positions.pair,pair)).all(),place:order=>this.broker.placeMarketOrder(order),store:this.exitFailures,notify:this.emit,report:(message,positionId)=>this.logger.error({positionId},message)});}
 private launch(name:string,work:()=>unknown|Promise<unknown>){if(this.stopping)return;const task=Promise.resolve().then(()=>this.stopping?undefined:work()).then(()=>{}).catch(()=>{try{this.logger.error({task:name},'Paper background task failed');}catch{/* Shutdown still drains tasks if a logger fails. */}}).finally(()=>{this.tasks.delete(task);});this.tasks.add(task);}

 context(id:string):DecisionContext{const now=Date.now();const account=db.select().from(accounts).where(eq(accounts.id,id)).get()!;const valuation=this.broker.valuation(id),equity=valuation.equity,entryScope=this.broker.executionProvenance(id).evaluationVersion;const positionsNow=valuation.positions.map(p=>({...p,entryEvidence:positionEntryEvidence(sqlite,p,now,entryScope),currentValue:p.value,unrealizedEur:p.pnlEur,unrealizedPct:p.pnlPct,heldMinutes:(now-p.openedAt)/60000}));
 const midnight=new Date(now);midnight.setUTCHours(0,0,0,0);const today=db.select().from(trades).where(and(eq(trades.accountId,id),gte(trades.ts,midnight.getTime()))).all();
 const features=[...this.market.features.values()].filter(f=>now-(f.ts+15*60000)<30*60000);const timeUTC=new Date(now).toISOString();const timeZurich=new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',dateStyle:'short',timeStyle:'medium'}).format(now);
 const policy=this.broker.policies.get(id);
 const {covariance,...marketSnapshot}=collectMarketContext(this.market,now);
 const previousPortfolioEvidence=portfolioEvidence(this.market.venue,config.QUOTE_CURRENCY,false,this.broker.provenance?.strategyVersion,this.broker.executionProvenance(id).universeHash??undefined);
 const combinedPortfolioEvidence=covariance?{...(previousPortfolioEvidence as Record<string,unknown>),covariance}:previousPortfolioEvidence;
 return {tradingPolicy:policy??undefined,forwardCohort:readForwardCohort(sqlite,this.broker.executionProvenance(id).buildVerified?this.broker.executionProvenance(id).evaluationVersion:null),protectiveExitFailures:this.exitFailures.all(id),forwardEvidence:forwardSummary(sqlite,id,this.broker.executionProvenance(id).buildVerified?this.broker.executionProvenance(id).evaluationVersion:null),portfolioEvidence:combinedPortfolioEvidence,researchEvidence:researchEvidence(this.market.venue,config.QUOTE_CURRENCY),marketContext:marketSnapshot,execution:{mode:'paper',...this.broker.executionProvenance(id),venue:this.market.venue,quoteCurrency:config.QUOTE_CURRENCY,connected:this.market.connected,roundTripFeePct:config.TAKER_FEE_RATE*200,missingLiveValidation:true},performance:computeAccountAnalytics(db.select().from(trades).where(eq(trades.accountId,id)).all(),db.select().from(equitySnapshots).where(eq(equitySnapshots.accountId,id)).orderBy(equitySnapshots.ts).all(),equity),timeUTC,timeZurich,account:{...account,equity,valuation,drawdown:equity===null?null:drawdown(equity,account.peakEquity),tradesToday:today.length},positions:positionsNow,features,recentTrades:db.select().from(trades).where(eq(trades.accountId,id)).orderBy(desc(trades.ts)).limit(10).all(),limits:{MAX_POSITION_PCT:policy?.maxPositionPct??config.MAX_POSITION_PCT,MAX_TOTAL_RISK_PCT:policy?.maxPortfolioRiskPct??config.MAX_TOTAL_RISK_PCT,MAX_ENTRY_SPREAD_BPS:policy?.maxSpreadBps??config.MAX_ENTRY_SPREAD_BPS,MAX_ENTRY_SLIPPAGE_BPS:policy?.maxSlippageBps??config.MAX_ENTRY_SLIPPAGE_BPS,MAX_OPEN_POSITIONS:policy?.maxOpenPositions??config.MAX_OPEN_POSITIONS,MAX_TRADES_PER_DAY:policy?.maxEntriesPerDay??config.MAX_TRADES_PER_DAY,MIN_ORDER_EUR:config.MIN_ORDER_EUR,TAKER_FEE_RATE:config.TAKER_FEE_RATE,MAX_DRAWDOWN_PCT:config.MAX_DRAWDOWN_PCT},memory:features.map(f=>recall(f.pair,f,Date.parse(timeUTC),id)),lessons:db.select().from(lessons).where(eq(lessons.active,true)).all()};}
 private persistDecision(decision:typeof decisions.$inferInsert,evidence?:unknown,insert=false){db.transaction(tx=>{const result=insert?tx.insert(decisions).values(decision).run():tx.update(decisions).set(decision).where(eq(decisions.id,decision.id)).run();if(result.changes!==1)throw Error('Entscheidungsprotokoll nicht gespeichert');if(evidence!==undefined&&evidence!==null)tx.insert(decisionEvidence).values({decisionId:decision.id,evidenceJson:JSON.stringify(evidence),recordedAt:Date.now()}).onConflictDoUpdate({target:decisionEvidence.decisionId,set:{evidenceJson:JSON.stringify(evidence),recordedAt:Date.now()}}).run();});}
 renderPrompt(ctx:DecisionContext){try{return SYSTEM_PROMPT+'\n\n'+packContext(ctx,config.AI_MAX_CONTEXT_CHARS).user;}catch{return SYSTEM_PROMPT+'\n\n[Kontext zu gross; kein KI-Aufruf. Vollständiger Kontext im Entscheidungsprotokoll.]';}}
 async run(onlyAccountId?:string){if(this.stopping)return 'stopping' as const;if(this.running)return 'busy' as const;this.experiment?.assertReady();this.running=true;try{await this.external.refresh(config.CONTEXT_EXTERNAL_ENABLED);for(const a of db.select().from(accounts).all()){
  if(onlyAccountId!==undefined&&a.id!==onlyAccountId)continue;
  if(this.stopping)break;
  if(a.strategy==='hold')continue;if(a.strategy==='dca'){
   try{if(a.status==='active')await runPaperDca(sqlite,this.broker,this.market,config.QUOTE_CURRENCY);}catch(error){this.logger.error({error},'DCA paper run failed');}
   continue;
  }this.experiment?.assertReady();
  this.observeForwardAccount(a);
  const id=randomUUID(),ctx={...this.context(a.id),externalContext:this.external.snapshot()},prompt=this.renderPrompt(ctx);
  let provider:DecisionProvider|undefined;let providerName=a.strategy==='rules'?'rules':config.AI_PROVIDER;
  if(a.strategy==='rules')provider=new RuleBasedProvider();else if(config.AI_PROVIDER==='mock'){provider=createMockProvider(config.PAPER_MOCK_POLICY);if(config.PAPER_MOCK_POLICY!=='trend-v2')providerName='mock:'+config.PAPER_MOCK_POLICY;}else if(config.AI_ENABLED&&config.AI_PROVIDER==='openai-compatible')provider=new CompatibleDecisionProvider({enabled:config.AI_ENABLED,baseUrl:config.AI_BASE_URL,model:config.AI_MODEL,apiKey:config.AI_API_KEY,allowRemote:config.AI_ALLOW_REMOTE,maxChars:config.AI_MAX_CONTEXT_CHARS,maxOutputTokens:config.AI_MAX_OUTPUT_TOKENS,mode:config.AI_MODEL_MODE,expectedFingerprint:config.AI_EXPECTED_MODEL_FINGERPRINT,contextTokens:config.AI_CONTEXT_TOKENS,onPrepared:input=>{if(this.stopping)throw Error('Scheduler beendet; kein Modellauftrag');decision.contextJson=JSON.stringify(input.context);decision.promptText=input.systemPrompt+'\n\n'+input.userPrompt;this.persistDecision(decision,input.evidence);}});
  const decision={id,accountId:a.id,provider:providerName,ts:Date.now(),status:'not_sent',marketView:'',actionsJson:'[]',contextJson:JSON.stringify(ctx),promptText:prompt,rawResponse:''};
  if(a.status!=='active')provider=undefined;
  if(!provider){db.insert(decisions).values(decision).run();saveMemory(id,a.id,ctx.features,[]);this.emit('decision',decision);continue;}
  try{
   decision.status='prepared';this.persistDecision(decision,undefined,true);
   const result=await provider.decide(ctx);if(this.stopping){decision.status='cancelled';decision.rawResponse=JSON.stringify(result);this.persistDecision(decision,provider.getEvidence?.());continue;}let actions=result.actions;
   if(a.strategy==='ai'){const parsed=parseAiAnswer(JSON.stringify(result),new Set([...this.market.features.keys()]));if(!parsed.valid||parsed.errors.length){decision.status='invalid';decision.rawResponse=JSON.stringify(result);this.persistDecision(decision,provider.getEvidence?.());this.emit('decision',decision);continue;}actions=parsed.actions;}
   decision.marketView=result.marketView;decision.actionsJson=JSON.stringify(actions);decision.rawResponse=JSON.stringify(result);
   // Durable original context, transmitted prompt and validated result precede every order.
   decision.status='validated';this.persistDecision(decision,provider.getEvidence?.());
   const actionable=actions.filter(x=>x.type!=='hold') as Exclude<Action,{type:'hold'}>[];
   if(!actionable.length)decision.status='hold';else{let successful=0;for(const action of actionable){if(this.stopping)break;const r=await this.broker.placeMarketOrder({accountId:a.id,pair:action.pair,side:action.type,amountEur:action.type==='buy'?action.amountEur:undefined,sellFraction:action.type==='sell'?action.sellFraction:undefined,stopLossPct:action.type==='buy'?action.stopLossPct:undefined,takeProfitPct:action.type==='buy'?action.takeProfitPct:undefined,reason:action.reasoning,decisionId:id,confidence:action.confidence,policyRevision:(ctx.tradingPolicy as {revision:number}|undefined)?.revision});if(r.ok)successful++;}decision.status=successful===actionable.length?'executed':successful>0?'partially':'rejected';}
   this.persistDecision(decision,provider.getEvidence?.());saveMemory(id,a.id,ctx.features,actions);this.emit('decision',decision);
  }catch(error){this.logger.error({error,account:a.id},'Strategy failed');decision.status=this.stopping?'cancelled':'invalid';this.persistDecision(decision,provider.getEvidence?.());this.emit('decision',decision);}
 }}finally{this.running=false;}return 'completed' as const;}
 async buyHoldFirst(){if(this.stopping)return;this.experiment?.assertReady();const acc=db.select().from(accounts).where(eq(accounts.id,'hold')).get();const earlier=db.select().from(trades).where(eq(trades.accountId,'hold')).limit(1).get();if(!acc||earlier)return;
 const book=this.market.books.get(`BTC/${config.QUOTE_CURRENCY}`);if(!book?.valid||Date.now()-book.receivedAt>config.MAX_BOOK_AGE_MS)return;
 this.observeForwardAccount(acc);
 const decisionId=randomUUID();const result=await this.broker.placeMarketOrder({accountId:'hold',pair:`BTC/${config.QUOTE_CURRENCY}`,side:'buy',amountEur:acc.cash,reason:'Initialer Buy-&-Hold-Kauf in BTC',decisionId});
 const decision={id:decisionId,accountId:'hold',provider:'hold',ts:Date.now(),status:result.ok?'executed':'rejected',marketView:'Einmaliger BTC-Kauf und anschliessendes Halten',actionsJson:JSON.stringify([{type:'buy',pair:`BTC/${config.QUOTE_CURRENCY}`,amountEur:acc.cash,reasoning:'Buy & Hold'}]),contextJson:JSON.stringify(this.context('hold')),promptText:'',rawResponse:JSON.stringify(result)};db.insert(decisions).values(decision).run();this.emit('decision',decision);if(result.ok)this.logger.info('Buy and Hold initialized');}
 onTick(pair:string,bid:number){this.protective.onTick(pair,bid);}
 private observeForwardAccount(a:typeof accounts.$inferSelect){
  if(this.experiment)return;
  try{const valuation=this.broker.valuation(a.id);
   observeForward(sqlite,this.broker.executionProvenance(a.id),{accountId:a.id,ts:valuation.asOf,cash:a.cash,equity:valuation.equity,positionCount:valuation.positions.length,active:a.status==='active',connected:this.market.connected});
  }catch(error){this.logger.error({error,account:a.id},'Forward observation failed');}

 }
 private tickEquity(){const now=Math.floor(Date.now()/60000)*60000;for(const a of db.select().from(accounts).all()){
  const valuation=this.broker.valuation(a.id),equity=valuation.equity;
  this.observeForwardAccount(a);
  if(equity===null){this.emit('equity',{accountId:a.id,ts:now,equity:null,cash:a.cash,valuation});continue;}
  const peak=Math.max(equity,a.peakEquity);
  db.insert(equitySnapshots).values({accountId:a.id,ts:now,equity,cash:a.cash}).onConflictDoUpdate({target:[equitySnapshots.accountId,equitySnapshots.ts],set:{equity,cash:a.cash}}).run();
  if(a.strategy!=='hold'&&drawdown(equity,peak)>=config.MAX_DRAWDOWN_PCT&&a.status==='active'){db.update(accounts).set({peakEquity:peak,status:'paused'}).where(eq(accounts.id,a.id)).run();this.emit('account_status',{accountId:a.id,status:'paused',reason:'Kill-Switch'});}else if(peak>a.peakEquity)db.update(accounts).set({peakEquity:peak}).where(eq(accounts.id,a.id)).run();
  this.emit('equity',{accountId:a.id,ts:now,equity,cash:a.cash});
 }this.experiment?.capture();}
 start(){this.launch('external_context',()=>this.external.refresh(config.CONTEXT_EXTERNAL_ENABLED));const schedule=()=>{const interval=config.DECISION_INTERVAL_MINUTES*60000,now=Date.now();const next=(Math.floor((now-5000)/interval)+1)*interval+5000;const wait=Math.max(0,next-now);this.decisionTimer=setTimeout(()=>{this.launch('strategy',()=>this.run());schedule();},wait);};schedule();
 this.timers.push(setInterval(()=>this.launch('equity_and_hold',async()=>{this.tickEquity();await this.buyHoldFirst();}),60000),setInterval(()=>{try{backfillMemory()}catch(e){this.logger.warn({error:e},'Memory backfill failed')}},5*60000),setInterval(()=>this.launch('candle_prune',()=>{db.delete(candles).where(lt(candles.ts,Date.now()-config.HISTORY_DAYS*86400000-3600000)).run();}),86400000));this.launch('initial_equity_and_hold',async()=>{this.tickEquity();await this.buyHoldFirst();});}
 async stop(){this.stopping=true;this.protective.stop();if(this.decisionTimer)clearTimeout(this.decisionTimer);for(const t of this.timers)clearInterval(t);this.timers=[];await Promise.allSettled([...this.tasks,this.protective.drain()]);}
}
