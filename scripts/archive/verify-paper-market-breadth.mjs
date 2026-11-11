import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyCaptureConfig,loadHistoricalPeriod} from './historical-period-files.mjs';
import {aggregate,marketContext} from '../apps/server/dist/context/market-context.js';
import {paperMarketContext} from '../apps/server/dist/context/paper-market-context.js';
import {feature} from '../apps/server/dist/market/indicators.js';
import {digest,inspectBuild} from '../apps/server/dist/provenance/build.js';
globalThis.fetch=async()=>{throw Error('Offline replay');};
const {markets}=loadHistoricalPeriod(historyCaptureConfig(process.cwd(),false),'2026-04');
const step=900000,scope=[];
for(let day=1;day<=30;day++){
 const now=Date.UTC(2026,3,day,12);
 const inputs=markets.map(({pair,candles})=>{
  const past=candles.filter(c=>c.ts+step<=now).slice(-750);
  const hourly=aggregate(past,60,now),close=past.at(-1).close;
  return {pair,candles:past,hourly,feature:feature(pair,past,hourly,{bid:close,ask:close},now)};
 });
 const {breadth:old,...baseline}=marketContext(inputs,'binance','EUR',now);
 const {breadth:next,...candidate}=paperMarketContext(inputs,'binance','EUR',now);
 assert.deepEqual(candidate,baseline);
 const values=[];
 for(const input of inputs){
  const byTime=new Map(input.candles.map(c=>[c.ts,c.close]));
  const closes=Array.from({length:97},(_,i)=>byTime.get(now-(97-i)*step));
  if(closes.every(x=>x!==undefined))values.push(100*(closes.at(-1)/closes[0]-1));
 }
 values.sort((a,b)=>a-b);
 assert.equal(next.return24hKnown,values.length);
 assert.equal(next.positive24h,values.filter(x=>x>0).length);
 assert.ok(values.length);
 const a=Math.floor((values.length-1)/2),b=Math.ceil((values.length-1)/2);
 assert.ok(Math.abs(next.medianChange24h-(values[a]+values[b])/2)<1e-10);
 scope.push({now,old,next});
}
const baselineId='d9a4a8b7cea171e8d8224b620eaa03427564587b426e88f64b329bf4b8b3f7b5';
const archive=JSON.parse(fs.readFileSync('data/build-archives/'+baselineId+'/manifest.json','utf8'));
const patch=JSON.parse(fs.readFileSync('docs/hourly-trend-runtime-patch-v1.json','utf8'));
const pins=Object.entries({...patch.sourceHashes,...patch.runtimeHashes}).map(([path,oldHash])=>{
 const before=[...archive.sources,...archive.runtimeFiles].find(f=>f.path===path).sha256;
 const current=digest(fs.readFileSync(path));assert.equal(current,before,path);
 return {path,hash:current,matchesOriginalHourlyPatch:current===oldHash};
});
const build=inspectBuild(process.cwd());
assert.equal(build.verified,true);
const facts={version:'paper-market-breadth-april-replay-v1',generatedAt:new Date().toISOString(),build,baselineId,scope,markets:markets.length,hourlyPatchInputsUnchangedFromBaseline:pins,nonBreadthContextIdentical:true,source:'Already-inspected sealed April candles at fixed daily noon UTC. Descriptive context arithmetic only.'};
const data=JSON.stringify(facts,null,2)+'\n',hash=digest(data),path='docs/paper-market-breadth-april-'+hash.slice(0,16)+'.json';
fs.writeFileSync(path,data,{flag:'wx'});
console.log(JSON.stringify({path,hash,clocks:scope.length,markets:markets.length,completeClocks:scope.filter(x=>x.next.complete).length,changedMedians:scope.filter(x=>x.old.medianChange24h!==x.next.medianChange24h).length,preexistingHistoricalPinDifferences:pins.filter(p=>!p.matchesOriginalHourlyPatch).map(p=>p.path),build:build.buildId}));
