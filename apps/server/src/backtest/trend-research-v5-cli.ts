import Database from 'better-sqlite3';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ArchiveCandleSource} from '../archive/candle-source.js';
import {ArchiveUniverse} from '../archive/universe.js';
import {ARCHIVE_DB,PROJECT_ROOT} from '../archive/paths.js';
import {request} from '../forward/cli.js';
import {exchangeLots,type ExchangeInfo} from '../forward/lots.js';
import {researchHash} from './trend-research.js';
import {v5DevelopmentSource,V5_RESEARCH} from './trend-research-v2.js';
import {runTrendResearchV5,v5Markdown,V5_PROFILES} from './trend-research-v5.js';
import {v5EqualWeightHold} from './research-v5-benchmark.js';
import type {V4SpikeComparison} from './trend-research-v4.js';

/** Manual opt-in CLI only: read historical candles, never place a real or Paper order. */
export async function main(){
 const registration=JSON.parse(readFileSync(PROJECT_ROOT+'/docs/research/hypotheses.json','utf8'))
  .find((h:{id:string})=>h.id==='H-025');
 if(registration?.variantsTested!==25||registration.drawdownV5?.mode!=='run_v5'||
  registration.drawdownV5?.variantsRegistered!==4||
  registration.drawdownV5?.historicalRunsCompleted!==0||
  registration.drawdownV5?.historicalRunStatus!=='not-executed')
  throw Error('Four H-025 v5 variants must be preregistered before any research replay');
 const db=new Database(ARCHIVE_DB,{readonly:true,fileMustExist:true});
 const archive=new ArchiveCandleSource({databasePath:ARCHIVE_DB});
 try{
  const exchange=await request('exchangeInfo') as ExchangeInfo;
  const lotRules=exchangeLots(exchange);
  const lotSnapshotAt=new Date().toISOString();
  const universe=new ArchiveUniverse(db);
  const archived=await archive.listSymbols();
  if(!archived.includes('BTCUSDT')||!archived.includes('ETHUSDT'))
   throw Error('H-025 v5 requires both archived BTC/ETH daily sources');
  const codeBuild=execFileSync('git',['rev-parse','HEAD'],{
   cwd:PROJECT_ROOT,encoding:'utf8'}).trim();
  const options={source:archive,lotRules,lotSnapshotAt,codeBuild,
   // The archive was explicitly imported with BTC/ETH only. Membership at
   // each evaluation day still comes from the causal, previous-30-day query.
   universeAt:(day:number)=>universe.universeAt(day,{quote:'USDT',topN:archived.length})
    .map(x=>x.symbol).filter(s=>s==='BTCUSDT'||s==='ETHUSDT')};
  const reports=[];
  for(const profileName of V5_PROFILES)
   reports.push(await runTrendResearchV5({...options,...(profileName?{profileName}:{})}));
  const passive=await v5EqualWeightHold(v5DevelopmentSource(archive),lotRules);
  const spike=JSON.parse(readFileSync(PROJECT_ROOT+
   '/docs/spikes/trend-1d-2020-2023.json','utf8')) as V4SpikeComparison;
  const manifest=researchHash(db.prepare('SELECT path,sha256 FROM files ORDER BY path').all());
  const directory=PROJECT_ROOT+'/data/trend-research-v5';
  mkdirSync(directory,{recursive:true});
  const artifact={hypothesis:'H-025',version:'v5',researchOnly:true,paperApproved:false,
   pipelineEligible:false,registration:V5_RESEARCH,
   evaluation:{from:'2020-01-01',toExclusive:'2024-01-01'},
   warmup:{from:'2019-01-01',toExclusive:'2020-01-01',purpose:'indicators-only'},
   reports,equalWeightHold:passive,spikeReference:spike,
   exchangeInfo:exchange,archiveManifestHash:manifest,codeBuild};
  writeFileSync(directory+'/report.json',JSON.stringify(artifact,null,2)+'\n');
  const markdown=v5Markdown(reports,passive,spike);
  writeFileSync(directory+'/summary.md',markdown+'\n');
  console.log(markdown);
 }finally{archive.close();db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{
  console.error(error instanceof Error?error.message:'H-025 v5 failed');
  process.exitCode=1;
 });
