import type {CandleSource} from './candle-source.js';
import {validateCandles} from './candle-source.js';
import {makeFillModel} from './fill-models.js';
import {calculateMetrics} from './metrics.js';
import {floorLot,type LotRules} from '../forward/lots.js';
import {TREND_RESEARCH_ASSUMPTIONS as a,DAY} from './trend-research.js';

export type V5PassiveComparison={
 name:'BTC/ETH 50/50 halten';netReturn:number|null;cagr:number|null;
 maxDrawdown:number|null;sharpe:number|null;calmar:number|null;
 trades:number|null;costs:number|null;reason:string;
};
/** Development-only, no future prices in entry sizes. Same initial cash and current lots. */
export async function v5EqualWeightHold(source:CandleSource,lots:LotRules):Promise<V5PassiveComparison>{
 const fail=(reason:string):V5PassiveComparison=>({
  name:'BTC/ETH 50/50 halten',netReturn:null,cagr:null,maxDrawdown:null,
  sharpe:null,calmar:null,trades:null,costs:null,reason
 });
 const days=(a.toMs-a.fromMs)/DAY;
 const data=await Promise.all(['BTCUSDT','ETHUSDT'].map(s=>
  source.getCandles(s,1440,a.fromMs,a.toMs)));
 if(data.some((rows)=>rows.length!==days))return fail('Unvollständige gemeinsame Entwicklungs-Tageskerzen');
 for(const rows of data)validateCandles(rows,1440,a.fromMs,a.toMs);
 const model=makeFillModel('conservative-ohlc',{spreadBps:a.spreadBps,slippageBps:a.slippageBps});
 const holdings:{qty:number;cost:number}[]=[];
 let cash=a.initialCash,costs=0;
 for(let i=0;i<2;i++){
  const symbol=i===0?'BTCUSDT':'ETHUSDT',lot=lots[symbol],bar=data[i]![0]!;
  if(!lot)return fail('Aktuelle Mengenregeln fehlen für '+symbol);
  const quote=model.entry(bar,'buy'),budget=a.initialCash/2;
  const qty=floorLot(budget/(quote.price*(1+a.feeRate)),lot);
  const notional=qty*quote.price,fee=notional*a.feeRate;
  if(qty<Number(lot.minQty)||notional<Number(lot.minNotional)||
   notional+fee>cash+1e-8)return fail('Mengenregel oder Cash verhindert 50/50-Einmalanlage');
  cash-=notional+fee;
  costs+=fee+qty*(quote.spreadCost+quote.slippageCost);
  holdings.push({qty,cost:notional+fee});
 }
 const points=[{ts:a.fromMs,equity:a.initialCash,exposed:false},
  ...Array.from({length:days},(_,i)=>({
   ts:a.fromMs+(i+1)*DAY,
   equity:cash+holdings.reduce((sum,h,j)=>sum+h.qty*data[j]![i]!.close,0),
   exposed:true
  }))];
 const m=calculateMetrics(points,[],a.fromMs,a.toMs).metrics;
 return {name:'BTC/ETH 50/50 halten',netReturn:m.netReturn,cagr:m.cagr,
  maxDrawdown:m.maxDrawdown,sharpe:m.sharpe,calmar:m.calmar,
  trades:2,costs,reason:'Einmaliger Einstieg zum 2020-01-01 Open, aktuelle Binance-Lots, identische synthetische Gebühren, Spread und Slippage; kein erfundener Schlussverkauf'};
}
