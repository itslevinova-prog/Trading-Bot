import type Database from 'better-sqlite3';
import {digest} from '../provenance/build.js';
import {observeForward,type ForwardObservation} from './forward.js';
import {registerPaperExperiment,readPaperExperiment,assertStoredExperimentPolicy,type PaperExperiment,type ExperimentRuntime} from './paper-experiment.js';
const validTime=(n:number)=>Number.isSafeInteger(n)&&n>=0;
export type ExperimentSource={runId:string;connected:boolean;observedAt:number};
function sourceValid(s:ExperimentSource,now:number){if(!validTime(now)||s.observedAt!==now||typeof s.connected!=='boolean'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s.runId))throw Error('Fresh explicit paper source/run identity required');}
export function initPaperExperimentObservations(db:Database.Database){db.exec(`
 CREATE TABLE IF NOT EXISTS paper_experiment_runs(experiment_id TEXT NOT NULL REFERENCES paper_experiments(id),run_id TEXT NOT NULL,first_seen INTEGER NOT NULL,PRIMARY KEY(experiment_id,run_id));
 CREATE TABLE IF NOT EXISTS paper_experiment_samples(experiment_id TEXT NOT NULL REFERENCES paper_experiments(id),captured_at INTEGER NOT NULL,account_id TEXT NOT NULL,epoch_id TEXT NOT NULL,observed_at INTEGER NOT NULL,observed_cash REAL NOT NULL,position_count INTEGER NOT NULL,
 PRIMARY KEY(experiment_id,captured_at,account_id),FOREIGN KEY(epoch_id,observed_at) REFERENCES forward_points(epoch_id,ts));`);}
