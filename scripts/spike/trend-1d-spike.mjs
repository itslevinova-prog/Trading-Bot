#!/usr/bin/env node
/** Issue #33. PRE-REGISTERED RESEARCH ONLY. The only allowed archive window is
 * 2020-01-01 inclusive to 2024-01-01 exclusive. Never request holdout data. */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

export const START=Date.UTC(2020,0,1);
export const END=Date.UTC(2024,0,1);
export const DAY=86_400_000;
export const MARKETS=Object.freeze(['BTCUSDT','ETHUSDT']);
export const WINDOWS=Object.freeze([50,100,200]);
export const FEE_RATE=.001;   // 10 bps each executed side
export const SLIPPAGE_RATE=.0005;  // 5 bps adverse execution per side
const START_CAPITAL=1000;

const isValidPositive=n=>Number.isFinite(n)&&n>0;
export function validateDevelopmentBars(symbol,rows){
 if(!MARKETS.includes(symbol)||!Array.isArray(rows))throw Error('Unknown development market');
 const expected=(END-START)/DAY;
 if(rows.length!==expected)throw Error(symbol+': complete contiguous 2020–2023 daily candles required');
 for(let i=0;i<rows.length;i++){
  const c=rows[i];
  if(c.ts!==START+i*DAY||![c.open,c.high,c.low,c.close].every(isValidPositive)||
   !Number.isFinite(c.volume)||c.volume<0||
   c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close))
   throw Error(symbol+': archive gap, duplicate, incomplete or invalid candle at '+i);
 }
 return rows;
}
export function buyOrSellAtOpen(sleeve,side,open,ts){
 if(!isValidPositive(open)||!Number.isSafeInteger(ts)||ts<0||
  !['buy','sell'].includes(side))throw Error('Invalid reference fill');
 const slip=side==='buy'?open*(1+SLIPPAGE_RATE):open*(1-SLIPPAGE_RATE);
 const size=side==='buy'?sleeve.cash/(slip*(1+FEE_RATE)):sleeve.qty;
 if(!Number.isFinite(size)||size<0)throw Error('Invalid simulated quantity');
 if(size===0)return null;
 const notional=size*slip,fee=notional*FEE_RATE;
 const slipCost=Math.abs(slip-open)*size;
 if(side==='buy'){sleeve.cash-=notional+fee;sleeve.qty+=size;}
 else{sleeve.cash+=notional-fee;sleeve.qty-=size;}
 if(Math.abs(sleeve.cash)<1e-9)sleeve.cash=0;
 if(Math.abs(sleeve.qty)<1e-12)sleeve.qty=0;
 sleeve.costs+=fee+slipCost;
 const fill={ts,side,qty:size,referenceOpen:open,fillPrice:slip,fee,slippageCost:slipCost};
 sleeve.trades.push(fill);
 return fill;
}
/** Signal at close(t) is ONLY placed on the next opening price(t+1).
 * Fixed allocation sleeve: no transfers to/from the other coin. */
