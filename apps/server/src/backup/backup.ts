import Database from 'better-sqlite3';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {closeSync,copyFileSync,constants,existsSync,lstatSync,mkdirSync,openSync,readFileSync,readSync,readdirSync,realpathSync,renameSync,rmSync,statSync,statfsSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';

export type BackupEntry={source:string;storedPath:string;kind:'sqlite'|'file';size:number;sha256:string;integrityCheck:'ok'|null};
export type BackupManifest={version:1;id:string;createdAt:string;gitCommit:string|null;status:'ok'|'invalid';files:BackupEntry[]};
export type BackupOptions={root:string;backupDir?:string;includeArchive?:boolean;now?:Date;retention?:{daily:number;weekly:number;monthly:number}};
export type BackupCheck={id:string;ok:boolean;errors:string[];manifest:BackupManifest|null};
const ID=/^\d{4}-\d{2}-\d{2}_\d{4}$/;
const HASH=/^[a-f0-9]{64}$/;
const GIT_SHA=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const BASE_RETENTION={daily:7,weekly:4,monthly:6};

function inside(parent:string,child:string){const rel=relative(parent,child);return rel===''||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);}
function pathParts(p:string){if(!p||p.includes('\\')||p.includes('\0')||p.split('/').some(x=>!x||x==='.'||x==='..'||x.includes(':')))throw Error(`Unsicherer Backup-Pfad: ${p}`);return p.split('/');}
function safeExisting(path:string,expected:'file'|'directory'){
 if(!existsSync(path))return false;
 const s=lstatSync(path);
 if(s.isSymbolicLink()||(expected==='file'? !s.isFile()||s.nlink!==1:!s.isDirectory()))throw Error(`Unsicheres Dateisystemobjekt: ${path}`);
 return true;
}
function assertNoSymlinks(path:string){let current=resolve(path);while(true){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error(`Symbolischer Link nicht erlaubt: ${current}`);const p=dirname(current);if(p===current)break;current=p;}}
function options(o:BackupOptions){const root=resolve(o.root),data=join(root,'data'),target=resolve(root,o.backupDir??process.env.BACKUP_DIR??'data/backups');
 if(!inside(root,data)||inside(target,data)||target===data)throw Error('BACKUP_DIR darf data/ nicht umfassen');
 assertNoSymlinks(root);assertNoSymlinks(data);assertNoSymlinks(target);
 const includeArchive=o.includeArchive??process.env.BACKUP_INCLUDE_ARCHIVE==='true';
 const retention=o.retention??Object.fromEntries((['daily','weekly','monthly'] as const).map(k=>{const raw=process.env[`BACKUP_RETENTION_${k.toUpperCase()}`];const n=raw===undefined?BASE_RETENTION[k]:Number(raw);if(!Number.isSafeInteger(n)||n<0||n>10000)throw Error(`Ungültige Backup-Aufbewahrung: ${k}`);return [k,n]})) as {daily:number;weekly:number;monthly:number};
 return {root,data,target,includeArchive,retention};
}
function idAt(date:Date){const p=(n:number)=>String(n).padStart(2,'0');return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;}
export function sufficientBackupSpace(bytes:number,free:bigint){return free>=BigInt(Math.ceil(bytes*2))+64n*1024n*1024n;}
function ensureStorageFree(folder:string,bytes:number){const fs=statfsSync(folder);const free=BigInt(fs.bavail)*BigInt(fs.bsize);if(!sufficientBackupSpace(bytes,free))throw Error(`Backup abgebrochen: zu wenig freier Speicher (${free} Bytes frei)`);}
function sha(path:string){const h=createHash('sha256'),fd=openSync(path,'r'),buffer=Buffer.allocUnsafe(1024*1024);try{let count:number;while((count=readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,count));return h.digest('hex');}finally{closeSync(fd);}}
function integrity(path:string){let db:Database.Database|undefined;try{db=new Database(path,{readonly:true,fileMustExist:true,timeout:1000});const result=db.pragma('integrity_check') as {integrity_check:string}[];return result.length===1&&result[0]?.integrity_check==='ok';}catch{return false;}finally{db?.close();}}
function collect(data:string,target:string,includeArchive:boolean){const found:{absolute:string;relative:string;kind:'sqlite'|'file';size:number}[]=[];
 function walk(dir:string){for(const node of readdirSync(dir,{withFileTypes:true})){const path=join(dir,node.name);if(inside(target,path)&&inside(data,target))continue;
  if(node.isSymbolicLink())throw Error(`Symbolischer Link unter data/ nicht erlaubt: ${path}`);
  if(node.isDirectory()){walk(path);continue;}if(!node.isFile())continue;
  const rel=relative(data,path).split(sep).join('/');
  if(/(?:^|\/)[^/]+\.db-(?:wal|shm|journal)$/.test(rel)||rel.endsWith('.lock')||rel.includes('.before-restore-'))continue;
  const kind=rel.endsWith('.db')?'sqlite':'file';
  if(!includeArchive&&rel.startsWith('archive/raw/')&&!rel.endsWith('.CHECKSUM')&&basename(rel)!=='report.json')continue;
  if(!safeExisting(path,'file'))continue;
  found.push({absolute:path,relative:rel,kind,size:statSync(path).size});
 }}walk(data);return found.sort((a,b)=>a.relative.localeCompare(b.relative));}
