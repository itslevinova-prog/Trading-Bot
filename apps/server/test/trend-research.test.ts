import {test,expect} from 'vitest';
import {DAY,researchQuality,validateResearchMonths,TREND_RESEARCH_ASSUMPTIONS as a} from '../src/backtest/trend-research.js';
import {runImport} from '../src/archive/download.js';
const rows=Array.from({length:240},(_,i)=>({ts:a.fromMs+i*DAY,open:1,high:1,low:1,close:1,volume:1,quoteVolume:5_000_000}));
const at=a.fromMs+240*DAY;
test('research gates age, past consecutive daily bars, volume and excluded bases without future leakage',()=>{
 expect(researchQuality('BTCUSDT',at,rows).status).toBe('allowed');
 expect(researchQuality('BTCUSDT',at,rows.slice(1)).status).toBe('unknown');
 expect(researchQuality('BTCUSDT',at,rows.filter((_,i)=>i!==100)).status).toBe('unknown');
 expect(researchQuality('BTCUSDT',at,rows.map(c=>({...c,quoteVolume:4_999_999}))).status).toBe('unknown');
 expect(researchQuality('USDCUSDT',at,rows).status).toBe('unknown');
 expect(researchQuality('BTCUSDT',at,[...rows,{...rows[0]!,ts:at,quoteVolume:1e20}])).toEqual(researchQuality('BTCUSDT',at,rows));
 expect(researchQuality('BTCUSDT',at,rows).sources[0]!.official).toBe(false);
 expect(a.pipelineEligible).toBe(false);
});
test('reject validation, holdout, malformed months and reversed ranges before import',()=>{
 validateResearchMonths('2020-01','2023-12');
 for(const pair of [['2024-01','2024-12'],['2020-01','2025-01'],['2020-00','2023-12'],['2023-12','2020-01']])
  expect(()=>validateResearchMonths(pair[0]!,pair[1]!)).toThrow();
});
test('reject unknown quote before network access',async()=>{
 await expect(runImport(['--quote','FAKE'],async()=>{throw Error('NETWORK');})).rejects.toThrow('Invalid --quote');
});

test('daily trend runs on real daily/hourly fixture channels without synthesizing 15m; no last-boundary order',async()=>{
 const {runBacktest}=await import('../src/backtest/runner.js');
 const from=Date.UTC(2021,0,1),to=from+3*DAY;
 const source={
  listSymbols:async()=>['BTCUSDT'],
  getCandles:async(_symbol:string,minutes:15|60|240|1440,start:number,end:number)=>{
   if(minutes===15)throw Error('Daily trend must not read or synthesize 15m candles');
   const step=minutes*60_000;
   return Array.from({length:Math.max(0,Math.floor((end-start)/step))},(_,i)=>{
    const ts=start+i*step,p=100+((ts-Date.UTC(2020,0,1))/DAY)*.1+Math.sin(ts/DAY)*.1;
    return {ts,open:p,high:p*1.01,low:p*.99,close:p,volume:1e6,quoteVolume:1e7};
   });
  }
 };
 const result=await runBacktest({source,strategy:'trend-vol-target',fromMs:from,toMs:to,intervalMinutes:1440,
  universeAt:()=>['BTCUSDT'],constraints:new Map([['BTCUSDT',{symbol:'BTCUSDT',ordermin:.0001,costmin:10,lotDecimals:4}]]),
  coinQuality:{check:async(symbol,asOf)=>({symbol,asOf,status:'allowed',reasons:['fixture'],sources:[{name:'fixture',fetchedAt:asOf,official:false}]})},
  enablePortfolioRisk:true,initialCash:10000,feeRate:.001,spreadBps:10,slippageBps:5,quoteCurrency:'USDT'});
 expect(result.equity.at(-1)!.ts).toBe(to);
 expect(result.decisions.every(d=>d.ts<to)).toBe(true);
 expect(result.universe).toEqual(['BTCUSDT']);
});

test('Actions must preserve empty symbols and reject a scoped trend run before importing',async()=>{
 const {readFileSync}=await import('node:fs');
 const workflow=readFileSync(new URL('../../../.github/workflows/research-data.yml',import.meta.url),'utf8');
 expect(workflow).toMatch(/symbols:\s+description:[^\n]+\s+default: ''/);
 expect(workflow).toContain("process.env.IMPORT_SYMBOLS!==''");
});
