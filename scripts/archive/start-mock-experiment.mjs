import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,openSync,closeSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';import {createServer} from 'node:net';import {spawn} from 'node:child_process';
import {requireStoppedResume,launchLock} from './process-guard.mjs';
import {inspectMockExperiment,verifyMockExperiment} from './mock-experiment-files.mjs';
assert.ok(process.argv.slice(2).every(a=>['--series=v2','--series=v3','--resume-stopped'].includes(a)),'Unsupported start option');const series=process.argv.includes('--series=v3')?'v3':process.argv.includes('--series=v2')?'v2':'v1';
assert.ok(process.argv.slice(2).filter(a=>a.startsWith('--series=')).length<=1,'One series only');
const {root,record,environment,pointer:chosenPointer,selection}=inspectMockExperiment(process.cwd(),series);assert.ok(!['stopped-known-context-clock-defect','stopped-universe-drift-on-resume'].includes(chosenPointer.status),'Retired experiment must remain preserved; a changed contract requires a separate registered version');
const file=join(root,'data/process.json'),release=launchLock(join(root,'data/launch.lock'));
try{const saved=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null,mode=requireStoppedResume(saved,process.argv.includes('--resume-stopped'));
 if(mode==='reuse'){console.log(JSON.stringify({reused:true,...await verifyMockExperiment(process.cwd(),series)}));}
 else{await new Promise((done,reject)=>{const s=createServer();s.once('error',reject);s.listen(record.port,'127.0.0.1',()=>s.close(done));});
  const essential={};for(const k of ['SystemRoot','WINDIR','TEMP','TMP','PATH','USERPROFILE','LOCALAPPDATA'])if(process.env[k])essential[k]=process.env[k];
  const env={...essential,...environment,NODE_ENV:'production',PAPER_EXPERIMENT_MODE:'mock',AI_PROVIDER:'mock',AI_ENABLED:'false',AI_ALLOW_REMOTE:'false',LIVE_ENABLED:'false',AI_API_KEY:'',ANTHROPIC_API_KEY:'',DOCKER:'false'};
  const out=openSync(join(root,'data/server.stdout.log'),'a'),err=openSync(join(root,'data/server.stderr.log'),'a'),child=spawn(process.execPath,['apps/server/dist/index.js'],{cwd:root,env,detached:true,windowsHide:true,stdio:['ignore',out,err]});
  await new Promise((done,reject)=>{child.once('error',reject);child.once('spawn',done);});closeSync(out);closeSync(err);child.unref();
  const launch={pid:child.pid,startedAtApprox:new Date().toISOString(),root,port:record.port,mode:'paper',simulation:'mock',resumedFromRunId:saved?.runId??null};
  if(saved){mkdirSync(join(root,'data/process-history'),{recursive:true});writeFileSync(join(root,'data/process-history',Date.now()+'.json'),JSON.stringify(saved,null,2),{flag:'wx'});}writeFileSync(file,JSON.stringify(launch,null,2),saved?{}:{flag:'wx'});
  const deadline=performance.now()+45000;let ready=false;while(performance.now()<deadline){try{const report=await fetch('http://127.0.0.1:'+record.port+'/api/paper-experiment',{signal:AbortSignal.timeout(2000)}).then(r=>r.json());if(report.experimentId){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
  assert.equal(ready,true,'Saved process may still be initializing; inspect same PID/logs, never relaunch on timeout');
  const proof=await verifyMockExperiment(process.cwd(),series);writeFileSync(file,JSON.stringify({...launch,runId:proof.runId},null,2));const pointer=join(process.cwd(),selection.pointerPath),old=JSON.parse(readFileSync(pointer,'utf8'));writeFileSync(pointer,JSON.stringify({...old,status:'running',pid:child.pid,runId:proof.runId},null,2));console.log(JSON.stringify({pid:child.pid,root,...proof}));
 }
}finally{release();}
