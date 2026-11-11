import {spawnSync} from 'node:child_process';
import {openSync,writeFileSync,readFileSync,closeSync,unlinkSync,renameSync} from 'node:fs';import {createHash} from 'node:crypto';
export function pidAlive(pid){if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid saved PID');try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;if(error.code==='EPERM')return true;throw error;}}
export function requireStoppedResume(saved,resume,isAlive=pidAlive){if(!saved)return 'new';if(isAlive(saved.pid))return 'reuse';if(!resume)throw Error('Saved process is stopped; use --resume-stopped to preserve its database and epochs');return 'resume';}
export function launchLock(path,isAlive=pidAlive){let fd;try{fd=openSync(path,'wx');}catch(error){if(error.code!=='EEXIST')throw error;const bytes=readFileSync(path),old=JSON.parse(bytes);if(isAlive(old.pid))throw Error('Another launcher is active');const digest=createHash('sha256').update(bytes).digest('hex');renameSync(path,path+'.stale-'+digest);fd=openSync(path,'wx');}const contents=JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()});writeFileSync(fd,contents);closeSync(fd);return ()=>{if(readFileSync(path,'utf8')!==contents)throw Error('Launch lock ownership changed');unlinkSync(path);};}


function windowsStartTime(pid) {
    if (process.platform !== 'win32') return null;
    const command = "(Get-Process -Id " + pid + " -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')";
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8', windowsHide: true, timeout: 5000,
    });
    return result.status === 0 ? Date.parse(result.stdout.trim()) : null;
}

/** A later Windows process can reuse the numeric ID of a stopped Paper server. */
export function mainPaperOwnerAlive(saved, isAlive = pidAlive, startTime = windowsStartTime) {
    if (!isAlive(saved.pid)) return false;
    const recordedAt = Date.parse(saved.startedAtApprox);
    if (!Number.isFinite(recordedAt)) return true;
    const startedAt = startTime(saved.pid);
    // Keep the owner if inspection fails or the timestamps are close.
    return !Number.isFinite(startedAt) || startedAt <= recordedAt + 30000;
}
