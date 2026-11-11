import type {MarketFeed} from '../market/types.js';

/** A received public spot cross, not an assumed stablecoin peg. */
export type QuoteCross = {rate:number;receivedAt:number;source:string};
export type QuoteExposureInputs = {
 now:number;
 quote:'EUR'|'USD'|'USDT'|'USDC';
 /** The paper account is isolated to one settlement quote. All amounts below are in it. */
 equityQuote:number;
 availableCashQuote:number;
 /** Outstanding, already-reserved quote balance; must not also be counted as cash. */
 reservedQuote:number;
 positions:readonly {pair:string;valueQuote:number}[];
 /** Planned all-in buy debit; projection moves quote cash into base inventory. */
 entryDebitQuote:number;
 eurPerUsd?:QuoteCross|null;
 stablecoinUsd?:QuoteCross|null;
};
export type QuoteExposureLimits = {
 warningPct:number;blockPct:number;maxCrossAgeMs:number;maxPegDeviation:number;
};
export const DEFAULT_QUOTE_EXPOSURE_LIMITS:Readonly<QuoteExposureLimits>=Object.freeze({
 warningPct:.8,blockPct:.95,maxCrossAgeMs:30_000,maxPegDeviation:.01
});
export type QuoteExposureVerdict = {
 allowed:boolean;
 status:'ok'|'warning'|'blocked';
 reasons:string[];
 quote:string;
 quoteEurRate:number|null;
 cashEur:number|null;
 reservedEur:number|null;
 /** Base assets are *not* stablecoin holdings; they are reported in the same EUR basis. */
 basePositionsEur:number|null;
 projectedCashEur:number|null;
 /** Fraction of EUR equity remaining as liquid or reserved settlement quote after buy. */
 projectedQuotePct:number|null;
 settlementQuotePct:number|null;
};
const validNonnegative=(n:number)=>Number.isFinite(n)&&n>=0;
function validCross(c:QuoteCross|undefined|null,now:number,maxAgeMs:number):c is QuoteCross {
 return !!c&&Number.isFinite(c.rate)&&c.rate>0&&
  Number.isSafeInteger(c.receivedAt)&&c.receivedAt<=now&&
  now-c.receivedAt<=maxAgeMs&&typeof c.source==='string'&&c.source.length>0;
}
export function evaluateQuoteExposure(
 input:QuoteExposureInputs,limits:Readonly<QuoteExposureLimits>=DEFAULT_QUOTE_EXPOSURE_LIMITS
):QuoteExposureVerdict {
 const reasons:string[]=[];
 const result=(status:'ok'|'warning'|'blocked',quoteEurRate:number|null=null,
  cashEur:number|null=null,reservedEur:number|null=null,basePositionsEur:number|null=null,
  projectedCashEur:number|null=null,projectedQuotePct:number|null=null,
  settlementQuotePct:number|null=null):QuoteExposureVerdict=>({
   allowed:status!=='blocked',status,reasons,quote:input.quote,quoteEurRate,
   cashEur,reservedEur,basePositionsEur,projectedCashEur,projectedQuotePct,settlementQuotePct
  });
 if(!Number.isSafeInteger(input.now)||input.now<0||
   !Number.isFinite(input.equityQuote)||input.equityQuote<=0||
   !validNonnegative(input.availableCashQuote)||!validNonnegative(input.reservedQuote)||
   !validNonnegative(input.entryDebitQuote)||input.entryDebitQuote<=0||
   !Array.isArray(input.positions)||input.positions.some(p=>
    typeof p.pair!=='string'||p.pair.split('/').length!==2||
    p.pair.split('/')[1]!==input.quote||!validNonnegative(p.valueQuote))||
   !['EUR','USD','USDT','USDC'].includes(input.quote)||
   ![limits.warningPct,limits.blockPct,limits.maxPegDeviation,limits.maxCrossAgeMs].every(Number.isFinite)||
   limits.warningPct<=0||limits.warningPct>=limits.blockPct||limits.blockPct>1||
   limits.maxPegDeviation<=0||limits.maxPegDeviation>=1||
   !Number.isSafeInteger(limits.maxCrossAgeMs)||limits.maxCrossAgeMs<=0){
  reasons.push('Invalid or mixed-quote paper valuation, order or concentration limits');
  return result('blocked');
 }
 if(input.availableCashQuote+1e-8<input.entryDebitQuote){
  reasons.push('Entry exceeds available settlement-quote cash');
  return result('blocked');
 }
 const positionsQuote=input.positions.reduce((sum,p)=>sum+p.valueQuote,0);
 const accounted=input.availableCashQuote+input.reservedQuote+positionsQuote;
 if(!Number.isFinite(accounted)||
   Math.abs(accounted-input.equityQuote)>Math.max(1e-6,input.equityQuote*1e-7)){
  reasons.push('Cash, reserved settlement quote and base inventory do not reconcile to equity');
  return result('blocked');
 }
 let eurPerQuote:number;
 if(input.quote==='EUR')eurPerQuote=1;
 else {
  if(!validCross(input.eurPerUsd,input.now,limits.maxCrossAgeMs)){
   reasons.push('Fresh, independently observed USD/EUR cross is missing');
   return result('blocked');
  }
  eurPerQuote=input.eurPerUsd.rate;
  if(input.quote==='USDT'||input.quote==='USDC'){
   if(!validCross(input.stablecoinUsd,input.now,limits.maxCrossAgeMs)){
    reasons.push('Fresh independent stablecoin/USD spot cross is missing; no 1:1 assumption');
    return result('blocked');
   }
   if(Math.abs(input.stablecoinUsd.rate-1)>limits.maxPegDeviation){
    reasons.push('Stablecoin/USD spot cross shows a possible depeg; no new entries');
    return result('blocked');
   }
   eurPerQuote*=input.stablecoinUsd.rate;
  }
 }
 const equityEur=input.equityQuote*eurPerQuote;
 const cashEur=input.availableCashQuote*eurPerQuote;
 const reservedEur=input.reservedQuote*eurPerQuote;
 const basePositionsEur=positionsQuote*eurPerQuote;
 const projectedCashEur=(input.availableCashQuote-input.entryDebitQuote)*eurPerQuote;
 const projectedQuotePct=(projectedCashEur+reservedEur)/equityEur;
 const settlementQuotePct=(cashEur+reservedEur+basePositionsEur)/equityEur;
 if(![equityEur,cashEur,reservedEur,basePositionsEur,
    projectedCashEur,projectedQuotePct,settlementQuotePct].every(Number.isFinite)||
   equityEur<=0||projectedQuotePct< -1e-9||settlementQuotePct>1+1e-7){
  reasons.push('Converted quote exposure cannot be valued safely');
  return result('blocked');
 }
 // EUR is the account's native, non-stablecoin reference currency. A EUR cash
 // balance is not itself a stablecoin-depeg concentration risk.
 if(input.quote==='EUR')return result('ok',eurPerQuote,cashEur,reservedEur,
  basePositionsEur,projectedCashEur,projectedQuotePct,settlementQuotePct);
 if(projectedQuotePct>limits.blockPct+1e-10){
  reasons.push('Projected '+input.quote+' cash/reservation concentration exceeds paper entry cap');
  return result('blocked',eurPerQuote,cashEur,reservedEur,basePositionsEur,
   projectedCashEur,projectedQuotePct,settlementQuotePct);
 }
 if(projectedQuotePct>limits.warningPct+1e-10){
  reasons.push('Projected '+input.quote+' settlement-quote concentration above warning threshold');
  return result('warning',eurPerQuote,cashEur,reservedEur,basePositionsEur,
   projectedCashEur,projectedQuotePct,settlementQuotePct);
 }
 return result('ok',eurPerQuote,cashEur,reservedEur,basePositionsEur,
  projectedCashEur,projectedQuotePct,settlementQuotePct);
}

