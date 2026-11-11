import {createHash} from 'node:crypto';
import {simulateDca} from '../dca/simulator.js';
import type {Candle,CandleSource} from './candle-source.js';
import {validateCandles} from './candle-source.js';
import {makeFillModel,type FillModelName} from './fill-models.js';

const DAY=86_400_000;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const MATCHED_BENCHMARK_VERSION='matched-fill-benchmarks-v1' as const;
export type MatchedBenchmarkCosts={
  initialCash:number;
  feeRate:number;
  spreadBps:number;
  slippageBps:number;
  minOrderEur:number;
  fillModel:FillModelName;
};
export type MatchedBenchmark={
  name:string;netReturn:number|null;
  equity:Array<{ts:number;equity:number}>;
  coverageDays:number;note:string;
  reportVersion:typeof MATCHED_BENCHMARK_VERSION;
  quoteCurrency:string;initialCapital:number;
  costs:MatchedBenchmarkCosts;
  cashflows:Array<{ts:number;amount:number}>;
  feesPaid:number|null;spreadPaid:number|null;slippagePaid:number|null;
  fingerprints:{universe:string;costs:string;data:string|null};
};
type Inputs={source:CandleSource;fromMs:number;toMs:number;quote:string;costs:MatchedBenchmarkCosts};

function checkCosts(c:MatchedBenchmarkCosts):void {
  if(!Number.isFinite(c.initialCash)||c.initialCash<=0||!Number.isFinite(c.feeRate)||c.feeRate<0||c.feeRate>.05||
     !Number.isFinite(c.spreadBps)||c.spreadBps<0||c.spreadBps>1000||
     !Number.isFinite(c.slippageBps)||c.slippageBps<0||c.slippageBps>1000||
     !Number.isFinite(c.minOrderEur)||c.minOrderEur<0||
     !['conservative-ohlc','synthetic-bid','maker-queue'].includes(c.fillModel))
    throw Error('Invalid matched benchmark costs');
}
function symbolFor(available:Set<string>,base:string,quote:string):string|null {
  return [base+'/'+quote,base+quote].find(symbol=>available.has(symbol))??null;
}
function contiguous(rows:readonly Candle[],fromMs:number,toMs:number):boolean {
  return rows.length===(toMs-fromMs)/DAY&&
    rows.every((bar,i)=>bar.ts===fromMs+i*DAY);
}