function gitCommit(root:string){try{const value=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:3000,stdio:['ignore','pipe','ignore']}).trim();return GIT_SHA.test(value)?value:null;}catch{return null;}}
function manifestPath(target:string,id:string){if(!ID.test(id))throw Error('Ungültige Backup-ID');const dir=join(target,id);if(!inside(target,dir))throw Error('Ungültiger Backup-Pfad');return dir;}
function validManifest(value:unknown,id:string):value is BackupManifest{if(!value||typeof value!=='object')return false;const m=value as BackupManifest;return m.version===1&&m.id===id&&Number.isFinite(Date.parse(m.createdAt))&&(m.status==='ok'||m.status==='invalid')&&Array.isArray(m.files)&&m.files.length>0&&m.files.every(f=>f&&typeof f.source==='string'&&typeof f.storedPath==='string'&&(['file','sqlite'] as string[]).includes(f.kind)&&f.kind===(f.source.endsWith('.db')?'sqlite':'file')&&Number.isSafeInteger(f.size)&&f.size>=0&&typeof f.sha256==='string'&&HASH.test(f.sha256)&&(f.integrityCheck===null||f.integrityCheck==='ok')&&(m.status==='invalid'||f.kind!=='sqlite'||f.integrityCheck==='ok')&&f.storedPath===`files/${f.source}`&&safeRelative(f.source));}
function safeRelative(rel:string){try{pathParts(rel);return true;}catch{return false;}}
function readManifest(target:string,id:string){const dir=manifestPath(target,id);if(!safeExisting(dir,'directory'))throw Error('Backup fehlt');const path=join(dir,'manifest.json');if(!safeExisting(path,'file'))throw Error('Backup-Manifest fehlt');const manifest:unknown=JSON.parse(readFileSync(path,'utf8'));if(!validManifest(manifest,id))throw Error('Ungültiges Backup-Manifest');return manifest;}

/** Online SQLite copies are staged, hashed, checked and atomically published. */
export async function runBackup(o:BackupOptions):Promise<BackupManifest>{const p=options(o);if(!safeExisting(p.data,'directory'))throw Error('Datenordner fehlt; Backup nicht möglich');
 const items=collect(p.data,p.target,p.includeArchive);if(!items.length)throw Error('Keine relevanten Dateien für Backup gefunden');
 mkdirSync(p.target,{recursive:true,mode:0o700});assertNoSymlinks(p.target);ensureStorageFree(p.target,items.reduce((sum,i)=>sum+i.size,0));
 const date=o.now??new Date(),id=idAt(date),final=manifestPath(p.target,id);if(existsSync(final))throw Error(`Backup ${id} existiert bereits; kein Überschreiben`);
 const staging=join(p.target,`.pending-${id}-${randomUUID()}`);mkdirSync(staging,{mode:0o700});
 let published=false;
 try{const manifest:BackupManifest={version:1,id,createdAt:date.toISOString(),gitCommit:gitCommit(p.root),status:'ok',files:[]};
  for(const item of items){const storedPath=`files/${item.relative}`,destination=join(staging,...pathParts(storedPath));mkdirSync(dirname(destination),{recursive:true});
   if(item.kind==='sqlite'){const source=new Database(item.absolute,{readonly:true,fileMustExist:true,timeout:3000});try{await source.backup(destination);}finally{source.close();}}
   else {const before=statSync(item.absolute);copyFileSync(item.absolute,destination,constants.COPYFILE_EXCL);const after=statSync(item.absolute);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.size!==statSync(destination).size)throw Error(`Datei während Backup verändert: ${item.relative}`);}
   const correct=item.kind==='sqlite'?integrity(destination):true;
   if(!correct)manifest.status='invalid';
   manifest.files.push({source:item.relative,storedPath,kind:item.kind,size:statSync(destination).size,sha256:sha(destination),integrityCheck:item.kind==='sqlite'&&correct?'ok':null});
  }
  writeFileSync(join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  if(existsSync(final))throw Error(`Backup ${id} existiert bereits; kein Überschreiben`);
  renameSync(staging,final);published=true;
  if(manifest.status!=='ok')throw Error(`WARNUNG: Backup ${id} enthält eine defekte SQLite-Kopie und darf nicht wiederhergestellt werden`);
  pruneBackups({...o,backupDir:p.target},id);
  return manifest;
 }finally{if(!published&&safeExisting(staging,'directory'))rmSync(staging,{recursive:true,force:false});}
}

