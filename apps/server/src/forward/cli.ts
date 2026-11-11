import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,rmSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from '../provenance/build.js';
import type {Candle} from '../backtest/candle-source.js';
import {advance,initialState,seriesId,DAY,LABEL,summary,type State} from './engine.js';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
async function request(path:string):Promise<unknown>{
 for(let attempt=0;attempt<4;attempt++){
  const r=await fetch('https://api.binance.com/api/v3/'+path,{headers:{'User-Agent':'paper-forward-research/1'},signal:AbortSignal.timeout(30000)});
  if(r.ok)return r.json();
  if(r.status!==429&&r.status<500)throw Error('Public data HTTP '+r.status);
  const delay=Math.max(Number(r.headers.get('retry-after')??0)*1000,1000*2**attempt);
  if(delay>60000)throw Error('Public data rate limit; retry next run');
  await new Promise(done=>setTimeout(done,delay));
 }
 throw Error('Public data retries exhausted');
}
export async function main(){
 const args=process.argv.slice(2),arg=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 const fixture=arg('--fixture'),dry=args.includes('--dry-run');
 if(!dry&&process.env.FORWARD_ENABLED!=='true')throw Error('Forward disabled; use --dry-run for validation');
 if(process.env.LIVE_ENABLED!=='false'||process.env.AI_ALLOW_REMOTE!=='false'||process.env.LIVE_ACK)throw Error('Unsafe environment');
 const start=Date.parse(arg('--start')??'');
 const now=Date.now(),until=Math.floor(now/DAY)*DAY;
 const codeFiles=['strategy/trend-vol-target-v1.ts','backtest/trend-research.ts','backtest/fill-models.ts','coin-quality/contracts.ts','dca/paper.ts','provenance/build.ts',
  ...readdirSync(join(root,'apps/server/src/forward')).filter(x=>x.endsWith('.ts')).map(x=>'forward/'+x)].sort();
 const hash=digest(JSON.stringify(codeFiles.map(p=>[p,digest(readFileSync(join(root,'apps/server/src',p)))])));
 const fresh=initialState(start,hash),id=seriesId(fresh),base=resolve(arg('--output')??join(root,'forward'));
 const directory=join(base,id),stateFile=join(directory,'state.json');
 if(!fixture&&!existsSync(stateFile)&&start<until)throw Error('New real-data series must start prospectively today or later');
 const input:State=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):fresh;
 if(input.codeHash!==hash||input.configHash!==fresh.configHash||input.start!==start)throw Error('Series identity mismatch');
 let rows:Record<string,Candle[]>;
 let end=until;
 if(fixture){const data=JSON.parse(readFileSync(fixture,'utf8'));rows=data.rows;end=data.until;}
 else{
  const exchange=await request('exchangeInfo') as {symbols:{symbol:string;quoteAsset:string;status:string;isSpotTradingAllowed:boolean}[]};
  await request('ticker/24hr'); // Current observation is never used to rank a historical day.
  const symbols=new Set([...exchange.symbols.filter(s=>s.quoteAsset==='USDT'&&s.status==='TRADING'&&s.isSpotTradingAllowed).map(s=>s.symbol),
   ...Object.values(input.accounts).flatMap(w=>Object.keys(w.positions)),'BTCUSDT','ETHUSDT']);
  rows={};
  const from=(input.lastDay===null?start:input.lastDay+DAY)-260*DAY;
  for(const symbol of [...symbols].sort()){
   rows[symbol]=[];
   for(let cursor=from;cursor<until;){
    const page=await request(`klines?symbol=${encodeURIComponent(symbol)}&interval=1d&startTime=${cursor}&endTime=${until-1}&limit=1000`) as number[][];
    if(!Array.isArray(page))throw Error('Invalid public candle response');
    if(!page.length)break;
    for(const c of page)if(Number(c[0])+DAY<=until)rows[symbol]!.push({ts:Number(c[0]),open:Number(c[1]),high:Number(c[2]),low:Number(c[3]),close:Number(c[4]),volume:Number(c[5]),quoteVolume:Number(c[7])});
    const next=Number(page.at(-1)![0])+DAY;if(next<=cursor)throw Error('Pagination stalled');cursor=next;
    await new Promise(done=>setTimeout(done,150));
   }
  }
 }
 const result=advance(input,rows,end,now);
 if(dry){console.log(JSON.stringify({label:LABEL,series:id,days:result.points.length,fills:result.fills.length,dryRun:true}));return;}
 if(JSON.stringify(result)===JSON.stringify(input))return;
 mkdirSync(base,{recursive:true});
 const staged=join(base,'.staged-'+id);if(existsSync(staged))throw Error('Staged output already exists');
 mkdirSync(join(staged,'days'),{recursive:true});
 writeFileSync(join(staged,'state.json'),JSON.stringify(result,null,2)+'\n');
 const csv=(items:object[],fields:string[])=>[fields.join(','),...items.map(x=>fields.map(k=>JSON.stringify((x as Record<string,unknown>)[k]??'')).join(','))].join('\n')+'\n';
 writeFileSync(join(staged,'ledger.csv'),csv(result.fills,['day','account','symbol','side','qty','price','fee','spread','slippage','reason']));
 writeFileSync(join(staged,'equity.csv'),csv(result.points,['day','strategy','hold','dca','reason']));
 for(const point of result.points){const date=new Date(point.day).toISOString().slice(0,10);writeFileSync(join(staged,'days',date+'.md'),`# ${date}\n\n${LABEL}\n\n${point.reason}\n\nStrategie: ${point.strategy??'unbekannt'}; BTC: ${point.hold??'unbekannt'}; Sparplan: ${point.dca??'unbekannt'} USDT.\n`);}
 writeFileSync(join(staged,'README.md'),`# ${LABEL}\n\nSerie ${id}; seit ${new Date(start).toISOString().slice(0,10)}.\n\n${result.points.length} Tage; ${result.fills.length} simulierte Fills. Sparplan mit zusätzlichen monatlichen Einzahlungen; Endvermögen nicht direkt vergleichbar.\n`);
 // The workflow commits only after successful completion. Failed local writes do not replace the prior state.
 for(const account of ['strategy','hold','dca'] as const){
  const metrics=summary(result,account);
  const report=metrics===null?'Keine belastbaren Kennzahlen (fehlende Bewertungen).':JSON.stringify(metrics);
  writeFileSync(join(staged,account+'-metrics.json'),JSON.stringify({label:LABEL,metrics},null,2)+'\n');
  const overview=join(staged,'README.md');
  writeFileSync(overview,readFileSync(overview,'utf8')+'\n'+account+': '+report+'\n');
 }
 const backup=directory+'.previous';
 if(existsSync(backup))throw Error('Previous transaction needs inspection');
 if(existsSync(directory))renameSync(directory,backup);
 try{renameSync(staged,directory);}catch(error){if(existsSync(backup))renameSync(backup,directory);throw error;}
 if(existsSync(backup))rmSync(backup,{recursive:true});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e instanceof Error?e.message:'Forward run failed');process.exitCode=1;});
