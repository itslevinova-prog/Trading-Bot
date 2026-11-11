export type ClosedFeatureFrame={pair:string;decisionAt:number;featureContractHash:string;x:readonly number[]};
const time=(x:number)=>Number.isSafeInteger(x)&&x>=0;
/** Exact same-clock source binding, historical close domain only. No labels, fit or actual receipt inference. */
export function commonMarketFeatures(rows:readonly ClosedFeatureFrame[],quote:string){
 if(!/^[A-Z0-9]{2,12}$/.test(quote)||!Array.isArray(rows))throw Error('Invalid common-market scope');
 const seen=new Set<string>(),sources=new Map<number,ClosedFeatureFrame>();
 for(const r of rows){if(!r||typeof r.pair!=='string'||!r.pair.endsWith('/'+quote)||!time(r.decisionAt)||!r.featureContractHash||!/^[0-9a-f]{64}$/.test(r.featureContractHash)||!Array.isArray(r.x)||r.x.length!==8||!r.x.every(Number.isFinite)||r.x[4]!<=-100)throw Error('Invalid closed common-market feature');const key=JSON.stringify([r.pair,r.decisionAt]);if(seen.has(key))throw Error('Duplicate common-market source');seen.add(key);if(r.pair==='BTC/'+quote)sources.set(r.decisionAt,r);}
 return rows.map(r=>{const btc=sources.get(r.decisionAt);return {pair:r.pair,decisionAt:r.decisionAt,ownFeatureContractHash:r.featureContractHash,sourcePair:'BTC/'+quote,sourceDecisionAt:btc?.decisionAt??null,sourceFeatureContractHash:btc?.featureContractHash??null,btcChange4hPct:btc?.x[4]??null,x9:btc?[...r.x,btc.x[4]!]:null,available:!!btc,reason:btc?null:'same-clock-btc-closed-feature-unavailable',availabilityDomain:'modeled-historical-bar-close-v1',actualReceiptObserved:false,independentSignalVotes:null};});
}