export function listBackups(o:BackupOptions):BackupCheck[]{const p=options(o);if(!existsSync(p.target))return [];if(!safeExisting(p.target,'directory'))throw Error('Backup-Verzeichnis ungültig');
 return readdirSync(p.target,{withFileTypes:true}).filter(e=>ID.test(e.name)&&e.isDirectory()&&!e.isSymbolicLink()).map(e=>{try{const m=readManifest(p.target,e.name);return {id:e.name,ok:m.status==='ok',errors:m.status==='ok'?[]:['Im Manifest als defekt markiert'],manifest:m};}catch(error){return {id:e.name,ok:false,errors:[String(error)],manifest:null};}}).sort((a,b)=>b.id.localeCompare(a.id));}
export function verifyBackup(o:BackupOptions,id:string):BackupCheck{const p=options(o),errors:string[]=[];let manifest:BackupManifest|null=null;
 try{manifest=readManifest(p.target,id);if(manifest.status!=='ok')errors.push('Im Manifest als defekt markiert');
  const dir=manifestPath(p.target,id),seen=new Set<string>();
  for(const item of manifest.files){if(seen.has(item.source)){errors.push(`Doppelter Eintrag: ${item.source}`);continue;}seen.add(item.source);
   const dest=join(dir,...pathParts(item.storedPath));try{assertNoSymlinks(dest);if(!safeExisting(dest,'file')||!inside(dir,realpathSync(dest)))throw Error('Datei fehlt/ungültig');
    if(statSync(dest).size!==item.size)errors.push(`${item.source}: Größe abweichend`);
    if(sha(dest)!==item.sha256)errors.push(`${item.source}: SHA256 abweichend`);
    if(item.kind==='sqlite'&&(!integrity(dest)||item.integrityCheck!=='ok'))errors.push(`${item.source}: SQLite integrity_check fehlgeschlagen`);
   }catch(e){errors.push(`${item.source}: ${String(e)}`);}
  }
 }catch(e){errors.push(String(e));}
 return {id,ok:errors.length===0,errors,manifest};}
