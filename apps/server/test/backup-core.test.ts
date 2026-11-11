import {afterEach,expect,test} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {listBackups,pruneBackups,restoreBackup,runBackup,sufficientBackupSpace,verifyBackup} from '../src/backup/backup.js';
const roots:string[]=[];
function fixture(){const root=mkdtempSync(join(tmpdir(),'trading-backup-'));roots.push(root);mkdirSync(join(root,'data'),{recursive:true});return root;}
function dbAt(root:string,path='paper.db'){const file=join(root,'data',path);mkdirSync(dirname(file),{recursive:true});const db=new Database(file);db.pragma('journal_mode = WAL');db.exec('CREATE TABLE events (n INTEGER NOT NULL)');db.prepare('INSERT INTO events VALUES (?)').run(1);return db;}
function day(day:number){return new Date(2026,9,day,3,30);}
afterEach(()=>{for(const root of roots.splice(0))if(dirname(root)===resolve(tmpdir())&&basename(root).startsWith('trading-backup-'))rmSync(root,{recursive:true,force:true});});

test('consistent online SQLite backup while writer remains open, with manifest and archive filtering',async()=>{
 const root=fixture(),db=dbAt(root);mkdirSync(join(root,'data/recordings'),{recursive:true});const recorder=dbAt(root,'recordings/market-2026-11.db');
 mkdirSync(join(root,'data/archive/raw'),{recursive:true});const rawDb=dbAt(root,'archive/raw/redownloadable.db');rawDb.close();writeFileSync(join(root,'data/archive/raw/large.bin'),'re-downloadable');writeFileSync(join(root,'data/archive/raw/part.CHECKSUM'),'sha');writeFileSync(join(root,'data/archive/report.json'),'{}');writeFileSync(join(root,'data/archive/holdout-access.log'),'audit');writeFileSync(join(root,'data/recordings/heartbeat.json'),'live');
 try{const pending=runBackup({root,now:day(1)});for(let i=2;i<35;i++)db.prepare('INSERT INTO events VALUES (?)').run(i);const m=await pending;
  expect(m.status).toBe('ok');expect(m.files.some(x=>x.source==='paper.db'&&x.integrityCheck==='ok')).toBe(true);expect(m.files.some(x=>x.source==='recordings/market-2026-11.db')).toBe(true);expect(m.files.some(x=>x.source==='archive/raw/large.bin')).toBe(false);expect(m.files.some(x=>x.source==='archive/raw/redownloadable.db')).toBe(false);expect(m.files.some(x=>x.source==='archive/raw/part.CHECKSUM')).toBe(true);expect(m.files.some(x=>x.source==='archive/report.json')).toBe(true);expect(m.files.some(x=>x.source==='archive/holdout-access.log')).toBe(true);
  expect(verifyBackup({root},m.id).ok).toBe(true);const copy=new Database(join(root,'data/backups',m.id,'files/paper.db'),{readonly:true});try{expect((copy.prepare('SELECT count(*) AS n FROM events').get() as {n:number}).n).toBeGreaterThan(0);}finally{copy.close();}
 }finally{db.close();recorder.close();}
});

test('tampered SQLite backup is rejected and restore never touches current database',async()=>{
 const root=fixture(),db=dbAt(root);try{const m=await runBackup({root,now:day(2)});const copy=join(root,'data/backups',m.id,'files/paper.db');writeFileSync(copy,'corrupted');const check=verifyBackup({root},m.id);expect(check.ok).toBe(false);expect(check.errors.join(' ')).toMatch(/SHA256|integrity_check/);expect(()=>restoreBackup({root},m.id)).toThrow(/abgebrochen/);expect((db.prepare('SELECT count(*) AS n FROM events').get() as {n:number}).n).toBe(1);}finally{db.close();}
});

