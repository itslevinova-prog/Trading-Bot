import {expect,test} from 'vitest';
import {FixtureCandleSource,type Candle,type CandleSource} from '../src/backtest/candle-source.js';
import {runBacktest,type BacktestOptions,type BacktestResult} from '../src/backtest/runner.js';
import {runCostStressMatrix,robustnessLight,COST_STRESS_MATRIX_VERSION,type CostStressMatrix} from '../src/backtest/stress.js';
import {reportHtml,type BacktestReport} from '../src/backtest/report.js';

const MIN=60_000,HOUR=60*MIN,FROM=Date.UTC(2022,0,3),TO=FROM+310*15*MIN;
function source():FixtureCandleSource {
 const bar=(ts:number,p:number):Candle=>({
  ts,open:p,high:p*1.01,low:p*.99,close:p*1.001,volume:100
 });
 return new FixtureCandleSource([
  {symbol:'BTC/EUR',intervalMinutes:15,
   candles:Array.from({length:310},(_,i)=>bar(FROM+i*15*MIN,100+i*.1))},
  {symbol:'BTC/EUR',intervalMinutes:60,
   candles:Array.from({length:77},(_,i)=>bar(FROM+i*HOUR,100+i*.4))}
 ]);
}
function options(s:CandleSource=source()):BacktestOptions{
 return {source:s,strategy:'hold',fromMs:FROM,toMs:TO,intervalMinutes:15,
  initialCash:1000,quoteCurrency:'EUR',seed:10,feeRate:.001,
  spreadBps:10,slippageBps:8,
  constraints:new Map([['BTC/EUR',{symbol:'BTC/EUR',ordermin:.0001,costmin:10,lotDecimals:8}]])};
}
test('five precommitted scenarios run the full broker with identical archived input fingerprints',async()=>{
 const input=options();
 const matrix=await runCostStressMatrix(input);
 expect(matrix.version).toBe(COST_STRESS_MATRIX_VERSION);
 expect(matrix.status).toBe('complete');
 expect(matrix.cells.map(c=>c.name)).toEqual([
  'baseline','fees-x2','spread-x2','slippage-x2','combined-x2'
 ]);
 expect(matrix.inputHash).toMatch(/^[a-f0-9]{64}$/);
 expect(matrix.cells.every(c=>c.status==='available'&&c.inputHash===matrix.inputHash)).toBe(true);
 expect(matrix.cells.every(c=>c.configurationHash?.match(/^[a-f0-9]{64}$/))).toBe(true);
 expect(matrix.cells.every(c=>c.fills===1&&c.rejectedOrders===0)).toBe(true);
 const plain=await runBacktest(input);
 const base=matrix.cells[0]!;
 expect(base.netReturn).toBeCloseTo(plain.metrics.netReturn,10);
 expect(base.costs?.fees).toBeCloseTo(plain.trades.reduce((s,t)=>s+t.fee,0),10);
 expect(base.costs?.spread).toBeCloseTo(plain.trades.reduce((s,t)=>s+t.spreadCost,0),10);
 expect(base.costs?.slippage).toBeCloseTo(plain.trades.reduce((s,t)=>s+t.slippageCost,0),10);
 expect(base.costs?.total).toBeCloseTo(base.costs!.fees+base.costs!.spread+base.costs!.slippage,10);
 const combined=matrix.cells[4]!;
 expect(combined.assumptions).toEqual({feeRate:.002,spreadBps:20,slippageBps:16});
 expect(combined.costs!.fees).toBeGreaterThan(base.costs!.fees);
 expect(combined.costs!.spread).toBeGreaterThan(base.costs!.spread);
 expect(combined.costs!.slippage).toBeGreaterThan(base.costs!.slippage);
 expect(combined.netReturn!).toBeLessThan(base.netReturn!);
 expect(matrix).toEqual(await runCostStressMatrix(input));
});
test('joint fee/spread/slippage stress captures nonadditive order sizing and fill effects',async()=>{
 const m=await runCostStressMatrix(options());
 const [base,fee,spread,slippage,all]=m.cells;
 expect(m.status).toBe('complete');
 // Replaying with new costs changes purchasable quantity: summing individual
 // post-hoc PnL haircuts is not the same as a combined broker replay.
 const additive=fee!.netReturn!+spread!.netReturn!+slippage!.netReturn!-2*base!.netReturn!;
 expect(Math.abs(all!.netReturn!-additive)).toBeGreaterThan(1e-9);
});
test('a failed replay creates explicit n/a cell and cannot pass the robustness traffic light',async()=>{
 let calls=0;
 const fixture=source();
 const flaky:CandleSource={
  listSymbols:()=>fixture.listSymbols(),
  getCandles:(...args)=>{if(++calls>=5)throw Error('fixture: absent historical candles');return fixture.getCandles(...args);}
 };
 const matrix=await runCostStressMatrix(options(flaky));
 expect(matrix.status).toBe('insufficient_evidence');
 expect(matrix.cells).toHaveLength(5);
 expect(matrix.cells.some(c=>c.status==='unavailable'&&c.netReturn===null&&c.costs===null)).toBe(true);
 const dummy={metrics:{netReturn:.1,pbo:.1,deflatedSharpeProbability:.99}} as BacktestResult;
 const legacy=['double-fees','double-slippage','one-bar-delay','drop-5-percent-signals'].map(name=>({
  name,netReturn:.01,trades:1,rejectedOrders:0
 })) as Parameters<typeof robustnessLight>[1];
 expect(robustnessLight(dummy,legacy,matrix)).toBe('insufficient_evidence');
 const partial:{[K in keyof CostStressMatrix]:CostStressMatrix[K]}={...matrix,
  status:'complete',cells:matrix.cells.slice(0,4)};
 expect(robustnessLight(dummy,legacy,partial)).toBe('insufficient_evidence');
});
test('sealed validation/holdout dates cannot trigger even symbol enumeration',async()=>{
 let requests=0;
 const blocked:CandleSource={
  listSymbols:async()=>{requests++;return ['BTC/EUR'];},
  getCandles:async()=>{requests++;return [];}
 };
 const m=await runCostStressMatrix({...options(blocked),fromMs:Date.UTC(2025,0,1),toMs:Date.UTC(2025,0,3)});
 expect(m.status).toBe('insufficient_evidence');
 expect(m.cells.every(c=>c.netReturn===null&&c.inputHash===null)).toBe(true);
 expect(requests).toBe(0);
 const maker=await runCostStressMatrix({...options(blocked),fillModel:'maker-queue'});
 expect(maker.status).toBe('insufficient_evidence');
 expect(requests).toBe(0);
});
test('the report carries per-cell fills, rejections, costs, shared input hash and explicit missing evidence',async()=>{
 const input=options(),base=await runBacktest(input),costStressMatrix=await runCostStressMatrix(input);
 const report={
  runId:base.fingerprints.combined.slice(0,16),backtest:base,
  benchmarks:[],bootstrap:null,stress:[],costStressMatrix,
  robustness:'insufficient_evidence',parity:{}
 } as unknown as BacktestReport;
 const html=reportHtml(report);
 expect(html).toContain(COST_STRESS_MATRIX_VERSION);
 expect(html).toContain('combined-x2');
 expect(html).toContain(costStressMatrix.inputHash!);
 expect(html).toContain('Gebühren');
 expect(html).toContain('Verworfen');
 expect(html).toContain('Kosten gesamt');
 expect(JSON.stringify(report)).toContain('"status":"complete"');
 const missing=reportHtml({...report,costStressMatrix:{
  ...costStressMatrix,status:'insufficient_evidence',
  cells:costStressMatrix.cells.map((cell,i)=>i===4?{...cell,status:'unavailable',netReturn:null,
   costs:null,reason:'n/a: synthetic missing data'}:cell)
 }});
 expect(missing).toContain('synthetic missing data');
 expect(missing).toContain('n/a');
});
