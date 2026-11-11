import {readFileSync,statSync} from 'node:fs';import {resolve} from 'node:path';import {projectRoot} from '../config.js';
let cache:{mtime:number;value:unknown}|undefined;
/** Research is descriptive context, never an instruction or automatic selection. */
export function researchEvidence(venue:string,quote:string){
 try{const file=resolve(projectRoot,'docs/research-latest.json'),mtime=statSync(file).mtimeMs;if(cache?.mtime===mtime)return cache.value;
  const report=JSON.parse(readFileSync(file,'utf8'));
  if(report.venue!==venue||report.quoteCurrency!==quote||!Array.isArray(report.results)||!Number.isFinite(Date.parse(report.generatedAt))||Date.parse(report.generatedAt)>Date.now()+60000)return {status:'unavailable',reason:'Research venue/currency/timestamp mismatch'};
  const value={status:'available',generatedAt:report.generatedAt,venue,quoteCurrency:quote,method:report.method,warning:'Research presets differ from the actual rule account. All presets shown; no winner selected. Retrospective results cannot establish future profitability.',columns:['pair','preset','bars','holdoutReturnPct','holdoutTrades','holdoutMaxDrawdownPct','benchmarkReturnPct','historicalWinRatePct','doubleCostHoldoutReturnPct','positiveFolds','evaluationTrades','verdict'],rows:report.results.slice(0,320).map((r:any)=>[r.pair,r.strategy,r.bars,r.outOfSample?.returnPct??null,r.outOfSample?.trades??null,r.outOfSample?.maxDrawdownPct??null,r.outOfSample?.benchmarkReturnPct??null,r.outOfSample?.winRatePct??null,r.stress?.returnPct??null,r.robustness?.positiveFolds??null,r.robustness?.evaluatedTrades??null,r.robustness?.verdict??'unavailable'])};cache={mtime,value};return value;
 }catch{return {status:'unavailable',reason:'No validated local historical report'};}
}