export function simulateSleeve(rows,capital,windowN=null){
 if(!Array.isArray(rows)||rows.length===0||!isValidPositive(capital)||
  (windowN!==null&&(!Number.isSafeInteger(windowN)||windowN<2)))
  throw Error('Invalid simulation fixture');
 const sleeve={cash:capital,qty:0,costs:0,trades:[]};
 const equity=[capital],exposure=[];
 let pending=windowN===null?'buy':null;
 for(let i=0;i<rows.length;i++){
  const bar=rows[i];
  if(!Number.isSafeInteger(bar.ts)||!isValidPositive(bar.open)||!isValidPositive(bar.close))
   throw Error('Invalid fixture bar');
  if(pending)buyOrSellAtOpen(sleeve,pending,bar.open,bar.ts);
  const value=sleeve.cash+sleeve.qty*bar.close;
  if(!isValidPositive(value))throw Error('Invalid mark-to-market');
  equity.push(value);
  exposure.push(sleeve.qty>0?1:0);
  pending=null;
  // The last close never causes a fill outside the pre-registered window.
  if(windowN!==null&&i+1<rows.length&&i+1>=windowN){
   const recent=rows.slice(i-windowN+1,i+1);
   if(recent.length===windowN){
    const sma=recent.reduce((sum,x)=>sum+x.close,0)/windowN;
    const long=bar.close>sma;
    if(long&&sleeve.qty===0)pending='buy';
    if(!long&&sleeve.qty>0)pending='sell';
   }
  }
 }
 return {equity,exposure,trades:sleeve.trades,costs:sleeve.costs};
}
function variance(values){
 if(values.length<2)return null;
 const mean=values.reduce((sum,x)=>sum+x,0)/values.length;
 return values.reduce((sum,x)=>sum+(x-mean)**2,0)/(values.length-1);
}
export function summarizePath(equity,exposure,tradeCount,costs,startCapital){
 if(!Array.isArray(equity)||equity.length<2||equity.some(x=>!isValidPositive(x))||
  exposure.length!==equity.length-1||!isValidPositive(startCapital))
  throw Error('Invalid metric series');
 const initial=equity[0],final=equity.at(-1),days=exposure.length;
 const ret=equity.slice(1).map((x,i)=>x/equity[i]-1);
 const mu=ret.reduce((sum,x)=>sum+x,0)/ret.length;
 const varianceValue=variance(ret),std=varianceValue===null?null:Math.sqrt(varianceValue);
 let peak=initial,dd=0;
 for(const value of equity){peak=Math.max(peak,value);dd=Math.max(dd,(peak-value)/peak);}
 const cagr=(final/initial)**(365/days)-1;
 const sharpe=std!==null&&std>0?mu/std*Math.sqrt(365):null;
 const calmar=dd>0?cagr/dd:null;
 return {cagr,maxDrawdown:dd,sharpe,calmar,trades:tradeCount,
  exposure:exposure.reduce((sum,x)=>sum+x,0)/exposure.length,
  costsPctOfInitial:costs/startCapital*100};
}
function combine(sleeves){
 const length=sleeves[0].equity.length;
 if(sleeves.some(s=>s.equity.length!==length))throw Error('Nonaligned paper sleeves');
 const equity=Array.from({length},(_,i)=>sleeves.reduce((sum,x)=>sum+x.equity[i],0));
 const exposure=Array.from({length:length-1},(_,i)=>sleeves.reduce((sum,x)=>sum+x.exposure[i],0)/sleeves.length);
 return summarizePath(equity,exposure,sleeves.reduce((sum,x)=>sum+x.trades.length,0),
  sleeves.reduce((sum,x)=>sum+x.costs,0),START_CAPITAL);
}
export function classify(variants,reference){
 if(!Number.isFinite(reference.sharpe)||!Number.isFinite(reference.calmar))
  return {status:'unclassifiable',reason:'Benchmark Sharpe/Calmar unavailable; no promotion'};
 const better=variants.map(v=>({
  both:Number.isFinite(v.sharpe)&&Number.isFinite(v.calmar)&&
    v.sharpe>reference.sharpe&&v.calmar>reference.calmar,
  either:(Number.isFinite(v.sharpe)&&v.sharpe>reference.sharpe)||
    (Number.isFinite(v.calmar)&&v.calmar>reference.calmar)
 }));
 if(better.some(x=>x.both))return {status:'green',reason:'At least one fixed SMA window exceeds both reference Sharpe and Calmar'};
 if(better.some(x=>x.either))return {status:'yellow',reason:'At least one fixed SMA window exceeds only one reference measure'};
 return {status:'red',reason:'No fixed SMA window exceeds reference Sharpe or Calmar'};
}
export function runFixedComparison(btc,eth){
 validateDevelopmentBars('BTCUSDT',btc);validateDevelopmentBars('ETHUSDT',eth);
 const variants=WINDOWS.map(window=>({window,
  ...combine([simulateSleeve(btc,START_CAPITAL/2,window),
   simulateSleeve(eth,START_CAPITAL/2,window)])}));
 const benchmarks={
  btcBuyHold:summarizePath(...(()=>{
   const s=simulateSleeve(btc,START_CAPITAL,null);
   return [s.equity,s.exposure,s.trades.length,s.costs,START_CAPITAL];
  })()),
  btcEth5050BuyHold:combine([simulateSleeve(btc,START_CAPITAL/2,null),
   simulateSleeve(eth,START_CAPITAL/2,null)])
 };
 const decision=classify(variants,benchmarks.btcEth5050BuyHold);
 return {protocol:'trend-1d-spike-v1',researchOnly:true,
  range:{fromInclusive:'2020-01-01',toExclusive:'2024-01-01'},
  markets:MARKETS,windows:WINDOWS,
  costAssumptions:{feeBpsPerSide:10,slippageBpsPerSide:5},
  hashes:{BTCUSDT:createHash('sha256').update(JSON.stringify(btc)).digest('hex'),
   ETHUSDT:createHash('sha256').update(JSON.stringify(eth)).digest('hex')},
  variants,benchmarks,decision,
  limitations:['Development-window diagnostic only','No parameter optimization',
   'Signal at closed UTC day; fills only next daily open',
   'No order book, borrowing, funding or observed maker queue',
   'Positions marked to last close, no invented final liquidation',
   'Never a validation or holdout claim']};
}
const num=v=>v===null?'–':(100*v).toFixed(2)+' %';
const dec=v=>v===null?'–':v.toFixed(3);
export function markdown(report){
 const rows=[...report.variants.map(v=>({name:'SMA'+v.window,...v})),
  {name:'BTC Buy & Hold',...report.benchmarks.btcBuyHold},
  {name:'BTC/ETH 50:50 Buy & Hold',...report.benchmarks.btcEth5050BuyHold}];
 return ['# Trendfolge 1d – vorregistrierter Entwicklungsschnelltest',
  '',
  'Nur BTCUSDT/ETHUSDT, 2020-01-01 bis 2023-12-31. Kein Holdout oder 2024.',
  'SMA-Longsignal bei Tagesschluss, Ausführung erst zur nächsten Tageseröffnung.',
  'Kosten: pro Trade-Seite 10 bps Gebühr + 5 bps Slippage. Kein Ergebnis ist eine Gewinnprognose.',
  '',
  '| Variante | CAGR | Max-Drawdown | Sharpe | Calmar | Trades | Exposure | Kosten/Start |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...rows.map(r=>`| ${r.name} | ${num(r.cagr)} | ${num(r.maxDrawdown)} | ${dec(r.sharpe)} | ${dec(r.calmar)} | ${r.trades} | ${num(r.exposure)} | ${r.costsPctOfInitial.toFixed(2)} % |`),
  '',`**Vorregistrierte Entscheidung:** ${report.decision.status.toUpperCase()} – ${report.decision.reason}`,
  '',`Daten-Hashes: BTC ${report.hashes.BTCUSDT}; ETH ${report.hashes.ETHUSDT}.`,
  '', 'Dieser Spike ersetzt keine Validierung oder #21; Ergebnisse erst nach unabhängiger Prüfung ins Hypothesenregister übernehmen.',''].join('\n');
}
function persistExactly(path,content){
 mkdirSync(dirname(path),{recursive:true});
 if(existsSync(path)){
  if(readFileSync(path,'utf8')!==content)throw Error('Existing research output differs; refusing overwrite: '+path);
  return;
 }
 writeFileSync(path,content,{flag:'wx'});
}
async function main(){
 if(process.env.LIVE_ENABLED==='true')throw Error('Spike must never run with LIVE_ENABLED=true');
 // Only this execution path opens the archive. Imports and unit tests never do.
 const {ArchiveCandleSource}=await import('../../apps/server/src/archive/candle-source.ts');
 const source=new ArchiveCandleSource(); // no allowHoldout override
 try {
  const [btc,eth]=await Promise.all(MARKETS.map(m=>source.getCandles(m,1440,START,END)));
  const report=runFixedComparison(btc,eth);
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  persistExactly(resolve(root,'docs/spikes/trend-1d-2020-2023.json'),JSON.stringify(report,null,2)+'\n');
  persistExactly(resolve(root,'docs/spikes/TREND-1D-SPIKE.md'),markdown(report));
  process.stdout.write(JSON.stringify({decision:report.decision,
   files:['docs/spikes/trend-1d-2020-2023.json','docs/spikes/TREND-1D-SPIKE.md']})+'\n');
 }finally{source.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
