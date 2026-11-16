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
import {runTrendResearchV2,v2Markdown,v2ProfilesMarkdown,developmentSource} from './trend-research-v2.js';
import {runTrendResearchV3,v3Markdown} from './trend-research-v3.js';
import {runTrendResearchV4,v4Markdown,V4_ORDER,V4_PROFILES,type V4SpikeComparison} from './trend-research-v4.js';
import {ArchiveRegimeProvider} from '../regime/providers.js';

export async function main(){
 const registration=JSON.parse(readFileSync(PROJECT_ROOT+'/docs/research/hypotheses.json','utf8')).find((x:{id:string})=>x.id==='H-025');
 if(['--v3','--v4','--profiles'].filter(flag=>process.argv.includes(flag)).length>1)
  throw Error('H-025 research modes are mutually exclusive');
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
  if(process.argv.includes('--v4')){
   if(registration.variantsTested!==25||registration.drawdownV4?.mode!=='run_v4'||
    registration.drawdownV4?.variantsRegistered!==8||
    registration.drawdownV4?.historicalRunsCompleted!==0)
    throw Error('H-025 v4 eight fixed diagnostic runs must be registered before dispatch');
   const spike=JSON.parse(readFileSync(PROJECT_ROOT+
    '/docs/spikes/trend-1d-2020-2023.json','utf8')) as V4SpikeComparison;
   // Same single archive import and one current exchangeInfo snapshot for all eight runs.
   const reports=[];
   for(const variant of V4_ORDER)for(const profileName of V4_PROFILES)
    reports.push(await runTrendResearchV4({...options,variant,
     ...(profileName?{profileName}:{})}));
   const artifact={hypothesis:'H-025',version:'v4',diagnosticOnly:true,
    development:{from:'2020-01',to:'2023-12'},reports,spikeReference:spike,
    exchangeInfo:exchange,archiveManifestHash};
   const v4Directory=PROJECT_ROOT+'/data/trend-research-v4';
   mkdirSync(v4Directory,{recursive:true});
   writeFileSync(v4Directory+'/report.json',JSON.stringify(artifact,null,2)+'\n');
   const md=v4Markdown(reports,spike);
   writeFileSync(v4Directory+'/summary.md',md+'\n');console.log(md);
  }else if(process.argv.includes('--v3')){
   if(registration.variantsTested<9||registration.drawdownV3?.mode!=='run_v3')
    throw Error('H-025 v3 must be pre-registered with four fixed candidates');
   // The archive, exchangeInfo snapshot and point-in-time universe are shared by all four runs.
   // The regime history is computed exactly once from closed development-only daily candles.
   const provider=new ArchiveRegimeProvider({source:developmentSource(archive),
    universeAt:(day,{topN})=>universe.universeAt(day,{quote:'USDT',topN}).map(x=>x.symbol)});
   const states=await provider.getHistory(TREND_RESEARCH_ASSUMPTIONS.fromMs,
    TREND_RESEARCH_ASSUMPTIONS.toMs-86_400_000);
   const byDay=new Map(states.map(s=>[s.asOf,s.regime]));
   const regimeAt=(asOf:number)=>{
    const status=byDay.get(asOf);
    if(!status)throw Error('Missing registered closed-day market regime: '+asOf);
    return status;
   };
   const reports=[];
   for(const profileName of [undefined,'vorsichtig','normal','aggressiv'] as const)
    reports.push(await runTrendResearchV3({...options,profileName,regimeAt}));
   const artifact={hypothesis:'H-025',version:'v3',development:{from:'2020-01',to:'2023-12'},
    reports,regimeStates:states,exchangeInfo:exchange,archiveManifestHash};
   const v3Directory=PROJECT_ROOT+'/data/trend-research-v3';mkdirSync(v3Directory,{recursive:true});
   writeFileSync(v3Directory+'/report.json',JSON.stringify(artifact,null,2)+'\\n');
   const md=v3Markdown(reports);
   writeFileSync(v3Directory+'/summary.md',md+'\\n');console.log(md);
  }else if(process.argv.includes('--profiles')){
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
