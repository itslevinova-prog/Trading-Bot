import {createHash} from 'node:crypto';
import type {Candle,CandleSource} from './candle-source.js';
import {validateCandles} from './candle-source.js';
import {makeFillModel,type FillModelName} from './fill-models.js';
import type {MarketConstraints} from './simulated-broker.js';

const DAY=86_400_000;
const DEV_FROM=Date.UTC(2020,0,1);
const DEV_END=Date.UTC(2024,0,1);
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso=(ts:number)=>new Date(ts).toISOString().slice(0,10);
const monthStart=(ts:number)=>{
 const date=new Date(ts);
 return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1);
};
export type HistoricalTop10Options={
 source:CandleSource;fromMs:number;toMs:number;
 /** Returns TOP TEN symbols as they were knowable at the opening of that UTC month.
  * ArchiveUniverse.universeAt(monthStart,{topN:10,...}) is the production provider. */
 universeAt:(utcMonthStart:number)=>readonly string[]|Promise<readonly string[]>;
 fillModel:FillModelName;feeRate:number;spreadBps:number;slippageBps:number;
 initialCash:number;minOrderEur:number;
 constraints?:ReadonlyMap<string,MarketConstraints>;
};
export type Top10Fill={
 ts:number;symbol:string;side:'buy'|'sell';qty:number;price:number;notional:number;
 fee:number;spreadCost:number;slippageCost:number;
};
export type HistoricalTop10Result={
 name:'Equal-weight historical Top 10 (monthly rebalanced, net)';
 netReturn:number|null;
 equity:Array<{ts:number;equity:number}>;
 coverageDays:number;
 note:string;
 universeHistory:Array<{monthMs:number;symbols:string[]}>;
 trades:Top10Fill[];
 feesPaid:number;
 costs:{feeRate:number;spreadBps:number;slippageBps:number;fillModel:FillModelName;minOrderEur:number};
 fingerprints:{universe:string;costs:string;data:string|null};
};
export async function simulateHistoricalTop10(o:HistoricalTop10Options):Promise<HistoricalTop10Result>{
 const {fromMs,toMs}=o;
 // Check split boundaries before calling the historical universe, source, or broker.
 if(!Number.isSafeInteger(fromMs)||!Number.isSafeInteger(toMs)||fromMs<DEV_FROM||
    toMs>DEV_END||fromMs>=toMs||fromMs%DAY!==0||toMs%DAY!==0)
  throw Error('Historical top-ten research is sealed to UTC development dates 2020-2023');
 if(![o.feeRate,o.spreadBps,o.slippageBps,o.initialCash,o.minOrderEur].every(Number.isFinite)||
    o.feeRate<0||o.feeRate>.05||o.spreadBps<0||o.spreadBps>1000||
    o.slippageBps<0||o.slippageBps>1000||o.initialCash<=0||o.minOrderEur<0)
  throw Error('Invalid comparable benchmark cost, order minimum or capital');
 const costs={feeRate:o.feeRate,spreadBps:o.spreadBps,slippageBps:o.slippageBps,
  fillModel:o.fillModel,minOrderEur:o.minOrderEur};
 const universeHistory:Array<{monthMs:number;symbols:string[]}>=[];
 const trades:Top10Fill[]=[];
 const equity:Array<{ts:number;equity:number}>=[];
 const fingerprints:{universe:string;costs:string;data:string|null}={
  universe:'',costs:digest({costs,initialCash:o.initialCash,
   constraints:o.constraints?[...o.constraints.entries()].sort(([a],[b])=>a.localeCompare(b)):null}),
  data:null
 };
 const answer=(netReturn:number|null,note:string):HistoricalTop10Result=>({
  name:'Equal-weight historical Top 10 (monthly rebalanced, net)',
  netReturn,equity:netReturn===null?[]:equity,
  coverageDays:netReturn===null?0:equity.length,note,universeHistory,
  trades:netReturn===null?[]:trades,
  feesPaid:netReturn===null?0:trades.reduce((sum,t)=>sum+t.fee,0),costs,fingerprints
 });
 if(o.fillModel==='maker-queue')
  return answer(null,'Maker fills cannot be reconstructed without historical order-book queue evidence.');
 let missingReason:string|null=null;
 for(let ts=fromMs;ts<toMs;){
  const first=monthStart(ts),next=Date.UTC(new Date(first).getUTCFullYear(),
   new Date(first).getUTCMonth()+1,1);
  let symbols:readonly string[];
  try{symbols=await o.universeAt(first);}
  catch(error){missingReason='Point-in-time membership unavailable at '+iso(first)+': '+String(error);break;}
  if(!Array.isArray(symbols)||symbols.length<1||symbols.length>10||
     symbols.some(s=>typeof s!=='string'||!/^[A-Z0-9/]{5,24}$/.test(s))||
     new Set(symbols).size!==symbols.length){
   missingReason='Unverified or incomplete historical Top-10 membership at '+iso(first);
   break;
  }
  universeHistory.push({monthMs:first,symbols:[...symbols].sort()});
  ts=Math.min(next,toMs);
 }
 fingerprints.universe=digest(universeHistory);
 if(missingReason)return answer(null,missingReason);
 const allSymbols=[...new Set(universeHistory.flatMap(x=>x.symbols))].sort();
 let available:Set<string>;
 try{available=new Set(await o.source.listSymbols());}
 catch{return answer(null,'Archived symbol list unavailable');}
 if(allSymbols.some(x=>!available.has(x)))
  return answer(null,'Historical universe contains a symbol without archived candles');
 const bars=new Map<string,Map<number,Candle>>();
 for(const symbol of allSymbols){
  try{
   const series=await o.source.getCandles(symbol,1440,fromMs,toMs);
   validateCandles(series,1440,fromMs,toMs);
   bars.set(symbol,new Map(series.map(c=>[c.ts,c])));
  }catch(error){
   return answer(null,'Invalid or missing archived daily series for '+symbol+': '+String(error));
  }
 }
 fingerprints.data=digest([...bars.entries()].map(([symbol,days])=>[symbol,[...days.entries()]]));
 const fill=makeFillModel(o.fillModel,{spreadBps:o.spreadBps,slippageBps:o.slippageBps});
 let cash=o.initialCash,month=-1;
 const position=new Map<string,number>();
 function rules(symbol:string):MarketConstraints{
  return o.constraints?.get(symbol)??{symbol,ordermin:0,costmin:0,lotDecimals:8};
 }
 function quantity(amount:number,symbol:string):number{
  const precision=rules(symbol).lotDecimals;
  if(!Number.isSafeInteger(precision)||precision<0||precision>12)
   throw Error('Historical lot precision unknown for '+symbol);
  const scale=10**precision;
  return Math.floor(Math.max(0,amount)*scale+1e-9)/scale;
 }
 function trade(symbol:string,side:'buy'|'sell',qty:number,candle:Candle):boolean{
  const constraint=rules(symbol);
  const quoted=fill.entry(candle,side);
  const notional=qty*quoted.price,fee=notional*o.feeRate;
  if(!Number.isFinite(notional)||qty<=0||notional+1e-8<Math.max(o.minOrderEur,constraint.costmin)||
      qty+1e-9<constraint.ordermin)return false;
  if(side==='buy'){
   if(notional+fee>cash+1e-7)return false;
   cash-=notional+fee;
   position.set(symbol,(position.get(symbol)??0)+qty);
  }else{
   const held=position.get(symbol)??0;
   if(held+1e-8<qty)return false;
   cash+=notional-fee;
   if(held-qty<=1e-9)position.delete(symbol);
   else position.set(symbol,held-qty);
  }
  trades.push({ts:candle.ts,symbol,side,qty,price:quoted.price,notional,fee,
   spreadCost:quoted.spreadCost*qty,slippageCost:quoted.slippageCost*qty});
  return true;
 }
 for(let ts=fromMs;ts<toMs;ts+=DAY){
  const current=monthStart(ts);
  const chosen=universeHistory.find(x=>x.monthMs===current)?.symbols;
  if(!chosen)return answer(null,'Missing month membership for '+iso(current));
  const required=new Set([...chosen,...position.keys()]);
  const day=new Map<string,Candle>();
  for(const symbol of required){
   const candle=bars.get(symbol)?.get(ts);
   if(!candle)return answer(null,'Missing daily candle for held or selected '+symbol+' at '+iso(ts));
   day.set(symbol,candle);
  }
  if(month!==current){
   let nav=cash;
   for(const [symbol,qty] of position)nav+=qty*day.get(symbol)!.open;
   if(!Number.isFinite(nav)||nav<=0)return answer(null,'Non-finite or depleted portfolio before rebalance');
   const target=nav/chosen.length;
   // Sell removed markets first, then trim overweight names.
   for(const symbol of [...position.keys()].sort()){
    const held=position.get(symbol)!;
    const wanted=chosen.includes(symbol)?target:0;
    const excess=held*day.get(symbol)!.open-wanted;
    if(excess<=1e-9)continue;
    const qty=chosen.includes(symbol)?
     Math.min(held,quantity(excess/day.get(symbol)!.open,symbol)):held;
    if(qty<=0)continue;
    if(!trade(symbol,'sell',qty,day.get(symbol)!)){
     if(!chosen.includes(symbol))
      return answer(null,'Historical rebalance cannot liquidate '+symbol+' under minimum order rules');
     // Tiny non-executable trims are left invested, not filled at a fake price.
    }
   }
   // Recalculate after actual sell-side costs, buy deficits at the same bar OPEN.
   let investable=cash;
   for(const [symbol,qty] of position)investable+=qty*day.get(symbol)!.open;
   const postSaleTarget=investable/chosen.length;
   for(const symbol of [...chosen].sort()){
    const candle=day.get(symbol)!;
    const gap=postSaleTarget-(position.get(symbol)??0)*candle.open;
    if(gap<=1e-9)continue;
    const quote=fill.entry(candle,'buy').price;
    const needed=quantity(gap/candle.open,symbol);
    const affordable=quantity(cash/(quote*(1+o.feeRate)),symbol);
    const qty=Math.min(needed,affordable);
    if(qty<=0||!trade(symbol,'buy',qty,candle)){
     if(!position.has(symbol))
      return answer(null,'Cannot establish historical Top-10 position under minimum order and cost rules: '+symbol);
     // Small rebalance amounts below minimum are never fabricated as fills.
    }
   }
   if(chosen.some(symbol=>!position.has(symbol)))
    return answer(null,'Insufficient cash to establish all historically selected symbols');
   month=current;
  }
  let closeEquity=cash;
  for(const [symbol,qty] of position){
   const candle=day.get(symbol);
   if(!candle)return answer(null,'Held market missing mark at '+iso(ts));
   closeEquity+=qty*candle.close;
  }
  if(!Number.isFinite(closeEquity)||closeEquity<=0)
   return answer(null,'Invalid or depleted marked portfolio at '+iso(ts));
  equity.push({ts:ts+DAY,equity:closeEquity});
 }
 if(equity.length!==(toMs-fromMs)/DAY)return answer(null,'Incomplete historical benchmark daily curve');
 const last=equity.at(-1)!.equity;
 return answer(last/o.initialCash-1,
  'Monthly equal-weight PIT membership from prior closed candles; realistic adverse synthetic open fills, fees and lot/minimum-order limits. '+
  'No free close-to-close trading or gap filling. Historical exchange tradability and exact old lot rules remain unverified; terminal holdings are marked to the last daily close without a fictitious final liquidation.');
}
