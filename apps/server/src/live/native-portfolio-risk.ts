import {PortfolioRiskEngine,type RiskCandle,type RiskSnapshot,type RiskVerdict} from '../risk-engine/engine.js';

/** Offline, already-closed public observations; the order adapter never fetches
 * missing history, substitutes today's marks or assumes a stablecoin peg. */
export type NativePortfolioRiskEvidence={
 asOf:number;
 daily:Record<string,RiskCandle[]>;
 btcHourly:RiskCandle[];
 feedConnected:boolean;
 feedLastAt:number;
 reconnectsLastHour:number;
};
/** A separate local read-only feed supplies observed history when available.
 * Missing provider = no new native entries. Never a request for private keys. */
export type NativePortfolioRiskProvider=(pairs:readonly string[],asOf:number)=>
 NativePortfolioRiskEvidence|null;

export type NativeValuedRiskAccount={
 equity:number;cash:number;snapshotCompletedAt:number;
 positions:readonly {pair:string;value:number;priceAsOf:number}[];
};
export const missingNativeRiskVerdict=(reason:string):RiskVerdict=>({
 allowed:false,approvedAmount:0,status:'exit-only',reasons:[reason],
 portfolioVol:null,portfolioBeta:null,clusterPct:null,drawdown:1
});

/** All portfolio mathematics and brakes are the *same* PortfolioRiskEngine as
 * Paper/Backtest; this bridge only binds verified native account valuations. */
export function evaluateNativePortfolioRisk(
 engine:PortfolioRiskEngine,account:NativeValuedRiskAccount,peakEquity:number,
 pair:string,requestedDebit:number,now:number,
 evidence:NativePortfolioRiskEvidence|null
):RiskVerdict {
 if(!evidence||!Number.isSafeInteger(now)||now<0||
   !Number.isSafeInteger(evidence.asOf)||evidence.asOf!==now||
   !Number.isSafeInteger(account.snapshotCompletedAt)||
   account.snapshotCompletedAt>now||now-account.snapshotCompletedAt>15_000||
   !Number.isFinite(peakEquity)||peakEquity<=0||
   !Array.isArray(account.positions)||account.positions.some(p=>
    !Number.isSafeInteger(p.priceAsOf)||p.priceAsOf>now||now-p.priceAsOf>5_000))
  return missingNativeRiskVerdict('Native Portfolio-RiskEngine: verified account/history snapshot unavailable or stale');
 const snapshot:RiskSnapshot={
  asOf:now,equity:account.equity,peakEquity,cash:account.cash,
  positions:account.positions.map(p=>({pair:p.pair,marketValue:p.value})),
  daily:evidence.daily,btcHourly:evidence.btcHourly,
  feedConnected:evidence.feedConnected,feedLastAt:evidence.feedLastAt,
  reconnectsLastHour:evidence.reconnectsLastHour
 };
 return engine.evaluateBuy(pair,requestedDebit,snapshot);
}
