import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,realpathSync,rmSync,readdirSync} from 'node:fs';import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {requireStoppedResume,launchLock,mainPaperOwnerAlive} from './process-guard.mjs';
test('stopped resume is explicit, live or reused PIDs never authorize another launch',()=>{assert.equal(requireStoppedResume(null,false),'new');assert.equal(requireStoppedResume({pid:123},true,()=>true),'reuse');assert.throws(()=>requireStoppedResume({pid:123},false,()=>false),/resume-stopped/);assert.equal(requireStoppedResume({pid:123},true,()=>false),'resume');});
test('launcher lock excludes concurrent owners and archives a stopped owner without losing its record',()=>{const temp=mkdtempSync(join(tmpdir(),'paper-process-guard-'));try{const file=join(temp,'launch.lock'),release=launchLock(file);assert.throws(()=>launchLock(file,()=>true),/active/);release();writeFileSync(file,JSON.stringify({pid:999,createdAt:'old'}));const resumed=launchLock(file,()=>false);assert.equal(readdirSync(temp).filter(name=>name.includes('.stale-')).length,1);resumed();assert.equal(readdirSync(temp).length,1);}finally{const target=realpathSync(temp);assert.equal(dirname(target),realpathSync(tmpdir()));assert.match(target.split(/[\\/]/).at(-1),/^paper-process-guard-/);rmSync(target,{recursive:true,force:true});}});

test('main Paper ownership distinguishes a recycled Windows PID and keeps uncertain owners',()=>{
    const saved={pid:123,startedAtApprox:'2026-11-03T21:13:26.230Z'};
    const recorded=Date.parse(saved.startedAtApprox);
    assert.equal(mainPaperOwnerAlive(saved,()=>true,()=>recorded+3600000),false);
    assert.equal(mainPaperOwnerAlive(saved,()=>true,()=>recorded-100),true);
    assert.equal(mainPaperOwnerAlive(saved,()=>true,()=>recorded+100),true);
    assert.equal(mainPaperOwnerAlive(saved,()=>true,()=>null),true);
    assert.equal(mainPaperOwnerAlive({pid:123},()=>true,()=>recorded+3600000),true);
    assert.equal(mainPaperOwnerAlive(saved,()=>false,()=>{throw Error('Stopped PID needs no inspection');}),false);
});
