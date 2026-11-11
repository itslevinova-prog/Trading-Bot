import type Database from 'better-sqlite3';
import {digest} from '../provenance/build.js';

export type ForwardIdentity={runId:string|null;evaluationVersion:string|null;buildVerified:boolean};
export type ForwardObservation={accountId:string;ts:number;cash:number;equity:number|null;positionCount:number;active:boolean;connected:boolean};
type Epoch={id:string;account_id:string;evaluation_version:string;run_id:string;started_at:number;baseline_equity:number;contamination:string|null};
type Point={ts:number;equity:number|null;reason:string|null};
/** Prospective paper observations only. An epoch starts flat before any versioned fill. */
export function initForward(database:Database.Database){database.exec(`
 CREATE TABLE IF NOT EXISTS forward_epochs(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,evaluation_version TEXT NOT NULL,run_id TEXT NOT NULL,started_at INTEGER NOT NULL,baseline_equity REAL NOT NULL,contamination TEXT,UNIQUE(account_id,evaluation_version));
 CREATE TABLE IF NOT EXISTS forward_points(epoch_id TEXT NOT NULL REFERENCES forward_epochs(id),ts INTEGER NOT NULL,run_id TEXT NOT NULL,equity REAL,reason TEXT,PRIMARY KEY(epoch_id,ts));
`);}
export function invalidateForward(database:Database.Database,reason:string){if(!reason.trim())throw Error('Reset reason required');database.prepare('UPDATE forward_epochs SET contamination=coalesce(contamination,?)').run(reason);}
function epochFor(database:Database.Database,account:string,version:string){return database.prepare('SELECT * FROM forward_epochs WHERE account_id=? AND evaluation_version=?').get(account,version) as Epoch|undefined;}
export function observeForward(database:Database.Database,identity:ForwardIdentity,point:ForwardObservation){
 if(!identity.buildVerified||!identity.evaluationVersion||!identity.runId)return {recorded:false,reason:'unverified_runtime'};
 if(!Number.isSafeInteger(point.ts)||point.ts<0||!Number.isFinite(point.cash)||point.cash<0||!Number.isInteger(point.positionCount)||point.positionCount<0)return {recorded:false,reason:'invalid_observation'};
 const version=identity.evaluationVersion,runId=identity.runId;
 return database.transaction(()=>{
  let epoch=epochFor(database,point.accountId,version);
  const equityValid=point.equity!==null&&Number.isFinite(point.equity)&&point.equity>=0;
  if(!epoch){
   if(!point.active||!point.connected||!equityValid||point.equity!<=0)return {recorded:false,reason:'awaiting_active_market'};
   if(point.positionCount!==0)return {recorded:false,reason:'inherited_positions'};
   if(Math.abs(point.equity!-point.cash)>1e-8)return {recorded:false,reason:'inconsistent_flat_baseline'};
   const previous=database.prepare('SELECT 1 FROM trades t JOIN trade_provenance p ON p.trade_id=t.id WHERE t.account_id=? AND p.evaluation_version=? LIMIT 1').get(point.accountId,version);
   if(previous)return {recorded:false,reason:'version_traded_before_registration'};
   const id=digest(point.accountId+':'+version);
   database.prepare('INSERT INTO forward_epochs(id,account_id,evaluation_version,run_id,started_at,baseline_equity) VALUES(?,?,?,?,?,?)').run(id,point.accountId,version,runId,point.ts,point.equity!);
   epoch=epochFor(database,point.accountId,version)!;
  }
  const last=database.prepare('SELECT max(ts) AS ts FROM forward_points WHERE epoch_id=?').get(epoch.id) as {ts:number|null};
  if(point.ts<epoch.started_at||last.ts!==null&&point.ts<=last.ts)return {recorded:false,reason:'nonmonotonic_or_duplicate_observation'};
  const mixed=database.prepare('SELECT 1 FROM trades t LEFT JOIN trade_provenance p ON p.trade_id=t.id WHERE t.account_id=? AND t.ts>=? AND (p.trade_id IS NULL OR p.verified<>1 OR p.evaluation_version<>?) LIMIT 1').get(point.accountId,epoch.started_at,version);
  if(mixed&&!epoch.contamination){database.prepare('UPDATE forward_epochs SET contamination=? WHERE id=?').run('Unassigned, unverified or different-version trade after baseline',epoch.id);epoch.contamination='mixed_execution_versions';}
  const reason=epoch.contamination?'mixed_execution_versions':!point.connected?'disconnected':!equityValid?'valuation_unavailable':null;
  database.prepare('INSERT INTO forward_points VALUES(?,?,?,?,?)').run(epoch.id,point.ts,runId,reason?null:point.equity,reason);
  return {recorded:true,reason,epochId:epoch.id};
 })();
}
export function forwardSummary(database:Database.Database,account:string,version:string|null,now=Date.now()){
 const common={accountId:account,profitabilityEstablished:false,independentPerformanceEstablished:false,valuationMethod:'Fresh top bid for held positions; paid fill fees included in cash. Hypothetical exit fees/depth and live fills are not modelled.'};
 if(!version)return {...common,status:'unavailable',reason:'No verified executable version'};
 const epoch=epochFor(database,account,version);if(!epoch)return {...common,status:'awaiting_baseline',reason:'Requires active account, connected market and flat balance before this version trades'};
 const points=database.prepare('SELECT ts,equity,reason FROM forward_points WHERE epoch_id=? ORDER BY ts').all(epoch.id) as Point[];
 const valid=points.filter((p):p is Point&{equity:number}=>p.equity!==null),last=valid.at(-1),latest=points.at(-1);
 let peak=epoch.baseline_equity,drawdown=0,maxGapMs=0;for(let i=0;i<points.length;i++){const p=points[i]!;if(i)maxGapMs=Math.max(maxGapMs,p.ts-points[i-1]!.ts);if(p.equity!==null){peak=Math.max(peak,p.equity);drawdown=Math.max(drawdown,peak>0?(peak-p.equity)/peak*100:0);}}
 const fills=database.prepare(`SELECT count(*) AS fills,coalesce(sum(CASE WHEN t.side='sell' THEN 1 ELSE 0 END),0) AS sells FROM trades t JOIN trade_provenance p ON p.trade_id=t.id WHERE t.account_id=? AND t.ts>=? AND p.evaluation_version=? AND p.verified=1`).get(account,epoch.started_at,version) as {fills:number;sells:number};
 const stale=!latest||now-latest.ts>120000||!!latest.reason;
 return {...common,status:epoch.contamination?'contaminated':stale?'observation_gap':'collecting',epochId:epoch.id,evaluationVersion:version,registeredAt:epoch.started_at,baselineEquity:epoch.baseline_equity,lastValidAt:last?.ts??null,latestObservationAt:latest?.ts??null,elapsedDays:Math.max(0,now-epoch.started_at)/86400000,observations:points.length,invalidObservations:points.length-valid.length,maxGapMs,currentGapMs:latest?Math.max(0,now-latest.ts):null,returnPct:!epoch.contamination&&last?(last.equity/epoch.baseline_equity-1)*100:null,maxObservedDrawdownPct:epoch.contamination?null:drawdown,metricsAreStale:stale,fills:fills.fills,sellFills:fills.sells,insufficientSample:true,contamination:epoch.contamination,warning:'Prospective paper observations; no independent long-term result or profit advantage established. Gaps are retained. Sell fills may be partial positions.'};
}
