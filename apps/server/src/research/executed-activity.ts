import {parseClosedPublicActivity} from './public-activity.js';
export const EXECUTED_ACTIVITY_VERSION='executed-activity96-v1';
/** Descriptive execution aggregates. No decision rule, depth estimate or model is activated. */
export function summarizePublicActivity(pair:string,raw:unknown,closedAt:number,capturedAt:number){
 const parsed=parseClosedPublicActivity(pair,raw,closedAt,capturedAt);
 const window=(count:number)=>{
  const common={from:parsed.closedAt===null?null:parsed.closedAt-count*900000,to:parsed.closedAt,expectedBars:count};
  const unknown=(reason:string)=>({...common,complete:false as const,reason,baseVolume:null,quoteVolume:null,trades:null,takerBuyBaseShare:null,takerBuyQuoteShare:null,takerQuoteImbalance:null,executionVwap:null});
  if(!parsed.complete)return unknown(parsed.reason);
  const bars=parsed.bars.slice(-count),baseVolume=bars.reduce((s,b)=>s+b.candle.volume,0),quoteVolume=bars.reduce((s,b)=>s+b.quoteVolume,0),trades=bars.reduce((s,b)=>s+b.trades,0),buyBase=bars.reduce((s,b)=>s+b.takerBuyBaseVolume,0),buyQuote=bars.reduce((s,b)=>s+b.takerBuyQuoteVolume,0);
  if(![baseVolume,quoteVolume,buyBase,buyQuote].every(Number.isFinite)||!Number.isSafeInteger(trades))return unknown('unrepresentable-window-aggregate');
  const takerBuyBaseShare=baseVolume>0?buyBase/baseVolume:null,takerBuyQuoteShare=quoteVolume>0?buyQuote/quoteVolume:null,vwap=baseVolume>0&&quoteVolume>0?quoteVolume/baseVolume:null;
  return {...common,complete:true as const,reason:null,baseVolume,quoteVolume,trades,takerBuyBaseShare,takerBuyQuoteShare,takerQuoteImbalance:takerBuyQuoteShare===null?null:2*takerBuyQuoteShare-1,executionVwap:vwap!==null&&Number.isFinite(vwap)&&vwap>0?vwap:null};
 };
 return {version:EXECUTED_ACTIVITY_VERSION,pair,closedAt:parsed.closedAt,capturedAt:parsed.capturedAt,sourceComplete:parsed.complete,quoteCurrency:typeof pair==='string'?pair.split('/')[1]??null:null,scope:'One-venue actual public aggregate executions. Quote turnover and quote/base execution VWAP use retained source fields, not OHLC approximations. Taker imbalance is aggressor participation, not net capital flow, book depth, forecast confidence or profit probability. No-trade/unknown decisions require separate policy and risk validation.',windows:{h1:window(4),h4:window(16),h24:window(96)}};
}
