import {summarizePublicActivity} from './executed-activity.js';
export const HISTORICAL_AGGRESSOR_DOMAIN='modeled-historical-bar-close-v1';
/** Separate idealized historical feature contract. Never an actual-capture availability receipt. */
export function modeledHistoricalAggressor4h(pair:string,raw:unknown,decisionAt:number,archiveRetrievedAt:number,domain:string){
 const common={version:'historical-aggressor4h-v1',availabilityDomain:HISTORICAL_AGGRESSOR_DOMAIN,closedAt:Number.isSafeInteger(decisionAt)&&decisionAt>=0?decisionAt:null,archiveRetrievedAt:Number.isSafeInteger(archiveRetrievedAt)&&archiveRetrievedAt>=0?archiveRetrievedAt:null,horizonBars:16,actualFirstReceiptObserved:false,actualCaptureDecisionEligible:false};
 const unknown=(reason:string)=>({...common,complete:false as const,reason,quoteImbalance:null,quoteVolume:null,trades:null});
 if(domain!==HISTORICAL_AGGRESSOR_DOMAIN)return unknown('explicit-modeled-availability-domain-required');
 const summary=summarizePublicActivity(pair,raw,decisionAt,archiveRetrievedAt),w=summary.windows.h4;
 if(!summary.sourceComplete||!w.complete)return unknown('archived-source-window-unavailable');
 if(w.takerQuoteImbalance===null)return unknown('zero-executed-quote-reference');
 return {...common,complete:true as const,reason:null,quoteImbalance:w.takerQuoteImbalance,quoteVolume:w.quoteVolume,trades:w.trades};
}
