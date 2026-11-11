import {afterEach,beforeEach,expect,test} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PaperReconcileGate,reconcilePaperAccount,reconcileAllPaperAccounts,writePaperReconcileEvidence}
 from '../src/broker/paper-reconcile.js';

let db:Database.Database,folder:string;
beforeEach(()=>{
 folder=mkdtempSync(join(tmpdir(),'paper-reconcile-'));
 db=new Database(join(folder,'paper.db'));
 db.exec(`CREATE TABLE accounts(
  id TEXT PRIMARY KEY,strategy TEXT NOT NULL,starting_balance REAL NOT NULL,
  cash REAL NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE positions(
  id TEXT PRIMARY KEY,account_id TEXT NOT NULL,pair TEXT NOT NULL,
  qty REAL NOT NULL,cost_basis_eur REAL NOT NULL,avg_entry_price REAL NOT NULL);
 CREATE TABLE trades(
  id TEXT PRIMARY KEY,account_id TEXT NOT NULL,ts INTEGER NOT NULL,pair TEXT NOT NULL,
  side TEXT NOT NULL,qty REAL NOT NULL,fill_price REAL NOT NULL,
  cost_eur REAL NOT NULL,fee_eur REAL NOT NULL,realized_pnl_eur REAL);
 CREATE TABLE dca_paper_deposits(
  account_id TEXT NOT NULL,period TEXT NOT NULL,ts INTEGER NOT NULL,
  amount REAL NOT NULL,PRIMARY KEY(account_id,period));`);
});
afterEach(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
function account(id='rules',cash=1000,starting=1000,strategy='rules'){
 db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(id,strategy,starting,cash,0);
}
function fill(id:string,ts:number,side:'buy'|'sell',qty:number,price:number,fee:number,
 realized:number|null=null,accountId='rules'){
 db.prepare('INSERT INTO trades VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run(id,accountId,ts,'BTC/EUR',side,qty,price,qty*price,fee,realized);
}
function position(id='rules',qty=1,basis=101){
 db.prepare('INSERT INTO positions VALUES(?,?,?,?,?,?)')
  .run('pos-'+id,id,'BTC/EUR',qty,basis,basis/qty);
}
function correctLedger(){
 account('rules',916.8,1000);
 fill('buy-1',1000,'buy',2,100,2);
 fill('sell-1',2000,'sell',1,120,1.2,17.8);
 position('rules',1,101);
}
test('chronological fills reproduce exact cash, qty, fees and proportional cost basis',()=>{
 correctLedger();
 const result=reconcilePaperAccount(db,'rules');
 expect(result.status).toBe('matched');
 expect(result.issues).toEqual([]);
 expect(result.calculatedCash).toBeCloseTo(916.8,10);
 expect(result.actualCash).toBeCloseTo(916.8,10);
 expect(result.fills).toBe(2);
 expect(result.verifiedPositions).toBe(1);
 expect(result.snapshotId).toMatch(/^[a-f0-9]{64}$/);
 expect(reconcilePaperAccount(db,'rules')).toEqual(result);
 expect(result.unchecked).toContain('peak_equity');
});
test('tampering stored cash blocks entries and creates an irreversible audit record, without repair',()=>{
 correctLedger();
 db.prepare('UPDATE accounts SET cash=999 WHERE id=?').run('rules');
 const originalCash=(db.prepare('SELECT cash FROM accounts WHERE id=?').get('rules') as {cash:number}).cash;
 const gate=new PaperReconcileGate(db,()=>123456);
 const reports=gate.scanAll();
 expect(reports[0]?.status).toBe('blocked');
 expect(reports[0]?.issues.map(x=>x.code)).toContain('cash_mismatch');
 expect(gate.entryBlock('rules')).toContain('PAPER_RECONCILE_BLOCKED');
 const persisted=db.prepare('SELECT reason_code,snapshot_id FROM paper_reconcile_blocks WHERE account_id=?')
  .get('rules') as {reason_code:string;snapshot_id:string};
 expect(persisted.reason_code).toBe('cash_mismatch');
 expect(persisted.snapshot_id).toBe(reports[0]?.snapshotId);
 expect((db.prepare('SELECT cash FROM accounts WHERE id=?').get('rules') as {cash:number}).cash).toBe(originalCash);
 db.prepare('UPDATE accounts SET cash=916.8 WHERE id=?').run('rules');
 expect(reconcilePaperAccount(db,'rules').status).toBe('matched');
 expect(gate.entryBlock('rules')).toContain('PAPER_RECONCILE_BLOCKED'); // sticky
 expect((db.prepare('SELECT COUNT(*) AS count FROM paper_reconcile_audit').get() as {count:number}).count)
  .toBeGreaterThanOrEqual(2);
});
test('wrong persisted position quantity, cost basis and average are detected independently',()=>{
 correctLedger();
 db.prepare('UPDATE positions SET qty=3,cost_basis_eur=400,avg_entry_price=1').run();
 const codes=reconcilePaperAccount(db,'rules').issues.map(x=>x.code);
 expect(codes).toContain('position_qty_mismatch');
 expect(codes).toContain('position_basis_mismatch');
 expect(codes).toContain('position_avg_mismatch');
});
test('invalid realized profit and forged trade cost are not accepted as evidence',()=>{
 correctLedger();
 db.prepare('UPDATE trades SET realized_pnl_eur=999 WHERE id=?').run('sell-1');
 expect(reconcilePaperAccount(db,'rules').issues.map(x=>x.code)).toContain('realized_pnl_mismatch');
 db.prepare('UPDATE trades SET cost_eur=999 WHERE id=?').run('buy-1');
 expect(reconcilePaperAccount(db,'rules').issues.map(x=>x.code)).toContain('cost_mismatch');
});
test('DCA contributions are replayed as real recorded cash inputs, not invented initial balance',()=>{
 account('dca',49.5,0,'dca');
 db.prepare('INSERT INTO dca_paper_deposits VALUES(?,?,?,?)').run('dca','2022-01',1000,100);
 fill('dca-buy',2000,'buy',1,50,.5,null,'dca');
 position('dca',1,50.5);
 const result=reconcilePaperAccount(db,'dca');
 expect(result.status).toBe('matched');
 expect(result.deposits).toBe(1);
 db.exec('DROP TABLE dca_paper_deposits');
 expect(reconcilePaperAccount(db,'dca')).toEqual(expect.objectContaining({
  status:'blocked'
 }));
 expect(reconcilePaperAccount(db,'dca').issues.map(x=>x.code)).toContain('missing_deposit_ledger');
});
test('half-finished simulated write never triggers reconciliation repair',()=>{
 account('rules',1000,1000);
 fill('not-committed-to-cash',1000,'buy',1,100,1);
 const gate=new PaperReconcileGate(db);
 expect(gate.entryBlock('rules')).toContain('PAPER_RECONCILE_BLOCKED');
 const before=(db.prepare('SELECT cash FROM accounts WHERE id=?').get('rules') as {cash:number}).cash;
 expect(before).toBe(1000);
 expect(reconcilePaperAccount(db,'rules').issues.map(x=>x.code)).toEqual(expect.arrayContaining([
  'cash_mismatch','position_qty_mismatch'
 ]));
 expect((db.prepare('SELECT cash FROM accounts WHERE id=?').get('rules') as {cash:number}).cash).toBe(before);
});
test('startup scan stays sticky across new guard instances and clean accounts remain eligible',()=>{
 correctLedger();
 account('clean',250,250);
 const first=new PaperReconcileGate(db,()=>10);
 expect(first.scanAll().map(x=>x.status)).toEqual(['matched','matched']);
 expect(first.entryBlock('rules')).toBeNull();
 expect(first.entryBlock('clean')).toBeNull();
 db.prepare('UPDATE positions SET cost_basis_eur=200 WHERE account_id=?').run('rules');
 expect(first.entryBlock('rules')).toContain('PAPER_RECONCILE_BLOCKED');
 const second=new PaperReconcileGate(db,()=>20);
 expect(second.scanAll().find(x=>x.accountId==='rules')?.status).toBe('blocked');
 db.prepare('UPDATE positions SET cost_basis_eur=101 WHERE account_id=?').run('rules');
 expect(second.entryBlock('rules')).toContain('PAPER_RECONCILE_BLOCKED');
 expect(reconcileAllPaperAccounts(db).every(x=>x.status==='matched')).toBe(true);
});

test('separate evidence file is content-addressed and never rewrites prior snapshots',()=>{
 correctLedger();
 const result=reconcilePaperAccount(db,'rules');
 const first=writePaperReconcileEvidence(folder,[result]);
 const original=readFileSync(first,'utf8');
 expect(JSON.parse(original).accounts[0].snapshotId).toBe(result.snapshotId);
 expect(writePaperReconcileEvidence(folder,[result])).toBe(first);
 expect(readFileSync(first,'utf8')).toBe(original);
 db.prepare('UPDATE accounts SET cash=999 WHERE id=?').run('rules');
 const later=writePaperReconcileEvidence(folder,[reconcilePaperAccount(db,'rules')]);
 expect(later).not.toBe(first);
 expect(readFileSync(first,'utf8')).toBe(original);
});
