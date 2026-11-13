import type {Action,DecisionContext,DecisionProvider,DecisionResult} from '@paper/shared';
import type {Candle} from '../backtest/candle-source.js';

/** Pre-registered paper-only baseline; one completed UTC daily bar is the atomic
 * signal, with no same-day or future observations allowed. */
export const TREND_V1_LOOKBACKS=[20,50,100,200] as const;
const DAY=86_400_000;
const VOL_DAYS=30;
const MIN_HISTORY=240;
const MAX_POSITION_WEIGHT=.30;
const MAX_ROUNDTRIP_BPS=40;
const MAX_ACTIONS=3;
export type TrendQuality='allowed'|'hold-only'|'exit'|'unknown';
export type TrendMarket={
 pair:string;daily:readonly Candle[];quality:TrendQuality;
 assumedRoundtripBps:number|null;
 lot:{minQty:number;minNotional:number;decimals:number};
};
export type TrendHolding={pair:string;qty:number;highestCloseSinceEntry:number|null};
export type TrendV1Input={
 asOf:number;quote:string;equity:number;cash:number;
 markets:TrendMarket[];positions:TrendHolding[];
 lastRebalanceAt?:number|null;
 /** Four registered knobs; do not select using validation or holdout. */
 targetAnnualVol?:number;topK?:number;rebalanceTolerance?:number;atrMultiple?:number;
 /** Optional stricter entry sizing for a pre-registered paper risk profile. */
 maxPositionPct?:number;maxInvestedPct?:number;
};
export type TrendRank={pair:string;strength:number;annualVol:number;score:number;weight:number};
export type TrendPlan={status:'ready'|'blocked';reason:string;actions:Action[];ranked:TrendRank[]};
const hold=(reason:string):Action=>({type:'hold',confidence:1,reasoning:reason.slice(0,400)});
const valid=(n:number)=>Number.isFinite(n);
const positive=(n:number)=>valid(n)&&n>0;
function closedDaily(rows:readonly Candle[],asOf:number):Candle[]|null {
 if(!Array.isArray(rows))return null;
 const eligible=rows.filter(c=>c.ts+DAY<=asOf).sort((a,b)=>a.ts-b.ts);
 if(eligible.length<MIN_HISTORY)return null;
 const tail=eligible.slice(-MIN_HISTORY),last=asOf-DAY;
 for(let i=0;i<tail.length;i++){
  const c=tail[i]!;
  if(!Number.isSafeInteger(c.ts)||c.ts!==last-(tail.length-i-1)*DAY||
   ![c.open,c.high,c.low,c.close,c.volume].every(valid)||
   c.low<=0||c.open<=0||c.close<=0||c.volume<0||
   c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close))return null;
 }
 return tail;
}
function ema(closes:readonly number[],days:number):number {
 let value=closes.slice(0,days).reduce((n,x)=>n+x,0)/days;
 const rate=2/(days+1);
 for(let i=days;i<closes.length;i++)value=closes[i]! *rate+value*(1-rate);
 return value;
}
function annualVol(closes:readonly number[]):number|null {
 const subset=closes.slice(-(VOL_DAYS+1)),r:number[]=[];
 for(let i=1;i<subset.length;i++)r.push(Math.log(subset[i]!/subset[i-1]!));
 const mean=r.reduce((n,x)=>n+x,0)/r.length;
 const variance=r.reduce((n,x)=>n+(x-mean)**2,0)/(r.length-1);
 const v=Math.sqrt(variance*365);
 return positive(v)?v:null;
}
function atrPct(bars:readonly Candle[],multiple:number):number {
 const c=bars.slice(-15);let total=0;
 for(let i=1;i<c.length;i++){
  const a=c[i]!,previous=c[i-1]!.close;
  total+=Math.max(a.high-a.low,Math.abs(a.high-previous),Math.abs(a.low-previous));
 }
 return Math.min(.15,Math.max(.02,multiple*(total/14)/c.at(-1)!.close));
}
function signal(bars:readonly Candle[]){
 const closes=bars.map(c=>c.close),price=closes.at(-1)!;
 const strength=TREND_V1_LOOKBACKS.filter(days=>price>ema(closes,days)).length/4;
 const momentum50=price/closes[closes.length-51]!-1;
 return {price,strength,momentum50,annualVol:annualVol(closes),atrPct:atrPct(bars,3)};
}
function lotQty(quoteAmount:number,price:number,lot:TrendMarket['lot']):number {
 if(!Number.isSafeInteger(lot.decimals)||lot.decimals<0||lot.decimals>8||
  !positive(lot.minQty)||!positive(lot.minNotional)||!positive(price)||!positive(quoteAmount))return 0;
 const factor=10**lot.decimals;
 const qty=Math.floor((quoteAmount/price+1e-12)*factor)/factor;
 return qty>=lot.minQty&&qty*price>=lot.minNotional?qty:0;
}
export function planTrendVolTargetV1(input:TrendV1Input):TrendPlan {
 const empty=(reason:string):TrendPlan=>({status:'blocked',reason,actions:[hold(reason)],ranked:[]});
 if(!Number.isSafeInteger(input.asOf)||input.asOf<0||input.asOf%DAY!==0)
  return empty('Nur vollständige UTC-Tageskerzen: kein Intraday-Rebalancing');
 if(!positive(input.equity)||!valid(input.cash)||input.cash<0||input.cash>input.equity||
  !Array.isArray(input.markets)||!Array.isArray(input.positions)||!/^[A-Z]{3,6}$/.test(input.quote))
  return empty('Ungültiger oder unbekannter Cash-/Portfoliozustand');
 const cfg={
  targetAnnualVol:input.targetAnnualVol??.20,
  topK:input.topK??3,
  rebalanceTolerance:input.rebalanceTolerance??.20,
  atrMultiple:input.atrMultiple??3,
  maxPositionPct:input.maxPositionPct??MAX_POSITION_WEIGHT,
  maxInvestedPct:input.maxInvestedPct??1
 };
 if(!positive(cfg.targetAnnualVol)||cfg.targetAnnualVol>1||
  !Number.isSafeInteger(cfg.topK)||cfg.topK<1||cfg.topK>10||
  !valid(cfg.rebalanceTolerance)||cfg.rebalanceTolerance<.10||cfg.rebalanceTolerance>1||
  !valid(cfg.atrMultiple)||cfg.atrMultiple<1||cfg.atrMultiple>8||
  !positive(cfg.maxPositionPct)||cfg.maxPositionPct>MAX_POSITION_WEIGHT||
  !positive(cfg.maxInvestedPct)||cfg.maxInvestedPct>1)
  return empty('Ungültige, nicht vorregistrierte Strategieparameter');
 const currentDay=Math.floor(input.asOf/DAY)*DAY;
 if(input.lastRebalanceAt!==undefined&&input.lastRebalanceAt!==null&&
   input.lastRebalanceAt>=currentDay)
  return empty('Maximal eine Rebalancing-Entscheidung pro UTC-Tag');
 if(new Set(input.markets.map(m=>m.pair)).size!==input.markets.length||
  new Set(input.positions.map(p=>p.pair)).size!==input.positions.length||
  input.positions.some(p=>!p.pair||!valid(p.qty)||p.qty<0||
   (p.highestCloseSinceEntry!==null&&!positive(p.highestCloseSinceEntry))))
  return empty('Ungültige Positions- oder Marktidentität');
 const markets=new Map(input.markets.map(m=>[m.pair,m]));
 const btc=['BTC/'+input.quote,'BTC'+input.quote].find(p=>markets.has(p));
 const btcMarket=btc?markets.get(btc):undefined;
 const btcBars=btcMarket?closedDaily(btcMarket.daily,input.asOf):null;
 if(!btcBars)return empty('BTC-200d-Regime nicht aus vollständigen geschlossenen Tageskerzen belegbar');
 const btcClose=btcBars.at(-1)!.close;
 const riskOn=btcClose>ema(btcBars.map(c=>c.close),200);
 const current= new Map(input.positions.map(p=>[p.pair,p]));
 const prepared: Array<{m:TrendMarket;bars:Candle[];price:number;strength:number;
  vol:number;score:number;trailPct:number}>=[];
 for(const m of input.markets){
  const bars=closedDaily(m.daily,input.asOf);
  if(!bars)continue;
  const s=signal(bars);
  if(!s.annualVol)continue;
  const adjusted=atrPct(bars,cfg.atrMultiple);
  prepared.push({m,bars,price:s.price,strength:s.strength,vol:s.annualVol,
   score:Math.max(0,s.momentum50)/s.annualVol,trailPct:adjusted});
 }
 const ranks=prepared.filter(x=>x.m.quality==='allowed'&&
  x.m.assumedRoundtripBps!==null&&
  valid(x.m.assumedRoundtripBps)&&x.m.assumedRoundtripBps>=0&&
  x.m.assumedRoundtripBps<=MAX_ROUNDTRIP_BPS&&
  x.strength>0&&x.score>0)
  .sort((a,b)=>b.score-a.score||a.m.pair.localeCompare(b.m.pair)).slice(0,cfg.topK);
 const weights=new Map(ranks.map(x=>[x.m.pair,riskOn?
  Math.min(MAX_POSITION_WEIGHT,cfg.maxPositionPct,x.strength*cfg.targetAnnualVol/x.vol):0]));
 const total=[...weights.values()].reduce((n,x)=>n+x,0);
 if(total>cfg.maxInvestedPct)
  for(const [pair,w] of weights)weights.set(pair,w*cfg.maxInvestedPct/total);
 const actions:Action[]=[];
 for(const holding of input.positions){
  if(holding.qty===0)continue;
  const row=prepared.find(x=>x.m.pair===holding.pair);
  // A missing candle must never be interpreted as a zero-valued position.
  if(!row&&!riskOn){actions.push({type:'sell',pair:holding.pair,sellFraction:1,
    confidence:1,reasoning:'BTC-Regime risk-off: Exposure abbauen; Schutzverkäufe separat abgesichert'});continue;}
  if(!row)continue;
  const currentValue=holding.qty*row.price;
  const targetValue=(weights.get(holding.pair)??0)*input.equity;
  const stopHit=holding.highestCloseSinceEntry!==null&&
   row.price<=holding.highestCloseSinceEntry*(1-row.trailPct);
  const forceExit=!riskOn||row.m.quality==='exit'||row.strength===0||stopHit;
  if(forceExit){actions.push({type:'sell',pair:holding.pair,sellFraction:1,confidence:1,
   reasoning:stopHit?'ATR-Trailing-Stop auf abgeschlossenen Tagesdaten':
     !riskOn?'BTC unter 200d EMA; nur Cash':row.m.quality==='exit'?'Coin-Qualität verlangt Exit':'Trendensemble abgefallen'});continue;}
  const deviation=currentValue-targetValue;
  if(deviation<=0||deviation/Math.max(currentValue,targetValue)<cfg.rebalanceTolerance)continue;
  const qty=lotQty(deviation,row.price,row.m.lot);
  if(qty>0)actions.push({type:'sell',pair:holding.pair,
   sellFraction:Math.min(1,qty/holding.qty),confidence:.7,reasoning:'Tägliche Trend-Risikogewichtung: Übergewicht abbauen'});
 }
 let cashLeft=input.cash;
 for(const row of ranks){
  if(!riskOn||actions.length>=MAX_ACTIONS)break;
  const target=(weights.get(row.m.pair)??0)*input.equity;
  const existing=current.get(row.m.pair);
  const currentValue=existing?existing.qty*row.price:0;
  const desired=target-currentValue;
  if(desired<=0||desired/Math.max(target,currentValue)<cfg.rebalanceTolerance)continue;
  const quoteAmount=Math.min(cashLeft,desired);
  const qty=lotQty(quoteAmount,row.price,row.m.lot);
  if(qty<=0)continue;
  const roundedQuote=qty*row.price;
  if(roundedQuote>cashLeft||roundedQuote<=0)continue;
  cashLeft-=roundedQuote;
  actions.push({type:'buy',pair:row.m.pair,amountEur:roundedQuote,
   stopLossPct:row.trailPct,confidence:row.strength,
   reasoning:'Geschlossener Tagestrend 20/50/100/200 EMA; Volatilitätsziel, BTC-200d-Regime und Kostenannahme geprüft'});
 }
 return {status:'ready',reason:riskOn?'BTC 200d EMA bestätigt; tägliches Rebalancing':'BTC unter 200d EMA; Cash-Regime',
  actions:actions.slice(0,MAX_ACTIONS).length?actions.slice(0,MAX_ACTIONS):[hold('Kein täglicher Rebalancingbedarf oder Einstieg konservativ gesperrt')],
  ranked:ranks.map(x=>({pair:x.m.pair,strength:x.strength,annualVol:x.vol,
   score:x.score,weight:weights.get(x.m.pair)??0}))};
}
/** Same interface as other strategies. Missing closed-day payload refuses entries. */
export class TrendVolTargetV1Provider implements DecisionProvider {
 async decide(c:DecisionContext):Promise<DecisionResult> {
  const payload=(c.execution as {trendV1?:TrendV1Input}|undefined)?.trendV1;
  if(!payload||!Number.isSafeInteger(payload.asOf)||payload.asOf!==Date.parse(c.timeUTC))
   return {marketView:'trend-vol-target-v1: geschlossene Tagesdaten fehlen',actions:[hold('Fehlendes zeitpunktgenaues Tagespaket; keine neuen Einstiege')]};
  const plan=planTrendVolTargetV1(payload);
  return {marketView:'trend-vol-target-v1: '+plan.reason+'; keine empirische Aussage',actions:plan.actions};
 }
}
