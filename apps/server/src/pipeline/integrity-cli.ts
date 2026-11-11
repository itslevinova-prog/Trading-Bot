import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {projectRoot} from '../config.js';
import {loadRegistry,readStage,stageFile,type Stage} from './registry.js';

export type IntegrityFinding={
 strategyId:string;version:string;stage:Stage;
 status:'verified'|'blocked';reason:string;
 integrityHash:string|null;
};
export type IntegrityInspection={
 inspected:number;verified:number;blocked:number;
 status:'passed'|'blocked';fingerprint:string;findings:IntegrityFinding[];
};
/** Read-only verification for local backups/restores. Does not evaluate gates,
 * rewrite stage reports, touch market data or consume one-shot stages. */
export function inspectPipelineStageIntegrity(root:string):IntegrityInspection{
 const registry=loadRegistry(root),findings:IntegrityFinding[]=[];
 for(const strategy of [...registry.strategies].sort((a,b)=>a.id.localeCompare(b.id))){
  for(const version of [...strategy.versions].sort((a,b)=>a.version.localeCompare(b.version))){
   for(let n=1;n<=6;n++){
    const stage=n as Stage;
    const file=stageFile(root,strategy.id,version.version,stage);
    const consumed=version.consumedStages.includes(stage),exists=existsSync(file);
    if(!consumed&&!exists)continue;
    try{
     if(!consumed)throw Error('Unexpected unreserved Stage file');
     if(!exists)throw Error('Reserved Stage has no immutable result file');
     const result=readStage(root,strategy.id,version.version,stage);
     if(!result)throw Error('Stage result not found');
     findings.push({strategyId:strategy.id,version:version.version,stage,
      status:'verified',reason:'Registry-anchored result and checks verified',
      integrityHash:result.integrityHash??null});
    }catch(error){
     findings.push({strategyId:strategy.id,version:version.version,stage,
      status:'blocked',reason:String(error instanceof Error?error.message:error),integrityHash:null});
    }
   }
  }
 }
 const verified=findings.filter(x=>x.status==='verified').length,blocked=findings.length-verified;
 return {inspected:findings.length,verified,blocked,status:blocked?'blocked':'passed',
  fingerprint:createHash('sha256').update(JSON.stringify(findings)).digest('hex'),findings};
}
export function runIntegrityCli(args=process.argv.slice(2)):void{
 if(args.length)throw Error('Usage: pnpm pipeline:verify-integrity (read-only, no args)');
 const report=inspectPipelineStageIntegrity(projectRoot);
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
 if(report.status==='blocked')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{runIntegrityCli();}catch(error){console.error(error);process.exitCode=1;}
}