function baselineIntact(db:Database.Database,id:string,c:PaperExperiment){
 for(const l of c.legs){const e=db.prepare(`SELECT e.id,e.started_at,e.baseline_equity,e.contamination,p.equity,p.reason FROM forward_epochs e LEFT JOIN forward_points p ON p.epoch_id=e.id AND p.ts=? WHERE e.account_id=? AND e.evaluation_version=?`).get(c.registeredAt,l.accountId,l.evaluationVersion) as any;
  if(!e||e.id!==digest(l.accountId+':'+l.evaluationVersion)||e.started_at!==c.registeredAt||e.baseline_equity!==c.startingBalance||e.contamination!==null||e.equity!==c.startingBalance||e.reason!==null)throw Error('Original common baseline missing or contaminated; never recreate it');
  const sample=db.prepare('SELECT epoch_id,observed_at,observed_cash,position_count FROM paper_experiment_samples WHERE experiment_id=? AND captured_at=? AND account_id=?').get(id,c.registeredAt,l.accountId) as any;
  if(sample?.epoch_id!==e.id||sample.observed_at!==c.registeredAt||sample.observed_cash!==c.startingBalance||sample.position_count!==0)throw Error('Original matched baseline sample missing');
 }
}
function addPoint(db:Database.Database,id:string,c:PaperExperiment,s:ExperimentSource,p:ForwardObservation){
 const leg=c.legs.find(l=>l.accountId===p.accountId)!;
 const r=observeForward(db,{runId:s.runId,evaluationVersion:leg.evaluationVersion,buildVerified:true},{...p,connected:s.connected});
 if(!r.recorded||!('epochId' in r)||!r.epochId)throw Error('Paper observation rejected: '+r.reason);
 db.prepare('INSERT INTO paper_experiment_samples VALUES(?,?,?,?,?,?,?)').run(id,s.observedAt,p.accountId,r.epochId,p.ts,p.cash,p.positionCount);
}
/** Must run before any Scheduler/hold execution in a dedicated frozen experiment. */
export function startPaperExperiment(db:Database.Database,c:PaperExperiment,r:ExperimentRuntime,s:ExperimentSource,now:number){
 sourceValid(s,now);return db.transaction(()=>{
  const registration=registerPaperExperiment(db,c,r,now);
  if(registration.created){if(!s.connected)throw Error('Connected public market required for initial baseline');
   for(const leg of c.legs)addPoint(db,registration.id,c,s,{accountId:leg.accountId,ts:now,cash:c.startingBalance,equity:c.startingBalance,positionCount:0,active:true,connected:true});
  }else baselineIntact(db,registration.id,c);
  db.prepare('INSERT INTO paper_experiment_runs VALUES(?,?,?) ON CONFLICT(experiment_id,run_id) DO NOTHING').run(registration.id,s.runId,now);
  return registration;
 })();
}
export function observePaperExperiment(db:Database.Database,id:string,r:ExperimentRuntime,s:ExperimentSource,points:ForwardObservation[],now:number){
 sourceValid(s,now);return db.transaction(()=>{
  const c=readPaperExperiment(db,id);if(!c)throw Error('Unregistered experiment');registerPaperExperiment(db,c,r,now);
  const run=db.prepare('SELECT first_seen FROM paper_experiment_runs WHERE experiment_id=? AND run_id=? AND first_seen<=?').get(id,s.runId,now) as {first_seen:number}|undefined;
  if(!run)throw Error('Register this runtime before observations');
  if(points.length!==3||new Set(points.map(p=>p.accountId)).size!==3||points.some(p=>!c.legs.some(l=>l.accountId===p.accountId)||!validTime(p.ts)||p.ts>now||p.ts<run.first_seen||now-p.ts>1000||p.connected!==s.connected))throw Error('Three actual aligned source times required');
  for(const p of points){const a=db.prepare('SELECT cash,status FROM accounts WHERE id=?').get(p.accountId) as any,count=(db.prepare('SELECT count(*) n FROM positions WHERE account_id=?').get(p.accountId) as {n:number}).n;
   if(!a||a.cash!==p.cash||(a.status==='active')!==p.active||count!==p.positionCount||p.positionCount===0&&p.equity!==null&&Math.abs(p.equity-p.cash)>1e-8)throw Error('Source inventory/cash does not match actual paper database');}
  for(const p of points)addPoint(db,id,c,s,p);return {recorded:true,points:3,capturedAt:now};
 })();
}
export function readPaperExperimentComparison(db:Database.Database,id:string,now:number){return db.transaction(()=>readComparisonSnapshot(db,id,now))();}
function readComparisonSnapshot(db:Database.Database,id:string,now:number){
 if(!validTime(now))throw Error('Invalid comparison clock');const c=readPaperExperiment(db,id);if(!c)throw Error('Unknown paper experiment');
 const common={experimentId:id,profitabilityEstablished:false,independentSamples:null,insufficientSample:true,currentMetrics:null as null|{asOf:number;returnsPct:Record<string,number>;aiExcessVsRules:number;aiExcessVsHold:number},warning:'Matched fresh paper marks only. Paid fill fees included; hypothetical exit costs/intraminute path unknown. Gaps do not reconstruct missed executions.'};
 try{baselineIntact(db,id,c);assertStoredExperimentPolicy(db,c);}catch{return {...common,status:'invalid_baseline'};}
 const fillsByAccount=new Map<string,any[]>();
 for(const leg of c.legs){const rows=db.prepare(`SELECT t.side,t.pair,t.ts,t.qty,t.cost_eur,t.fee_eur,t.realized_pnl_eur,p.verified,p.evaluation_version,p.build_id,p.strategy_version,p.universe_hash,p.run_id,p.recorded_at FROM trades t LEFT JOIN trade_provenance p ON p.trade_id=t.id WHERE t.account_id=? AND t.ts>=? ORDER BY t.ts,t.id`).all(leg.accountId,c.registeredAt) as any[];
  for(const t of rows){const strategy=leg.policyFingerprint?digest(c.baseStrategyVersion+':'+leg.policyFingerprint):c.baseStrategyVersion,run=db.prepare('SELECT first_seen FROM paper_experiment_runs WHERE experiment_id=? AND run_id=?').get(id,t.run_id) as {first_seen:number}|undefined;
   if(!['buy','sell'].includes(t.side)||!validTime(t.ts)||t.ts>now||!validTime(t.recorded_at)||t.recorded_at<t.ts||t.recorded_at>now||![t.qty,t.cost_eur,t.fee_eur].every(Number.isFinite)||t.qty<=0||t.cost_eur<=0||t.fee_eur<0||Math.abs(t.fee_eur-t.cost_eur*c.common.feeRate)>Math.max(1e-9,t.cost_eur*1e-10)||t.realized_pnl_eur!==null&&!Number.isFinite(t.realized_pnl_eur)||t.verified!==1||t.evaluation_version!==leg.evaluationVersion||t.build_id!==c.buildId||t.strategy_version!==strategy||t.universe_hash!==c.universeHash||!run||run.first_seen>t.ts)return {...common,status:'contaminated_fill',accountId:leg.accountId};}
  fillsByAccount.set(leg.accountId,rows);
  if(leg.accountId==='hold'&&(rows.length>1||rows.some(t=>t.side!=='buy'||t.pair!=='BTC/'+c.quote)))return {...common,status:'invalid_benchmark'};
 }
 const rows=db.prepare(`SELECT s.captured_at,s.account_id,s.epoch_id,s.observed_at,s.observed_cash,s.position_count,e.account_id actual_account,e.evaluation_version,e.contamination,p.run_id,p.equity,p.reason FROM paper_experiment_samples s LEFT JOIN forward_epochs e ON e.id=s.epoch_id LEFT JOIN forward_points p ON p.epoch_id=s.epoch_id AND p.ts=s.observed_at WHERE s.experiment_id=? ORDER BY s.captured_at,s.account_id LIMIT 60003`).all(id) as any[];
 if(rows.length>60000)return {...common,status:'history_limit',currentMetrics:null};
 const groups=new Map<number,any[]>();for(const p of rows){const leg=c.legs.find(l=>l.accountId===p.account_id);
  if(!leg||p.actual_account!==p.account_id||p.epoch_id!==digest(leg.accountId+':'+leg.evaluationVersion)||p.evaluation_version!==leg.evaluationVersion||p.contamination!==null||!validTime(p.captured_at)||p.captured_at>now||!validTime(p.observed_at)||p.observed_at<c.registeredAt||p.observed_at>p.captured_at||p.captured_at-p.observed_at>1000||p.captured_at<c.registeredAt)return {...common,status:'invalid_sample'};
  const sourceRun=db.prepare('SELECT first_seen FROM paper_experiment_runs WHERE experiment_id=? AND run_id=?').get(id,p.run_id) as {first_seen:number}|undefined;
  if(!sourceRun||sourceRun.first_seen>p.observed_at)return {...common,status:'unknown_sample_run'};
  if(!Number.isFinite(p.observed_cash)||p.observed_cash<0)return {...common,status:'invalid_cash'};
  const ledgerCash=(fillsByAccount.get(p.account_id)??[]).filter(t=>t.ts<=p.observed_at).reduce((cash,t)=>cash+(t.side==='buy'?-t.cost_eur-t.fee_eur:t.cost_eur-t.fee_eur),c.startingBalance);
  if(Math.abs(ledgerCash-p.observed_cash)>1e-7)return {...common,status:'unattributed_cash',accountId:p.account_id};
  const g=groups.get(p.captured_at)??[];g.push(p);groups.set(p.captured_at,g);}
 let maxGapMs=0,gaps=0,invalid=0,previous=c.registeredAt;const good:{at:number;returns:Record<string,number>}[]=[];
 for(const [at,g]of groups){if(g.length!==3||new Set(g.map(p=>p.account_id)).size!==3)return {...common,status:'incomplete_sample'};
  const gap=at-previous;maxGapMs=Math.max(maxGapMs,gap);if(gap>90000)gaps++;previous=at;
  if(g.some(p=>p.reason!==null||typeof p.equity!=='number'||!Number.isFinite(p.equity)||p.equity<0)){invalid++;continue;}
  const returns=Object.fromEntries(g.map(p=>[p.account_id,(p.equity/c.startingBalance-1)*100]));
  if(!Object.values(returns).every(Number.isFinite))return {...common,status:'invalid_return_arithmetic'};
  good.push({at,returns});}
 const last=good.at(-1),latest=[...groups.keys()].at(-1),holdFill=db.prepare("SELECT min(ts) ts FROM trades WHERE account_id='hold' AND ts>=?").get(c.registeredAt) as {ts:number|null};
 const diagnostics={samples:groups.size,validSamples:good.length,invalidSamples:invalid,maxGapMs,longGaps:gaps,currentAgeMs:latest===undefined?null:now-latest,observedCadenceComplete:gaps===0&&invalid===0};
 if(holdFill.ts===null)return {...common,...diagnostics,status:'awaiting_benchmark_fill'};
 const lastRows=latest===undefined?[]:groups.get(latest)!;
 if(lastRows.some(p=>(fillsByAccount.get(p.account_id)??[]).some(t=>t.ts>p.observed_at)))return {...common,...diagnostics,status:'awaiting_post_fill_marks'};
 if(!last||last.at!==latest||now-last.at>120000||last.at<holdFill.ts)return {...common,...diagnostics,status:'observation_gap'};
 return {...common,...diagnostics,status:'collecting',currentMetrics:{asOf:last.at,returnsPct:last.returns,aiExcessVsRules:last.returns.ai!-last.returns.rules!,aiExcessVsHold:last.returns.ai!-last.returns.hold!}};
}
