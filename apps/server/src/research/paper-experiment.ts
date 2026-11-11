import type Database from 'better-sqlite3';
import {z} from 'zod';
import {digest,evaluationFingerprint} from '../provenance/build.js';
import {effectiveTradingPolicy,TradingPolicyStore} from '../strategy/trading-policy.js';
import {canonicalJson} from './dataset.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/),time=z.number().int().nonnegative().safe(),positive=z.number().finite().positive();
const leg=z.object({accountId:z.enum(['ai','rules','hold']),evaluationVersion:hash,policyFingerprint:hash.nullable()}).strict();
const common=z.object({feeRate:z.number().finite().min(0).max(.05),maxSpreadBps:z.number().finite().min(0).max(1000),maxSlippageBps:z.number().finite().min(0).max(1000),latencyMinMs:z.number().finite().nonnegative(),latencyMaxMs:z.number().finite().nonnegative(),maxBookAgeMs:positive,maxPositionPct:positive.max(1),maxOpenPositions:positive.int(),maxPortfolioRiskPct:positive.max(.1),maxDrawdownPct:positive.max(1),minOrderQuote:positive,maxEntriesPerDay:positive.int(),cooldownMinutes:z.number().finite().nonnegative(),defaultStopLossPct:z.number().finite().min(.02).max(.15)}).strict().refine(c=>c.latencyMaxMs>=c.latencyMinMs,'Invalid latency bounds');
export const paperExperimentSchema=z.object({format:z.literal('mock-paper-experiment-v1'),registeredAt:time,venue:z.literal('binance'),quote:z.enum(['EUR','USDT','USDC']),startingBalance:positive,buildId:hash,baseStrategyVersion:hash,universeHash:hash,common:common,aiSettings:z.object({mode:z.enum(['safe','risky']),stopLossPct:z.number().finite().min(.02).max(.15),revision:time,updatedAt:time.nullable()}).strict(),benchmark:z.literal('initial-full-cash-BTC-buy; hold bypasses entry risk caps and has no stop'),legs:z.array(leg).length(3)}).strict();
export type PaperExperiment=z.infer<typeof paperExperimentSchema>;
export type ExperimentRuntime={paperOnly:boolean;buildVerified:boolean;aiProvider:string;aiEnabled:boolean;allowRemote:boolean;liveEnabled:boolean;buildId:string;baseStrategyVersion:string;venue:string;quote:string;universeHash:string;common:PaperExperiment['common'];legs:{accountId:string;evaluationVersion:string;policyFingerprint:string|null}[]};
function hardLimits(c:PaperExperiment){return {MAX_POSITION_PCT:c.common.maxPositionPct,MAX_OPEN_POSITIONS:c.common.maxOpenPositions,MAX_TRADES_PER_DAY:c.common.maxEntriesPerDay,COIN_COOLDOWN_MINUTES:c.common.cooldownMinutes,MAX_TOTAL_RISK_PCT:c.common.maxPortfolioRiskPct,MAX_ENTRY_SPREAD_BPS:c.common.maxSpreadBps,MAX_ENTRY_SLIPPAGE_BPS:c.common.maxSlippageBps,DEFAULT_STOP_LOSS_PCT:c.common.defaultStopLossPct};}
export function validatePaperExperiment(raw:unknown):PaperExperiment{
 const c=paperExperimentSchema.parse(raw);
 if(c.aiSettings.updatedAt!==null&&c.aiSettings.updatedAt>c.registeredAt)throw Error('Future AI policy settings');
 const policy=effectiveTradingPolicy(c.aiSettings,hardLimits(c));
 if(new Set(c.legs.map(l=>l.accountId)).size!==3)throw Error('Exactly ai/rules/hold required');
 for(const l of c.legs){if((l.accountId==='ai')!==(l.policyFingerprint!==null))throw Error('AI policy identity must be explicit; baselines have no AI policy');
  if(l.accountId==='ai'&&l.policyFingerprint!==policy.fingerprint)throw Error('AI policy fingerprint does not match actual settings/hard limits');
  const strategy=l.policyFingerprint?digest(c.baseStrategyVersion+':'+l.policyFingerprint):c.baseStrategyVersion;
  if(l.evaluationVersion!==evaluationFingerprint(strategy,c.universeHash))throw Error('Leg evaluation identity does not match strategy/policy/universe');}
 return c;
}
export function assertExperimentRuntime(c:PaperExperiment,r:ExperimentRuntime){
 if(r.paperOnly!==true||r.buildVerified!==true||r.aiProvider!=='mock'||r.aiEnabled!==false||r.allowRemote!==false||r.liveEnabled!==false)throw Error('Only verified mock-only paper runtime allowed');
 if(r.buildId!==c.buildId||r.baseStrategyVersion!==c.baseStrategyVersion||r.venue!==c.venue||r.quote!==c.quote||r.universeHash!==c.universeHash||canonicalJson(r.common)!==canonicalJson(c.common))throw Error('Experiment build/universe/cost/risk drift');
 if(r.legs.length!==3||new Set(r.legs.map(l=>l.accountId)).size!==3)throw Error('Runtime legs missing or duplicated');
 for(const l of c.legs){const actual=r.legs.find(a=>a.accountId===l.accountId);if(!actual||actual.evaluationVersion!==l.evaluationVersion||actual.policyFingerprint!==l.policyFingerprint)throw Error('Runtime leg identity drift');}
}
export function initPaperExperiment(database:Database.Database){database.exec(`CREATE TABLE IF NOT EXISTS paper_experiments (
 id TEXT PRIMARY KEY,contract_json TEXT NOT NULL,registered_at INTEGER NOT NULL);`);}
