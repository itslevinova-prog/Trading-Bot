/**
 * Offline, point-in-time quote valuation for comparable EUR-denominated reports.
 *
 * Rates are supplied by an archived provider (e.g. ECB daily USD/EUR fixings and
 * public spot crosses). This module never fetches data, assumes stablecoin parity,
 * converts cash automatically, or modifies trading decisions.
 */
export type QuoteCurrency = 'EUR'|'USD'|'USDT'|'USDC';

export type HistoricalRate = {
 /** Timestamp of the market observation/fixing in UTC milliseconds. */
 observedAtMs:number;
 /** Earliest timestamp at which the value was publicly available. */
 knownAtMs:number;
 /** Positive: EUR per USD, or USD per one stablecoin respectively. */
 rate:number;
 source:string;
};

export type QuoteValuationInput = {
 quote:QuoteCurrency;
 fromMs:number;
 toMs:number;
 initialQuoteEquity:number;
 finalQuoteEquity:number;
 /** ECB EUR-per-USD historical rates (not EUR-per-USD guessed from today's rate). */
 ecbEurPerUsd?:readonly HistoricalRate[];
 /** Archived public spot cross: USD paid for one unit of the specified stablecoin. */
 stablecoinUsdCross?:readonly HistoricalRate[];
};

export type QuoteValuation = {
 quote:QuoteCurrency;
 base:'EUR';
 status:'available'|'unavailable';
 fromMs:number;
 toMs:number;
 reason:string|null;
 tradingReturn:number;
 quoteFxReturn:number|null;
 stablecoinReturn:number|null;
 totalEurReturn:number|null;
 /** Additive waterfall in initial EUR equity units; sums to totalEurReturn. */
 tradingContribution:number|null;
 quoteFxContribution:number|null;
 stablecoinContribution:number|null;
 initialEurEquity:number|null;
 finalEurEquity:number|null;
 /** Deviations from USD 1; null for non-stablecoin quotes or missing cross. */
 stablecoinPegDeviation:{initial:number;final:number}|null;
 sources:string[];
};

const DAY=86_400_000;
const ECB_MAX_AGE=4*DAY; // Weekends + normal publication delays, never a historic gap-filler.
const SPOT_MAX_AGE=DAY;
type RateAt={rate:number;source:string};

/** No future observation or later-published rate may be read, even for a past fixing. */
function rateAt(rows:readonly HistoricalRate[]|undefined,ts:number,maxAgeMs:number):RateAt|null {
 let selected:HistoricalRate|null=null;
 for(const row of rows??[]){
  if(!Number.isSafeInteger(row.observedAtMs)||!Number.isSafeInteger(row.knownAtMs)||
     row.observedAtMs<0||row.knownAtMs<row.observedAtMs||!Number.isFinite(row.rate)||
     row.rate<=0||!row.source.trim())throw Error('Invalid historical FX observation');
  if(row.observedAtMs>ts||row.knownAtMs>ts||ts-row.observedAtMs>maxAgeMs)continue;
  if(!selected||row.observedAtMs>selected.observedAtMs||
    (row.observedAtMs===selected.observedAtMs&&row.knownAtMs>selected.knownAtMs))selected=row;
 }
 return selected?{rate:selected.rate,source:selected.source}:null;
}

export function valueQuoteInEur(input:QuoteValuationInput):QuoteValuation {
 const {quote,fromMs,toMs,initialQuoteEquity,finalQuoteEquity}=input;
 if(!['EUR','USD','USDT','USDC'].includes(quote)||
    !Number.isSafeInteger(fromMs)||!Number.isSafeInteger(toMs)||fromMs<0||toMs<=fromMs||
    !Number.isFinite(initialQuoteEquity)||initialQuoteEquity<=0||
    !Number.isFinite(finalQuoteEquity)||finalQuoteEquity<0)
  throw Error('Invalid quote valuation inputs');
 const tradingReturn=finalQuoteEquity/initialQuoteEquity-1;
 const stable=quote==='USDT'||quote==='USDC';
 const ecbStart=quote==='EUR'?{rate:1,source:'native EUR'}:rateAt(input.ecbEurPerUsd,fromMs,ECB_MAX_AGE);
 const ecbEnd=quote==='EUR'?{rate:1,source:'native EUR'}:rateAt(input.ecbEurPerUsd,toMs,ECB_MAX_AGE);
 const pegStart=stable?rateAt(input.stablecoinUsdCross,fromMs,SPOT_MAX_AGE):{rate:1,source:'not a stablecoin'};
 const pegEnd=stable?rateAt(input.stablecoinUsdCross,toMs,SPOT_MAX_AGE):{rate:1,source:'not a stablecoin'};
 const fxReady=ecbStart!==null&&ecbEnd!==null;
 const pegReady=pegStart!==null&&pegEnd!==null;
 const quoteFxReturn=fxReady?ecbEnd!.rate/ecbStart!.rate-1:null;
 const stablecoinReturn=pegReady?pegEnd!.rate/pegStart!.rate-1:null;
 const available=fxReady&&pegReady;
 const grossTrading=1+tradingReturn;
 const grossFx=quoteFxReturn===null?null:1+quoteFxReturn;
 const grossPeg=stablecoinReturn===null?null:1+stablecoinReturn;
 const sources=[ecbStart,ecbEnd,pegStart,pegEnd].filter((x):x is RateAt=>x!==null&&x.source!=='not a stablecoin'&&x.source!=='native EUR').map(x=>x.source);
 const reason=!fxReady?'Historischer ECB-USD/EUR-Kurs fehlt oder ist nicht zeitpunktgültig':
  !pegReady?'Historischer Stablecoin/USD-Spot-Cross fehlt oder ist nicht zeitpunktgültig':null;
 return {
  quote,base:'EUR',status:available?'available':'unavailable',fromMs,toMs,reason,
  tradingReturn,quoteFxReturn,stablecoinReturn,
  totalEurReturn:available?grossTrading*grossFx!*grossPeg!-1:null,
  tradingContribution:available?tradingReturn:null,
  quoteFxContribution:available?grossTrading*(grossFx!-1):null,
  stablecoinContribution:available?grossTrading*grossFx!*(grossPeg!-1):null,
  initialEurEquity:available?initialQuoteEquity*ecbStart!.rate*pegStart!.rate:null,
  finalEurEquity:available?finalQuoteEquity*ecbEnd!.rate*pegEnd!.rate:null,
  stablecoinPegDeviation:stable&&pegReady?{
   initial:pegStart!.rate-1,final:pegEnd!.rate-1
  }:null,
  sources:[...new Set(sources)]
 };
}
