import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {ArchiveCandleSource} from '../archive/candle-source.js';
import {simulateDca,type DcaVariant,type DcaInterval} from './simulator.js';
import {DCA_VARIANTS,summarizeDcaRuns} from './comparison.js';
import {projectRoot} from '../config.js';
const variants:DcaVariant[]=[...DCA_VARIANTS];

function args(argv:string[]){
 const values=new Map<string,string>();
 for(let i=0;i<argv.length;i++){
  const arg=argv[i],next=argv[i+1];
  if(!arg?.startsWith('--')||!next||next.startsWith('--')||values.has(arg))throw Error('Use distinct --key value options');
  values.set(arg,next);i++;
 }
 const accepted=new Set(['--from','--to','--amount','--interval','--allocation','--multi-start']);
 if([...values.keys()].some(x=>!accepted.has(x)))throw Error('Unknown DCA option');
 const from=values.get('--from')??'2020-01-01',to=values.get('--to')??'2024-01-01';
 for(const date of [from,to])if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)
  throw Error('Invalid UTC calendar date');
 const amount=Number(values.get('--amount')??'100'),interval=values.get('--interval')??'monthly';
 if(!Number.isFinite(amount)||amount<=0||!['monthly','weekly'].includes(interval))throw Error('Invalid simulated deposit');
 const parsed=(values.get('--allocation')??'70/30').split('/').map(Number);
 if(parsed.length!==2||parsed.some(x=>!Number.isFinite(x)||x<0)||(parsed[0]! + parsed[1]!) !== 100)throw Error('Allocation must sum to 100, e.g. 70/30');
 const multi=values.get('--multi-start')??'false';
 if(multi!=='true'&&multi!=='false')throw Error('--multi-start must be true or false');
 return {fromMs:Date.parse(from+'T00:00:00Z'),toMs:Date.parse(to+'T00:00:00Z'),amount,interval:interval as DcaInterval,
  allocation:{BTCUSDT:parsed[0]!/100,ETHUSDT:parsed[1]!/100},multi:multi==='true'};
}
async function main() {
 const opt=args(process.argv.slice(2));
 // No holdout or validation reads are permitted in the research CLI.
 if(opt.fromMs<Date.UTC(2020,0,1)||opt.toMs>Date.UTC(2024,0,1)||opt.fromMs>=opt.toMs)
  throw Error('DCA research is restricted to 2020-01-01 through 2023-12-31 (exclusive 2024)');
 const source=new ArchiveCandleSource();
 try {
  const starts:number[]=[];
  if(opt.multi){
   for(let ts=opt.fromMs;ts<opt.toMs;){
    starts.push(ts);const date=new Date(ts);
    ts=Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1);
   }
  }else starts.push(opt.fromMs);
  const runs=[];
  for(const start of starts)for(const variant of variants)runs.push(await simulateDca(source,{...opt,fromMs:start,variant}));
  const comparison=summarizeDcaRuns(runs);
  const document={kind:'DCA development-only benchmark; not independent evidence',generatedAt:new Date().toISOString(),
   split:'2020-01-01..2023-12-31',options:opt,
   results:runs.map(({daily,trades,...summary})=>({...summary,lastDay:daily.at(-1)??null})),
   comparison};
  const key=createHash('sha256').update(JSON.stringify({options:opt,variants})).digest('hex').slice(0,16);
  const file=resolve(projectRoot,'data/backtests/dca-'+key+'/report.json');
  if(existsSync(file))throw Error('Report exists; results are create-only, move it only after recording its provenance');
  mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(document,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({file,variants,starts:starts.length,runs:runs.length,
   // These are simulated, after assumed fees; never label as holdout performance.
   comparison:{starts:comparison.starts,distributions:comparison.distributions,warning:comparison.warning},
   summaries:runs.map(r=>({variant:r.variant,from:new Date(r.fromMs).toISOString().slice(0,10),
    twr:r.twr,irr:r.irr,maxDrawdown:r.maxDrawdown,fees:r.totalFees,netWorth:r.netWorth}))},null,2)+'\n');
 }finally{source.close();}
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/dca/cli.ts'))
 main().catch(e=>{console.error(e);process.exitCode=1;});
