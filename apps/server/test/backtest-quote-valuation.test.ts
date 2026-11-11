import {expect,test} from 'vitest';
import {valueQuoteInEur,type HistoricalRate} from '../src/backtest/quote-valuation.js';
import {reportHtml,type BacktestReport} from '../src/backtest/report.js';

const START=Date.UTC(2022,0,3,18),END=Date.UTC(2022,0,4,18);
const rate=(observedAtMs:number,rate:number,source:string,knownAtMs=observedAtMs):HistoricalRate=>({
 observedAtMs,knownAtMs,rate,source
});
const usdEur=[rate(START-3_600_000,.9,'ECB historical fixing'),
 rate(END-3_600_000,.85,'ECB historical fixing')];
const stableUsd=[rate(START-60_000,.99,'public USDT/USD spot'),
 rate(END-60_000,.97,'public USDT/USD spot')];

test('decomposes trading, USD/EUR FX and stablecoin depeg without conflating returns',()=>{
 const result=valueQuoteInEur({
  quote:'USDT',fromMs:START,toMs:END,initialQuoteEquity:1000,finalQuoteEquity:1100,
  ecbEurPerUsd:usdEur,stablecoinUsdCross:stableUsd
 });
 expect(result.status).toBe('available');
 expect(result.tradingReturn).toBeCloseTo(.1,10);
 expect(result.quoteFxReturn).toBeCloseTo(.85/.9-1,10);
 expect(result.stablecoinReturn).toBeCloseTo(.97/.99-1,10);
 expect(result.initialEurEquity).toBeCloseTo(891,10);
 expect(result.finalEurEquity).toBeCloseTo(906.95,10);
 expect(result.stablecoinPegDeviation).toEqual({initial:-.010000000000000009,final:-.030000000000000027});
 const sum=result.tradingContribution!+result.quoteFxContribution!+result.stablecoinContribution!;
 expect(sum).toBeCloseTo(result.totalEurReturn!,10);
 expect(result.totalEurReturn).toBeCloseTo(906.95/891-1,10);
 expect(result.sources).toEqual(['ECB historical fixing','public USDT/USD spot']);
});

test('EUR quote has zero FX and no stablecoin effect',()=>{
 const result=valueQuoteInEur({
  quote:'EUR',fromMs:START,toMs:END,initialQuoteEquity:100,finalQuoteEquity:110
 });
 expect(result.status).toBe('available');
 expect(result.totalEurReturn).toBeCloseTo(.1,10);
 expect(result.quoteFxReturn).toBe(0);
 expect(result.stablecoinReturn).toBe(0);
 expect(result.stablecoinPegDeviation).toBeNull();
 expect(result.sources).toEqual([]);
});

test('USD requires historical ECB rates; missing USD/USDC cross is never assumed at parity',()=>{
 const baseline={fromMs:START,toMs:END,initialQuoteEquity:100,finalQuoteEquity:110};
 const usd=valueQuoteInEur({...baseline,quote:'USD',ecbEurPerUsd:usdEur});
 expect(usd.totalEurReturn).toBeCloseTo(1.1*.85/.9-1,10);
 const missingEcb=valueQuoteInEur({...baseline,quote:'USDC',stablecoinUsdCross:stableUsd});
 expect(missingEcb.status).toBe('unavailable');
 expect(missingEcb.totalEurReturn).toBeNull();
 expect(missingEcb.quoteFxReturn).toBeNull();
 const missingCross=valueQuoteInEur({...baseline,quote:'USDC',ecbEurPerUsd:usdEur});
 expect(missingCross.tradingReturn).toBeCloseTo(.1,10);
 expect(missingCross.quoteFxReturn).not.toBeNull();
 expect(missingCross.stablecoinReturn).toBeNull();
 expect(missingCross.totalEurReturn).toBeNull();
 expect(missingCross.finalEurEquity).toBeNull();
 expect(missingCross.reason).toMatch(/Spot-Cross/);
});

test('future publication, stale spot and long ECB gaps are unknown instead of backfilled',()=>{
 const base={quote:'USDT' as const,fromMs:START,toMs:END,initialQuoteEquity:100,finalQuoteEquity:110,
  ecbEurPerUsd:usdEur,stablecoinUsdCross:stableUsd};
 const future=valueQuoteInEur({...base,ecbEurPerUsd:[
  rate(START-3_600_000,.9,'published later',START+1000),usdEur[1]!
 ]});
 expect(future.status).toBe('unavailable');
 expect(future.quoteFxReturn).toBeNull();
 const stale=valueQuoteInEur({...base,stablecoinUsdCross:[stableUsd[0]!]});
 expect(stale.totalEurReturn).toBeNull();
 const old=valueQuoteInEur({...base,ecbEurPerUsd:[rate(START-5*86_400_000,.9,'old'),usdEur[1]!]});
 expect(old.totalEurReturn).toBeNull();
});

test('invalid exchange rates cannot manufacture profitable conversions',()=>{
 expect(()=>valueQuoteInEur({quote:'USDC',fromMs:START,toMs:END,
  initialQuoteEquity:100,finalQuoteEquity:110,ecbEurPerUsd:usdEur,
  stablecoinUsdCross:[rate(START,-1,'bad')]})).toThrow(/Invalid historical FX/);
});

test('HTML output explicitly labels missing FX as n/a and preserves separated effects',()=>{
 const valuation=valueQuoteInEur({quote:'USDC',fromMs:START,toMs:END,
  initialQuoteEquity:100,finalQuoteEquity:110,ecbEurPerUsd:usdEur});
 const report={
  runId:'a'.repeat(16),quoteValuation:valuation,
  backtest:{
   configuration:{strategy:'hold',fromMs:START,toMs:END,fillModel:'conservative-ohlc',
    spreadBps:0,slippageBps:0,feeRate:.001},
   metrics:{},coverage:null,
   historicalTradability:{unknownMarketDays:null,totalMarketDays:null,
    restrictedMarketDays:null,evidencedTradableMarketDays:null,
    unknownTrades:0,totalTrades:0,restrictedTrades:0,evidencedTradableTrades:0,evidenceSources:[]},
   equity:[],daily:[],limitations:[],
   fingerprints:{data:'b'.repeat(64),configuration:'c'.repeat(64),codeBuild:null}
  },benchmarks:[],bootstrap:null,stress:[],robustness:'insufficient_evidence',parity:{}
 } as unknown as BacktestReport;
 const html=reportHtml(report);
 expect(html).toContain('Quote-Bewertung in EUR');
 expect(html).toContain('Handelsrendite in Quote');
 expect(html).toContain('Stablecoin-Abweichung');
 expect(html).toContain('n/a');
 expect(html).toContain('Spot-Cross');
});
