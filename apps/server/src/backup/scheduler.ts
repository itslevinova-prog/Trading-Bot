import {runBackup} from './backup.js';
export function shouldRunBackup(now:Date,schedule:string,lastDay:string|null){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule))throw Error('BACKUP_SCHEDULE muss HH:mm sein');const day=now.getFullYear()+'-'+(now.getMonth()+1)+'-'+now.getDate();return String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')===schedule&&day!==lastDay;}
/** Local-machine time, one attempt per local calendar day, with re-entry protection. */
export function startBackupScheduler(root:string,logger:{info:(message:string)=>void;error:(message:string)=>void}={info:console.info,error:console.error}){
 if(process.env.BACKUP_ENABLED==='false')return ()=>{};
 const schedule=process.env.BACKUP_SCHEDULE??'03:30';shouldRunBackup(new Date(),schedule,null);
 let lastDay:string|null=null,running=false,stopped=false;
 const tick=async()=>{if(stopped||running)return;const now=new Date();if(!shouldRunBackup(now,schedule,lastDay))return;lastDay=now.getFullYear()+'-'+(now.getMonth()+1)+'-'+now.getDate();running=true;
  try{const result=await runBackup({root});logger.info('Tägliches Backup erstellt: '+result.id);}catch(e){logger.error('WARNUNG: Tägliches Backup fehlgeschlagen: '+String(e));}finally{running=false;}};
 const timer=setInterval(()=>void tick(),30_000);timer.unref();void tick();return ()=>{stopped=true;clearInterval(timer);};
}