/** Only public fresh book crosses. Never infer a peg from another stablecoin. */
function cross(market:Pick<MarketFeed,'books'|'connected'>,pair:string,now:number,
 maxAgeMs:number,inverse=false):QuoteCross|null {
 if(!market.connected)return null;
 const book=market.books.get(pair);
 const bid=Number(book?.bids[0]?.price),ask=Number(book?.asks[0]?.price);
 if(!book?.valid||!Number.isSafeInteger(book.receivedAt)||book.receivedAt>now||
    now-book.receivedAt>maxAgeMs||!Number.isFinite(bid)||bid<=0||
    !Number.isFinite(ask)||ask<bid)return null;
 const rate=inverse?1/ask:bid;
 return Number.isFinite(rate)&&rate>0?{rate,receivedAt:book.receivedAt,source:pair}:null;
}
export function paperQuoteCrosses(
 market:Pick<MarketFeed,'books'|'connected'>,quote:QuoteExposureInputs['quote'],now:number,
 maxAgeMs=DEFAULT_QUOTE_EXPOSURE_LIMITS.maxCrossAgeMs
):Pick<QuoteExposureInputs,'eurPerUsd'|'stablecoinUsd'> {
 if(quote==='EUR')return {};
 const eurPerUsd=cross(market,'USD/EUR',now,maxAgeMs) ??
  cross(market,'EUR/USD',now,maxAgeMs,true);
 const stablecoinUsd=quote==='USDT'||quote==='USDC'?
  cross(market,quote+'/USD',now,maxAgeMs):null;
 return {eurPerUsd,stablecoinUsd};
}
