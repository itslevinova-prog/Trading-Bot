import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {config,projectRoot} from '../apps/server/dist/config.js';
const require=createRequire(new URL('../apps/server/package.json',import.meta.url)),Database=require('better-sqlite3');
const file=resolve(projectRoot,config.DATABASE_PATH),snapshot=resolve(projectRoot,'data/memory-preservation-2026-10-30.json');
const sql=new Database(file,{readonly:true,fileMustExist:true});
try {
 const rows=sql.prepare('SELECT * FROM memory_entries ORDER BY id').all();
 const hashes=Object.fromEntries(rows.map(r=>[r.id,createHash('sha256').update(JSON.stringify(r)).digest('hex')]));
 if(process.argv[2]==='capture'){
  writeFileSync(snapshot,JSON.stringify({capturedAt:new Date().toISOString(),databasePath:file,hashes},null,2));
  console.log(JSON.stringify({capturedRows:rows.length,snapshot}));
 }else if(process.argv[2]==='verify'){
  const before=JSON.parse(readFileSync(snapshot,'utf8'));
  if(before.databasePath!==file)throw Error('Paper database identity changed');
  for(const [id,hash]of Object.entries(before.hashes))if(hashes[id]!==hash)throw Error('Original memory row changed or missing: '+id);
  const tables=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('memory_observations','memory_outcomes')").all();
  if(tables.length!==2)throw Error('Additive memory evidence tables missing');
  console.log(JSON.stringify({verifiedAt:new Date().toISOString(),originalRowsPreserved:Object.keys(before.hashes).length,currentRows:rows.length,additiveTables:2}));
 }else throw Error('Expected capture or verify');
}finally{sql.close();}
