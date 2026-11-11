import {expect,test} from 'vitest';
import {FixtureCandleSource,type Candle} from '../src/backtest/candle-source.js';
import {matchedCostBenchmarks,MATCHED_BENCHMARK_VERSION,type MatchedBenchmarkCosts} from '../src/backtest/benchmark-costs.js';
import {benchmarks,reportHtml,type BacktestReport} from '../src/backtest/report.js';

const DAY=86_400_000;
const FROM=Date.UTC(2022,0,1),TO=FROM+3*DAY;
const candle=(ts:number,open:number,close:number):Candle=>({
  ts,open,close,high:Math.max(open,close),low:Math.min(open,close),volume:1000
});
function fixture(missingEthDay=false){
  return new FixtureCandleSource([
    {symbol:'BTCUSDT',intervalMinutes:1440,candles:[
      candle(FROM,10,12),candle(FROM+DAY,12,15),candle(FROM+2*DAY,15,16)
    ]},
    {symbol:'ETHUSDT',intervalMinutes:1440,candles:[
      candle(FROM,20,22),...(!missingEthDay?[candle(FROM+DAY,22,25)]:[]),
      candle(FROM+2*DAY,25,26)
    ]}
  ]);
}
const costs:MatchedBenchmarkCosts={
  initialCash:100,feeRate:.01,spreadBps:0,slippageBps:0,
  minOrderEur:1,fillModel:'conservative-ohlc'
};
const run=(options:Partial<MatchedBenchmarkCosts>={},missingEthDay=false)=>
  matchedCostBenchmarks({source:fixture(missingEthDay),fromMs:FROM,toMs:TO,quote:'USDT',costs:{...costs,...options}});

test('cost-matched BTC lump sum debits exact fee, rounds quantity and marks last close without fictional sale',async()=>{
  const [hold]=await run();
  const qty=Math.floor((100/(10*1.01))*1e8)/1e8;
  const fee=qty*10*.01;
  const cash=100-qty*10-fee;
  expect(hold?.reportVersion).toBe(MATCHED_BENCHMARK_VERSION);
  expect(hold?.quoteCurrency).toBe('USDT');
  expect(hold?.equity.map(p=>p.ts)).toEqual([FROM+DAY,FROM+2*DAY,TO]);
  expect(hold?.feesPaid).toBeCloseTo(fee,8);
  expect(hold?.spreadPaid).toBe(0);
  expect(hold?.slippagePaid).toBe(0);
  expect(hold?.netReturn).toBeCloseTo((cash+qty*16)/100-1,9);
  expect(hold?.cashflows).toEqual([]);
  expect(hold?.fingerprints.data).toMatch(/^[a-f0-9]{64}$/);
});
test('DCA monthly deposits retain their own cashflows and TWR, with same fee/fill cost assumptions',async()=>{
  const [hold,dca]=await run();
  expect(hold?.netReturn).not.toBeNull();
  expect(dca?.netReturn).not.toBeNull();
  expect(dca?.cashflows).toEqual([{ts:FROM,amount:100}]);
  // The opening purchases allocate 70 to BTC and 30 to ETH; each pays 1% fees.
  const btcQty=Math.floor(70/(10*1.01)*1e8)/1e8;
  const ethQty=Math.floor(30/(20*1.01)*1e8)/1e8;
  const fees=(btcQty*10+ethQty*20)*.01;
  expect(dca?.feesPaid).toBeCloseTo(fees,8);
  expect(dca?.equity.map(p=>p.ts)).toEqual(hold?.equity.map(p=>p.ts));
  expect(dca?.netReturn).toBeCloseTo((btcQty*16+ethQty*26+100-(btcQty*10+ethQty*20+fees))/100-1,7);
});
test('spread and slippage are charged to both references, and cannot improve deterministic returns',async()=>{
  const [baseHold,baseDca]=await run();
  const [stressedHold,stressedDca]=await run({spreadBps:20,slippageBps:12});
  expect(stressedHold?.netReturn).toBeLessThan(baseHold!.netReturn!);
  expect(stressedDca?.netReturn).toBeLessThan(baseDca!.netReturn!);
  expect(stressedHold?.spreadPaid).toBeGreaterThan(0);
  expect(stressedDca?.slippagePaid).toBeGreaterThan(0);
  expect(stressedHold?.fingerprints.costs).not.toEqual(baseHold?.fingerprints.costs);
});
test('unavailable day or unexecutable fee/minimum cannot become a fake benchmark return',async()=>{
  const missing=await run({},true);
  expect(missing.every(r=>r.netReturn===null&&r.coverageDays===0)).toBe(true);
  const min=await run({minOrderEur:1_000});
  expect(min.every(r=>r.netReturn===null)).toBe(true);
  const maker=await run({fillModel:'maker-queue'});
  expect(maker.every(r=>r.netReturn===null)).toBe(true);
  expect(maker[0]?.note).toContain('Maker');
});
test('holdout boundaries are checked before any CandleSource is read',async()=>{
  let reads=0;
  const source={
    listSymbols:async()=>{reads++;return ['BTCUSDT','ETHUSDT'];},
    getCandles:async()=>{reads++;return [];}
  };
  const result=await matchedCostBenchmarks({source,quote:'USDT',
    fromMs:Date.UTC(2025,0,1),toMs:Date.UTC(2025,0,3),costs});
  expect(reads).toBe(0);
  expect(result.every(r=>r.netReturn===null)).toBe(true);
});
test('the report appends versioned net references instead of replacing the original idealized comparators',async()=>{
  const result=await benchmarks(fixture(),1440,FROM,TO,['BTCUSDT','ETHUSDT'],'USDT',false,undefined,costs);
  expect(result).toHaveLength(5);
  expect(result.some(x=>x.name==='BTC Buy & Hold')).toBe(true);
  const net=result.find(x=>x.name.includes('cost-matched lump sum'));
  const dca=result.find(x=>x.name.includes('cost-matched monthly TWR'));
  expect(net?.netReturn).not.toBeNull();
  expect(dca?.netReturn).not.toBeNull();
  expect(net?.reportVersion).toBe(MATCHED_BENCHMARK_VERSION);
  expect(net?.fingerprints?.costs).toMatch(/^[a-f0-9]{64}$/);
  const report={
    runId:'a'.repeat(16),
    backtest:{
      configuration:{strategy:'rules',fromMs:FROM,toMs:TO,fillModel:'conservative-ohlc',
        spreadBps:0,slippageBps:0,feeRate:.01},
      metrics:{},coverage:null,
      historicalTradability:{unknownMarketDays:null,totalMarketDays:null,
        restrictedMarketDays:null,evidencedTradableMarketDays:null,
        unknownTrades:0,totalTrades:0,restrictedTrades:0,evidencedTradableTrades:0,evidenceSources:[]},
      equity:[],daily:[],limitations:[],fingerprints:{data:'b'.repeat(64),configuration:'c'.repeat(64),codeBuild:null}
    },
    benchmarks:result,bootstrap:null,stress:[],robustness:'insufficient_evidence',parity:{}
  } as unknown as BacktestReport;
  const html=reportHtml(report);
  expect(html).toContain(MATCHED_BENCHMARK_VERSION);
  expect(html).toContain('BTC Buy &amp; Hold');
  expect(html).toContain('USDT');
});
