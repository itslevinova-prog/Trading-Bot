import {createHash} from 'node:crypto';
import type {Candle} from './candle-source.js';
import type {QualityVerdict} from '../coin-quality/contracts.js';
import {excludedBase,median} from '../coin-quality/contracts.js';

export const DAY=86_400_000;
// H-025 preregistration. Research assumptions never grant pipeline admission.
export const TREND_RESEARCH_ASSUMPTIONS=Object.freeze({
 version:'H-025-research-v1',label:'Forschungslauf mit Annahmen',pipelineEligible:false,
 fromMs:Date.UTC(2020,0,1),toMs:Date.UTC(2024,0,1),
 minAgeDays:240,consecutiveDailyBars:240,minMedianQuoteVolume30d:5_000_000,
 lotDecimals:0,minNotional:10,initialCash:10_000,feeRate:.001,spreadBps:10,slippageBps:5,
 quote:'USDT',historicalTradabilityVerified:false
});
export function researchQuality(symbol:string,asOf:number,rows:readonly Candle[]):QualityVerdict{
 const a=TREND_RESEARCH_ASSUMPTIONS;
 if(asOf<a.fromMs||asOf>a.toMs||asOf%DAY!==0)throw Error('Sealed UTC development range required');
 const closed=rows.filter(c=>c.ts+DAY<=asOf&&c.ts>=a.fromMs);
 const tail=closed.slice(-a.consecutiveDailyBars);
 const volumes=tail.slice(-30).map(c=>c.quoteVolume??NaN);
 const allowed=symbol.endsWith('USDT')&&!excludedBase(symbol.slice(0,-4))&&
  tail.length===a.consecutiveDailyBars&&tail.every((c,i)=>c.ts===asOf-(tail.length-i)*DAY)&&
  closed[0]!.ts<=asOf-a.minAgeDays*DAY&&
  volumes.every(Number.isFinite)&&(median(volumes)??0)>=a.minMedianQuoteVolume30d;
 return {symbol,asOf,status:allowed?'allowed':'unknown',
  reasons:[allowed?'Research-only assumed eligibility; historical exchange status, tags, depegs and lots NOT verified':'Research age, volume, exclusion or consecutive-day gate failed'],
  sources:[{name:a.version+'; candle-derived research assumption, NOT historical exchange evidence',fetchedAt:asOf,official:false}]};
}
export function validateResearchMonths(from:string,to:string):void{
 if(!/^202[0-3]-(0[1-9]|1[0-2])$/.test(from)||!/^202[0-3]-(0[1-9]|1[0-2])$/.test(to)||from>to)
  throw Error('Only development months 2020-01 through 2023-12 are allowed');
}
export const researchHash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
