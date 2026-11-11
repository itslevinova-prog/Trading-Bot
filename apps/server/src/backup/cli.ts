import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config as loadEnv} from 'dotenv';
import {listBackups,restoreBackup,runBackup,verifyBackups} from './backup.js';
const root=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
loadEnv({path:resolve(root,'.env')});
const [command,...args]=process.argv.slice(2);
function flag(name:string){const index=args.indexOf(name);if(index<0)return undefined;const value=args[index+1];if(!value||value.startsWith('--'))throw Error('Wert fehlt: '+name);return value;}
async function main(){const options={root};
 switch(command){
  case 'run':{const manifest=await runBackup(options);console.log('Backup OK: '+manifest.id+' ('+manifest.files.length+' Dateien)');break;}
  case 'list':{for(const b of listBackups(options))console.log((b.ok?'✅':'❌')+' '+b.id+' '+(b.manifest?.files.reduce((sum,f)=>sum+f.size,0)??'?')+' Bytes'+(b.errors.length?' – '+b.errors.join('; '):''));break;}
  case 'verify':{const results=verifyBackups(options,flag('--id'));if(!results.length)throw Error('Keine Backups vorhanden');for(const r of results)console.log((r.ok?'✅':'❌')+' '+r.id+(r.errors.length?' – '+r.errors.join('; '):''));if(results.some(r=>!r.ok))process.exitCode=1;break;}
  case 'restore':{const id=flag('--id');if(!id)throw Error('Erforderlich: --id YYYY-MM-DD_HHMM');const files=restoreBackup(options,id,flag('--file'),args.includes('--i-understand-live-journal'));console.log('Wiederhergestellt: '+files.join(', ')+'. Vorherige Versionen bleiben als .before-restore-* erhalten.');break;}
  default:throw Error('Verwendung: backup:{run|list|verify [--id ID]|restore --id ID [--file DB] [--i-understand-live-journal]}');
 }
}
main().catch(e=>{console.error('BACKUP FEHLER:',e instanceof Error?e.message:String(e));process.exitCode=1;});
