import {expect,test} from 'vitest';
import {synchronizedPortfolioBootstrap,type SynchronizedPortfolioDay} from '../src/backtest/synchronized-bootstrap.js';
import {reportHtml} from '../src/backtest/report.js';

const DAY=86_400_000;
const start=Date.UTC(2022,2,1);
const clusters={BTCUSDT:'large-cap',ETHUSDT:'large-cap'};
function sample():SynchronizedPortfolioDay[] {
  return Array.from({length:6},(_,i)=>({
    utcDayMs:start+i*DAY,
    returns:{BTCUSDT:i===2?-.5:.01,ETHUSDT:i===2?-.7:.02},
    exposures:{BTCUSDT:.5,ETHUSDT:.5}
  }));
}

test('one shared source-day index keeps both coins in the same crash',()=>{
  const rows=sample(),result=synchronizedPortfolioBootstrap(rows,clusters,{seed:7,paths:10,blockLength:10000});
  expect(result.status).toBe('ok');
  expect(result.firstPathSourceIndices).toHaveLength(rows.length);
  expect(result.firstPathSourceIndices).toContain(2);
  result.firstPathSourceIndices!.forEach((index,i)=>{
    const source=rows[index]!;
    const expected=source.returns.BTCUSDT!*.5+source.returns.ETHUSDT!*.5;
    expect(result.firstPathPortfolioReturns![i]).toBeCloseTo(expected,12);
    if(index===2)expect(result.firstPathPortfolioReturns![i]).toBeCloseTo(-.6,12);
  });
  expect(result.maxDrawdown!.p90).toBeGreaterThan(.5);
  expect(result.maxClusterExposure!.p50).toBeCloseTo(1);
});

test('fixed seed is reproducible without mutating histories or relying on symbol ordering',()=>{
  const rows=sample(),before=JSON.stringify(rows);
  const options={seed:152,paths:100,blockLength:3};
  const a=synchronizedPortfolioBootstrap(rows,clusters,options);
  const b=synchronizedPortfolioBootstrap(rows.map(d=>({
    utcDayMs:d.utcDayMs,returns:{ETHUSDT:d.returns.ETHUSDT!,BTCUSDT:d.returns.BTCUSDT!},
    exposures:{ETHUSDT:d.exposures.ETHUSDT!,BTCUSDT:d.exposures.BTCUSDT!}
  })),{ETHUSDT:'large-cap',BTCUSDT:'large-cap'},options);
  expect(a).toEqual(b);
  expect(JSON.stringify(rows)).toBe(before);
});

test.each(['missing-return','missing-market','unknown-position','stale-day','duplicate-day','future-day','overweight','missing-cluster'] as const)(
  '%s fails closed without a fabricated performance estimate',kind=>{
    const rows=sample();
    const mapping:{[key:string]:string}={...clusters};
    if(kind==='missing-return')rows[1]!.returns={BTCUSDT:.02,ETHUSDT:null};
    if(kind==='missing-market')rows[2]!.returns={BTCUSDT:-.5};
    if(kind==='unknown-position')rows[1]!.exposures={BTCUSDT:.5,ETHUSDT:null};
    if(kind==='stale-day')rows[3]!.utcDayMs+=DAY;
    if(kind==='duplicate-day')rows[3]!.utcDayMs=rows[2]!.utcDayMs;
    if(kind==='future-day')rows[3]!.utcDayMs=Date.UTC(2024,0,1);
    if(kind==='overweight')rows[1]!.exposures={BTCUSDT:.6,ETHUSDT:.6};
    if(kind==='missing-cluster')delete mapping.ETHUSDT;
    const r=synchronizedPortfolioBootstrap(rows,mapping,{paths:30});
    expect(r.status).toBe('insufficient_evidence');
    expect(r.endReturn).toBeNull();
    expect(r.maxDrawdown).toBeNull();
    expect(r.maxClusterExposure).toBeNull();
    expect(r.firstPathSourceIndices).toBeNull();
  }
);

test('cluster exposure is measured from actual held fractions, not assumed equal weights',()=>{
  const rows=sample().map(d=>({...d,exposures:{BTCUSDT:.3,ETHUSDT:.2}}));
  const result=synchronizedPortfolioBootstrap(rows,{BTCUSDT:'btc',ETHUSDT:'eth'},{paths:10});
  expect(result.maxClusterExposure!.p50).toBeCloseTo(.3);
  expect(result.worstDailyReturn!.p10).toBeLessThan(0);
});

test('invalid random configuration rejects instead of silently changing the seed',()=>{
  expect(()=>synchronizedPortfolioBootstrap(sample(),clusters,{paths:0})).toThrow();
  expect(()=>synchronizedPortfolioBootstrap(sample(),clusters,{seed:NaN})).toThrow();
  expect(()=>synchronizedPortfolioBootstrap(sample(),clusters,{blockLength:0})).toThrow();
});

test('standalone report is explicitly n/a when no synchronized diagnostics are supplied',()=>{
  // Existing report fixtures elsewhere exercise the complete BacktestReport shape.
  const sampleReport={
    runId:'aaaaaaaaaaaaaaaa',
    backtest:{
      configuration:{strategy:'rules',fromMs:start,toMs:start+DAY,fillModel:'conservative-ohlc',spreadBps:5,slippageBps:5,feeRate:.001},
      metrics:{},coverage:null,
      historicalTradability:{
        evidenceSources:[],unknownMarketDays:null,totalMarketDays:null,
        restrictedMarketDays:null,evidencedTradableMarketDays:null,
        unknownTrades:0,totalTrades:0,restrictedTrades:0,evidencedTradableTrades:0
      },
      equity:[],daily:[],fingerprints:{data:'test',configuration:'test',codeBuild:null},limitations:[]
    },
    benchmarks:[],bootstrap:null,stress:[],robustness:'insufficient_evidence',parity:{}
  };
  const html=reportHtml(sampleReport as unknown as Parameters<typeof reportHtml>[0]);
  expect(html).toContain('Synchronisierte Portfolio-Tagesblöcke');
  expect(html).toContain('n/a');
  const diagnostics=synchronizedPortfolioBootstrap(sample(),clusters,{paths:3,seed:4});
  const withDiagnostics=reportHtml({...sampleReport,synchronizedBootstrap:diagnostics} as unknown as Parameters<typeof reportHtml>[0]);
  expect(withDiagnostics).toContain('synchronized-portfolio-bootstrap-v1');
  expect(withDiagnostics).toContain('synthetisch');
});