/** Append-only, cost-matched reference variants. No network, historical look-ahead, orders or synthetic missing bars. */
export async function matchedCostBenchmarks(o:Inputs):Promise<MatchedBenchmark[]> {
  const {fromMs,toMs,quote,costs}=o;
  checkCosts(costs);
  if(!Number.isSafeInteger(fromMs)||!Number.isSafeInteger(toMs)||fromMs>=toMs||fromMs%DAY!==0||toMs%DAY!==0)
    throw Error('Matched benchmark needs whole UTC development days');
  const btcName='BTC Buy & Hold (net, cost-matched lump sum)';
  const dcaName='DCA 70/30 BTC/ETH (net, cost-matched monthly TWR)';
  const universe=hash({quote,assets:['BTC','ETH']});
  const fingerprints={universe,costs:hash({version:MATCHED_BENCHMARK_VERSION,quote,costs}),data:null as string|null};
  const base=(name:string,note:string):MatchedBenchmark=>({
    name,netReturn:null,equity:[],coverageDays:0,note,
    reportVersion:MATCHED_BENCHMARK_VERSION,quoteCurrency:quote,initialCapital:costs.initialCash,
    costs:{...costs},cashflows:[],feesPaid:null,spreadPaid:null,slippagePaid:null,
    fingerprints:{...fingerprints}
  });
  const blocked=(reason:string)=>[base(btcName,reason),base(dcaName,reason)];
  if(fromMs<Date.UTC(2020,0,1)||toMs>Date.UTC(2024,0,1))
    return blocked('n/a: Nur geschlossene Entwicklungsdaten 2020–2023; keine Validierungs- oder Holdout-Auswertung.');
  if(!['EUR','USDT','USDC'].includes(quote))
    return blocked('n/a: Unbekannte Quote-Währung; keine automatische Umrechnung.');
  if(costs.fillModel==='maker-queue')
    return blocked('n/a: Historische Maker-Queue-Fills sind nicht belegt.');
  let symbols:string[];
  try {symbols=await o.source.listSymbols();}catch{return blocked('n/a: Archiv-Symbolliste nicht verfügbar.');}
  const available=new Set(symbols);
  const btc=symbolFor(available,'BTC',quote),eth=symbolFor(available,'ETH',quote);
  if(!btc||!eth)return blocked('n/a: Gemeinsame historische BTC/ETH-Quote-Zeitreihen fehlen.');
  let btcBars:Candle[],ethBars:Candle[];
  try {
    [btcBars,ethBars]=await Promise.all([
      o.source.getCandles(btc,1440,fromMs,toMs),o.source.getCandles(eth,1440,fromMs,toMs)
    ]);
    validateCandles(btcBars,1440,fromMs,toMs);
    validateCandles(ethBars,1440,fromMs,toMs);
  }catch{return blocked('n/a: Historische Tageskerzen fehlen oder verletzen den CandleSource-Vertrag.');}
  if(!contiguous(btcBars,fromMs,toMs)||!contiguous(ethBars,fromMs,toMs))
    return blocked('n/a: Für beide Referenzen sind alle gemeinsamen geschlossenen UTC-Tageskerzen erforderlich.');
  const data=hash({btc,eth,btcBars,ethBars});
  const evidence={...fingerprints,data};
  const model=makeFillModel(costs.fillModel,{spreadBps:costs.spreadBps,slippageBps:costs.slippageBps});
  const initial=btcBars[0]!;
  const buy=model.entry(initial,'buy');
  const qty=Math.floor(costs.initialCash/(buy.price*(1+costs.feeRate))*1e8)/1e8;
  const notional=qty*buy.price,fee=notional*costs.feeRate;
  let hold:MatchedBenchmark;
  if(qty<=0||notional<costs.minOrderEur||notional+fee>costs.initialCash+1e-8) {
    hold={...base(btcName,'n/a: BTC-Einmalanlage bei Tagesöffnung unter Rundungs-, Mindest- oder Gebührenregel nicht ausführbar.'),fingerprints:evidence};
  }else{
    const cash=costs.initialCash-notional-fee;
    const equity=btcBars.map(bar=>({ts:bar.ts+DAY,equity:cash+qty*bar.close}));
    hold={
      ...base(btcName,'Nettowert einer BTC-Einmalanlage am ersten Tages-Open; 8 Nachkommastellen, gleiche synthetische Fill-/Gebührenbasis wie DCA; Endbestand nur zum letzten Close bewertet (kein fiktiver Verkauf).'),
      netReturn:equity.at(-1)!.equity/costs.initialCash-1,equity,coverageDays:equity.length,
      feesPaid:fee,spreadPaid:qty*buy.spreadCost,slippagePaid:qty*buy.slippageCost,
      fingerprints:evidence
    };
  }
  const mapped:CandleSource={
    listSymbols:async()=>['BTCUSDT','ETHUSDT'],
    getCandles:(symbol,interval,from,to)=>
      o.source.getCandles(symbol==='BTCUSDT'?btc:symbol==='ETHUSDT'?eth:symbol,interval,from,to)
  };
  let dca:MatchedBenchmark;
  try {
    // DCA contributes the configured capital per month, not a fictional single initial deposit.
    // It is a separate cash-flow-neutral TWR reference, not equivalent to lump-sum wealth.
    const result=await simulateDca(mapped,{
      fromMs,toMs,amount:costs.initialCash,interval:'monthly',variant:'classic',
      allocation:{BTCUSDT:.7,ETHUSDT:.3},feeRate:costs.feeRate,
      spreadBps:costs.spreadBps,slippageBps:costs.slippageBps,minNotional:costs.minOrderEur
    });
    // A cash deposit is not evidence of an executable 70/30 allocation. Both legs
    // must actually fill on every scheduled date, otherwise the reference is n/a.
    if(result.daily.length!==(toMs-fromMs)/DAY||
       result.deposits.some(deposit=>
         !(['BTCUSDT','ETHUSDT'] as const).every(symbol=>
           result.trades.some(trade=>trade.ts===deposit.ts&&trade.symbol===symbol))))
      throw Error('Unexecutable scheduled DCA allocation');
    const lookup=new Map<string,Map<number,Candle>>([
      ['BTCUSDT',new Map(btcBars.map(bar=>[bar.ts,bar]))],
      ['ETHUSDT',new Map(ethBars.map(bar=>[bar.ts,bar]))]
    ]);
    let spreadPaid=0,slippagePaid=0;
    for(const trade of result.trades){
      const open=lookup.get(trade.symbol)?.get(trade.ts)?.open;
      if(open===undefined)throw Error('DCA fill without observed daily opening price');
      spreadPaid+=trade.qty*open*costs.spreadBps/20000;
      slippagePaid+=trade.qty*open*costs.slippageBps/10000;
    }
    dca={
      ...base(dcaName,'Monatliche separate Einzahlungen in Höhe des konfigurierten Startkapitals, BTC/ETH 70/30, Tag-Open-Fills mit identischen Kosten; TWR neutralisiert Cashflows, keine direkte Endvermögens-Gleichsetzung mit Einmalanlage.'),
      netReturn:result.twr,equity:result.daily.map(p=>({ts:p.ts+DAY,equity:p.twrIndex})),
      coverageDays:result.daily.length,cashflows:result.deposits,
      feesPaid:result.totalFees,spreadPaid,slippagePaid,fingerprints:evidence
    };
  }catch{
    dca={...base(dcaName,'n/a: DCA konnte mit gemeinsamen Tageskerzen, Rundung, Kosten und Mindestausführung nicht vollständig simuliert werden.'),fingerprints:evidence};
  }
  return [hold,dca];
}
