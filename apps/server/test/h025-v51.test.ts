import {test,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {ResearchV51Drawdown,H025_V51_REENTRY} from '../src/backtest/research-v51-drawdown.js';
import {closedBtc200Regime} from '../src/strategy/trend-vol-target-v1.js';
import {runTrendResearchV51,v51Markdown,V51_PROFILES} from '../src/backtest/trend-research-v51.js';
import {runTrendResearchV5,V5_PROFILES} from '../src/backtest/trend-research-v5.js';
import {V51_RESEARCH,V5_RESEARCH,V5_WARMUP_FROM,validateV5Inputs} from '../src/backtest/trend-research-v2.js';
import {runBacktest} from '../src/backtest/runner.js';
import {resolvePaperRiskProfile} from '../src/risk-engine/profiles.js';
import {DAY,TREND_RESEARCH_ASSUMPTIONS as a} from '../src/backtest/trend-research.js';
import type {Candle,CandleSource} from '../src/backtest/candle-source.js';

const AT=Date.UTC(2021,0,1),END=Date.UTC(2024,0,1);
const observe=(c:ResearchV51Drawdown,n:number,regime:'risk-on'|'risk-off'|null='risk-on',
 openPositions=0,equity=1250,historicalPeak=2000)=>
 c.observeDay({asOf:AT+n*DAY,equity,historicalPeak,openPositions,btcRegime:regime});

test('v5.1 resets only after 30 FULL flat UTC days, at zero scale and closed risk-on',()=>{
 const c=new ResearchV51Drawdown(1000);
 expect(c.entryScale(AT,1250,2000)).toBe(0);
 for(let n=0;n<30;n++)
  expect(observe(c,n,n===29?'risk-off':'risk-on')).toBeNull();
 expect(c.resets).toHaveLength(0);
 expect(observe(c,30,'risk-off')).toBeNull();
 expect(observe(c,31,'risk-on')).toEqual({
  asOf:AT+31*DAY,date:new Date(AT+31*DAY).toISOString().slice(0,10),
  equity:1250,oldPeak:2000,newPeak:1250,
  reason:'30-full-flat-days-and-closed-btc-200d-risk-on'
 });
 expect(c.entryScale(AT+31*DAY,1250,2000)).toBe(1);
 expect(c.resets).toHaveLength(1);
 expect(observe(c,32,'risk-on')).toBeNull();
 expect(c.referencePeak).toBe(1250);
 expect(c.entryScale(AT+33*DAY,1400,2000)).toBe(1);
 expect(c.referencePeak).toBe(1400);
 expect(c.entryScale(AT+34*DAY,1120,2000)).toBeCloseTo(.5,9);
 expect(H025_V51_REENTRY.flatDays).toBe(30);
});

test('a position interrupts the flat streak; a missing day or risk-off cannot reset',()=>{
 const c=new ResearchV51Drawdown(1000);
 for(let n=0;n<29;n++)expect(observe(c,n)).toBeNull();
 expect(observe(c,29,'risk-on',1)).toBeNull();
 for(let n=30;n<59;n++)expect(observe(c,n,'risk-on')).toBeNull();
 expect(observe(c,59,null)).toBeNull();
 expect(observe(c,60,'risk-on')).not.toBeNull();
 const missing=new ResearchV51Drawdown(1000);
 observe(missing,0);
 expect(()=>observe(missing,2)).toThrow(/non-contiguous/);
 expect(missing.resets).toHaveLength(0);
 const withPosition=new ResearchV51Drawdown(1000);
 for(let n=0;n<=36;n++)expect(observe(withPosition,n,'risk-on',1)).toBeNull();
 expect(withPosition.resets).toHaveLength(0);
});

test('a positive scale does not reset, and loss of original starting capital is permanent',()=>{
 const noZero=new ResearchV51Drawdown(1000);
 for(let n=0;n<=31;n++)expect(observe(noZero,n,'risk-on',0,1600,2000)).toBeNull();
 expect(noZero.entryScale(AT+31*DAY,1600,2000)).toBeCloseTo(.5,9);
 const stopped=new ResearchV51Drawdown(1000);
 expect(observe(stopped,0,'risk-on',0,700,2000)).toBeNull();
 expect(stopped.permanentStopAt).toBe(AT);
 for(let n=1;n<=35;n++)expect(observe(stopped,n,'risk-on',0,1250,2000)).toBeNull();
 expect(stopped.entryScale(AT+36*DAY,1500,2000)).toBe(0);
 expect(stopped.resets).toEqual([]);
 expect(()=>new ResearchV51Drawdown(0)).toThrow();
});

test('BTC-200d risk-on matches closed planner regime, ignores future candles and fails closed on gaps',()=>{
 const bars:Candle[]=Array.from({length:260},(_,i)=>{
  const price=100+i*.3;
  return {ts:AT-(260-i)*DAY,open:price,high:price+1,low:price-1,
   close:price,volume:1e6,quoteVolume:1e8};
 });
 expect(closedBtc200Regime(bars,AT)).toBe('risk-on');
 const future:Candle={...bars.at(-1)!,ts:AT,open:1,close:1,high:1,low:1};
 expect(closedBtc200Regime([...bars,future],AT)).toBe('risk-on');
 expect(closedBtc200Regime(bars.filter((_,i)=>i!==50),AT)).toBeNull();
 expect(closedBtc200Regime(bars.slice(-200),AT)).toBeNull();
 const riskOff=bars.map((c,i)=>{const price=300-i*.3;return {...c,
  open:price,high:price+1,low:price-1,close:price};});
 expect(closedBtc200Regime(riskOff,AT)).toBe('risk-off');
});

test('v5.1 accepts no Paper-mode, mixed v5 switch, unsealed range or missing PIT evidence',async()=>{
 const source:CandleSource={listSymbols:async()=>['BTCUSDT'],getCandles:async()=>[]};
 await expect(runBacktest({source,strategy:'hold',fromMs:a.fromMs,
  toMs:a.toMs,intervalMinutes:1440,researchV51:true,collectResearchDiagnostics:true}))
  .rejects.toThrow(/v5/);
 await expect(runBacktest({source,strategy:'hold',fromMs:a.fromMs,
  toMs:a.toMs,intervalMinutes:1440,researchV5:true,researchV51:true}))
  .rejects.toThrow(/independently/);
 validateV5Inputs('2019-01','2023-12','1d','BTCUSDT,ETHUSDT');
 expect(()=>validateV5Inputs('2019-01','2024-01','1d','BTCUSDT,ETHUSDT')).toThrow();
});

test('four v5.1 runs preserve sealed v5 strategy and benchmark comparison, never read beyond 2023',async()=>{
 const calls:{symbol:string;minutes:number;from:number;to:number}[]=[];
 const source:CandleSource={
  listSymbols:async()=>['BTCUSDT','ETHUSDT','ALTUSDT'],
  getCandles:vi.fn(async(symbol,minutes,from,to)=>{
   calls.push({symbol,minutes,from,to});
   if(minutes!==1440||from<V5_WARMUP_FROM||to>END)throw Error('Unsealed data request');
   const n=(to-from)/DAY,offset=(from-V5_WARMUP_FROM)/DAY;
   return Array.from({length:n},(_,i)=>{
    const price=(symbol==='BTCUSDT'?115:78)+(offset+i)*.11+Math.sin((offset+i)/8)*.4;
    return {ts:from+i*DAY,open:price,high:price+.8,low:price-.8,
     close:price,volume:1e6,quoteVolume:1e8};
   });
  })
 };
 const lot={stepSize:'0.00500000',minQty:'0.00500000',minNotional:'5.00000000'};
 const options={source,lotRules:{BTCUSDT:lot,ETHUSDT:lot},
  lotSnapshotAt:'2026-11-13T00:00:00Z',codeBuild:'v51-offline-fixture',
  universeAt:(_day:number)=>['BTCUSDT','ETHUSDT']};
 const reports=[];const baseline=[];
 for(const profileName of V51_PROFILES){
  const input={...options,...(profileName?{profileName}:{})};
  reports.push(await runTrendResearchV51(input));
  baseline.push(await runTrendResearchV5(input));
 }
 expect(V51_PROFILES).toEqual(V5_PROFILES);
 expect(V51_RESEARCH.drawdown).toEqual(V5_RESEARCH.drawdown);
 expect(V51_RESEARCH.reentry).toEqual(H025_V51_REENTRY);
 expect(reports.every(r=>r.researchVariant==='v5.1'&&r.paperApproved===false&&
  r.pipelineEligible===false&&r.backtest.researchV51!==undefined)).toBe(true);
 expect(baseline.every(r=>r.researchVariant==='v5'&&r.backtest.researchV51===undefined)).toBe(true);
 expect(reports.every(r=>r.backtest.trades.every(t=>t.ts>=a.fromMs&&t.ts<a.toMs))).toBe(true);
 expect(calls.every(x=>x.minutes===1440&&x.to<=END&&x.from>=V5_WARMUP_FROM&&
  x.symbol!=='ALTUSDT')).toBe(true);
 const rerun=await runTrendResearchV5(options);
 expect(rerun.backtest.trades).toEqual(baseline[0]!.backtest.trades);
 expect(rerun.backtest.equity).toEqual(baseline[0]!.backtest.equity);
 expect(rerun.backtest.fingerprints.configuration).toBe(baseline[0]!.backtest.fingerprints.configuration);
 const passive={name:'BTC/ETH 50/50 halten' as const,netReturn:.2,cagr:.05,maxDrawdown:.1,
  sharpe:.6,calmar:.5,trades:2,costs:12,reason:'Fixture'};
 const spike={protocol:'trend-1d-spike-v1',range:{fromInclusive:'2020-01-01',toExclusive:'2024-01-01'},
  markets:['BTCUSDT','ETHUSDT'],windows:[50,100,200],
  variants:[50,100,200].map(window=>({window,cagr:.1,maxDrawdown:.2,
   sharpe:.3,calmar:.5,trades:8,exposure:.45,costsPctOfInitial:1.5}))};
 const md=v51Markdown(reports,baseline,passive,spike);
 expect(md).toContain('v5.1 / Basis');
 expect(md).toContain('v5 / Basis');
 expect(md).toContain('Sparplan');
 expect(md).toContain('SMA200');
 expect(md).toContain('50/50 halten');
 expect(md).toContain('Tage Faktor 0');
 expect(md).toContain('Resets');
 expect(()=>v51Markdown([],baseline,passive,spike)).toThrow(/four/);
},180000);

test('v5.1 preregistered (+4) and manual-off with privacy event to issue #3; forward unchanged',()=>{
 const registration=JSON.parse(readFileSync('../../docs/research/hypotheses.json','utf8'))
  .find((x:{id:string})=>x.id==='H-025');
 expect(registration.variantsTested).toBe(25);
 expect(registration.drawdownV51).toMatchObject({
  mode:'run_v51',variantsRegistered:4,historicalRunsCompleted:0,
  historicalRunStatus:'not-executed',noPaperOrForward:true
 });
 expect(registration.drawdownV5.mode).toBe('run_v5');
 const flow=readFileSync('../../.github/workflows/research-data.yml','utf8');
 const section=flow.slice(flow.indexOf('      run_v51:'),flow.indexOf('      run_v51:')+200);
 expect(section).toContain('default: false');
 expect(flow).toContain('RUN_V51: '+'$'+'{{ inputs.run_v51 }}');
 expect(flow).toContain('validateV5Inputs(process.env.IMPORT_FROM!');
 expect(flow.indexOf('validateV5Inputs(process.env.IMPORT_FROM!'))
  .toBeLessThan(flow.indexOf('      - name: Öffentliche Binance-Kerzen importieren'));
 expect(flow).toContain('src/backtest/trend-research-v51-cli.ts');
 expect(flow).toContain('data/trend-research-v51/');
 const comment=flow.split('      - name: H-025 v5.1 – Datenschutzprüfung und Kommentar in Issue #3')[1]!;
 expect(comment).toContain('GITHUB_EVENT_NAME=issue_comment GITHUB_EVENT_PATH="$PWD/v51-comment-event.json"');
 expect(comment.indexOf('node .github/privacy-guard/check.mjs'))
  .toBeLessThan(comment.indexOf('gh issue comment 3'));
 expect(readFileSync('../../.github/workflows/paper-forward.yml','utf8')).not.toContain('run_v51');
});
