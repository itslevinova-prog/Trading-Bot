import type {Candle} from '../backtest/candle-source.js';
import type {RiskSnapshot,RiskCandle} from './engine.js';
const DAY=86_400_000,HOUR=3_600_000;
export type ClosedReplaySeries={h1:readonly Candle[]};
export type ReplayPositions={symbol:string;qty:number;entryPrice:number};
export type ReplayPortfolio={equity:number;cash:number;peak:number;
 positions:ReadonlyMap<string,ReplayPositions>;marks:ReadonlyMap<string,number>};
function exactHours(rows:readonly Candle[],start:number,count:number,asOf:number):RiskCandle[] {
 // A candle can be read only AFTER the full hour closes.
 const selected=rows.filter(c=>c.ts>=start&&c.ts<start+count*HOUR&&c.ts+HOUR<=asOf);
 if(selected.length!==count)return [];
 for(let i=0;i<selected.length;i++)if(selected[i]!.ts!==start+i*HOUR||
  !Number.isFinite(selected[i]!.close)||selected[i]!.close<=0)return [];
 return selected.map(c=>({ts:c.ts,close:c.close}));
}
function dailyFromHours(rows:readonly Candle[],now:number):RiskCandle[] {
 const today=Math.floor(now/DAY)*DAY,from=today-61*DAY;
 const hourly=exactHours(rows,from,61*24,now);
 return hourly.length===61*24?
  Array.from({length:61},(_,i)=>({ts:from+i*DAY,close:hourly[i*24+23]!.close})):[];
}
export function replayRiskSnapshot(
 now:number,proposed:string,quote:string,
 series:ReadonlyMap<string,ClosedReplaySeries>,portfolio:ReplayPortfolio
):RiskSnapshot {
 const reference=series.has('BTC/'+quote)?'BTC/'+quote:'BTC'+quote;
 const pairNames=[...new Set([proposed,...[...portfolio.positions.values()].map(p=>p.symbol)])];
 const daily:Record<string,RiskCandle[]>={BTCUSDT:dailyFromHours(series.get(reference)?.h1??[],now)};
 for(const name of pairNames)daily[name]=dailyFromHours(series.get(name)?.h1??[],now);
 const last=Math.floor(now/HOUR)*HOUR-HOUR;
 const hourly=exactHours(series.get(reference)?.h1??[],last-720*HOUR,721,now);
 return {asOf:now,equity:portfolio.equity,cash:portfolio.cash,peakEquity:portfolio.peak,
  positions:[...portfolio.positions.values()].map(p=>({pair:p.symbol,marketValue:
    p.qty*(portfolio.marks.get(p.symbol)??NaN)})),
  daily,btcHourly:hourly,feedConnected:true,feedLastAt:now,reconnectsLastHour:0};
}