export function verifyBackups(o:BackupOptions,id?:string){return id?[verifyBackup(o,id)]:listBackups(o).map(x=>verifyBackup(o,x.id));}
function week(date:Date){const utc=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));utc.setUTCDate(utc.getUTCDate()+4-(utc.getUTCDay()||7));const year=utc.getUTCFullYear();const start=new Date(Date.UTC(year,0,1));return `${year}-${Math.ceil(((utc.getTime()-start.getTime())/86400000+1)/7)}`;}
/** Only owned snapshots can be pruned; retain the newly verified backup. */
export function pruneBackups(o:BackupOptions,protectedId:string){const p=options(o);if(!ID.test(protectedId))throw Error('Ungültige geschützte Backup-ID');const all=listBackups(o).filter(x=>x.ok&&x.manifest&&verifyBackup(o,x.id).ok),valid=all.find(x=>x.id===protectedId);if(!valid||!verifyBackup(o,protectedId).ok)throw Error('Kein verifiziertes Schutz-Backup; Aufbewahrung abgebrochen');
 const keep=new Set([protectedId]);for(const [period,count,key] of [
  ['daily',p.retention.daily,(m:BackupManifest)=>m.id.slice(0,10)],
  ['weekly',p.retention.weekly,(m:BackupManifest)=>week(new Date(m.id.slice(0,10)+'T12:00:00Z'))],
  ['monthly',p.retention.monthly,(m:BackupManifest)=>m.id.slice(0,7)]
 ] as const){void period;const groups=new Set<string>();for(const backup of all){const bucket=key(backup.manifest!);if(groups.has(bucket))continue;if(groups.size>=count)continue;groups.add(bucket);keep.add(backup.id);}}
 for(const backup of all){if(keep.has(backup.id))continue;const dir=manifestPath(p.target,backup.id);if(!safeExisting(dir,'directory'))continue;const owned=readManifest(p.target,backup.id);if(owned.status==='ok')rmSync(dir,{recursive:true,force:false});}
}
function isLiveJournal(rel:string){return /(?:^|\/)(?:live|testnet)[^/]*\.db$|(?:^|\/)[^/]*journal[^/]*\.db$/i.test(rel);}
function isActiveLock(file:string){const content=readFileSync(file,'utf8').slice(0,4096).trim();const m=content.match(/(?:^|\"pid\"\s*:\s*)(\d+)(?:\D|$)/);if(!m)return true;const pid=Number(m[1]);if(!Number.isSafeInteger(pid)||pid<1)return true;try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}}
function checkLocks(data:string,backupDir:string){function walk(dir:string){for(const node of readdirSync(dir,{withFileTypes:true})){const file=join(dir,node.name);if(inside(backupDir,file)&&inside(data,backupDir))continue;if(node.isSymbolicLink())throw Error(`Symbolischer Link unter data/: ${file}`);if(node.isDirectory()){walk(file);continue;}if(node.name.endsWith('.lock')&&isActiveLock(file))throw Error(`Aktive oder unbekannte Prozesssperre: ${file}`);}}walk(data);}
export function restoreBackup(o:BackupOptions,id:string,file?:string,understandLiveJournal=false){const p=options(o);if(!safeExisting(p.data,'directory'))throw Error('Datenordner fehlt');const checked=verifyBackup(o,id);if(!checked.ok||!checked.manifest)throw Error(`Wiederherstellung abgebrochen: ${checked.errors.join('; ')}`);
 const selected=file?(file.startsWith('data/')?file.slice(5):file):undefined;if(selected&&!safeRelative(selected))throw Error('Ungültiger Dateiname');
 if(checked.manifest.files.some(e=>inside(p.target,join(p.data,...pathParts(e.source)))))throw Error('Manifest enthält Pfad in den Backup-Speicher');
 const entries=checked.manifest.files.filter(x=>!selected||x.source===selected);if(!entries.length)throw Error('Datei nicht im Backup');if(selected&&entries[0]?.kind!=='sqlite')throw Error('--file akzeptiert nur Datenbanken');
 if(entries.some(x=>isLiveJournal(x.source))&&!understandLiveJournal)throw Error('Live-Journal-Restore benötigt --i-understand-live-journal');
 checkLocks(p.data,p.target);
 for(const entry of entries){if(entry.kind!=='sqlite')continue;const target=join(p.data,...pathParts(entry.source));for(const suffix of ['-wal','-journal'])if(existsSync(target+suffix)&&statSync(target+suffix).size>0)throw Error(`SQLite-Sidecar vorhanden; Server/Recorder stoppen und Zustand prüfen: ${target+suffix}`);}
 for(const entry of entries){const dest=join(p.data,...pathParts(entry.source)),source=join(manifestPath(p.target,id),...pathParts(entry.storedPath));assertNoSymlinks(dirname(dest));assertNoSymlinks(dest);mkdirSync(dirname(dest),{recursive:true});
  if(safeExisting(dest,'file')&&statSync(dest).nlink!==1)throw Error('Unsicheres Ziel');
  const suffix=`.before-restore-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`;
  const aside=dest+suffix,staging=dest+`.restore-${randomUUID()}`;
  let moved=false;try{copyFileSync(source,staging,constants.COPYFILE_EXCL);if(entry.kind==='sqlite'&&!integrity(staging))throw Error('SQLite-Kopie vor Restore defekt');
   if(existsSync(dest)){renameSync(dest,aside);moved=true;}
   try{renameSync(staging,dest);}catch(error){if(moved)renameSync(aside,dest);throw error;}
  }finally{if(existsSync(staging))rmSync(staging);}
 }
 return entries.map(e=>e.source);
}
