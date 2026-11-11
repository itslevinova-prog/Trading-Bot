import {closeSync,existsSync,mkdirSync,openSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

function alive(pid:number) {
  if(!Number.isSafeInteger(pid)||pid<=0)return true;
  try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}
}
/** Exclusive OS file creation. Reap only proven-dead PIDs, never an unknown lock. */
export function acquireRecorderLock(file:string) {
  mkdirSync(dirname(file),{recursive:true});
  const token=randomUUID(),contents=JSON.stringify({pid:process.pid,token,startedAt:Date.now()});
  for(let attempt=0;attempt<2;attempt++){
    try {
      const fd=openSync(file,'wx',0o600);
      try{writeFileSync(fd,contents);}finally{closeSync(fd);}
      return ()=>{try{if(existsSync(file)&&readFileSync(file,'utf8')===contents)unlinkSync(file);}catch{/* Another owner must not be unlinked. */}};
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      let owner:{pid?:number}|null=null;
      try{owner=JSON.parse(readFileSync(file,'utf8')) as {pid?:number};}catch{}
      if(!owner||alive(Number(owner.pid)))throw Error('Recorder already running (or lock owner cannot be verified): '+file);
      if(attempt===0)unlinkSync(file);
    }
  }
  throw Error('Recorder lock could not be acquired');
}
