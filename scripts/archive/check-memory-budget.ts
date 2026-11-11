import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url))); 
import {readFileSync,writeFileSync} from 'node:fs';
import {packContext} from '../apps/server/src/ai/prompt.js';
import {readPackedMemoryRecord} from '../apps/server/src/ai/intent-encoding.js';
import {readPackedRootFeature,readPackedFeature} from '../apps/server/src/ai/feature-encoding.js';
import {readPackedBookLevels} from '../apps/server/src/ai/book-encoding.js';
import {readPackedNativeIntent} from '../apps/server/src/ai/intent-encoding.js';
const original='data/context-budget-fixtures/full-exit-af15ab524c3522ed780bf562ca78c4e0459752eee8ae718e3893202ad839b2ac.json';
const {context,maxChars}=JSON.parse(readFileSync(original,'utf8')),asOf=Date.parse(context.timeUTC),step=900000;
context.memory=context.features.map((f:any,i:number)=>({pair:f.pair,hits:Array.from({length:5},(_,j)=>{
 const close=Math.floor(asOf/step)*step-(j+2)*4*3600000;
 return {ts:close+1000,pair:f.pair,action:j%2?'buy':'hold',change1h:.15*(j+1),change4h:.3*(j-1),change24h:null,tradePnlEur:null,distance:.123456789*(j+1),priceCloseTs:close,outcomeAvailableAt:close+4*3600000+300000};}),
 summary:'5 nicht ueberlappende historische4h-Preisfenster; 3 positiv. Keine unabhaengigen Versuche oder Gewinnwahrscheinlichkeit; Kosten/Trade-PnL nicht ausgewertet.',
 evidence:{version:'paper-memory-v2',asOf,accountId:'ai',legacyRowsExcluded:i,invalidVectorsExcluded:0,duplicateWindowsExcluded:2*i,overlapWindowsExcluded:i+1,normalizationRows:2000-i,independence:'unknown',performanceValidated:false,estimatedWinProbability:null,scope:'observed closed-price changes, not executed trade PnL; costs not deducted'}}));
const artifact='data/context-budget-fixtures/memory-v2-synthetic.json';
writeFileSync(artifact,JSON.stringify({fixtureOnly:true,original,context,maxChars},null,2));
const before=JSON.stringify(context),packed=packContext(context,maxChars),decoded=JSON.parse(packed.user);
assert.equal(JSON.stringify(context),before);
const memories=decoded.memory.map((m:unknown)=>readPackedMemoryRecord(m,decoded));
for(const m of memories)assert.deepEqual(m,context.memory.find((x:any)=>x.pair===m.pair));
assert.equal(decoded.marketContext.markets.length,20);
assert.deepEqual(decoded.features.map((f:unknown)=>readPackedRootFeature(f,decoded)),context.features);
assert.deepEqual(decoded.tradingPolicy,context.tradingPolicy);assert.deepEqual(decoded.limits,context.limits);
assert.deepEqual(decoded.execution.nativeOrderHistory.items.map((r:unknown)=>readPackedNativeIntent(r,decoded)),context.execution.nativeOrderHistory.items);
for(const [i,m]of decoded.marketContext.markets.entries()){
 assert.deepEqual(readPackedFeature(m.feature,decoded),context.marketContext.markets[i].feature);
 assert.deepEqual(m.regime,context.marketContext.markets[i].regime);
 for(const k of ['bids','asks'])assert.deepEqual(readPackedBookLevels(m.microstructure[k],decoded),context.marketContext.markets[i].microstructure[k]);}
console.log(JSON.stringify({fixtureOnly:true,artifact,chars:packed.chars,maxChars,markets:20,exitHistories:decoded.execution.nativeOrderHistory.items.length,selectedMemoryRecords:memories.length,exactMemoryHits:memories.reduce((n:number,m:any)=>n+m.hits.length,0),allMandatoryValuesEqual:true,memoryEncoding:!!decoded.transmission.memoryEncoding,omissions:decoded.transmission.omissions}));
