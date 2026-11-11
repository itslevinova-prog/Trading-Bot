import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import type Database from 'better-sqlite3';

export const PAPER_RECONCILE_VERSION='paper-ledger-reconcile-v1';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const near=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-7,Math.max(Math.abs(a),Math.abs(b))*1e-9);
type Account={id:string;strategy:string;startingBalance:number;cash:number;createdAt:number};
type Fill={id:string;ts:number;pair:string;side:string;qty:number;price:number;cost:number;fee:number;realizedPnl:number|null};
type Position={pair:string;qty:number;basis:number;avgEntry:number};
type Deposit={period:string;ts:number;amount:number};
export type PaperReconcileIssue={
 code:'invalid_account'|'missing_deposit_ledger'|'invalid_deposit'|'invalid_fill'|
 'cost_mismatch'|'negative_cash'|'sell_without_position'|'realized_pnl_mismatch'|
 'cash_mismatch'|'position_qty_mismatch'|'position_basis_mismatch'|
 'position_avg_mismatch'|'duplicate_position';
 detail:string;
};
export type PaperReconcileResult={
 version:typeof PAPER_RECONCILE_VERSION;
 accountId:string;status:'matched'|'blocked';
 snapshotId:string;fills:number;deposits:number;verifiedPositions:number;
 calculatedCash:number|null;actualCash:number|null;
 issues:PaperReconcileIssue[];
 /** The mark-to-market peak is not independently derivable from fills alone. */
 unchecked:['peak_equity','historical_order_book'];
};
export function reconcilePaperAccount(sql:Database.Database,accountId:string):PaperReconcileResult {
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(accountId))throw Error('Invalid paper account id');
 // Read an internally consistent SQLite snapshot; never insert/update/delete trades.
 return sql.transaction(()=>{
  const account=sql.prepare('SELECT id,strategy,starting_balance AS startingBalance,cash,created_at AS createdAt FROM accounts WHERE id=?')
   .get(accountId) as Account|undefined;
  const fills=sql.prepare('SELECT id,ts,pair,side,qty,fill_price AS price,cost_eur AS cost,'+
   'fee_eur AS fee,realized_pnl_eur AS realizedPnl FROM trades WHERE account_id=? ORDER BY ts,id')
   .all(accountId) as Fill[];
  const actualPositions=sql.prepare('SELECT pair,qty,cost_basis_eur AS basis,avg_entry_price AS avgEntry '+
   'FROM positions WHERE account_id=? ORDER BY pair,id')
   .all(accountId) as Position[];
  const depositTable=sql.prepare(
   "SELECT name FROM sqlite_master WHERE type='table' AND name='dca_paper_deposits'"
  ).get();
  const deposits:Deposit[]=account?.strategy==='dca'&&depositTable?
   sql.prepare('SELECT period,ts,amount FROM dca_paper_deposits WHERE account_id=? ORDER BY ts,period')
    .all(accountId) as Deposit[]:[];
  const snapshotId=digest({version:PAPER_RECONCILE_VERSION,account,fills,actualPositions,deposits,
   hasDepositLedger:!!depositTable});
  const issues:PaperReconcileIssue[]=[];
  const add=(code:PaperReconcileIssue['code'],detail:string)=>issues.push({code,detail});
  if(!account||!Number.isFinite(account.startingBalance)||account.startingBalance<0||
     !Number.isFinite(account.cash)||account.cash<0){
   add('invalid_account','Account or its initial/current cash is missing or invalid');
  }
  if(account?.strategy==='dca'&&!depositTable)
   add('missing_deposit_ledger','DCA cash contributions cannot be proven without their durable deposit journal');
  const ledger=new Map<string,{qty:number;basis:number}>();
  let cash=account?.startingBalance??NaN;
  const events=[
   ...deposits.map(x=>({kind:'deposit' as const,ts:x.ts,id:x.period,item:x})),
   ...fills.map(x=>({kind:'fill' as const,ts:x.ts,id:x.id,item:x}))
  ].sort((a,b)=>a.ts-b.ts||(a.kind===b.kind?0:a.kind==='deposit'?-1:1)||
    a.id.localeCompare(b.id));
  for(const event of events){
   if(event.kind==='deposit'){
    const {amount,ts,period}=event.item;
    if(!Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(ts)||ts<0||
       typeof period!=='string'||!period){
     add('invalid_deposit','Malformed DCA contribution event');
     continue;
    }
    cash+=amount;continue;
   }
   const {id,pair,ts,side,qty,price,cost,fee,realizedPnl}=event.item;
   if(!Number.isSafeInteger(ts)||ts<0||!id||!pair||
      (side!=='buy'&&side!=='sell')||
      ![qty,price,cost,fee].every(x=>Number.isFinite(x)&&x>=0)||
      qty<=0||price<=0||fee>cost||!Number.isFinite(cash)){
    add('invalid_fill','Malformed recorded fill '+String(id));continue;
   }
   if(!near(qty*price,cost)){
    add('cost_mismatch','Journal fill '+id+' has a cost inconsistent with its quantity and price');
    continue;
   }
   const existing=ledger.get(pair)??{qty:0,basis:0};
   if(side==='buy'){
    cash-=cost+fee;
    ledger.set(pair,{qty:existing.qty+qty,basis:existing.basis+cost+fee});
    if(cash< -1e-7)add('negative_cash','Cash balance becomes negative after '+id);
   }else{
    if(existing.qty<=0||qty>existing.qty+1e-8){
     add('sell_without_position','Sell '+id+' exceeds quantity accumulated from prior recorded fills');
     continue;
    }
    const reducedBasis=existing.basis*qty/existing.qty;
    const expectedPnl=cost-fee-reducedBasis;
    if(realizedPnl===null||!Number.isFinite(realizedPnl)||!near(realizedPnl,expectedPnl))
     add('realized_pnl_mismatch','Sell '+id+' realized PnL differs from chronological cost basis');
    cash+=cost-fee;
    const remains=existing.qty-qty;
    if(remains<=1e-9)ledger.delete(pair);
    else ledger.set(pair,{qty:remains,basis:existing.basis-reducedBasis});
   }
  }
  if(account&&(!Number.isFinite(cash)||!near(cash,account.cash)))
   add('cash_mismatch','Stored cash differs from beginning cash plus deposits and net fills');
  const seen=new Set<string>();
  for(const stored of actualPositions){
   if(seen.has(stored.pair)){
    add('duplicate_position','More than one persisted position for '+stored.pair);
    continue;
   }
   seen.add(stored.pair);
   const expected=ledger.get(stored.pair);
   if(!expected||!Number.isFinite(stored.qty)||stored.qty<=0||!near(expected.qty,stored.qty))
    add('position_qty_mismatch','Stored quantity differs from fills for '+stored.pair);
   if(!expected||!Number.isFinite(stored.basis)||stored.basis<=0||!near(expected.basis,stored.basis))
    add('position_basis_mismatch','Stored cost basis differs from fills for '+stored.pair);
   if(!expected||!Number.isFinite(stored.avgEntry)||stored.avgEntry<=0||
      !near(stored.avgEntry,stored.basis/stored.qty))
    add('position_avg_mismatch','Stored entry price differs from cost basis per unit for '+stored.pair);
  }
  for(const pair of ledger.keys())
   if(!seen.has(pair))add('position_qty_mismatch','Non-zero fill quantity has no stored position for '+pair);
  return {version:PAPER_RECONCILE_VERSION,accountId,
   status:issues.length?'blocked':'matched',snapshotId,fills:fills.length,deposits:deposits.length,
   verifiedPositions:actualPositions.length,calculatedCash:Number.isFinite(cash)?cash:null,
   actualCash:account?.cash??null,issues,
   unchecked:['peak_equity','historical_order_book']} satisfies PaperReconcileResult;
 })();
}
export function reconcileAllPaperAccounts(sql:Database.Database):PaperReconcileResult[]{
 const ids=sql.prepare('SELECT id FROM accounts ORDER BY id').all() as {id:string}[];
 return ids.map(x=>reconcilePaperAccount(sql,x.id));
}
/** Lock records and audit events are separate from trading tables. These are
 * create-only: fixing a corrupted row cannot silently remove an old blocker. */
