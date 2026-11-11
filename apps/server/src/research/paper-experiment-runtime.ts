import type {Candle} from '@paper/shared';
import {alignedPortfolioCovariance} from '../context/portfolio-covariance.js';
import {needsCovariancePolicy} from '../strategy/mock-policy.js';
import type Database from 'better-sqlite3';
import type {config} from '../config.js';
import type {MarketFeed} from '../market/types.js';
import type {PaperExecutionAdapter} from '../broker/PaperExecutionAdapter.js';
import {digest,inspectBuild,sanitisedTradingConfig,type BuildVerification} from '../provenance/build.js';
import {initPaperExperiment,readPaperExperiment,assertExperimentRuntime,assertStoredExperimentPolicy,type PaperExperiment,type ExperimentRuntime} from './paper-experiment.js';
import {initPaperExperimentObservations,startPaperExperiment,observePaperExperiment,readPaperExperimentComparison} from './paper-experiment-observations.js';
/** Dedicated mock process only. No real provider, private client or financial account adapter. */
export class PaperExperimentRuntimeController {
 private id:string|undefined;private contract:PaperExperiment|undefined;private lastCapture=-1;private lastTimes=new Map<string,number>();
 constructor(private db:Database.Database,private broker:PaperExecutionAdapter,private market:MarketFeed,private settings:typeof config,private root:string,private liveDisabled:boolean,private verifyBuild:()=>Pick<BuildVerification,'verified'|'buildId'>=()=>inspectBuild(root)){
  this.profile();initPaperExperiment(db);initPaperExperimentObservations(db);
  broker.setPaperExperimentEntryGuard(()=>this.assertReady());
  // Register a resumed run before public ticks can trigger independent protective sells.
  // Entry gate stays closed until full market readiness and start() complete.
  const saved=db.prepare('SELECT id FROM paper_experiments LIMIT 1').get() as {id:string}|undefined;
  if(saved){const c=readPaperExperiment(db,saved.id)!,snapshot=this.snapshot(),now=Date.now();startPaperExperiment(db,c,snapshot.runtime,{runId:snapshot.provenance.runId,connected:market.connected,observedAt:now},now);}
 }
 private profile(){const c=this.settings;if(c.PAPER_EXPERIMENT_MODE!=='mock'||c.EXCHANGE!=='binance'||c.DATABASE_PATH!=='./data/mock-experiment.db'||c.AI_PROVIDER!=='mock'||c.AI_ENABLED||c.AI_ALLOW_REMOTE||c.AI_API_KEY!==''||c.ANTHROPIC_API_KEY!==''||this.liveDisabled!==true)throw Error('Dedicated mock-only paper profile required');}
 private snapshot(){
  this.profile();const p=this.broker.provenance,currentBuild=this.verifyBuild();if(!p?.verified||!p.build.buildId||!currentBuild.verified||currentBuild.buildId!==p.build.buildId)throw Error('Experiment needs current verified immutable build');
  if(digest(JSON.stringify(sanitisedTradingConfig(this.settings)))!==p.configurationFingerprint||digest(this.settings.DATABASE_PATH)!==p.databaseFingerprint||digest(this.settings.AI_BASE_URL)!==p.modelEndpointFingerprint)throw Error('Runtime configuration changed after provenance capture');
  const c=this.settings,common={feeRate:c.TAKER_FEE_RATE,maxSpreadBps:c.MAX_ENTRY_SPREAD_BPS,maxSlippageBps:c.MAX_ENTRY_SLIPPAGE_BPS,latencyMinMs:c.SIMULATED_LATENCY_MS_MIN,latencyMaxMs:c.SIMULATED_LATENCY_MS_MAX,maxBookAgeMs:c.MAX_BOOK_AGE_MS,maxPositionPct:c.MAX_POSITION_PCT,maxOpenPositions:c.MAX_OPEN_POSITIONS,maxPortfolioRiskPct:c.MAX_TOTAL_RISK_PCT,maxDrawdownPct:c.MAX_DRAWDOWN_PCT,minOrderQuote:c.MIN_ORDER_EUR,maxEntriesPerDay:c.MAX_TRADES_PER_DAY,cooldownMinutes:c.COIN_COOLDOWN_MINUTES,defaultStopLossPct:c.DEFAULT_STOP_LOSS_PCT};
  const ids=['ai','rules','hold']as const,legs=ids.map(accountId=>{const i=this.broker.executionProvenance(accountId),policy=this.broker.policies.get(accountId);if(!i.buildVerified||!i.evaluationVersion||!i.universeHash)throw Error('Incomplete actual leg provenance');return {accountId,evaluationVersion:i.evaluationVersion,policyFingerprint:policy?.fingerprint??null,universe:i.universeHash};});
  if(new Set(legs.map(l=>l.universe)).size!==1)throw Error('Leg universes differ');
  const runtime:ExperimentRuntime={paperOnly:true,buildVerified:true,aiProvider:c.AI_PROVIDER,aiEnabled:c.AI_ENABLED,allowRemote:c.AI_ALLOW_REMOTE,liveEnabled:!this.liveDisabled,buildId:p.build.buildId,baseStrategyVersion:p.strategyVersion,venue:c.EXCHANGE,quote:c.QUOTE_CURRENCY,universeHash:legs[0]!.universe,common,legs:legs.map(({universe,...l})=>l)};
  return {runtime,provenance:p};
 }
 start(now=Date.now()){
  const {runtime,provenance}=this.snapshot();if(!this.market.connected)throw Error('Public market not connected');
  const tracked=(this.db.prepare('SELECT count(*) n FROM pairs WHERE active=1').get() as {n:number}).n;
  if(!tracked||this.market.features.size!==tracked||[...this.market.features.values()].some(f=>f.ts+900000>now||now-f.ts-900000>1200000))throw Error('All registered market features must be fresh before experiment start');
  if(needsCovariancePolicy(this.settings.PAPER_MOCK_POLICY)){
   const symbols=this.db.prepare('SELECT symbol FROM pairs WHERE active=1 ORDER BY symbol').all() as {symbol:string}[];
   const read=this.db.prepare('SELECT pair,interval,ts,open,high,low,close,volume FROM candles WHERE pair=? AND interval=15 AND ts<=? ORDER BY ts DESC LIMIT 193');
   const panel=alignedPortfolioCovariance(symbols.map(p=>({pair:p.symbol,candles:(read.all(p.symbol,now-900000) as Candle[]).reverse()})),now);
   if(panel.valid.some(v=>!v)||panel.pairs.some((pair,i)=>{const f=this.market.features.get(pair);return !f||f.ts+900000!==panel.lastClosedAt||f.price!==panel.lastCloses[i];}))throw Error('Complete aligned covariance and current matching features required before baseline');
  }
  const btc=this.market.books.get('BTC/'+this.settings.QUOTE_CURRENCY);if(!btc?.valid||btc.receivedAt>now||now-btc.receivedAt>this.settings.MAX_BOOK_AGE_MS)throw Error('Fresh benchmark book required before registration');
  const saved=this.db.prepare('SELECT id FROM paper_experiments LIMIT 1').get() as {id:string}|undefined,policy=this.broker.policies.get('ai');if(!policy)throw Error('Actual AI policy missing');
  const c=saved?readPaperExperiment(this.db,saved.id)!:{format:'mock-paper-experiment-v1' as const,registeredAt:now,venue:'binance' as const,quote:this.settings.QUOTE_CURRENCY,startingBalance:this.settings.STARTING_BALANCE_EUR,buildId:runtime.buildId,baseStrategyVersion:runtime.baseStrategyVersion,universeHash:runtime.universeHash,common:runtime.common,aiSettings:{mode:policy.mode,stopLossPct:policy.stopLossPct,revision:policy.revision,updatedAt:policy.updatedAt},benchmark:'initial-full-cash-BTC-buy; hold bypasses entry risk caps and has no stop' as const,legs:runtime.legs as PaperExperiment['legs']};
  const result=startPaperExperiment(this.db,c,runtime,{runId:provenance.runId,connected:true,observedAt:now},now);
  this.id=result.id;this.contract=c;this.lastCapture=now;for(const l of c.legs){const last=this.db.prepare('SELECT max(ts) ts FROM forward_points WHERE epoch_id=?').get(digest(l.accountId+':'+l.evaluationVersion)) as {ts:number|null};this.lastTimes.set(l.accountId,last.ts??c.registeredAt);}return result;
 }
 assertReady(){if(!this.id||!this.contract)throw Error('Paper experiment has no atomic common baseline');if(Date.now()<this.contract.registeredAt)throw Error('Experiment clock precedes registration');const {runtime}=this.snapshot();assertExperimentRuntime(this.contract,runtime);assertStoredExperimentPolicy(this.db,this.contract);if(!this.market.connected)throw Error('Experiment market disconnected');}
 capture(){
  if(!this.id||!this.contract)throw Error('Experiment not initialized');const {runtime,provenance}=this.snapshot();
  const points=this.contract.legs.map(l=>{const a=this.db.prepare('SELECT cash,status FROM accounts WHERE id=?').get(l.accountId) as {cash:number;status:string},v=this.broker.valuation(l.accountId);return {accountId:l.accountId,ts:v.asOf,cash:a.cash,equity:v.equity,positionCount:v.positions.length,active:a.status==='active',connected:this.market.connected};});
  const now=Date.now();if(now<=this.lastCapture||points.some(p=>p.ts<=(this.lastTimes.get(p.accountId)??-1)))return {recorded:false,reason:'same_source_instant'};
  const result=observePaperExperiment(this.db,this.id,runtime,{runId:provenance.runId,connected:this.market.connected,observedAt:now},points,now);this.lastCapture=now;for(const p of points)this.lastTimes.set(p.accountId,p.ts);return result;
 }
 report(now=Date.now()){if(!this.id||!this.contract)return {status:'awaiting_registered_market',profitabilityEstablished:false,currentMetrics:null};if(!this.market.connected)return {status:'market_disconnected',profitabilityEstablished:false,currentMetrics:null};try{const {runtime}=this.snapshot();assertExperimentRuntime(this.contract,runtime);assertStoredExperimentPolicy(this.db,this.contract);}catch{return {status:'runtime_drift',profitabilityEstablished:false,currentMetrics:null};}return readPaperExperimentComparison(this.db,this.id,now);}
}
