import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadRegistry,register,rootPath,stageNumber,versionOf,computeConfigHash} from './registry.js';
import {evaluateStage,statusTable} from './evaluate.js';
import {preflightStage,inspectInterruptedStages} from './preflight.js';
import {sanitisedTradingConfig} from '../provenance/build.js';

function args(argv:string[]):Record<string,string>{
 const out:Record<string,string>={};
 for(let i=0;i<argv.length;i++){
  const key=argv[i]!;
  if(!key.startsWith('--'))throw Error('Unexpected argument: '+key);
  if(key==='--benchmark'){out.benchmark='true';continue;}
  const value=argv[++i];
  if(!value||value.startsWith('--'))throw Error('Missing value for '+key);
  out[key.slice(2)]=value;
 }
 return out;
}
function root():string {
 const cwd=process.cwd();
 try{readFileSync(resolve(cwd,'apps/server/package.json'));return cwd;}catch{return resolve(cwd,'../..');}
}
function main(){
 const command=process.argv[2];
 const options=args(process.argv.slice(3)),repo=root();
 if(command==='register'){
  const id=options.strategy,version=options.version;
  if(!id||!version)throw Error('Usage: pipeline:register --strategy <id> --version <v> [--hypothesis H-001] [--config data/strategy-config.json]');
  const config=options.config?JSON.parse(readFileSync(rootPath(repo,options.config),'utf8')) as Record<string,unknown>:{};
  if(!config||Array.isArray(config)||typeof config!=='object')throw Error('Config must be a JSON object');
  if(Object.keys(config).some(key=>/secret|token|password|api.?key|credential|live_ack/i.test(key)))throw Error('Secrets are not permitted in versioned config');
  // Preserve explicit, non-secret strategy parameters; the provenance helper identifies runtime settings.
  const captured={...sanitisedTradingConfig(process.env),...config};
  const entry=register(repo,{id,version,config:captured,
   hypothesisId:options.hypothesis??(id==='rules'?'H-001':id==='hold'?'BENCHMARK-BTC':id==='trend-vol-target'?'H-025':''),
   description:options.description??(id==='rules'?'EMA/volume-based rules provider':id==='hold'?'BTC buy-and-hold comparison':'Registered strategy'),
   benchmark:options.benchmark==='true'||id==='hold'});
  process.stdout.write(JSON.stringify(entry,null,2)+'\n');
 }else if(command==='evaluate'){
  const id=options.strategy,version=options.version,stage=options.stage;
  if(!id||!version||!stage)throw Error('Usage: pipeline:evaluate --strategy <id> --version <v> --stage <1..6> [--evidence data/.../evidence.json]');
  const {entry}=versionOf(loadRegistry(repo),id,version);
  const currentRuntime=sanitisedTradingConfig(process.env);
  for(const [key,value] of Object.entries(currentRuntime)){
   if(JSON.stringify(entry.config[key])!==JSON.stringify(value))throw Error('Runtime config changed: register a new strategy version');
  }
  if(options.config){
   const parsed=JSON.parse(readFileSync(rootPath(repo,options.config),'utf8')) as Record<string,unknown>;
   if(computeConfigHash({...currentRuntime,...parsed})!==entry.configHash)throw Error('Config file changed: register a new version');
  }
  const result=evaluateStage(repo,id,version,stageNumber(stage),{evidencePath:options.evidence});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(result.status==='failed')process.exitCode=2;
 }else if(command==='preflight'){
  const id=options.strategy,version=options.version,stage=options.stage;
  if(!id||!version||!stage)throw Error('Usage: pipeline:preflight --strategy <id> --version <v> --stage <1..6>');
  if(options.evidence||options.config)throw Error('Read-only preflight never ingests evidence or configuration files');
  const check=preflightStage(repo,id,version,stageNumber(stage));
  process.stdout.write(JSON.stringify(check,null,2)+'\n');
  if(!check.eligible)process.exitCode=2;
 }else if(command==='incidents'){
  if(Object.keys(options).length)throw Error('pipeline:incidents is read-only and accepts no options');
  const report=inspectInterruptedStages(repo);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.status==='unresolved')process.exitCode=2;
 }else if(command==='status'){
  process.stdout.write(statusTable(repo)+'\n');
 }else throw Error('Unknown pipeline command');
}
try{main();}catch(error){process.stderr.write((error instanceof Error?error.message:String(error))+'\n');process.exitCode=1;}
