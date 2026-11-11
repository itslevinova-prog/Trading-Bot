import fs from 'node:fs';import assert from 'node:assert/strict';
import {marketFile,pageFile,readCompressed} from './historical-period-files.mjs';import {strictHistoricalPage} from '../apps/server/dist/research/historical-period.js';import {digest} from '../apps/server/dist/provenance/build.js';import {canonicalJson} from '../apps/server/dist/research/dataset.js';
/** Read original immutable raw pages; no network, mutation, symbol substitution or July access. */
export function archivedActivityPeriod(config,id,pairs){
 assert.notEqual(id,'2026-07');const period=config.protocol.periods.find(p=>p.id===id);assert.ok(period);assert.ok(Array.isArray(pairs)&&pairs.length&&new Set(pairs).size===pairs.length);const markets=[],sources=[];
 for(const pair of pairs){assert.ok(config.protocol.symbols.includes(pair));const file=marketFile(config,period,pair),saved=readCompressed(file);assert.equal(saved.protocolHash,config.protocolHash);assert.equal(saved.pair,pair);assert.equal(canonicalJson(saved.period),canonicalJson(period));assert.equal(saved.repair.complete,true);const rawByTime=new Map(),retrievedByTime=new Map(),candles=[];
  for(const page of saved.pages){const path=pageFile(config,period,pair,page.from,page.toInclusive),document=readCompressed(path);assert.equal(document.protocolHash,config.protocolHash);assert.equal(document.pair,pair);assert.equal(document.publicEndpoint,config.protocol.endpoint);assert.equal(document.from,page.from);assert.equal(document.toInclusive,page.toInclusive);assert.equal(digest(canonicalJson(document.raw)),document.canonicalRawHash);assert.equal(document.canonicalRawHash,page.canonicalRawHash);
   const parsed=strictHistoricalPage(pair,page.from,page.toInclusive,period.toExclusive,document.raw),retrievedAt=Date.parse(document.retrievedAt);assert.ok(Number.isSafeInteger(retrievedAt)&&retrievedAt>=period.toExclusive);assert.ok(document.raw.every(r=>Array.isArray(r)&&r.length===12));candles.push(...parsed);
   for(const row of document.raw){assert.equal(rawByTime.has(row[0]),false);rawByTime.set(row[0],row);retrievedByTime.set(row[0],retrievedAt);}
   sources.push({period:id,pair,path,pageSha256:digest(fs.readFileSync(path)),rawHash:document.canonicalRawHash,retrievedAt:document.retrievedAt,from:page.from,toInclusive:page.toInclusive,rows:document.raw.length});
  }
  assert.equal(canonicalJson(candles),canonicalJson(saved.rows));markets.push({pair,candles,rawByTime,retrievedByTime,marketFileHash:digest(fs.readFileSync(file))});
 }
 return {period,markets,sources};
}
