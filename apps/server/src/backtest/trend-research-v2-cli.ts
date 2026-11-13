import Database from 'better-sqlite3';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ArchiveCandleSource} from '../archive/candle-source.js';
import {ArchiveUniverse} from '../archive/universe.js';
import {ARCHIVE_DB,PROJECT_ROOT} from '../archive/paths.js';
import {request} from '../forward/cli.js';
import {exchangeLots,type ExchangeInfo} from '../forward/lots.js';
import {CONFIG} from '../forward/engine-v2.js';
import {TREND_RESEARCH_ASSUMPTIONS,researchHash} from './trend-research.js';
import {runTrendResearchV2,v2Markdown,v2ProfilesMarkdown} from './trend-research-v2.js';

export async function main(){
 const registration=JSON.parse(readFileSync(PROJECT_ROOT+'/docs/research/hypotheses.json','utf8')).find((x:{id:string})=>x.id==='H-025');
 if(researchHash(registration.researchAssumptions)!==researchHash(TREND_RESEARCH_ASSUMPTIONS)||
  !registration.forwardVariants?.some((x:{version:string})=>x.version===CONFIG.strategy))throw Error('H-025 v1/v2 registration mismatch');
 const db=new Database(ARCHIVE_DB,{readonly:true,fileMustExist:true});
 const archive=new ArchiveCandleSource({databasePath:ARCHIVE_DB});
 try{
  const exchange=await request('exchangeInfo') as ExchangeInfo,lotSnapshotAt=new Date().toISOString();
  const lotRules=exchangeLots(exchange),universe=new ArchiveUniverse(db);
  const count=(await archive.listSymbols()).length;if(!count)throw Error('Historical archive is empty');
  const codeBuild=execFileSync('git',['rev-parse','HEAD'],{cwd:PROJECT_ROOT,encoding:'utf8'}).trim();
  const options={source:archive,lotRules,lotSnapshotAt,codeBuild,
   universeAt:(day:number)=>universe.universeAt(day,{quote:'USDT',topN:count}).map(x=>x.symbol)};
  const directory=PROJECT_ROOT+'/data/trend-research-v2';mkdirSync(directory,{recursive:true});
  const archiveManifestHash=researchHash(db.prepare('SELECT path,sha256 FROM files ORDER BY path').all());
  if(process.argv.includes('--profiles')){
   if(registration.variantsTested<5)throw Error('H-025 risk profiles not registered');
   const reports=[];
   for(const profileName of ['vorsichtig','normal','aggressiv'] as const){
    reports.push(await runTrendResearchV2({...options,profileName}));
   }
   const artifact={hypothesis:'H-025',development:{from:'2020-01',to:'2023-12'},
    profiles:reports,benchmarks:reports[0]!.benchmarks,exchangeInfo:exchange,archiveManifestHash};
   writeFileSync(directory+'/profiles-report.json',JSON.stringify(artifact,null,2)+'\n');
   const md=v2ProfilesMarkdown(reports);
   writeFileSync(directory+'/profiles-summary.md',md+'\n');console.log(md);
  }else{
   const report=await runTrendResearchV2(options);
   const artifact={...report,exchangeInfo:exchange,archiveManifestHash};
   // Preserve the existing unprofiled v2 report and evidence paths.
   writeFileSync(directory+'/report.json',JSON.stringify(artifact,null,2)+'\n');
   const md=v2Markdown(report);writeFileSync(directory+'/summary.md',md);console.log(md);
  }
 }finally{archive.close();db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{console.error(error instanceof Error?error.message:'H-025 v2 failed');process.exitCode=1;});
