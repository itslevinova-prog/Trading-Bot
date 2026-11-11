import {test,expect} from 'vitest';
import {planTrendVolTargetV1,TrendVolTargetV1Provider,type TrendV1Input,type TrendMarket} from '../src/strategy/trend-vol-target-v1.js';
const DAY=86_400_000,asOf=Date.UTC(2024,0,1);
function market(pair:string,slope:number,quality:'allowed'|'unknown'|'exit'='allowed'):TrendMarket{
 const bars=Array.from({length:260},(_,i)=>{
  const close=(pair.startsWith('BTC')?100:50)*(1+slope*i);
  return {ts:asOf-(260-i)*DAY,open:close,high:close*1.01,low:close*.99,
   close,volume:10000,quoteVolume:8_000_000};
 });
 return {pair,daily:bars,quality,assumedRoundtripBps:25,
  lot:{minQty:.001,minNotional:10,decimals:3}};
}
const input=(overrides:Partial<TrendV1Input>={}):TrendV1Input=>({
 asOf,quote:'USDT',equity:10000,cash:10000,
 markets:[market('BTC/USDT',.004),market('ETH/USDT',.006)],
 positions:[],...overrides
});
test('daily trend ensemble sizes only qualifying coins, without fixed profit target',()=>{
 const plan=planTrendVolTargetV1(input());
 expect(plan.status).toBe('ready');
 expect(plan.ranked.length).toBeGreaterThan(0);
 expect(plan.actions.some(a=>a.type==='buy')).toBe(true);
 for(const a of plan.actions.filter(a=>a.type==='buy')){
  if(a.type!=='buy')continue;
  expect(a.amountEur).toBeGreaterThanOrEqual(10);
  expect(a.takeProfitPct).toBeUndefined();
  expect(a.stopLossPct).toBeGreaterThanOrEqual(.02);
  expect(a.stopLossPct).toBeLessThanOrEqual(.15);
 }
 expect(plan.ranked.every(x=>x.weight<=.30)).toBe(true);
});
test('BTC below 200-day EMA vetoes all new entries and permits exits',()=>{
 const plan=planTrendVolTargetV1(input({
  cash:9000,markets:[market('BTC/USDT',-.002),market('ETH/USDT',.005)],
  positions:[{pair:'ETH/USDT',qty:10,highestCloseSinceEntry:180}]
 }));
 expect(plan.actions.some(a=>a.type==='buy')).toBe(false);
 expect(plan.actions.some(a=>a.type==='sell')).toBe(true);
 expect(plan.reason).toContain('Cash');
});
test('future prices cannot change the present decision or ordering',()=>{
 const baseline=input();
 const later=input({markets:baseline.markets.map(m=>({...m,
  daily:[...m.daily,{ts:asOf,open:1e9,high:1e9,low:1e9,close:1e9,volume:1}] }))});
 expect(planTrendVolTargetV1(later)).toEqual(planTrendVolTargetV1(baseline));
});
test('missing contiguous daily candles and intraday execution fail closed',()=>{
 const raw=input(),btc=raw.markets[0]!;
 const bad=input({markets:[{...btc,daily:btc.daily.filter((_,i)=>i!==250)},raw.markets[1]!]});
 expect(planTrendVolTargetV1(bad).status).toBe('blocked');
 expect(planTrendVolTargetV1(input({asOf:asOf+12*3600000})).status).toBe('blocked');
 expect(planTrendVolTargetV1(input({lastRebalanceAt:asOf})).status).toBe('blocked');
});
test('unknown quality, excessive modelled costs and minimum lot sizing cannot buy',()=>{
 const denied=input({markets:[market('BTC/USDT',.004,'unknown'),
  {...market('ETH/USDT',.005,'unknown'),assumedRoundtripBps:100}]});
 const plan=planTrendVolTargetV1(denied);
 expect(plan.actions.every(a=>a.type!=='buy')).toBe(true);
 const tooSmall=planTrendVolTargetV1(input({cash:5,
  markets:[{...market('BTC/USDT',.004),lot:{minQty:100000,minNotional:100000,decimals:0}},
   {...market('ETH/USDT',.005),lot:{minQty:100000,minNotional:100000,decimals:0}}]}));
 expect(tooSmall.actions.every(a=>a.type!=='buy')).toBe(true);
});
test('ATR trailing high-water stop triggers full exit, no automatic reinvestment of sale proceeds',()=>{
 const held=input({cash:5000,positions:[{pair:'ETH/USDT',qty:10,highestCloseSinceEntry:250}]});
 const plan=planTrendVolTargetV1(held);
 expect(plan.actions.some(a=>a.type==='sell'&&a.sellFraction===1)).toBe(true);
});
test('DecisionProvider requires a matching closed-day payload',async()=>{
 const provider=new TrendVolTargetV1Provider();
 const context={timeUTC:new Date(asOf).toISOString(),execution:{},positions:[],features:[],
  account:{equity:10000},limits:{},memory:[],lessons:[],recentTrades:[],
  timeZurich:'2024-01-01'};
 const output=await provider.decide(context);
 expect(output.actions).toHaveLength(1);
 expect(output.actions[0]?.type).toBe('hold');
 const withData=await provider.decide({...context,execution:{trendV1:input()}});
 expect(withData.actions.some(a=>a.type==='buy')).toBe(true);
});