test('restore preserves previous version and refuses an active lock',async()=>{
 const root=fixture(),db=dbAt(root);const m=await runBackup({root,now:day(3)});db.prepare('INSERT INTO events VALUES (2)').run();db.close();
 writeFileSync(join(root,'data','live-test.lock'),String(process.pid));expect(()=>restoreBackup({root},m.id,'paper.db')).toThrow(/Prozesssperre/);rmSync(join(root,'data','live-test.lock'));
 expect(restoreBackup({root},m.id,'paper.db')).toEqual(['paper.db']);const reopened=new Database(join(root,'data/paper.db'),{readonly:true});try{expect((reopened.prepare('SELECT count(*) AS n FROM events').get() as {n:number}).n).toBe(1);}finally{reopened.close();}
 const sidecar=readdirSync(join(root,'data')).find(x=>x.startsWith('paper.db.before-restore-'));expect(sidecar).toBeTruthy();const previous=new Database(join(root,'data',sidecar!),{readonly:true});try{expect((previous.prepare('SELECT count(*) AS n FROM events').get() as {n:number}).n).toBe(2);}finally{previous.close();}
});

test('live journal restore requires extra acknowledgement',async()=>{
 const root=fixture(),db=dbAt(root,'live-usdt-journal.db');db.close();const m=await runBackup({root,now:day(4)});
 expect(()=>restoreBackup({root},m.id,'live-usdt-journal.db')).toThrow(/i-understand-live-journal/);
 expect(restoreBackup({root},m.id,'live-usdt-journal.db',true)).toEqual(['live-usdt-journal.db']);
});

test('retention protects last good snapshot and removes only owned old copies',async()=>{
 const root=fixture(),db=dbAt(root);try{
  const keep={daily:0,weekly:0,monthly:0};const first=await runBackup({root,now:day(5),retention:keep});expect(listBackups({root})).toHaveLength(1);
  const second=await runBackup({root,now:day(6),retention:keep});expect(listBackups({root}).map(x=>x.id)).toEqual([second.id]);
  expect(verifyBackup({root},second.id).ok).toBe(true);
  expect(()=>pruneBackups({root,retention:keep},first.id)).toThrow(/Schutz-Backup/);
 }finally{db.close();}
});

test('backup never overwrites an existing snapshot and leaves no partial directory',async()=>{
 const root=fixture(),db=dbAt(root);try{const m=await runBackup({root,now:day(7)});const original=readFileSync(join(root,'data/backups',m.id,'manifest.json'),'utf8');await expect(runBackup({root,now:day(7)})).rejects.toThrow(/existiert/);expect(readFileSync(join(root,'data/backups',m.id,'manifest.json'),'utf8')).toBe(original);expect(readdirSync(join(root,'data/backups')).some(x=>x.startsWith('.pending-'))).toBe(false);}finally{db.close();}
});

test('preflight disk threshold refuses a partial backup before creating staging',()=>{
 const threshold=64n*1024n*1024n;
 expect(sufficientBackupSpace(0,threshold)).toBe(true);
 expect(sufficientBackupSpace(1024,threshold)).toBe(false);
 expect(sufficientBackupSpace(1024,threshold+2048n)).toBe(true);
});

test('daily, weekly and monthly retention keep distinct buckets',async()=>{
 const root=fixture(),db=dbAt(root);try{
  const keepAll={daily:20,weekly:20,monthly:20};
  for(const date of [new Date(2026,9,1,3,30),new Date(2026,9,10,3,30),new Date(2026,9,17,3,30),new Date(2026,10,1,3,30),new Date(2026,10,10,3,30)])await runBackup({root,now:date,retention:keepAll});
  pruneBackups({root,retention:{daily:1,weekly:2,monthly:2}},'2026-11-10_0330');
  expect(listBackups({root}).map(x=>x.id)).toEqual(['2026-11-10_0330','2026-11-01_0330','2026-10-17_0330']);
 }finally{db.close();}
});

test('restore ignores empty WAL left by read-only backup but blocks non-empty WAL',async()=>{
 const root=fixture(),db=dbAt(root);db.close();const m=await runBackup({root,now:day(5)});
 writeFileSync(join(root,'data','paper.db-wal'),'');
 expect(restoreBackup({root},m.id,'paper.db')).toEqual(['paper.db']);
 writeFileSync(join(root,'data','paper.db-wal'),'pending');
 expect(()=>restoreBackup({root},m.id,'paper.db')).toThrow(/SQLite-Sidecar/);
});
