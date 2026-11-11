import type {CandleSource,Candle} from '../archive/candle-source.js';
import {validateCandles} from '../backtest/candle-source.js';

const DAY = 86_400_000;
const YEAR = 365.25 * DAY;
export type DcaVariant = 'classic' | 'trend-park' | 'trend-double' | 'value-average';
export type DcaInterval = 'weekly' | 'monthly';
export type DcaSettings = {
  fromMs:number;toMs:number;amount:number;interval:DcaInterval;variant:DcaVariant;
  allocation:{BTCUSDT:number;ETHUSDT:number};initialCash?:number;
  feeRate?:number;spreadBps?:number;slippageBps?:number;minNotional?:number;
};
export type DcaTrade = {ts:number;symbol:'BTCUSDT'|'ETHUSDT';qty:number;price:number;fee:number;totalDebit:number};
export type DcaDay = {ts:number;cash:number;equity:number;twrIndex:number;contribution:number};
export type DcaResult = {
  variant:DcaVariant;fromMs:number;toMs:number;contributed:number;netWorth:number;
  twr:number;irr:number|null;maxDrawdown:number;totalFees:number;tradeCount:number;
  deposits:{ts:number;amount:number}[];trades:DcaTrade[];daily:DcaDay[];
  constraints:{feeRate:number;spreadBps:number;slippageBps:number;minNotional:number};
};
function nextDate(ts:number,interval:DcaInterval,anchorDay:number):number {
  if(interval==='weekly')return ts+7*DAY;
  const d=new Date(ts),year=d.getUTCFullYear(),month=d.getUTCMonth()+1;
  const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return Date.UTC(year,month,Math.min(anchorDay,last));
}
function sma200At(series:Map<number,Candle>,at:number):number|null {
 let sum=0;
 for(let i=1;i<=200;i++){
  const bar=series.get(at-i*DAY);
  if(!bar)return null;
  sum+=bar.close;
 }
 return sum/200;
}
/** Time-weighted cash-flow-neutral returns; deposits happen at the day's OPEN. */
export function moneyWeightedIrr(flows:{ts:number;amount:number}[],endAt:number,endingValue:number):number|null {
 if(!flows.length||endAt<=flows[0]!.ts||!Number.isFinite(endingValue)||endingValue<0||
    flows.some(f=>!Number.isSafeInteger(f.ts)||!Number.isFinite(f.amount)||f.amount<=0))return null;
 const anchor=flows[0]!.ts;
 const npv=(rate:number)=>flows.reduce((sum,f)=>sum-f.amount/Math.pow(1+rate,(f.ts-anchor)/YEAR),0)
   +endingValue/Math.pow(1+rate,(endAt-anchor)/YEAR);
 let left=-0.9999,right=10;
 if(npv(left)*npv(right)>0)return null;
 for(let i=0;i<140;i++){const middle=(left+right)/2;if(npv(middle)>0)left=middle;else right=middle;}
 return (left+right)/2;
}
function validSettings(o:DcaSettings) {
 const d=o.allocation;
 if(!Number.isSafeInteger(o.fromMs)||!Number.isSafeInteger(o.toMs)||
    o.fromMs<0||o.fromMs>=o.toMs||o.fromMs%DAY!==0||o.toMs%DAY!==0||
    o.toMs>Date.UTC(2024,0,1)||!(o.amount>0)||!Number.isFinite(o.amount)||
    !['weekly','monthly'].includes(o.interval)||!['classic','trend-park','trend-double','value-average'].includes(o.variant)||
    !Number.isFinite(d.BTCUSDT)||!Number.isFinite(d.ETHUSDT)||d.BTCUSDT<0||d.ETHUSDT<0||
    Math.abs(d.BTCUSDT+d.ETHUSDT-1)>1e-9||!Number.isFinite(o.initialCash??0)||(o.initialCash??0)<0)
  throw Error('Invalid DCA settings or development-only time window');
}
/** Cash-only simulated deposits; absolutely no real trading or network access. */
export async function simulateDca(source:CandleSource,options:DcaSettings):Promise<DcaResult> {
 validSettings(options);
 const fees=options.feeRate??0.001,spread=options.spreadBps??10,slippage=options.slippageBps??5,min=options.minNotional??10;
 if(!Number.isFinite(fees)||fees<0||fees>0.05||!Number.isFinite(spread)||spread<0||spread>1000||
  !Number.isFinite(slippage)||slippage<0||slippage>1000||!Number.isFinite(min)||min<0)throw Error('Invalid DCA cost assumptions');
 const start=Math.max(0,options.fromMs-200*DAY);
 const symbols=['BTCUSDT','ETHUSDT'] as const;
 const entries=await Promise.all(symbols.map(async symbol=>{
  const candles=await source.getCandles(symbol,1440,start,options.toMs);
  validateCandles(candles,1440,start,options.toMs);
  return [symbol,new Map(candles.map(c=>[c.ts,c]))] as const;
 }));
 const maps=Object.fromEntries(entries) as Record<(typeof symbols)[number],Map<number,Candle>>;
 let cash=options.initialCash??0,previousCloseEquity=cash,twrIndex=1;
 let nextDue=options.fromMs;
 const anchorDay=new Date(nextDue).getUTCDate();
 const amounts:{BTCUSDT:number;ETHUSDT:number}={BTCUSDT:0,ETHUSDT:0};
 const deposits:{ts:number;amount:number}[]=[],trades:DcaTrade[]=[],daily:DcaDay[]=[];
 let maxIndex=1,maxDrawdown=0,contributed=0,totalFees=0;
 for(let ts=options.fromMs;ts<options.toMs;ts+=DAY){
  const btc=maps.BTCUSDT.get(ts),eth=maps.ETHUSDT.get(ts);
  if(!btc||!eth)throw Error('Missing completed 1d candle on '+new Date(ts).toISOString().slice(0,10));
  const openEquity=cash+amounts.BTCUSDT*btc.open+amounts.ETHUSDT*eth.open;
  const overnight=previousCloseEquity>0?openEquity/previousCloseEquity:1;
  let deposited=0;
  if(ts===nextDue){
   deposited=options.amount;cash+=deposited;contributed+=deposited;
   deposits.push({ts,amount:deposited});nextDue=nextDate(nextDue,options.interval,anchorDay);
  }
  const avg=sma200At(maps.BTCUSDT,ts);
  const knownTrend=avg!==null && (maps.BTCUSDT.get(ts-DAY)?.close??0)>avg;
  // A missing 200-day warm-up is not an excuse to peek into future candles.
  const signalReady=avg!==null;
  const spend=options.variant==='classic'?deposited:
   !signalReady?0:
   options.variant==='trend-park'?(knownTrend?cash:0):
   options.variant==='trend-double'?(knownTrend?deposited:2*deposited):
   deposited*(knownTrend?0.5:1.5);
  const budget=Math.max(0,Math.min(cash,spend));
  for(const symbol of symbols){
    const basePrice=maps[symbol].get(ts)!.open;
    const price=basePrice*(1+spread/20000+slippage/10000);
    const allotted=budget*options.allocation[symbol];
    const qty=Math.floor((allotted/(price*(1+fees)))*1e8)/1e8;
    const notional=qty*price,fee=notional*fees,debit=notional+fee;
    if(qty<=0||notional<min||debit>cash+1e-8)continue;
    amounts[symbol]+=qty;cash-=debit;totalFees+=fee;
    trades.push({ts,symbol,qty,price,fee,totalDebit:debit});
  }
  const equity=cash+amounts.BTCUSDT*btc.close+amounts.ETHUSDT*eth.close;
  const intraday=openEquity+deposited>0?equity/(openEquity+deposited):1;
  twrIndex*=overnight*intraday;
  if(!Number.isFinite(twrIndex)||twrIndex<=0||!Number.isFinite(equity)||equity<0)throw Error('Invalid DCA equity');
  maxIndex=Math.max(maxIndex,twrIndex);maxDrawdown=Math.max(maxDrawdown,1-twrIndex/maxIndex);
  daily.push({ts,cash,equity,twrIndex,contribution:deposited});
  previousCloseEquity=equity;
 }
 return {variant:options.variant,fromMs:options.fromMs,toMs:options.toMs,contributed,netWorth:previousCloseEquity,
   twr:twrIndex-1,irr:moneyWeightedIrr(deposits,options.toMs,previousCloseEquity),maxDrawdown,
   totalFees,tradeCount:trades.length,deposits,trades,daily,
   constraints:{feeRate:fees,spreadBps:spread,slippageBps:slippage,minNotional:min}};
}
