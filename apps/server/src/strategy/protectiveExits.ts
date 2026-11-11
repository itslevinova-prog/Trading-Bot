import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import type {BrokerOrder} from '@paper/shared';
export type ProtectedPosition={id:string;accountId:string;pair:string;stopLossPrice:number|null;takeProfitPrice:number|null};
export type ExitFailure={positionId:string;accountId:string;pair:string;attempts:number;firstAt:number;lastAt:number;retryAt:number;reason:string;trigger:string;state?:'pending'|'retry_wait';unexpected:boolean};
export interface ExitFailureStore{get(positionId:string):ExitFailure|undefined;all(accountId?:string):ExitFailure[];save(failure:ExitFailure):void;clear(positionId:string):void;pause(accountId:string):void;}
export function initExitFailures(database:Database.Database){database.exec("CREATE TABLE IF NOT EXISTS protective_exit_failures(position_id TEXT PRIMARY KEY REFERENCES positions(id) ON DELETE CASCADE,account_id TEXT NOT NULL,pair TEXT NOT NULL,attempts INTEGER NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,retry_at INTEGER NOT NULL,reason TEXT NOT NULL,trigger TEXT NOT NULL,unexpected INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'retry_wait')");if(!(database.pragma('table_info(protective_exit_failures)') as {name:string}[]).some(row=>row.name==='state'))database.exec("ALTER TABLE protective_exit_failures ADD COLUMN state TEXT NOT NULL DEFAULT 'retry_wait'");}
export class SqliteExitFailures implements ExitFailureStore{
 constructor(private database:Database.Database){}
 private decode(row:any):ExitFailure|undefined{return row?{positionId:row.position_id,accountId:row.account_id,pair:row.pair,attempts:row.attempts,firstAt:row.first_at,lastAt:row.last_at,retryAt:row.retry_at,reason:row.reason,trigger:row.trigger,state:row.state==='pending'?'pending':'retry_wait',unexpected:!!row.unexpected}:undefined;}
 has(accountId:string){return !!this.database.prepare('SELECT 1 FROM protective_exit_failures WHERE account_id=? LIMIT 1').get(accountId);}
 get(id:string){return this.decode(this.database.prepare('SELECT * FROM protective_exit_failures WHERE position_id=?').get(id));}
 all(accountId?:string){const rows=accountId===undefined?this.database.prepare('SELECT * FROM protective_exit_failures ORDER BY last_at DESC').all():this.database.prepare('SELECT * FROM protective_exit_failures WHERE account_id=? ORDER BY last_at DESC').all(accountId);return rows.map(row=>this.decode(row)!);}
 save(f:ExitFailure){this.database.prepare('INSERT INTO protective_exit_failures(position_id,account_id,pair,attempts,first_at,last_at,retry_at,reason,trigger,unexpected,state) VALUES(@positionId,@accountId,@pair,@attempts,@firstAt,@lastAt,@retryAt,@reason,@trigger,@unexpected,@state) ON CONFLICT(position_id) DO UPDATE SET attempts=excluded.attempts,last_at=excluded.last_at,retry_at=excluded.retry_at,reason=excluded.reason,trigger=excluded.trigger,unexpected=excluded.unexpected,state=excluded.state').run({...f,state:f.state??'retry_wait',unexpected:Number(f.unexpected)});}
 clear(id:string){this.database.prepare('DELETE FROM protective_exit_failures WHERE position_id=?').run(id);}
 // Pause independently first: failure to save diagnostics must not reopen entries.
 pause(id:string){this.database.prepare("UPDATE accounts SET status='paused' WHERE id=? AND status='active'").run(id);}
}
type Options={positions:(pair:string)=>ProtectedPosition[];place:(order:BrokerOrder)=>Promise<{ok:boolean;reason:string}>;store:ExitFailureStore;now?:()=>number;notify?:(type:string,payload:unknown)=>void;report?:(message:string,positionId:string)=>void};
/** Paper only. Retry requires another valid market tick after the exit is latched; no background orders. */
export class ProtectiveExits{
 private pending=new Map<string,Promise<void>>();private fallback=new Map<string,ExitFailure>();private readRetryAt=new Map<string,number>();private stopping=false;private now:()=>number;
 constructor(private options:Options){this.now=options.now??Date.now;}
 private report(message:string,id:string){try{this.options.report?.(message,id);}catch{/* Diagnostics cannot create a rejected background task. */}}
 private notify(type:string,payload:unknown,id:string){try{this.options.notify?.(type,payload);}catch{this.report('Protective-exit notification failed',id);}}
 onTick(pair:string,bid:number){if(this.stopping||!Number.isFinite(bid)||bid<=0)return;
  for(const p of this.options.positions(pair)){
   if(this.pending.has(p.id)||this.now()<(this.readRetryAt.get(p.id)??0))continue;
   let prior:ExitFailure|undefined;
   try{prior=this.fallback.get(p.id)??this.options.store.get(p.id);this.readRetryAt.delete(p.id);if(prior&&this.now()<prior.retryAt)continue;}catch{this.readRetryAt.set(p.id,this.now()+5000);this.report('Protective-exit state unavailable',p.id);try{this.options.store.pause(p.accountId);}catch{this.report('Protective-exit account pause failed',p.id);}continue;}
   const reason=prior?.trigger??(p.stopLossPrice!==null&&bid<=p.stopLossPrice?'Stop-Loss ausgelöst':p.takeProfitPrice!==null&&bid>=p.takeProfitPrice?'Take-Profit ausgelöst':null);if(!reason)continue;
   const task=this.execute(p,reason,prior).finally(()=>{this.pending.delete(p.id);});this.pending.set(p.id,task);
  }
 }
 private async execute(p:ProtectedPosition,trigger:string,previous?:ExitFailure){
  const now=this.now(),attempts=Math.min(1000000,(previous?.attempts??0)+1),delay=Math.min(60000,1000*2**Math.min(attempts-1,6));
  const intent:ExitFailure={positionId:p.id,accountId:p.accountId,pair:p.pair,attempts,firstAt:previous?.firstAt??now,lastAt:now,retryAt:now+delay,reason:'Paper protective exit pending',trigger,state:'pending',unexpected:false};
  this.fallback.set(p.id,intent);
  try{this.options.store.save(intent);}catch{this.report('Protective trigger could not be persisted; no paper order submitted',p.id);try{this.options.store.pause(p.accountId);}catch{this.report('Protective-exit account pause failed',p.id);}return;}
  let result:{ok:boolean;reason:string},unexpected=false;
  try{result=await this.options.place({accountId:p.accountId,pair:p.pair,side:'sell',sellFraction:1,reason:trigger,decisionId:randomUUID(),protectiveExit:true});}
  catch{unexpected=true;result={ok:false,reason:'Unexpected paper execution error; inspect local diagnostics'};this.report('Protective paper execution failed',p.id);}
  try{
   if(result.ok){this.fallback.delete(p.id);this.options.store.clear(p.id);this.notify('protective_exit_status',{positionId:p.id,accountId:p.accountId,status:'resolved'},p.id);return;}
   const completedAt=this.now(),failure:ExitFailure={...intent,lastAt:completedAt,retryAt:completedAt+delay,reason:result.reason.slice(0,500),state:'retry_wait',unexpected};
   this.fallback.set(p.id,failure);this.options.store.pause(p.accountId);
   this.options.store.save(failure);this.notify('protective_exit_status',{...failure,status:'retry_wait'},p.id);
  }catch{this.report('Protective-exit persistence failed; account requires inspection',p.id);try{this.options.store.pause(p.accountId);}catch{this.report('Protective-exit account pause failed',p.id);}}
 }
 stop(){this.stopping=true;}
 async drain(){await Promise.all(this.pending.values());}
}