export function initPaperReconcileGuard(sql:Database.Database):void{
 sql.exec(`CREATE TABLE IF NOT EXISTS paper_reconcile_blocks(
  account_id TEXT PRIMARY KEY, detected_at INTEGER NOT NULL,
  reason_code TEXT NOT NULL,snapshot_id TEXT NOT NULL,details_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS paper_reconcile_audit(
  id TEXT PRIMARY KEY,account_id TEXT NOT NULL,checked_at INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL,status TEXT NOT NULL,issues_json TEXT NOT NULL);`);
}
export class PaperReconcileGate{
 constructor(private readonly sql:Database.Database,private readonly now:()=>number=Date.now){
  initPaperReconcileGuard(sql);
 }
 /** Startup scan is explicit and never clears a previous denial. */
 scanAll():PaperReconcileResult[]{
  const reports=reconcileAllPaperAccounts(this.sql);
  for(const result of reports)this.record(result);
  return reports;
 }
 private record(result:PaperReconcileResult):void{
  this.sql.transaction(()=>{
   const at=this.now(),codes=result.issues.map(x=>x.code);
   const auditId=digest([result.accountId,result.snapshotId,result.status,codes]);
   this.sql.prepare('INSERT OR IGNORE INTO paper_reconcile_audit '+
    '(id,account_id,checked_at,snapshot_id,status,issues_json) VALUES(?,?,?,?,?,?)')
    .run(auditId,result.accountId,at,result.snapshotId,result.status,JSON.stringify(result.issues));
   if(result.status==='blocked')
    this.sql.prepare('INSERT OR IGNORE INTO paper_reconcile_blocks '+
     '(account_id,detected_at,reason_code,snapshot_id,details_json) VALUES(?,?,?,?,?)')
     .run(result.accountId,at,codes[0]??'unknown',result.snapshotId,JSON.stringify(result.issues));
  })();
 }
 /** Each buy checks current committed fills and any historical sticky lock.
  * Sell/protective orders are NEVER denied by this entry-only guard. */
 entryBlock(accountId:string):string|null{
  let result:PaperReconcileResult;
  try{result=reconcilePaperAccount(this.sql,accountId);this.record(result);}
  catch(error){return 'PAPER_RECONCILE_UNAVAILABLE: '+String(error instanceof Error?error.message:error);}
  const persisted=this.sql.prepare('SELECT reason_code AS code FROM paper_reconcile_blocks WHERE account_id=?')
   .get(accountId) as {code:string}|undefined;
  if(persisted)return 'PAPER_RECONCILE_BLOCKED: '+persisted.code;
  return result.status==='matched'?null:'PAPER_RECONCILE_BLOCKED: '+(result.issues[0]?.code??'unknown');
 }
}

/** Content-addressed local evidence. Does not mutate the trading DB or
 * overwrite past reconciliation reports. */
export function writePaperReconcileEvidence(root:string,reports:readonly PaperReconcileResult[]):string{
 const evidence={version:PAPER_RECONCILE_VERSION,source:'local:sqlite-paper-trade-journal',
  accounts:reports};
 const fingerprint=digest(evidence);
 const path=resolve(root,'data','paper-reconcile',fingerprint+'.json');
 const content=JSON.stringify({...evidence,fingerprint},null,2)+'\n';
 mkdirSync(dirname(path),{recursive:true});
 if(existsSync(path)){
  if(readFileSync(path,'utf8')!==content)throw Error('Reconciliation evidence hash collision');
  return path;
 }
 writeFileSync(path,content,{flag:'wx'});
 return path;
}
