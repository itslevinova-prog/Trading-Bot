import Database from 'better-sqlite3';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {config,projectRoot} from '../config.js';
import {reconcileAllPaperAccounts,writePaperReconcileEvidence} from './paper-reconcile.js';

/** On-demand read-only scan. Persistent entry locks are managed only by the
 * running Paper adapter; this command never changes a trading database. */
export function main(args=process.argv.slice(2)):void{
 if(args.length)throw Error('Usage: pnpm paper:reconcile (read-only; no args)');
 const file=resolve(projectRoot,config.DATABASE_PATH);
 if(!existsSync(file))throw Error('Paper DB missing; reconciliation was not performed');
 const db=new Database(file,{readonly:true,fileMustExist:true});
 try{
  const reports=reconcileAllPaperAccounts(db);
  const path=writePaperReconcileEvidence(projectRoot,reports);
  process.stdout.write(JSON.stringify({status:reports.every(x=>x.status==='matched')?'matched':'blocked',
   accounts:reports.map(x=>({accountId:x.accountId,status:x.status,snapshotId:x.snapshotId,
    issues:x.issues.map(issue=>issue.code)})),evidencePath:path},null,2)+'\n');
  if(reports.some(x=>x.status!=='matched'))process.exitCode=1;
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{main();}catch(error){console.error(error);process.exitCode=1;}
}