/** Explicitly called only by a new research experiment, never auto-register/reset existing accounts. */
export function registerPaperExperiment(database:Database.Database,raw:unknown,runtime:ExperimentRuntime,now:number){
 const c=validatePaperExperiment(raw);if(!Number.isSafeInteger(now)||now<0||c.registeredAt>now)throw Error('Invalid or future registration time');
 assertExperimentRuntime(c,runtime);const json=canonicalJson(c),id=digest(json);
 return database.transaction(()=>{
  assertStoredExperimentPolicy(database,c);
  const old=database.prepare('SELECT registered_at,contract_json FROM paper_experiments WHERE id=?').get(id) as {registered_at:number;contract_json:string}|undefined;
  if(old){if(old.contract_json!==json||old.registered_at!==c.registeredAt)throw Error('Experiment identity collision');return {id,created:false};}
  if(c.registeredAt!==now)throw Error('Registration needs exact current observation time');
  if(database.prepare('SELECT 1 FROM paper_experiments LIMIT 1').get())throw Error('New dedicated database required; never rebaseline an existing experiment');
  const identity=database.prepare('SELECT venue_quote FROM database_identity WHERE id=1').get() as {venue_quote:string}|undefined;
  if(identity?.venue_quote!==c.venue+':'+c.quote)throw Error('Paper database venue/quote mismatch');
  const accounts=database.prepare('SELECT id,strategy,starting_balance,cash,status,created_at FROM accounts').all() as {id:string;strategy:string;starting_balance:number;cash:number;status:string;created_at:number}[];
  if(accounts.length!==3||new Set(accounts.map(a=>a.id)).size!==3)throw Error('Dedicated three-account paper database required');
  for(const l of c.legs){const a=accounts.find(a=>a.id===l.accountId);if(!a||a.strategy!==l.accountId||a.status!=='active'||a.starting_balance!==c.startingBalance||a.cash!==c.startingBalance||!Number.isSafeInteger(a.created_at)||a.created_at>now)throw Error('Clean equal active account baseline required');}
  // All leg baselines are registered atomically before any trade, decision or inherited position.
  for(const table of ['positions','trades','decisions','forward_epochs','equity_snapshots'])if((database.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n)throw Error('Experiment database already observed or traded; no retrospective baseline');
  database.prepare('INSERT INTO paper_experiments VALUES(?,?,?)').run(id,json,now);
  return {id,created:true};
 })();
}
export function readPaperExperiment(database:Database.Database,id:string){
 const row=database.prepare('SELECT registered_at,contract_json FROM paper_experiments WHERE id=?').get(id) as {registered_at:number;contract_json:string}|undefined;
 if(!row)return null;const c=validatePaperExperiment(JSON.parse(row.contract_json));if(digest(canonicalJson(c))!==id||row.registered_at!==c.registeredAt)throw Error('Registered experiment was modified');return c;
}

export function assertStoredExperimentPolicy(database:Database.Database,c:PaperExperiment){
 const actual=new TradingPolicyStore(database,hardLimits(c)).get('ai');
 if(actual?.fingerprint!==c.legs.find(l=>l.accountId==='ai')!.policyFingerprint)throw Error('Stored AI risk policy differs from experiment');
}
